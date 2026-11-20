//! The development engine setting. Until the setup wizard of M5 exists, `settings.json` in the
//! app config directory names the KataGo files to run.

use std::fmt;
use std::path::{Path, PathBuf};

use aji_engine::EngineFiles;
use serde::Deserialize;

/// The contents of `settings.json`. Unknown fields are ignored.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub dev_engine: Option<DevEngine>,
}

/// The three files KataGo needs. All must be absolute in `settings.json`.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DevEngine {
    pub katago: PathBuf,
    pub model: PathBuf,
    pub config: PathBuf,
}

impl DevEngine {
    /// The working directory is the config's folder. KataGo gets the config by file name and the
    /// model relative to that folder when it lives inside it, so a non-ASCII profile path stays off
    /// its command line (roadmap 3.3). A model elsewhere keeps its absolute path. The KataGo binary
    /// is the program, not an argument, and stays absolute.
    pub fn files(&self) -> EngineFiles {
        let working_dir = self
            .config
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_default();
        let config = self
            .config
            .file_name()
            .map(PathBuf::from)
            .unwrap_or_else(|| self.config.clone());
        let model = self
            .model
            .strip_prefix(&working_dir)
            .map(Path::to_path_buf)
            .unwrap_or_else(|_| self.model.clone());
        EngineFiles {
            katago: self.katago.clone(),
            model,
            config,
            working_dir,
            path_prepend: Vec::new(),
        }
    }
}

#[derive(Debug)]
pub enum SettingsError {
    Read(std::io::Error),
    Parse(serde_json::Error),
    RelativePath { field: &'static str },
}

impl fmt::Display for SettingsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Read(e) => write!(f, "cannot read settings.json: {e}"),
            Self::Parse(e) => write!(f, "settings.json is not valid: {e}"),
            Self::RelativePath { field } => {
                write!(f, "devEngine.{field} must be an absolute path")
            }
        }
    }
}

impl std::error::Error for SettingsError {}

/// A missing file gives the default settings. Malformed JSON or a relative path is an error.
pub fn load_settings(path: &Path) -> Result<Settings, SettingsError> {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Settings::default()),
        Err(e) => return Err(SettingsError::Read(e)),
    };
    let settings: Settings = serde_json::from_str(&text).map_err(SettingsError::Parse)?;
    if let Some(dev) = &settings.dev_engine {
        for (field, path) in [
            ("katago", &dev.katago),
            ("model", &dev.model),
            ("config", &dev.config),
        ] {
            if !path.is_absolute() {
                return Err(SettingsError::RelativePath { field });
            }
        }
    }
    Ok(settings)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn abs(name: &str) -> String {
        let root = if cfg!(windows) { "C:\\aji" } else { "/aji" };
        format!("{root}{}{name}", std::path::MAIN_SEPARATOR)
    }

    fn write(dir: &tempfile::TempDir, text: &str) -> PathBuf {
        let path = dir.path().join("settings.json");
        std::fs::write(&path, text).unwrap();
        path
    }

    #[test]
    fn a_missing_file_gives_the_default() {
        let dir = tempfile::tempdir().unwrap();
        let settings = load_settings(&dir.path().join("settings.json")).unwrap();
        assert_eq!(settings, Settings::default());
        assert!(settings.dev_engine.is_none());
    }

    #[test]
    fn a_valid_file_gives_the_three_paths() {
        let dir = tempfile::tempdir().unwrap();
        let json = serde_json::json!({"devEngine": {
            "katago": abs("katago"), "model": abs("model.bin.gz"), "config": abs("a.cfg")}});
        let settings = load_settings(&write(&dir, &json.to_string())).unwrap();
        let dev = settings.dev_engine.unwrap();
        assert_eq!(dev.katago, PathBuf::from(abs("katago")));
        assert_eq!(dev.model, PathBuf::from(abs("model.bin.gz")));
        assert_eq!(dev.config, PathBuf::from(abs("a.cfg")));
        assert_eq!(
            dev.files().working_dir,
            PathBuf::from(abs("a.cfg")).parent().unwrap()
        );
    }

    #[test]
    fn a_relative_path_is_an_error() {
        let dir = tempfile::tempdir().unwrap();
        for relative in ["katago", "model", "config"] {
            let field = |name: &str, absolute: String| {
                if name == relative {
                    name.to_string()
                } else {
                    absolute
                }
            };
            let json = serde_json::json!({"devEngine": {
                "katago": field("katago", abs("katago")),
                "model": field("model", abs("m")),
                "config": field("config", abs("c"))}});
            let result = load_settings(&write(&dir, &json.to_string()));
            assert!(
                matches!(&result, Err(SettingsError::RelativePath { field }) if *field == relative),
                "{relative}: {result:?}"
            );
        }
    }

    fn dev(root: &Path, model: &Path) -> DevEngine {
        DevEngine {
            katago: root.join("katago"),
            model: model.to_path_buf(),
            config: root.join("b").join("analysis.cfg"),
        }
    }

    #[test]
    fn files_pass_the_config_and_model_relative_to_the_config_folder() {
        let root = std::env::temp_dir().join("a");
        let folder = root.join("b");
        let files = dev(&root, &folder.join("net.bin.gz")).files();
        assert_eq!(files.working_dir, folder);
        assert_eq!(files.config, PathBuf::from("analysis.cfg"));
        assert_eq!(files.model, PathBuf::from("net.bin.gz"));
        assert_eq!(files.katago, root.join("katago"));
    }

    #[test]
    fn a_model_in_a_subfolder_stays_relative() {
        let root = std::env::temp_dir().join("a");
        let model = root.join("b").join("nets").join("net.bin.gz");
        let files = dev(&root, &model).files();
        assert_eq!(files.model, Path::new("nets").join("net.bin.gz"));
    }

    #[test]
    fn a_model_outside_the_config_folder_stays_absolute() {
        let root = std::env::temp_dir().join("a");
        let model = std::env::temp_dir().join("elsewhere").join("net.bin.gz");
        let files = dev(&root, &model).files();
        assert_eq!(files.model, model);
    }

    #[test]
    fn malformed_json_is_an_error() {
        let dir = tempfile::tempdir().unwrap();
        assert!(load_settings(&write(&dir, "{not json")).is_err());
    }

    #[test]
    fn an_unknown_top_level_field_is_ignored() {
        let dir = tempfile::tempdir().unwrap();
        let settings = load_settings(&write(&dir, r#"{"future": 1}"#)).unwrap();
        assert_eq!(settings, Settings::default());
    }
}
