//! Engine profiles (P2 M4 design 6): what the profile list shows, and the check an own-files
//! profile passes before it is added.

use std::ffi::OsString;
use std::path::Path;
use std::time::Duration;

use aji_engine::{LaunchSpec, RunLimits, run_to_end};
use serde::Serialize;
use ts_rs::TS;

use super::{Installed, ProfileKey};
use crate::manifest::Backend;

/// One profile, as the switcher and Settings list it.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProfileSummary {
    pub id: String,
    pub name: String,
    pub current: bool,
    pub source: ProfileSource,
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum ProfileSource {
    #[serde(rename_all = "camelCase")]
    Managed {
        engine: String,
        version: String,
        backend: Backend,
        network: String,
        network_name: String,
        threads: u32,
        /// The measured speed at `threads`; `None` until measured.
        visits_per_second: Option<f64>,
    },
    /// The user's own files, as display strings.
    #[serde(rename_all = "camelCase")]
    Own {
        katago: String,
        model: String,
        config: String,
    },
}

/// Which of the three own files a check refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum OwnFile {
    Katago,
    Model,
    Config,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum OwnProblem {
    Missing,
    NotKatago,
    Unreadable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OwnRefusal {
    pub file: OwnFile,
    pub problem: OwnProblem,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProfileError {
    NoSuchProfile,
    /// The current profile cannot be removed.
    Current,
    /// An install job runs.
    Busy,
    Own(OwnRefusal),
    Io(String),
}

/// How long `katago version` may take.
const VERSION_WAIT: Duration = Duration::from_secs(10);

/// The profiles in `installed`: sets first in record order, then own profiles.
pub fn summaries(installed: &Installed) -> Vec<ProfileSummary> {
    let current = installed.current_key();
    let sets = installed.sets.iter().filter_map(|set| {
        let engine = installed.engines.get(&set.engine)?;
        let network = installed.networks.get(&set.network)?;
        let key = ProfileKey::Set {
            engine: set.engine.clone(),
            network: set.network.clone(),
        };
        Some(ProfileSummary {
            id: key.id(),
            name: set.name.clone().unwrap_or_else(|| network.name.clone()),
            current: current.as_ref() == Some(&key),
            source: ProfileSource::Managed {
                engine: set.engine.clone(),
                version: engine.version.clone(),
                backend: engine.backend,
                network: set.network.clone(),
                network_name: network.name.clone(),
                threads: set.threads,
                visits_per_second: set
                    .benchmark
                    .iter()
                    .find(|s| s.threads == set.threads)
                    .map(|s| s.visits_per_second),
            },
        })
    });
    let own = installed.own.iter().map(|own| {
        let key = ProfileKey::Own { id: own.id.clone() };
        ProfileSummary {
            id: own.id.clone(),
            name: own.name.clone(),
            current: current.as_ref() == Some(&key),
            source: ProfileSource::Own {
                katago: own.katago.display().to_string(),
                model: own.model.display().to_string(),
                config: own.config.display().to_string(),
            },
        }
    });
    sets.chain(own).collect()
}

/// A network file's name without `.bin.gz` or `.txt.gz`, for an own profile's default name.
pub fn model_name(model: &Path) -> String {
    let name = model
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    [".bin.gz", ".txt.gz", ".gz"]
        .iter()
        .find_map(|ext| name.strip_suffix(ext))
        .unwrap_or(&name)
        .to_string()
}

/// Checks one's own files: each exists, the program answers `katago version`, and the network
/// and config can be read.
pub async fn check_own(katago: &Path, model: &Path, config: &Path) -> Result<(), OwnRefusal> {
    let refuse = |file, problem| Err(OwnRefusal { file, problem });
    for (path, file) in [
        (katago, OwnFile::Katago),
        (model, OwnFile::Model),
        (config, OwnFile::Config),
    ] {
        if !path.is_file() {
            return refuse(file, OwnProblem::Missing);
        }
    }
    if !answers_version(katago).await {
        return refuse(OwnFile::Katago, OwnProblem::NotKatago);
    }
    let (model, config) = (model.to_path_buf(), config.to_path_buf());
    let read = tokio::task::spawn_blocking(move || {
        if std::fs::read_to_string(&config).is_err() {
            return Some(OwnFile::Config);
        }
        aji_engine::identity_of(&model, &config)
            .err()
            .map(|_| OwnFile::Model)
    })
    .await
    .unwrap_or(Some(OwnFile::Model));
    match read {
        Some(file) => refuse(file, OwnProblem::Unreadable),
        None => Ok(()),
    }
}

async fn answers_version(katago: &Path) -> bool {
    let spec = LaunchSpec {
        program: katago.to_path_buf(),
        args: vec![OsString::from("version")],
        working_dir: katago.parent().map(Path::to_path_buf).unwrap_or_default(),
        env: Vec::new(),
    };
    let limits = RunLimits {
        stall: VERSION_WAIT,
        stderr_lines: 20,
    };
    match tokio::time::timeout(VERSION_WAIT, run_to_end(spec, limits)).await {
        Ok(Ok(output)) => {
            output.exit.code == Some(0)
                && output
                    .stdout
                    .lines()
                    .any(|line| line.trim_start().starts_with("KataGo v"))
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_models_name_loses_its_extensions() {
        assert_eq!(model_name(Path::new("/n/kata1-b28.bin.gz")), "kata1-b28");
        assert_eq!(model_name(Path::new("b18.txt.gz")), "b18");
        assert_eq!(model_name(Path::new("odd.gz")), "odd");
        assert_eq!(model_name(Path::new("plain")), "plain");
    }
}
