//! Persists installed apps and settings as JSON in the app data directory.

use crate::error::Result;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::{collections::HashMap, path::PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledApp {
    pub id: String,
    pub version: String,
    /// What to launch: an .app bundle, .exe, AppImage or command.
    pub path: String,
    /// app-bundle | nsis | msi | portable | appimage | deb
    pub kind: String,
    pub installed_at: u64,
    #[serde(default)]
    pub asset_name: String,
    /// False when Appetizer found the app on disk but did not install it.
    #[serde(default = "yes")]
    pub managed: bool,
}

fn yes() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub auto_update: bool,
    pub check_interval_hours: u32,
    pub launch_after_install: bool,
    pub catalog_url: String,
}

pub const DEFAULT_CATALOG_URL: &str =
    "https://raw.githubusercontent.com/fabianfreund/Appetizer-launcher/main/catalog.json";

impl Default for Settings {
    fn default() -> Self {
        Settings {
            auto_update: true,
            check_interval_hours: 6,
            launch_after_install: false,
            catalog_url: DEFAULT_CATALOG_URL.into(),
        }
    }
}

pub struct Store {
    dir: PathBuf,
    pub installed: HashMap<String, InstalledApp>,
    pub settings: Settings,
}

fn load<T: DeserializeOwned + Default>(path: &PathBuf) -> T {
    std::fs::read(path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn save<T: Serialize>(path: &PathBuf, value: &T) -> Result<()> {
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(value)?)?;
    std::fs::rename(tmp, path)?;
    Ok(())
}

impl Store {
    pub fn open(dir: PathBuf) -> Self {
        let _ = std::fs::create_dir_all(&dir);
        Store {
            installed: load(&dir.join("installed.json")),
            settings: load(&dir.join("settings.json")),
            dir,
        }
    }

    pub fn save_installed(&self) -> Result<()> {
        save(&self.dir.join("installed.json"), &self.installed)
    }

    pub fn save_settings(&self) -> Result<()> {
        save(&self.dir.join("settings.json"), &self.settings)
    }
}

pub fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}
