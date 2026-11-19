//! Messages between the UI and the engine side (charter section 6.1).
//!
//! These types are the single source of the protocol: `ts-rs` generates the TypeScript types in
//! `src/transport/generated/` from them. They cross a process or network boundary, so they never
//! carry file paths, and errors carry a code rather than user-facing text.

use aji_core::PositionKey;
use aji_engine::{AnalysisUpdate, EngineState};
pub use aji_manager::OsKind;
use aji_manager::hardware::HardwareReport;
use aji_manager::manifest::Backend;
use aji_manager::recommend::{BackendRecommendation, EngineVersionChoice, NetworkList};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A request from the UI. Serialised as `{"type": "<camelCase variant>", ...fields}`.
#[derive(Debug, Clone, PartialEq, Deserialize, TS)]
#[serde(tag = "type", rename_all = "camelCase")]
#[ts(export)]
pub enum Request {
    AppInfo,
    EngineStatus,
    EngineRestart,
    EngineStop,
    AnalysisPause,
    AnalysisResume,
    SetupDetect,
    SetupBackends,
    SetupVersions { backend: Backend },
    SetupNetworks { engine: String },
}

/// The answer to a [`Request`], tagged the same way.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(tag = "type", rename_all = "camelCase")]
#[ts(export)]
pub enum Response {
    AppInfo(AppInfo),
    EngineStatus {
        engine: EngineState,
        /// The position the engine is analysing.
        position: PositionKey,
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
    Ok,
}

/// A message the engine side pushes to the UI without being asked, tagged the same way.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(tag = "type", rename_all = "camelCase")]
#[ts(export)]
pub enum AppEvent {
    EngineState { engine: EngineState },
    AnalysisUpdate { analysis: AnalysisUpdate },
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
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ErrorCode {
    Internal,
    EngineNotConfigured,
    EngineNotRunning,
    SetupUnknownEngine,
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
                position: aji_core::PositionKey(0x4d32_5c64_abd3_78a1),
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
                position: aji_core::PositionKey(0x4d32_5c64_abd3_78a1),
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
            (json!({"type": "setupDetect"}), Request::SetupDetect),
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
        ] {
            assert_eq!(serde_json::from_value::<Request>(value).unwrap(), request);
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
        };
        assert_eq!(
            serde_json::to_value(e).unwrap(),
            json!({"code": "internal", "message": "boom"})
        );
    }
}
