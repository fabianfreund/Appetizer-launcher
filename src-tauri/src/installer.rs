//! Platform-specific install, uninstall, launch and detection.
//!
//! macOS: .dmg or .zip → .app copied into /Applications (or ~/Applications).
//! Windows: NSIS .exe (silent), .msi (passive) or portable .zip.
//! Linux: .AppImage into ~/.local/share/appetizer/apps with a desktop entry, or .deb via pkexec.

use crate::error::{Error, Result};
use std::path::{Path, PathBuf};
use tokio::process::Command;

pub struct Installed {
    pub path: String,
    pub kind: String,
}

async fn run(cmd: &mut Command) -> Result<String> {
    let out = cmd.output().await?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        let err = err.trim();
        return Err(Error::msg(if err.is_empty() {
            format!("Command failed ({})", out.status)
        } else {
            err.lines().last().unwrap_or(err).to_string()
        }));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn ext(file: &Path) -> String {
    let n = file.file_name().and_then(|n| n.to_str()).unwrap_or("").to_lowercase();
    for e in [".appimage", ".dmg", ".zip", ".exe", ".msi", ".deb"] {
        if n.ends_with(e) {
            return e.trim_start_matches('.').to_string();
        }
    }
    String::new()
}

fn unsupported(file: &Path) -> Error {
    Error::msg(format!(
        "Don't know how to install \"{}\" on this platform",
        file.file_name().and_then(|n| n.to_str()).unwrap_or("?")
    ))
}

/// Opens a URL or file with the system handler.
pub async fn open_with_system(target: &str) -> Result<()> {
    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = Command::new("open");
        c.arg(target);
        c
    };
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = Command::new("rundll32");
        c.args(["url.dll,FileProtocolHandler", target]);
        c
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = {
        let mut c = Command::new("xdg-open");
        c.arg(target);
        c
    };
    cmd.spawn()?;
    Ok(())
}

// ───────────────────────────── macOS ─────────────────────────────

#[cfg(target_os = "macos")]
mod platform {
    use super::*;

    fn applications_dir() -> PathBuf {
        let system = PathBuf::from("/Applications");
        let probe = system.join(".appetizer-write-test");
        if std::fs::write(&probe, b"").is_ok() {
            let _ = std::fs::remove_file(probe);
            return system;
        }
        let user = home().join("Applications");
        let _ = std::fs::create_dir_all(&user);
        user
    }

    fn home() -> PathBuf {
        std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| "/tmp".into())
    }

    fn find_app(dir: &Path, name: &str) -> Option<PathBuf> {
        let apps: Vec<PathBuf> = std::fs::read_dir(dir)
            .ok()?
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.extension().is_some_and(|e| e == "app"))
            .collect();
        apps.iter()
            .find(|p| p.file_stem().is_some_and(|s| s.eq_ignore_ascii_case(name)))
            .or(apps.first())
            .cloned()
    }

    pub async fn is_running(name: &str) -> bool {
        Command::new("osascript")
            .args(["-e", &format!("application \"{}\" is running", name.replace('"', ""))])
            .output()
            .await
            .map(|o| String::from_utf8_lossy(&o.stdout).trim() == "true")
            .unwrap_or(false)
    }

    pub async fn quit(name: &str) {
        let name = name.replace('"', "");
        let script = format!("if application \"{name}\" is running then tell application \"{name}\" to quit");
        let _ = Command::new("osascript").args(["-e", &script]).output().await;
        for _ in 0..20 {
            if !is_running(&name).await {
                return;
            }
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        }
    }

    async fn place_bundle(src: &Path) -> Result<PathBuf> {
        let file = src.file_name().ok_or_else(|| Error::msg("Bad app bundle"))?;
        let dest = applications_dir().join(file);
        let staging = dest.with_extension("appetizer-staging");
        let _ = std::fs::remove_dir_all(&staging);
        run(Command::new("ditto").arg(src).arg(&staging)).await?;
        if dest.exists() {
            std::fs::remove_dir_all(&dest)?;
        }
        std::fs::rename(&staging, &dest)?;
        let _ = Command::new("xattr").args(["-dr", "com.apple.quarantine"]).arg(&dest).output().await;
        Ok(dest)
    }

    pub async fn install(file: &Path, name: &str, work: &Path) -> Result<Installed> {
        let bundle = match ext(file).as_str() {
            "dmg" => {
                let mount = work.join("mount");
                std::fs::create_dir_all(&mount)?;
                run(Command::new("hdiutil")
                    .args(["attach", "-nobrowse", "-noautoopen", "-readonly", "-mountpoint"])
                    .arg(&mount)
                    .arg(file))
                .await?;
                let result = match find_app(&mount, name) {
                    Some(app) => place_bundle(&app).await,
                    None => Err(Error::msg("No app found inside the disk image")),
                };
                let _ = Command::new("hdiutil").arg("detach").arg(&mount).arg("-force").output().await;
                result?
            }
            "zip" => {
                let out = work.join("unzipped");
                run(Command::new("ditto").args(["-x", "-k"]).arg(file).arg(&out)).await?;
                let app = find_app(&out, name).ok_or_else(|| Error::msg("No app found inside the archive"))?;
                place_bundle(&app).await?
            }
            _ => return Err(unsupported(file)),
        };
        Ok(Installed { path: bundle.to_string_lossy().into(), kind: "app-bundle".into() })
    }

    pub async fn uninstall(path: &str, _kind: &str, name: &str) -> Result<()> {
        quit(name).await;
        let p = Path::new(path);
        if p.extension().is_some_and(|e| e == "app") && p.exists() {
            std::fs::remove_dir_all(p)?;
        }
        Ok(())
    }

    pub async fn launch(path: &str) -> Result<()> {
        run(Command::new("open").arg(path)).await.map(|_| ())
    }

    pub async fn reveal(path: &str) -> Result<()> {
        run(Command::new("open").arg("-R").arg(path)).await.map(|_| ())
    }

    /// Finds an app installed outside Appetizer and reads its version.
    pub async fn detect(name: &str) -> Option<(String, String)> {
        for dir in [PathBuf::from("/Applications"), home().join("Applications")] {
            let app = dir.join(format!("{name}.app"));
            if app.exists() {
                let plist = app.join("Contents/Info.plist");
                let version = Command::new("plutil")
                    .args(["-extract", "CFBundleShortVersionString", "raw", "-o", "-"])
                    .arg(&plist)
                    .output()
                    .await
                    .ok()
                    .filter(|o| o.status.success())
                    .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
                    .unwrap_or_default();
                return Some((app.to_string_lossy().into(), version));
            }
        }
        None
    }
}

// ───────────────────────────── Windows ─────────────────────────────

#[cfg(target_os = "windows")]
mod platform {
    use super::*;

    fn env_dir(key: &str) -> Option<PathBuf> {
        std::env::var_os(key).map(PathBuf::from)
    }

    fn portable_root() -> PathBuf {
        env_dir("LOCALAPPDATA").unwrap_or_else(std::env::temp_dir).join("Appetizer").join("Apps")
    }

    /// Where NSIS / MSI installers usually put an app called `name`.
    fn find_exe(name: &str) -> Option<PathBuf> {
        let exe = format!("{name}.exe");
        let roots = [
            env_dir("LOCALAPPDATA").map(|p| p.join("Programs")),
            env_dir("ProgramFiles"),
            env_dir("ProgramFiles(x86)"),
        ];
        for root in roots.into_iter().flatten() {
            let direct = root.join(name).join(&exe);
            if direct.exists() {
                return Some(direct);
            }
        }
        None
    }

    fn find_exe_in(dir: &Path, name: &str) -> Option<PathBuf> {
        let mut stack = vec![dir.to_path_buf()];
        let mut first = None;
        while let Some(d) = stack.pop() {
            let Ok(entries) = std::fs::read_dir(&d) else { continue };
            for e in entries.flatten() {
                let p = e.path();
                if p.is_dir() {
                    stack.push(p);
                } else if p.extension().is_some_and(|x| x.eq_ignore_ascii_case("exe")) {
                    if p.file_stem().is_some_and(|s| s.to_string_lossy().eq_ignore_ascii_case(name)) {
                        return Some(p);
                    }
                    let stem = p.file_stem().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default();
                    if first.is_none() && !stem.contains("unins") && !stem.contains("update") {
                        first = Some(p);
                    }
                }
            }
        }
        first
    }

    pub async fn quit(name: &str) {
        let _ = Command::new("taskkill").args(["/IM", &format!("{name}.exe"), "/F"]).output().await;
    }

    pub async fn install(file: &Path, name: &str, _work: &Path) -> Result<Installed> {
        match ext(file).as_str() {
            "exe" => {
                quit(name).await;
                // NSIS (electron-builder and most others) understands /S for silent installs.
                run(Command::new(file).arg("/S")).await?;
                let path = find_exe(name).map(|p| p.to_string_lossy().into()).unwrap_or_default();
                Ok(Installed { path, kind: "nsis".into() })
            }
            "msi" => {
                run(Command::new("msiexec").arg("/i").arg(file).args(["/passive", "/norestart"])).await?;
                let path = find_exe(name).map(|p| p.to_string_lossy().into()).unwrap_or_default();
                Ok(Installed { path, kind: "msi".into() })
            }
            "zip" => {
                quit(name).await;
                let dest = portable_root().join(name);
                let _ = std::fs::remove_dir_all(&dest);
                std::fs::create_dir_all(&dest)?;
                let f = std::fs::File::open(file)?;
                zip::ZipArchive::new(f)?.extract(&dest)?;
                let exe = find_exe_in(&dest, name).ok_or_else(|| Error::msg("No program found in the archive"))?;
                Ok(Installed { path: exe.to_string_lossy().into(), kind: "portable".into() })
            }
            _ => Err(unsupported(file)),
        }
    }

    pub async fn uninstall(path: &str, kind: &str, name: &str) -> Result<()> {
        quit(name).await;
        let p = Path::new(path);
        match kind {
            "portable" => {
                if let Some(dir) = p.parent().filter(|d| d.starts_with(portable_root())) {
                    std::fs::remove_dir_all(dir)?;
                }
                Ok(())
            }
            _ => {
                let uninstaller = p.parent().and_then(|dir| {
                    std::fs::read_dir(dir).ok()?.flatten().map(|e| e.path()).find(|f| {
                        let n = f.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
                        n.starts_with("unins") && n.ends_with(".exe")
                    })
                });
                match uninstaller {
                    Some(u) => run(Command::new(u).arg("/S")).await.map(|_| ()),
                    // No uninstaller next to the exe (e.g. MSI installs): hand over to Windows
                    // and keep the app listed until it's really gone.
                    None => {
                        open_with_system("ms-settings:appsfeatures").await?;
                        Err(Error::msg(format!("Finish removing {name} in Settings → Apps")))
                    }
                }
            }
        }
    }

    pub async fn launch(path: &str) -> Result<()> {
        if path.is_empty() {
            return Err(Error::msg("Could not find the program to start"));
        }
        Command::new(path).spawn()?;
        Ok(())
    }

    pub async fn reveal(path: &str) -> Result<()> {
        use std::os::windows::process::CommandExt;
        if path.is_empty() {
            return Err(Error::msg("Could not find where the app is installed"));
        }
        // explorer parses /select itself; Rust's default quoting of the whole token breaks it.
        std::process::Command::new("explorer").raw_arg(format!("/select,\"{path}\"")).spawn()?;
        Ok(())
    }

    pub async fn detect(name: &str) -> Option<(String, String)> {
        find_exe(name).map(|p| (p.to_string_lossy().into(), String::new()))
    }
}

// ───────────────────────────── Linux ─────────────────────────────

#[cfg(all(unix, not(target_os = "macos")))]
mod platform {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn data_home() -> PathBuf {
        std::env::var_os("XDG_DATA_HOME").map(PathBuf::from).unwrap_or_else(|| {
            std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| "/tmp".into()).join(".local/share")
        })
    }

    fn apps_dir() -> PathBuf {
        data_home().join("appetizer/apps")
    }

    fn desktop_file(id_or_name: &str) -> PathBuf {
        data_home().join("applications").join(format!("appetizer-{}.desktop", id_or_name.to_lowercase()))
    }

    pub async fn quit(name: &str) {
        let pattern = format!("{}.AppImage", name.to_lowercase());
        let _ = Command::new("pkill").args(["-f", &pattern]).output().await;
        for _ in 0..20 {
            let alive = Command::new("pgrep").args(["-f", &pattern]).output().await.map(|o| o.status.success()).unwrap_or(false);
            if !alive {
                return;
            }
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        }
    }

    pub async fn install(file: &Path, name: &str, _work: &Path) -> Result<Installed> {
        match ext(file).as_str() {
            "appimage" => {
                quit(name).await;
                let dir = apps_dir();
                std::fs::create_dir_all(&dir)?;
                let dest = dir.join(format!("{}.AppImage", name.to_lowercase()));
                // Copy next to the target, then rename over it: never write into a running binary.
                let staging = dest.with_extension("AppImage.appetizer-new");
                std::fs::copy(file, &staging)?;
                std::fs::set_permissions(&staging, std::fs::Permissions::from_mode(0o755))?;
                std::fs::rename(&staging, &dest)?;
                let entry = format!(
                    "[Desktop Entry]\nType=Application\nName={name}\nExec=\"{}\" %U\nTerminal=false\nCategories=Utility;\nX-Appetizer=true\n",
                    dest.display()
                );
                let df = desktop_file(name);
                if let Some(parent) = df.parent() {
                    std::fs::create_dir_all(parent)?;
                }
                std::fs::write(df, entry)?;
                Ok(Installed { path: dest.to_string_lossy().into(), kind: "appimage".into() })
            }
            "deb" => {
                let pkg = run(Command::new("dpkg-deb").args(["-f"]).arg(file).arg("Package")).await?;
                run(Command::new("pkexec").args(["dpkg", "-i"]).arg(file)).await?;
                Ok(Installed { path: pkg, kind: "deb".into() })
            }
            _ => Err(unsupported(file)),
        }
    }

    pub async fn uninstall(path: &str, kind: &str, name: &str) -> Result<()> {
        quit(name).await;
        match kind {
            "deb" => run(Command::new("pkexec").args(["dpkg", "-r", path])).await.map(|_| ()),
            _ => {
                let p = Path::new(path);
                if p.starts_with(apps_dir()) && p.exists() {
                    std::fs::remove_file(p)?;
                }
                let _ = std::fs::remove_file(desktop_file(name));
                Ok(())
            }
        }
    }

    pub async fn launch(path: &str) -> Result<()> {
        if path.contains('/') {
            Command::new(path).spawn()?;
        } else {
            // .deb installs store the package name; most packages ship a binary with that name.
            Command::new(path).spawn().map_err(|_| Error::msg("Could not start the app. Open it from your app menu."))?;
        }
        Ok(())
    }

    pub async fn reveal(path: &str) -> Result<()> {
        let dir = Path::new(path).parent().map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
        open_with_system(&dir).await
    }

    pub async fn detect(name: &str) -> Option<(String, String)> {
        let p = apps_dir().join(format!("{}.AppImage", name.to_lowercase()));
        p.exists().then(|| (p.to_string_lossy().into(), String::new()))
    }
}

pub use platform::{detect, install, launch, quit, reveal, uninstall};

#[cfg(target_os = "macos")]
pub use platform::is_running;

#[cfg(not(target_os = "macos"))]
pub async fn is_running(_name: &str) -> bool {
    false
}
