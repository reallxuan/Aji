//! `settings.json` in the app config directory: the development engine, the download source,
//! the accepted licences and the interface preferences. Each field is read on its own, so one
//! value Aji cannot read (a typo, or a value from a newer Aji) costs only that field.

use std::collections::BTreeMap;
use std::fmt;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use aji_core::game::AnalysisRules;
use aji_engine::EngineFiles;
use aji_manager::install::DownloadSource;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use ts_rs::TS;

/// The contents of `settings.json`. Unknown fields are ignored, and a missing or unreadable
/// field takes its default.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Settings {
    pub dev_engine: Option<DevEngine>,
    pub download_source: DownloadSource,
    /// The SHA-256 of each accepted licence text, to the RFC 3339 time it was accepted.
    pub accepted_licences: BTreeMap<String, String>,
    /// Stored flat: `language`, `theme`, `discLines`, `visitLimit`, `defaultRules` and
    /// `showCoordinates`.
    pub ui: UiSettings,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum LanguagePreference {
    #[default]
    System,
    #[serde(rename = "zh-CN")]
    #[ts(rename = "zh-CN")]
    ZhCn,
    En,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ThemePreference {
    #[default]
    System,
    Dark,
    Light,
}

/// A value a candidate disc can show on one of its two lines.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum DiscField {
    Winrate,
    ScoreLead,
    Visits,
}

/// The preferences the settings page edits.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct UiSettings {
    pub language: LanguagePreference,
    pub theme: ThemePreference,
    /// Two different fields, top line first.
    pub disc_lines: [DiscField; 2],
    /// The most visits per position; `None` for no limit.
    pub visit_limit: Option<u32>,
    /// The rules new games, and files that name neither rules nor komi, start with.
    pub default_rules: AnalysisRules,
    /// Coordinates in the board's margin; hidden, the margin shrinks to a thin edge.
    pub show_coordinates: bool,
}

impl Default for UiSettings {
    fn default() -> Self {
        UiSettings {
            language: LanguagePreference::System,
            theme: ThemePreference::System,
            disc_lines: [DiscField::Winrate, DiscField::ScoreLead],
            visit_limit: None,
            default_rules: AnalysisRules::Chinese,
            show_coordinates: true,
        }
    }
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
    Write(std::io::Error),
}

impl fmt::Display for SettingsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Read(e) => write!(f, "cannot read settings.json: {e}"),
            Self::Parse(e) => write!(f, "settings.json is not valid: {e}"),
            Self::RelativePath { field } => {
                write!(f, "devEngine.{field} must be an absolute path")
            }
            Self::Write(e) => write!(f, "cannot write settings.json: {e}"),
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
    let map: Map<String, Value> = serde_json::from_str(&text).map_err(SettingsError::Parse)?;
    let defaults = UiSettings::default();
    let settings = Settings {
        dev_engine: field(&map, "devEngine"),
        download_source: field(&map, "downloadSource").unwrap_or_default(),
        accepted_licences: field(&map, "acceptedLicences").unwrap_or_default(),
        ui: UiSettings {
            language: field(&map, "language").unwrap_or_default(),
            theme: field(&map, "theme").unwrap_or_default(),
            disc_lines: field::<[DiscField; 2]>(&map, "discLines")
                .filter(|[a, b]| a != b)
                .unwrap_or(defaults.disc_lines),
            visit_limit: field::<u32>(&map, "visitLimit").filter(|limit| *limit > 0),
            default_rules: field::<AnalysisRules>(&map, "defaultRules")
                .filter(AnalysisRules::is_valid)
                .unwrap_or_default(),
            show_coordinates: field(&map, "showCoordinates").unwrap_or(defaults.show_coordinates),
        },
    };
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

/// `map[key]` read as a `T`; `None` when it is missing, `null`, or not a `T`, which is logged.
fn field<T: DeserializeOwned>(map: &Map<String, Value>, key: &str) -> Option<T> {
    let value = map.get(key).filter(|v| !v.is_null())?;
    match serde_json::from_value(value.clone()) {
        Ok(value) => Some(value),
        Err(e) => {
            eprintln!("aji: settings.json: ignoring {key}: {e}");
            None
        }
    }
}

/// Writes the interface preferences, keeping every other field.
pub fn save_ui_settings(path: &Path, ui: &UiSettings) -> Result<(), SettingsError> {
    let value = serde_json::to_value(ui).map_err(SettingsError::Parse)?;
    update_settings(path, |map| {
        if let Value::Object(fields) = value {
            for (key, value) in fields {
                map.insert(key, value);
            }
        }
    })
}

/// Serialises every read-modify-write of `settings.json` in this process, so two requests
/// never lose each other's change.
static UPDATE: Mutex<()> = Mutex::new(());

/// Changes `settings.json` in place: `f` edits the top-level object. Fields Aji does not know
/// survive. A missing file, or folder, starts empty. A file that is not a JSON object is an
/// error and is left alone. The new text goes to a temporary file that is renamed over the old
/// one, so a crash leaves one or the other whole.
pub fn update_settings(
    path: &Path,
    f: impl FnOnce(&mut Map<String, Value>),
) -> Result<(), SettingsError> {
    let _update = UPDATE.lock().unwrap_or_else(|e| e.into_inner());
    let mut map = match fs::read_to_string(path) {
        Ok(text) => {
            serde_json::from_str::<Map<String, Value>>(&text).map_err(SettingsError::Parse)?
        }
        Err(e) if e.kind() == io::ErrorKind::NotFound => Map::new(),
        Err(e) => return Err(SettingsError::Read(e)),
    };
    f(&mut map);
    let mut text = serde_json::to_string_pretty(&map).map_err(SettingsError::Parse)?;
    text.push('\n');
    replace_file(path, &text).map_err(SettingsError::Write)
}

fn replace_file(path: &Path, text: &str) -> io::Result<()> {
    if let Some(dir) = path.parent().filter(|d| !d.as_os_str().is_empty()) {
        fs::create_dir_all(dir)?;
    }
    crate::platform::write_atomically(path, text)
}

/// Records `hashes` as accepted now, keeping the time of an earlier acceptance.
pub fn record_accepted_licences(path: &Path, hashes: &[String]) -> Result<(), SettingsError> {
    let now = rfc3339(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.as_secs()),
    );
    update_settings(path, |map| {
        let licences = map
            .entry("acceptedLicences")
            .or_insert_with(|| Value::Object(Map::new()));
        if !licences.is_object() {
            *licences = Value::Object(Map::new());
        }
        if let Value::Object(licences) = licences {
            for hash in hashes {
                licences
                    .entry(hash.clone())
                    .or_insert_with(|| Value::String(now.clone()));
            }
        }
    })
}

/// `secs` after the Unix epoch as an RFC 3339 UTC time, to the second.
fn rfc3339(secs: u64) -> String {
    let days = secs / 86_400;
    let (hour, minute, second) = (secs % 86_400 / 3600, secs % 3600 / 60, secs % 60);
    let (year, month, day) = civil_from_days(days);
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
}

/// The Gregorian date `days` after 1970-01-01. Counts in 400-year eras that start on
/// 0000-03-01, so the leap day is the last day of its year. The arithmetic is Howard Hinnant's
/// public-domain `civil_from_days` (<https://howardhinnant.github.io/date_algorithms.html>),
/// restricted to dates after 1970.
fn civil_from_days(days: u64) -> (u64, u64, u64) {
    // 1970-01-01 is day 719 468 after 0000-03-01; an era is 146 097 days.
    let z = days + 719_468;
    let era = z / 146_097;
    let day_of_era = z % 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    // Months counted from March: 0 is March, 11 is February.
    let month_from_march = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_from_march + 2) / 5 + 1;
    let month = if month_from_march < 10 {
        month_from_march + 3
    } else {
        month_from_march - 9
    };
    let year = era * 400 + year_of_era + u64::from(month <= 2);
    (year, month, day)
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

    #[test]
    fn the_download_source_defaults_to_direct() {
        let dir = tempfile::tempdir().unwrap();
        let settings = load_settings(&write(&dir, "{}")).unwrap();
        assert_eq!(settings.download_source, DownloadSource::Direct);
        assert!(settings.accepted_licences.is_empty());
        let json = serde_json::json!({
            "downloadSource": {"kind": "mirror", "url": "https://mirror.example/katago"},
            "acceptedLicences": {"abc": "2026-11-20T08:00:00Z"}
        });
        let settings = load_settings(&write(&dir, &json.to_string())).unwrap();
        assert_eq!(
            settings.download_source,
            DownloadSource::Mirror {
                url: "https://mirror.example/katago".into()
            }
        );
        assert_eq!(settings.accepted_licences["abc"], "2026-11-20T08:00:00Z");
    }

    #[test]
    fn update_settings_keeps_unknown_fields() {
        let dir = tempfile::tempdir().unwrap();
        let dev = serde_json::json!({
            "katago": abs("katago"), "model": abs("m.bin.gz"), "config": abs("a.cfg")});
        let json = serde_json::json!({"devEngine": dev, "future": 1});
        let path = write(&dir, &json.to_string());
        update_settings(&path, |map| {
            map.insert(
                "downloadSource".into(),
                serde_json::json!({"kind": "direct"}),
            );
        })
        .unwrap();
        let written: Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(written["devEngine"], dev);
        assert_eq!(written["future"], 1);
        assert_eq!(
            written["downloadSource"],
            serde_json::json!({"kind": "direct"})
        );
        assert!(load_settings(&path).unwrap().dev_engine.is_some());
        // Only settings.json is left: the temporary file was renamed into place.
        let names: Vec<_> = std::fs::read_dir(dir.path()).unwrap().collect();
        assert_eq!(names.len(), 1, "{names:?}");
    }

    #[test]
    fn a_missing_settings_file_is_created_by_an_update() {
        let dir = tempfile::tempdir().unwrap();
        // The config folder does not exist yet on a first run.
        let path = dir.path().join("config").join("settings.json");
        update_settings(&path, |map| {
            map.insert("future".into(), Value::from(2));
        })
        .unwrap();
        let written: Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(written, serde_json::json!({"future": 2}));
    }

    #[test]
    fn an_update_leaves_a_malformed_file_alone() {
        let dir = tempfile::tempdir().unwrap();
        for text in ["{not json", "[1, 2]"] {
            let path = write(&dir, text);
            let result = update_settings(&path, |map| {
                map.insert("future".into(), Value::from(2));
            });
            assert!(matches!(result, Err(SettingsError::Parse(_))), "{text}");
            assert_eq!(std::fs::read_to_string(&path).unwrap(), text);
        }
    }

    #[test]
    fn an_earlier_acceptance_keeps_its_time() {
        let dir = tempfile::tempdir().unwrap();
        let json = serde_json::json!({"acceptedLicences": {"old": "2026-01-01T00:00:00Z"}});
        let path = write(&dir, &json.to_string());
        record_accepted_licences(&path, &["old".into(), "new".into()]).unwrap();
        let accepted = load_settings(&path).unwrap().accepted_licences;
        assert_eq!(accepted["old"], "2026-01-01T00:00:00Z");
        assert_ne!(accepted["new"], "2026-01-01T00:00:00Z");
        assert_eq!(accepted.len(), 2);
    }

    #[test]
    fn rfc3339_times_are_utc_seconds() {
        assert_eq!(rfc3339(0), "1970-01-01T00:00:00Z");
        // A leap day, and a time of day.
        assert_eq!(rfc3339(1_709_210_096), "2024-02-29T12:34:56Z");
        assert_eq!(rfc3339(1_795_132_800), "2026-11-20T00:00:00Z");
        assert_eq!(rfc3339(951_868_799), "2000-02-29T23:59:59Z");
        assert_eq!(rfc3339(4_107_542_400), "2100-03-01T00:00:00Z");
    }
    // ------------------------------------------------------------ M5: interface preferences

    #[test]
    fn a_bad_field_falls_back_alone() {
        let dir = tempfile::tempdir().unwrap();
        let json = r#"{"theme":"sepia","language":"en","visitLimit":-5,
            "discLines":["visits","winrate"],"downloadSource":{"kind":"future"}}"#;
        let settings = load_settings(&write(&dir, json)).unwrap();
        assert_eq!(settings.ui.theme, ThemePreference::System);
        assert_eq!(settings.ui.language, LanguagePreference::En);
        assert_eq!(settings.ui.visit_limit, None);
        assert_eq!(
            settings.ui.disc_lines,
            [DiscField::Visits, DiscField::Winrate]
        );
        assert_eq!(settings.download_source, DownloadSource::Direct);
    }

    #[test]
    fn equal_disc_lines_fall_back_to_the_default() {
        let dir = tempfile::tempdir().unwrap();
        let settings = load_settings(&write(&dir, r#"{"discLines":["visits","visits"]}"#)).unwrap();
        assert_eq!(settings.ui.disc_lines, UiSettings::default().disc_lines);
    }

    #[test]
    fn zero_visit_limit_reads_as_none() {
        let dir = tempfile::tempdir().unwrap();
        let settings = load_settings(&write(&dir, r#"{"visitLimit":0}"#)).unwrap();
        assert_eq!(settings.ui.visit_limit, None);
        let settings = load_settings(&write(&dir, r#"{"visitLimit":5000}"#)).unwrap();
        assert_eq!(settings.ui.visit_limit, Some(5000));
    }

    #[test]
    fn ui_defaults() {
        assert_eq!(
            UiSettings::default(),
            UiSettings {
                language: LanguagePreference::System,
                theme: ThemePreference::System,
                disc_lines: [DiscField::Winrate, DiscField::ScoreLead],
                visit_limit: None,
                default_rules: AnalysisRules::Chinese,
                show_coordinates: true,
            }
        );
    }

    #[test]
    fn saving_ui_settings_keeps_unknown_fields() {
        let dir = tempfile::tempdir().unwrap();
        let path = write(
            &dir,
            r#"{"future":{"x":1},"downloadSource":{"kind":"direct"}}"#,
        );
        let ui = UiSettings {
            language: LanguagePreference::ZhCn,
            theme: ThemePreference::Dark,
            disc_lines: [DiscField::Winrate, DiscField::Visits],
            visit_limit: Some(5000),
            default_rules: AnalysisRules::JapaneseKorean,
            show_coordinates: false,
        };
        save_ui_settings(&path, &ui).unwrap();
        let value: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(value["future"], serde_json::json!({"x": 1}));
        assert_eq!(load_settings(&path).unwrap().ui, ui);
        let none = UiSettings {
            visit_limit: None,
            ..ui
        };
        save_ui_settings(&path, &none).unwrap();
        let value: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(value["visitLimit"], Value::Null);
    }

    #[test]
    fn ui_settings_json_shape() {
        let ui = UiSettings {
            language: LanguagePreference::ZhCn,
            theme: ThemePreference::Dark,
            disc_lines: [DiscField::Winrate, DiscField::Visits],
            visit_limit: Some(5000),
            default_rules: AnalysisRules::Custom {
                komi: aji_core::Komi::new(7.0).unwrap(),
                scoring: aji_core::game::Scoring::Territory,
            },
            show_coordinates: false,
        };
        assert_eq!(
            serde_json::to_value(&ui).unwrap(),
            serde_json::json!({"language":"zh-CN","theme":"dark",
                "discLines":["winrate","visits"],"visitLimit":5000,
                "defaultRules":{"kind":"custom","komi":7.0,"scoring":"territory"},
                "showCoordinates":false})
        );
        assert_eq!(
            serde_json::from_value::<UiSettings>(serde_json::to_value(&ui).unwrap()).unwrap(),
            ui
        );
    }

    // ------------------------------------------------------------ M7: coordinates

    #[test]
    fn show_coordinates_is_read_leniently() {
        let dir = tempfile::tempdir().unwrap();
        let read = |json: &str| {
            load_settings(&write(&dir, json))
                .unwrap()
                .ui
                .show_coordinates
        };
        assert!(read("{}"));
        assert!(!read(r#"{"showCoordinates":false}"#));
        assert!(read(r#"{"showCoordinates":true}"#));
        assert!(read(r#"{"showCoordinates":"no"}"#));
    }

    // ------------------------------------------------------------ M6: default rules

    #[test]
    fn default_rules_are_read_leniently() {
        let dir = tempfile::tempdir().unwrap();
        let settings = load_settings(&write(&dir, "{}")).unwrap();
        assert_eq!(settings.ui.default_rules, AnalysisRules::Chinese);
        let json = r#"{"theme":"dark","defaultRules":{"kind":"japaneseKorean"}}"#;
        let settings = load_settings(&write(&dir, json)).unwrap();
        assert_eq!(settings.ui.default_rules, AnalysisRules::JapaneseKorean);
        for bad in [
            r#"{"kind":"tromp"}"#,
            r#"{"kind":"custom","komi":7.3,"scoring":"area"}"#,
            r#"{"kind":"custom","komi":200,"scoring":"area"}"#,
            r#""chinese""#,
        ] {
            let json = format!(r#"{{"theme":"dark","visitLimit":800,"defaultRules":{bad}}}"#);
            let settings = load_settings(&write(&dir, &json)).unwrap();
            assert_eq!(settings.ui.default_rules, AnalysisRules::Chinese, "{bad}");
            assert_eq!(settings.ui.theme, ThemePreference::Dark, "{bad}");
            assert_eq!(settings.ui.visit_limit, Some(800), "{bad}");
        }
    }
}
