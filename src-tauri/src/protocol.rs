//! Messages between the UI and the engine side (charter section 6.1).
//!
//! These types are the single source of the protocol: `ts-rs` generates the TypeScript types in
//! `src/transport/generated/` from them. They cross a process or network boundary, so they never
//! carry file paths, and errors carry a code rather than user-facing text.

use aji_core::game::{AnalysisRules, GameInfo, Illegal, Preview};
use aji_core::{Color, Move, PositionKey};
use aji_engine::{AnalysisUpdate, EngineState};
pub use aji_manager::OsKind;
use aji_manager::hardware::HardwareReport;
use aji_manager::install::{
    ActiveSummary, DownloadSource, ImportedNetwork, JobSnapshot, LicenceInfo,
};
use aji_manager::manifest::Backend;
use aji_manager::recommend::{BackendRecommendation, EngineVersionChoice, NetworkList};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::game::{GameWarning, NavTarget, RulesState};
use crate::settings::UiSettings;

/// A request from the UI. Serialised as `{"type": "<camelCase variant>", ...fields}`, with
/// camelCase field names.
#[derive(Debug, Clone, PartialEq, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export)]
pub enum Request {
    AppInfo,
    EngineStatus,
    EngineRestart,
    EngineStop,
    AnalysisPause,
    AnalysisResume,
    /// The hardware report. `refresh` detects again, for example after a driver update.
    SetupDetect {
        #[serde(default)]
        refresh: bool,
    },
    SetupBackends,
    SetupVersions {
        backend: Backend,
    },
    SetupNetworks {
        engine: String,
    },
    /// The licences installing `engine` needs accepted.
    SetupLicences {
        engine: String,
    },
    /// Starts an install job. `accept_licences` are licence text hashes the user has just
    /// accepted; they are recorded in the settings first.
    SetupInstall {
        engine: String,
        network: String,
        accept_licences: Vec<String>,
        /// Measure the thread count with KataGo's benchmark. Settings asks for it; the wizard
        /// installs with the backend's default.
        #[serde(default)]
        benchmark: bool,
    },
    SetupCancel,
    /// The running install job, or the last one.
    SetupStatus,
    SetupSetDownloadSource {
        source: DownloadSource,
    },
    /// Asks the user for a network file and imports it.
    SetupImportNetwork,
    /// The active engine set and the size of everything it does not use.
    SetupInstalled,
    /// Deletes everything the active set does not use.
    SetupRemoveUnused,
    SettingsGet,
    /// Replaces the interface preferences.
    SettingsSet {
        settings: UiSettings,
    },
    /// Replaces the game with an empty board of `size` lines and the default rules.
    GameNew {
        size: u8,
    },
    /// Opens a file's first game. `bytes` is the file, base64-encoded.
    GameOpen {
        name: String,
        bytes: String,
    },
    GameNavigate {
        to: NavTarget,
    },
    /// The board after `moves` from the current node, colours alternating from the player to
    /// move. Changes nothing.
    GamePreview {
        moves: Vec<Move>,
    },
    /// The rules KataGo analyses this game with; `null` goes back to the file's reading.
    GameSetRules {
        rules: Option<AnalysisRules>,
    },
    GameSnapshot,
    /// The game as UTF-8 SGF text, with a file name to suggest.
    GameExport,
}

/// The answer to a [`Request`], tagged the same way.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export)]
pub enum Response {
    AppInfo(AppInfo),
    EngineStatus {
        engine: EngineState,
        /// The position the engine is analysing; `null` when it has none (an illegal position).
        position: Option<PositionKey>,
        /// The latest analysis of that position, if any has arrived.
        analysis: Option<AnalysisUpdate>,
    },
    SetupDetect {
        hardware: HardwareReport,
    },
    SetupBackends {
        recommendation: BackendRecommendation,
    },
    SetupVersions {
        versions: Vec<EngineVersionChoice>,
    },
    SetupNetworks {
        networks: NetworkList,
    },
    SetupLicences {
        licences: Vec<LicenceInfo>,
        /// The hashes among `licences` that were accepted before.
        accepted: Vec<String>,
    },
    SetupStatus {
        job: Option<JobSnapshot>,
    },
    SetupImportNetwork {
        /// `None` when the user cancelled the file dialog.
        network: Option<ImportedNetwork>,
    },
    SetupInstalled {
        active: Option<ActiveSummary>,
        #[ts(type = "number")]
        unused_bytes: u64,
    },
    SetupRemoved {
        #[ts(type = "number")]
        freed_bytes: u64,
    },
    Settings {
        settings: UiSettings,
    },
    /// The game after a `game*` request. `warnings` are what opening the file reported; only
    /// `gameOpen` and `gameSnapshot` carry them.
    Game {
        /// Boxed: a snapshot is far larger than any other reply.
        snapshot: Box<GameSnapshot>,
        warnings: Vec<GameWarning>,
    },
    GamePreview {
        preview: Preview,
    },
    GameExport {
        name: String,
        text: String,
    },
    Ok,
}

/// A message the engine side pushes to the UI without being asked, tagged the same way.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(tag = "type", rename_all = "camelCase")]
#[ts(export)]
pub enum AppEvent {
    EngineState {
        engine: EngineState,
    },
    AnalysisUpdate {
        analysis: AnalysisUpdate,
    },
    /// The install job changed.
    SetupProgress {
        job: JobSnapshot,
    },
    /// The interface preferences changed, here or in another client.
    SettingsChanged {
        settings: UiSettings,
    },
    /// The game changed, here or in another client.
    GameSnapshot {
        snapshot: GameSnapshot,
    },
}

/// Everything the UI shows about the open game at its current node (design 5.4).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct GameSnapshot {
    /// Increases on every change; a client ignores a snapshot older than the one it has.
    #[ts(type = "number")]
    pub revision: u64,
    /// The file name without `.sgf`; `null` for a new game. The UI composes the title.
    pub name: Option<String>,
    pub info: GameInfo,
    pub rules: RulesState,
    pub size: u8,
    /// Every point, row by row (`y * size + x`).
    pub stones: Vec<Option<Color>>,
    pub last_move: Option<Move>,
    pub next_color: Color,
    pub move_number: u32,
    /// The move number at the end of the main line.
    pub main_line_length: u32,
    pub at_start: bool,
    pub at_end: bool,
    /// The current node's move breaks the rules; KataGo does not analyse it.
    pub illegal: Option<Illegal>,
    /// Stones captured by Black, then by White.
    pub captures: [u32; 2],
    /// The position KataGo analyses; `null` on an illegal node.
    pub position_key: Option<PositionKey>,
    /// The game holds a move or a setup stone, so it can be saved.
    pub has_moves: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export)]
pub struct AppInfo {
    pub version: String,
    pub os: OsKind,
    pub arch: String,
}

/// A failed request. The UI shows text looked up from `code`; `message` is for logs only.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export)]
pub struct ProtocolError {
    pub code: ErrorCode,
    pub message: String,
    /// A value the UI puts in the text: only `sgfUnsupportedSize`'s size, as `19x13`.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ErrorCode {
    Internal,
    EngineNotConfigured,
    EngineNotRunning,
    SetupUnknownEngine,
    /// An install job is already running.
    SetupBusy,
    SetupUnknownNetwork,
    /// The chosen file is not a gzip file, so not a KataGo network.
    SetupImportFailed,
    SetupInvalidSource,
    /// An install job has the engine for its benchmark and test query.
    EngineBusy,
    /// A position with a point off the board.
    InvalidPosition,
    /// No game starts anywhere in the file.
    SgfNotAGame,
    /// The file records a game other than Go.
    SgfNotGo,
    /// The board is not square, or not 5 to 19 lines; `detail` is the size.
    SgfUnsupportedSize,
    /// The file is over 20 MB.
    SgfTooLarge,
    /// The game holds nothing to save.
    GameEmpty,
    FileReadFailed,
    FileWriteFailed,
    /// The file's name does not end in `.sgf`.
    FileNotSgf,
    /// A recent file that no longer exists.
    FileMissing,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn request_json_shape() {
        assert_eq!(
            serde_json::from_value::<Request>(json!({"type": "appInfo"})).unwrap(),
            Request::AppInfo
        );
        assert!(serde_json::from_value::<Request>(json!({"type": "nope"})).is_err());
    }

    #[test]
    fn response_json_shape() {
        let r = Response::AppInfo(AppInfo {
            version: "0.1.0".into(),
            os: OsKind::Macos,
            arch: "aarch64".into(),
        });
        assert_eq!(
            serde_json::to_value(r).unwrap(),
            json!({"type": "appInfo", "version": "0.1.0", "os": "macos", "arch": "aarch64"})
        );
    }

    #[test]
    fn engine_request_json_shapes() {
        for (name, request) in [
            ("engineStatus", Request::EngineStatus),
            ("engineRestart", Request::EngineRestart),
            ("engineStop", Request::EngineStop),
            ("analysisPause", Request::AnalysisPause),
            ("analysisResume", Request::AnalysisResume),
        ] {
            assert_eq!(
                serde_json::from_value::<Request>(json!({"type": name})).unwrap(),
                request
            );
        }
    }

    #[test]
    fn engine_status_json_shape() {
        assert_eq!(
            serde_json::to_value(Response::EngineStatus {
                engine: EngineState::NotConfigured,
                position: Some(aji_core::PositionKey(0x4d32_5c64_abd3_78a1)),
                analysis: None,
            })
            .unwrap(),
            json!({"type": "engineStatus", "engine": {"state": "notConfigured"},
                   "position": "4d325c64abd378a1", "analysis": null})
        );
    }

    #[test]
    fn engine_response_json_shapes() {
        assert_eq!(
            serde_json::to_value(Response::EngineStatus {
                engine: EngineState::NotConfigured,
                position: Some(aji_core::PositionKey(0x4d32_5c64_abd3_78a1)),
                analysis: None,
            })
            .unwrap(),
            json!({"type": "engineStatus", "engine": {"state": "notConfigured"},
                   "position": "4d325c64abd378a1", "analysis": null})
        );
        assert_eq!(
            serde_json::to_value(Response::Ok).unwrap(),
            json!({"type": "ok"})
        );
    }

    #[test]
    fn app_event_json_shapes() {
        assert_eq!(
            serde_json::to_value(AppEvent::EngineState {
                engine: EngineState::Stopped
            })
            .unwrap(),
            json!({"type": "engineState", "engine": {"state": "stopped"}})
        );
        let update = AnalysisUpdate {
            position: aji_core::PositionKey(7),
            board_size: 19,
            root_visits: 0,
            winrate: 0.5,
            score_lead: 0.0,
            is_final: false,
            candidates: vec![],
            previous_visits: 0,
        };
        let value = serde_json::to_value(AppEvent::AnalysisUpdate { analysis: update }).unwrap();
        assert_eq!(value["type"], "analysisUpdate");
        assert!(value["analysis"].is_object());
    }

    #[test]
    fn new_error_codes_json_shape() {
        assert_eq!(
            serde_json::to_value(ErrorCode::EngineNotConfigured).unwrap(),
            json!("engineNotConfigured")
        );
        assert_eq!(
            serde_json::to_value(ErrorCode::EngineNotRunning).unwrap(),
            json!("engineNotRunning")
        );
    }

    #[test]
    fn setup_request_json_shapes() {
        for (value, request) in [
            (
                json!({"type": "setupDetect"}),
                Request::SetupDetect { refresh: false },
            ),
            (
                json!({"type": "setupDetect", "refresh": true}),
                Request::SetupDetect { refresh: true },
            ),
            (json!({"type": "setupInstalled"}), Request::SetupInstalled),
            (
                json!({"type": "setupRemoveUnused"}),
                Request::SetupRemoveUnused,
            ),
            (json!({"type": "settingsGet"}), Request::SettingsGet),
            (
                json!({"type": "settingsSet", "settings": {"language": "en", "theme": "light",
                       "discLines": ["visits", "scoreLead"], "visitLimit": null,
                       "defaultRules": {"kind": "japaneseKorean"}}}),
                Request::SettingsSet {
                    settings: UiSettings {
                        language: crate::settings::LanguagePreference::En,
                        theme: crate::settings::ThemePreference::Light,
                        disc_lines: [
                            crate::settings::DiscField::Visits,
                            crate::settings::DiscField::ScoreLead,
                        ],
                        visit_limit: None,
                        default_rules: AnalysisRules::JapaneseKorean,
                    },
                },
            ),
            (json!({"type": "setupBackends"}), Request::SetupBackends),
            (
                json!({"type": "setupVersions", "backend": "cuda"}),
                Request::SetupVersions {
                    backend: Backend::Cuda,
                },
            ),
            (
                json!({"type": "setupNetworks", "engine": "katago-v1.18.2-metal-macos-arm64"}),
                Request::SetupNetworks {
                    engine: "katago-v1.18.2-metal-macos-arm64".into(),
                },
            ),
            (
                json!({"type": "setupLicences", "engine": "e"}),
                Request::SetupLicences { engine: "e".into() },
            ),
            (
                json!({"type": "setupInstall", "engine": "e", "network": "n",
                       "acceptLicences": []}),
                Request::SetupInstall {
                    engine: "e".into(),
                    network: "n".into(),
                    accept_licences: vec![],
                    benchmark: false,
                },
            ),
            (
                json!({"type": "setupInstall", "engine": "e", "network": "n",
                       "acceptLicences": [], "benchmark": true}),
                Request::SetupInstall {
                    engine: "e".into(),
                    network: "n".into(),
                    accept_licences: vec![],
                    benchmark: true,
                },
            ),
            (json!({"type": "setupCancel"}), Request::SetupCancel),
            (json!({"type": "setupStatus"}), Request::SetupStatus),
            (
                json!({"type": "setupSetDownloadSource",
                       "source": {"kind": "prefix", "url": "https://p.example/"}}),
                Request::SetupSetDownloadSource {
                    source: DownloadSource::Prefix {
                        url: "https://p.example/".into(),
                    },
                },
            ),
            (
                json!({"type": "setupImportNetwork"}),
                Request::SetupImportNetwork,
            ),
        ] {
            assert_eq!(serde_json::from_value::<Request>(value).unwrap(), request);
        }
    }

    fn snapshot() -> JobSnapshot {
        JobSnapshot {
            id: 1,
            engine: "e".into(),
            backend: Backend::Metal,
            network: "n".into(),
            tasks: vec![],
            outcome: None,
            measures: false,
            benchmark: None,
        }
    }

    #[test]
    fn setup_progress_event_json_shape() {
        let value = serde_json::to_value(AppEvent::SetupProgress { job: snapshot() }).unwrap();
        assert_eq!(
            value,
            json!({"type": "setupProgress", "job": {"id": 1, "engine": "e", "backend": "metal",
                   "network": "n", "tasks": [], "outcome": null, "measures": false, "benchmark": null}})
        );
    }

    #[test]
    fn setup_install_response_json_shapes() {
        assert_eq!(
            serde_json::to_value(Response::SetupStatus { job: None }).unwrap(),
            json!({"type": "setupStatus", "job": null})
        );
        assert_eq!(
            serde_json::to_value(Response::SetupLicences {
                licences: vec![LicenceInfo {
                    name: "EULA".into(),
                    url: "https://example.com/eula".into(),
                    text_sha256: "ab".into(),
                    components: vec![],
                }],
                accepted: vec!["ab".into()],
            })
            .unwrap(),
            json!({"type": "setupLicences", "accepted": ["ab"], "licences": [
                {"name": "EULA", "url": "https://example.com/eula", "textSha256": "ab",
                 "components": []}]})
        );
        assert_eq!(
            serde_json::to_value(Response::SetupImportNetwork { network: None }).unwrap(),
            json!({"type": "setupImportNetwork", "network": null})
        );
    }

    #[test]
    fn setup_install_error_codes_json_shape() {
        for (code, name) in [
            (ErrorCode::SetupBusy, "setupBusy"),
            (ErrorCode::SetupUnknownNetwork, "setupUnknownNetwork"),
            (ErrorCode::SetupImportFailed, "setupImportFailed"),
            (ErrorCode::SetupInvalidSource, "setupInvalidSource"),
        ] {
            assert_eq!(serde_json::to_value(code).unwrap(), json!(name));
        }
    }

    #[test]
    fn setup_response_json_shapes() {
        let versions = serde_json::to_value(Response::SetupVersions { versions: vec![] }).unwrap();
        assert_eq!(versions, json!({"type": "setupVersions", "versions": []}));
        let networks = serde_json::to_value(Response::SetupNetworks {
            networks: NetworkList {
                networks: vec![],
                preselected: None,
                human: None,
            },
        })
        .unwrap();
        assert_eq!(networks["type"], "setupNetworks");
        assert_eq!(networks["networks"]["preselected"], json!(null));
        let backends = serde_json::to_value(Response::SetupBackends {
            recommendation: BackendRecommendation {
                platform: None,
                gpu: None,
                backends: vec![],
                default: None,
                fallbacks: vec![],
                notes: vec![],
                driver: None,
            },
        })
        .unwrap();
        assert_eq!(backends["type"], "setupBackends");
        assert_eq!(backends["recommendation"]["default"], json!(null));
    }

    #[test]
    fn setup_unknown_engine_code_json_shape() {
        assert_eq!(
            serde_json::to_value(ErrorCode::SetupUnknownEngine).unwrap(),
            json!("setupUnknownEngine")
        );
    }

    #[test]
    fn error_json_shape() {
        let e = ProtocolError {
            code: ErrorCode::Internal,
            message: "boom".into(),
            detail: None,
        };
        assert_eq!(
            serde_json::to_value(e).unwrap(),
            json!({"code": "internal", "message": "boom"})
        );
    }

    #[test]
    fn m5_response_and_event_json_shapes() {
        assert_eq!(
            serde_json::to_value(Response::SetupInstalled {
                active: None,
                unused_bytes: 7,
            })
            .unwrap(),
            json!({"type": "setupInstalled", "active": null, "unusedBytes": 7})
        );
        assert_eq!(
            serde_json::to_value(Response::SetupRemoved { freed_bytes: 9 }).unwrap(),
            json!({"type": "setupRemoved", "freedBytes": 9})
        );
        let settings = UiSettings::default();
        assert_eq!(
            serde_json::to_value(Response::Settings {
                settings: settings.clone()
            })
            .unwrap(),
            json!({"type": "settings", "settings": {"language": "system", "theme": "system",
                   "discLines": ["winrate", "scoreLead"], "visitLimit": null,
                   "defaultRules": {"kind": "chinese"}}})
        );
        assert_eq!(
            serde_json::to_value(AppEvent::SettingsChanged { settings }).unwrap()["type"],
            "settingsChanged"
        );
        assert_eq!(
            serde_json::to_value(ErrorCode::EngineBusy).unwrap(),
            json!("engineBusy")
        );
    }
}
