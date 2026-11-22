mod error;
mod github;
mod installer;
mod store;

use error::{Error, Result};
use futures_util::StreamExt;
use github::Release;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    time::{Duration, Instant},
};
use store::{InstalledApp, Settings, Store};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::{io::AsyncWriteExt, sync::Mutex};

const RELEASE_TTL: Duration = Duration::from_secs(10 * 60);

struct AppState {
    http: reqwest::Client,
    store: Mutex<Store>,
    releases: Mutex<HashMap<String, (Instant, Release)>>,
    busy: std::sync::Mutex<HashSet<String>>,
}

/// What the UI needs to know to install one catalog app.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppRef {
    id: String,
    name: String,
    repo: String,
    #[serde(default)]
    patterns: Vec<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress<'a> {
    id: &'a str,
    phase: &'a str,
    received: u64,
    total: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PlatformInfo {
    os: &'static str,
    arch: &'static str,
    version: &'static str,
}

#[tauri::command]
fn platform_info() -> PlatformInfo {
    PlatformInfo {
        os: github::current_os(),
        arch: std::env::consts::ARCH,
        version: env!("CARGO_PKG_VERSION"),
    }
}

#[tauri::command]
async fn fetch_catalog(state: State<'_, AppState>, url: String) -> Result<serde_json::Value> {
    if !url.starts_with("https://") {
        return Err(Error::msg("Catalog URL must use https"));
    }
    let res = state.http.get(&url).timeout(Duration::from_secs(15)).send().await?;
    if !res.status().is_success() {
        return Err(Error::msg(format!("Catalog returned HTTP {}", res.status().as_u16())));
    }
    Ok(res.json().await?)
}

async fn cached_release(state: &AppState, repo: &str, force: bool) -> Result<Release> {
    if !force {
        if let Some((at, r)) = state.releases.lock().await.get(repo) {
            if at.elapsed() < RELEASE_TTL {
                return Ok(r.clone());
            }
        }
    }
    let r = github::latest_release(&state.http, repo).await?;
    state.releases.lock().await.insert(repo.to_string(), (Instant::now(), r.clone()));
    Ok(r)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReleaseInfo {
    #[serde(flatten)]
    release: Release,
    /// The download Appetizer would use on this machine, if any.
    asset: Option<github::Asset>,
}

#[tauri::command]
async fn latest_release(
    state: State<'_, AppState>,
    app: AppRef,
    force: Option<bool>,
) -> Result<ReleaseInfo> {
    let release = cached_release(&state, &app.repo, force.unwrap_or(false)).await?;
    let asset = github::pick_asset(&release.assets, &app.patterns).cloned();
    Ok(ReleaseInfo { release, asset })
}

/// Installed apps from the registry, plus catalog apps found on disk.
#[tauri::command]
async fn installed_apps(
    state: State<'_, AppState>,
    known: Vec<AppRef>,
) -> Result<HashMap<String, InstalledApp>> {
    let mut store = state.store.lock().await;
    let mut changed = false;
    // Forget managed apps the user deleted by hand.
    store.installed.retain(|_, a| {
        let keep = a.kind == "deb" || a.path.is_empty() || std::path::Path::new(&a.path).exists();
        changed |= !keep;
        keep
    });
    for app in &known {
        if store.installed.contains_key(&app.id) {
            continue;
        }
        if let Some((path, version)) = installer::detect(&app.name).await {
            store.installed.insert(
                app.id.clone(),
                InstalledApp {
                    id: app.id.clone(),
                    version,
                    path,
                    kind: if cfg!(target_os = "macos") { "app-bundle".into() } else { "detected".into() },
                    installed_at: store::now(),
                    asset_name: String::new(),
                    managed: false,
                },
            );
        }
    }
    if changed {
        store.save_installed()?;
    }
    Ok(store.installed.clone())
}

struct BusyGuard<'a> {
    state: &'a AppState,
    id: String,
}

impl Drop for BusyGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut busy) = self.state.busy.lock() {
            busy.remove(&self.id);
        }
    }
}

fn mark_busy<'a>(state: &'a AppState, id: &str) -> Result<BusyGuard<'a>> {
    let inserted = state.busy.lock().map(|mut b| b.insert(id.to_string())).unwrap_or(false);
    if !inserted {
        return Err(Error::msg("Already working on this app"));
    }
    Ok(BusyGuard { state, id: id.to_string() })
}

#[tauri::command]
async fn install_app(handle: AppHandle, state: State<'_, AppState>, app: AppRef) -> Result<InstalledApp> {
    let _guard = mark_busy(&state, &app.id)?;
    let emit = |phase: &str, received: u64, total: u64| {
        let _ = handle.emit("install-progress", Progress { id: &app.id, phase, received, total });
    };
    emit("preparing", 0, 0);

    let release = cached_release(&state, &app.repo, true).await?;
    let asset = github::pick_asset(&release.assets, &app.patterns)
        .cloned()
        .ok_or_else(|| Error::msg(format!("No download for {} in {}", github::current_os(), release.tag)))?;

    // Download into a fresh work directory.
    let work = std::env::temp_dir().join("appetizer").join(&app.id);
    let _ = tokio::fs::remove_dir_all(&work).await;
    tokio::fs::create_dir_all(&work).await?;
    let safe_name: String =
        asset.name.chars().map(|c| if c.is_ascii_alphanumeric() || "-_.".contains(c) { c } else { '_' }).collect();
    let file_path = work.join(safe_name);

    let res = state.http.get(&asset.url).send().await?.error_for_status()?;
    let total = res.content_length().unwrap_or(asset.size);
    let mut file = tokio::fs::File::create(&file_path).await?;
    let mut stream = res.bytes_stream();
    let mut received = 0u64;
    let mut last = Instant::now();
    emit("downloading", 0, total);
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        file.write_all(&chunk).await?;
        received += chunk.len() as u64;
        if last.elapsed() > Duration::from_millis(80) {
            emit("downloading", received, total);
            last = Instant::now();
        }
    }
    file.flush().await?;
    drop(file);
    emit("downloading", received, total);

    // Install, quitting the app first and reopening it afterwards if it was running.
    emit("installing", received, total);
    let was_running = installer::is_running(&app.name).await;
    if was_running {
        installer::quit(&app.name).await;
    }
    let result = installer::install(&file_path, &app.name, &work).await;
    let _ = tokio::fs::remove_dir_all(&work).await;
    let installed = result?;

    let entry = InstalledApp {
        id: app.id.clone(),
        version: release.version.clone(),
        path: installed.path,
        kind: installed.kind,
        installed_at: store::now(),
        asset_name: asset.name.clone(),
        managed: true,
    };
    let launch_after = {
        let mut store = state.store.lock().await;
        store.installed.insert(app.id.clone(), entry.clone());
        store.save_installed()?;
        store.settings.launch_after_install
    };
    if (was_running || launch_after) && !entry.path.is_empty() {
        let _ = installer::launch(&entry.path).await;
    }
    emit("done", received, total);
    Ok(entry)
}

#[tauri::command]
async fn uninstall_app(state: State<'_, AppState>, app: AppRef) -> Result<()> {
    let _guard = mark_busy(&state, &app.id)?;
    let entry = state.store.lock().await.installed.get(&app.id).cloned();
    if let Some(e) = entry {
        installer::uninstall(&e.path, &e.kind, &app.name).await?;
    }
    let mut store = state.store.lock().await;
    store.installed.remove(&app.id);
    store.save_installed()
}

async fn installed_path(state: &AppState, id: &str) -> Result<String> {
    state
        .store
        .lock()
        .await
        .installed
        .get(id)
        .map(|a| a.path.clone())
        .ok_or_else(|| Error::msg("App is not installed"))
}

#[tauri::command]
async fn launch_app(state: State<'_, AppState>, id: String) -> Result<()> {
    installer::launch(&installed_path(&state, &id).await?).await
}

#[tauri::command]
async fn reveal_app(state: State<'_, AppState>, id: String) -> Result<()> {
    installer::reveal(&installed_path(&state, &id).await?).await
}

#[tauri::command]
async fn open_url(url: String) -> Result<()> {
    if !url.starts_with("https://") {
        return Err(Error::msg("Only https links can be opened"));
    }
    installer::open_with_system(&url).await
}

#[tauri::command]
async fn get_settings(state: State<'_, AppState>) -> Result<Settings> {
    Ok(state.store.lock().await.settings.clone())
}

#[tauri::command]
async fn save_settings(state: State<'_, AppState>, settings: Settings) -> Result<Settings> {
    let mut store = state.store.lock().await;
    store.settings = settings;
    store.save_settings()?;
    Ok(store.settings.clone())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            app.manage(AppState {
                http: github::client(),
                store: Mutex::new(Store::open(dir)),
                releases: Mutex::new(HashMap::new()),
                busy: std::sync::Mutex::new(HashSet::new()),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            platform_info,
            fetch_catalog,
            latest_release,
            installed_apps,
            install_app,
            uninstall_app,
            launch_app,
            reveal_app,
            open_url,
            get_settings,
            save_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Appetizer");
}
