//! Fetches stable releases from GitHub and picks the right download for this machine.

use crate::error::{Error, Result};
use regex::RegexBuilder;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Asset {
    pub name: String,
    pub url: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Release {
    pub tag: String,
    pub version: String,
    pub name: String,
    pub notes: String,
    pub published_at: String,
    pub html_url: String,
    pub assets: Vec<Asset>,
}

#[derive(Deserialize)]
struct GhAsset {
    name: String,
    browser_download_url: String,
    size: u64,
}

#[derive(Deserialize)]
struct GhRelease {
    tag_name: String,
    name: Option<String>,
    body: Option<String>,
    published_at: Option<String>,
    html_url: String,
    assets: Vec<GhAsset>,
}

pub fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(concat!("Appetizer/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(std::time::Duration::from_secs(15))
        .build()
        .expect("http client")
}

fn valid_repo(repo: &str) -> bool {
    let mut parts = repo.split('/');
    let ok = |s: Option<&str>| {
        s.is_some_and(|s| {
            !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
        })
    };
    ok(parts.next()) && ok(parts.next()) && parts.next().is_none()
}

/// `releases/latest` only returns the newest published, non-draft, non-prerelease release.
pub async fn latest_release(http: &reqwest::Client, repo: &str) -> Result<Release> {
    if !valid_repo(repo) {
        return Err(Error::msg(format!("Invalid repository \"{repo}\"")));
    }
    let mut req = http
        .get(format!("https://api.github.com/repos/{repo}/releases/latest"))
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28");
    if let Ok(token) = std::env::var("GITHUB_TOKEN") {
        if !token.is_empty() {
            req = req.bearer_auth(token);
        }
    }
    let res = req.send().await?;
    match res.status().as_u16() {
        200 => {}
        404 => return Err(Error::msg("No stable release published yet")),
        403 | 429 => {
            return Err(Error::msg(
                "GitHub rate limit reached. Try again in a few minutes.",
            ))
        }
        s => return Err(Error::msg(format!("GitHub returned HTTP {s}"))),
    }
    let gh: GhRelease = res.json().await?;
    Ok(Release {
        version: normalize_version(&gh.tag_name),
        name: gh.name.filter(|n| !n.trim().is_empty()).unwrap_or_else(|| gh.tag_name.clone()),
        tag: gh.tag_name,
        notes: gh.body.unwrap_or_default(),
        published_at: gh.published_at.unwrap_or_default(),
        html_url: gh.html_url,
        assets: gh
            .assets
            .into_iter()
            .map(|a| Asset { name: a.name, url: a.browser_download_url, size: a.size })
            .collect(),
    })
}

pub fn normalize_version(tag: &str) -> String {
    let t = tag.trim();
    let t = t.rsplit_once(['@', '/']).map(|(_, v)| v).unwrap_or(t);
    t.trim_start_matches(['v', 'V']).to_string()
}

pub fn current_os() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    }
}

fn default_patterns(os: &str) -> Vec<&'static str> {
    match os {
        "macos" => vec![r"\.dmg$", r"(mac|darwin|osx|macos).*\.zip$"],
        "windows" => vec![r"setup.*\.exe$", r"\.exe$", r"\.msi$", r"(win|windows).*\.zip$"],
        _ => vec![r"\.appimage$", r"\.deb$"],
    }
}

const JUNK: [&str; 9] =
    [".blockmap", ".yml", ".yaml", ".sig", ".sha256", ".sha512", ".txt", ".json", ".asc"];

fn arch_score(name: &str) -> i32 {
    let n = name.to_lowercase();
    let arm = ["arm64", "aarch64", "apple-silicon"].iter().any(|t| n.contains(t));
    let x64 = ["x64", "x86_64", "amd64", "intel", "win64"].iter().any(|t| n.contains(t));
    let universal = n.contains("universal");
    let on_arm = cfg!(target_arch = "aarch64");
    match (arm, x64, universal) {
        (_, _, true) => 3,
        (true, false, _) if on_arm => 4,
        (false, true, _) if !on_arm => 4,
        (false, false, _) => 2, // no arch in the name, usually fine
        _ => 0,                 // other architecture: last resort (Rosetta / emulation)
    }
}

/// Picks the best asset: first pattern with matches wins, ties broken by architecture.
pub fn pick_asset<'a>(assets: &'a [Asset], patterns: &[String]) -> Option<&'a Asset> {
    let os = current_os();
    let defaults: Vec<String> = default_patterns(os).into_iter().map(String::from).collect();
    let patterns = if patterns.is_empty() { &defaults } else { patterns };
    let usable: Vec<&Asset> = assets
        .iter()
        .filter(|a| {
            let n = a.name.to_lowercase();
            !JUNK.iter().any(|j| n.ends_with(j))
        })
        .collect();
    for p in patterns {
        let Ok(re) = RegexBuilder::new(p).case_insensitive(true).build() else { continue };
        let best = usable
            .iter()
            .filter(|a| re.is_match(&a.name))
            .max_by_key(|a| arch_score(&a.name));
        if let Some(a) = best {
            return Some(a);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions() {
        assert_eq!(normalize_version("oneshot@v2.1.0"), "2.1.0");
    }

    #[test]
    fn picks_by_arch() {
        let a = |n: &str| Asset { name: n.into(), url: String::new(), size: 0 };
        let assets = vec![
            a("OneShot-1.0.0-arm64.dmg"),
            a("OneShot-1.0.0-arm64.dmg.blockmap"),
            a("OneShot-1.0.0.dmg"),
            a("latest-mac.yml"),
        ];
        let pick = pick_asset(&assets, &[r"\.dmg$".into()]).unwrap();
        if cfg!(target_arch = "aarch64") {
            assert_eq!(pick.name, "OneShot-1.0.0-arm64.dmg");
        } else {
            assert_eq!(pick.name, "OneShot-1.0.0.dmg");
        }
    }
}
