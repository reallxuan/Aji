//! Messages between the UI and the engine side (charter section 6.1).
//!
//! These types are the single source of the protocol: `ts-rs` generates the TypeScript types in
//! `src/transport/generated/` from them. They cross a process or network boundary, so they never
//! carry file paths, and errors carry a code rather than user-facing text.

use aji_core::game::{AnalysisRules, GameInfo, Illegal, Preview, Score};
use aji_core::{Color, Move, Point, PositionKey};
use aji_engine::{AnalysisUpdate, CacheStats, EngineState, Loss, Rejection, TrendStats};
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
use crate::job::{JobOptions, JobProgress};
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
    /// Searches the current position past its visit limit, by one more limit.
    AnalysisContinue,
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
    /// The cached result of every main-line node, for the trend graph.
    GameTrend,
    /// Analyses the main line (P2 M2 design 5.3), replacing a running job.
    JobStart {
        options: JobOptions,
    },
    JobStop,
    /// Forgets results; `game` and `all` stop a running job.
    CacheClear {
        scope: CacheScope,
    },
    CacheStats,
    /// The current position's score: KataGo's estimate, or the final count with `dead` removed.
    GameScore {
        mode: ScoreMode,
    },
}

/// Which results `cacheClear` forgets.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum CacheScope {
    /// The current position's.
    Position,
    /// The main line's positions.
    Game,
    /// Every result, for every engine.
    All,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum ScoreMode {
    /// From the current position's ownership.
    Estimate,
    /// The stones the user marked dead removed, regions flood-filled.
    Final { dead: Vec<Point> },
}

/// A score, with the stones the ownership suggests are dead (empty without ownership).
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ScoreView {
    #[serde(flatten)]
    #[ts(flatten)]
    pub score: Score,
    pub suggested_dead: Vec<Point>,
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
        /// KataGo refused that position.
        rejected: Option<Rejection>,
        /// What the engine runs, for the engine card; `null` with no engine.
        running: Option<RunningEngine>,
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
    Trend {
        /// The session revision the line was read at; `trendNodes` with another are stale.
        #[ts(type = "number")]
        revision: u64,
        nodes: Vec<TrendNode>,
    },
    CacheStats(CacheStats),
    Score(ScoreView),
    Ok,
}

/// One main-line node in the trend graph (design 5.3). Several nodes can share a move number:
/// setup and comment-only nodes carry no move.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TrendNode {
    pub move_number: u32,
    /// Who played the node's move; `null` on a node without one.
    pub mover: Option<Color>,
    #[serde(rename = "move")]
    #[ts(rename = "move")]
    pub mv: Option<Move>,
    /// The engine's cached result for the node's position; `null` when it has none.
    pub stats: Option<TrendStats>,
    /// The node's move's loss (design 5.1); `null` without a move or results.
    pub loss: Option<Loss>,
}

/// A trend node whose result changed, by its index on the main line.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TrendNodeUpdate {
    pub line_index: u32,
    pub stats: Option<TrendStats>,
    pub loss: Option<Loss>,
}

/// The engine files' names, as the engine card shows them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RunningEngine {
    /// `null` for a development engine.
    pub backend: Option<Backend>,
    pub network_name: String,
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
    /// KataGo refused the current position.
    AnalysisRejected {
        rejection: Rejection,
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
    /// The main line's positions, or the engine's results, changed wholesale: a game was opened
    /// or created, its rules changed, or the engine's files changed.
    GameTrend {
        #[ts(type = "number")]
        revision: u64,
        nodes: Vec<TrendNode>,
    },
    /// Some nodes of the trend's line got results: the line read at `revision`.
    TrendNodes {
        #[ts(type = "number")]
        revision: u64,
        nodes: Vec<TrendNodeUpdate>,
    },
    JobProgress {
        progress: JobProgress,
    },
    /// The results cache changed size or fell back to memory.
    CacheStatus {
        status: CacheStats,
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
    /// The current node's index in the main line: its slot in the trend graph.
    pub line_index: u32,
    /// The move actually played next in the record; `null` at the end, or when a node in
    /// between changes the board without a move.
    pub next_move: Option<Move>,
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
    /// The position has no ownership yet to estimate a score from.
    ScoreUnavailable,
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
            ("analysisContinue", Request::AnalysisContinue),
            ("gameTrend", Request::GameTrend),
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
                rejected: None,
                running: None,
            })
            .unwrap(),
            json!({"type": "engineStatus", "engine": {"state": "notConfigured"},
                   "position": "4d325c64abd378a1", "analysis": null,
                   "rejected": null, "running": null})
        );
    }

    #[test]
    fn job_request_json_shapes() {
        use crate::job::{BoostOptions, JobOptions, JobRange, JobSide};
        let options = JobOptions {
            range: JobRange::Moves { from: 3, to: 40 },
            side: JobSide::Black,
            visits: 500,
            boost: BoostOptions {
                on: true,
                threshold: 10.0,
                visits: 3000,
            },
        };
        for (value, request) in [
            (
                json!({"type": "jobStart", "options": {
                    "range": {"kind": "moves", "from": 3, "to": 40}, "side": "black",
                    "visits": 500, "boost": {"on": true, "threshold": 10.0, "visits": 3000}}}),
                Request::JobStart { options },
            ),
            (json!({"type": "jobStop"}), Request::JobStop),
            (
                json!({"type": "cacheClear", "scope": "game"}),
                Request::CacheClear {
                    scope: CacheScope::Game,
                },
            ),
            (json!({"type": "cacheStats"}), Request::CacheStats),
            (
                json!({"type": "gameScore", "mode": {"kind": "estimate"}}),
                Request::GameScore {
                    mode: ScoreMode::Estimate,
                },
            ),
            (
                json!({"type": "gameScore", "mode": {"kind": "final", "dead": [{"x": 3, "y": 4}]}}),
                Request::GameScore {
                    mode: ScoreMode::Final {
                        dead: vec![aji_core::Point { x: 3, y: 4 }],
                    },
                },
            ),
        ] {
            assert_eq!(serde_json::from_value::<Request>(value).unwrap(), request);
        }
        assert_eq!(
            serde_json::from_value::<Request>(json!({"type": "jobStart", "options": {
                "range": {"kind": "whole"}, "side": "both", "visits": 500,
                "boost": {"on": false, "threshold": 10.0, "visits": 3000}}}))
            .unwrap(),
            Request::JobStart {
                options: JobOptions {
                    boost: BoostOptions {
                        on: false,
                        ..JobOptions::default().boost
                    },
                    ..JobOptions::default()
                }
            }
        );
    }

    #[test]
    fn job_and_cache_event_json_shapes() {
        use crate::job::{JobProgress, JobState};
        let stats = aji_engine::CacheStats {
            used_bytes: 10,
            cap_bytes: 20,
            persistent: true,
            reason: None,
        };
        assert_eq!(
            serde_json::to_value(Response::CacheStats(stats.clone())).unwrap(),
            json!({"type": "cacheStats", "usedBytes": 10, "capBytes": 20,
                   "persistent": true, "reason": null})
        );
        assert_eq!(
            serde_json::to_value(AppEvent::CacheStatus { status: stats }).unwrap()["type"],
            json!("cacheStatus")
        );
        let progress = JobProgress {
            state: JobState::Boosting,
            done: 9,
            total: 9,
            boost_done: 1,
            boost_total: 2,
            working: Some(4),
            queued: vec![5],
            eta_seconds: Some(12),
        };
        assert_eq!(
            serde_json::to_value(AppEvent::JobProgress { progress }).unwrap(),
            json!({"type": "jobProgress", "progress": {"state": "boosting", "done": 9,
                   "total": 9, "boostDone": 1, "boostTotal": 2, "working": 4,
                   "queued": [5], "etaSeconds": 12}})
        );
        assert_eq!(
            serde_json::to_value(AppEvent::TrendNodes {
                revision: 7,
                nodes: vec![TrendNodeUpdate {
                    line_index: 3,
                    stats: None,
                    loss: Some(aji_engine::Loss {
                        winrate: 12.5,
                        score: 3.0
                    }),
                }],
            })
            .unwrap(),
            json!({"type": "trendNodes", "revision": 7, "nodes": [{"lineIndex": 3,
                   "stats": null, "loss": {"winrate": 12.5, "score": 3.0}}]})
        );
    }

    #[test]
    fn score_response_json_shape() {
        let board = aji_core::game::Board::new(aji_core::BoardSize::new(5).unwrap());
        let score = aji_core::game::final_score(
            &board,
            &[],
            aji_core::ScoringRule::Area,
            aji_core::Komi::new(7.5).unwrap(),
            (0, 0),
        );
        let value = serde_json::to_value(Response::Score(ScoreView {
            score,
            suggested_dead: vec![aji_core::Point { x: 1, y: 2 }],
        }))
        .unwrap();
        assert_eq!(value["type"], json!("score"));
        assert_eq!(value["margin"], json!(-7.5));
        assert_eq!(value["suggestedDead"], json!([{"x": 1, "y": 2}]));
        assert_eq!(value["black"]["stones"], json!(0));
    }

    #[test]
    fn trend_json_shapes() {
        let node = TrendNode {
            move_number: 3,
            mover: Some(Color::White),
            mv: Some(Move::Pass),
            stats: Some(aji_engine::TrendStats {
                winrate: 0.25,
                score_lead: -1.5,
                visits: 80,
            }),
            loss: None,
        };
        let want = json!({"moveNumber": 3, "mover": "white", "move": {"type": "pass"},
                          "stats": {"winrate": 0.25, "scoreLead": -1.5, "visits": 80},
                          "loss": null});
        assert_eq!(
            serde_json::to_value(Response::Trend {
                revision: 4,
                nodes: vec![node.clone()]
            })
            .unwrap(),
            json!({"type": "trend", "revision": 4, "nodes": [want.clone()]})
        );
        assert_eq!(
            serde_json::to_value(AppEvent::GameTrend {
                revision: 4,
                nodes: vec![node]
            })
            .unwrap(),
            json!({"type": "gameTrend", "revision": 4, "nodes": [want]})
        );
    }

    #[test]
    fn rejection_and_running_json_shapes() {
        let rejection = Rejection {
            position: aji_core::PositionKey(1),
            message: "illegal".into(),
        };
        assert_eq!(
            serde_json::to_value(AppEvent::AnalysisRejected {
                rejection: rejection.clone()
            })
            .unwrap(),
            json!({"type": "analysisRejected",
                   "rejection": {"position": "0000000000000001", "message": "illegal"}})
        );
        assert_eq!(
            serde_json::to_value(Response::EngineStatus {
                engine: EngineState::Ready {
                    version: "1.18.2".into(),
                    limit_reached: true
                },
                position: None,
                analysis: None,
                rejected: Some(rejection),
                running: Some(RunningEngine {
                    backend: None,
                    network_name: "m.bin.gz".into()
                }),
            })
            .unwrap(),
            json!({"type": "engineStatus",
                   "engine": {"state": "ready", "version": "1.18.2", "limitReached": true},
                   "position": null, "analysis": null,
                   "rejected": {"position": "0000000000000001", "message": "illegal"},
                   "running": {"backend": null, "networkName": "m.bin.gz"}})
        );
    }

    #[test]
    fn engine_response_json_shapes() {
        assert_eq!(
            serde_json::to_value(Response::EngineStatus {
                engine: EngineState::NotConfigured,
                position: Some(aji_core::PositionKey(0x4d32_5c64_abd3_78a1)),
                analysis: None,
                rejected: None,
                running: None,
            })
            .unwrap(),
            json!({"type": "engineStatus", "engine": {"state": "notConfigured"},
                   "position": "4d325c64abd378a1", "analysis": null,
                   "rejected": null, "running": null})
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
            ownership: None,
            next: None,
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
                       "defaultRules": {"kind": "japaneseKorean"}, "showCoordinates": false,
                       "perspective": "white", "showNextMove": false, "analyseOnOpen": true,
                       "cacheCapMb": 2048, "saveAnalysis": true,
                       "jobOptions": {"range": {"kind": "whole"}, "side": "both",
                           "visits": 500, "boost": {"on": true, "threshold": 10.0,
                           "visits": 3000}}}}),
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
                        show_coordinates: false,
                        perspective: crate::settings::Perspective::White,
                        show_next_move: false,
                        analyse_on_open: true,
                        cache_cap_mb: 2048,
                        save_analysis: true,
                        job_options: crate::job::JobOptions::default(),
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
                   "defaultRules": {"kind": "chinese"}, "showCoordinates": true,
                   "perspective": "black", "showNextMove": true, "analyseOnOpen": false,
                   "cacheCapMb": 1024, "saveAnalysis": false,
                   "jobOptions": {"range": {"kind": "whole"}, "side": "both", "visits": 500,
                       "boost": {"on": true, "threshold": 10.0, "visits": 3000}}}})
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
