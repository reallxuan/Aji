//! Messages between the UI and the engine side (charter section 6.1).
//!
//! These types are the single source of the protocol: `ts-rs` generates the TypeScript types in
//! `src/transport/generated/` from them. They cross a process or network boundary, so they never
//! carry file paths, and errors carry a code rather than user-facing text.

use aji_engine::{AnalysisUpdate, EngineState};
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
}

/// The answer to a [`Request`], tagged the same way.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(tag = "type", rename_all = "camelCase")]
#[ts(export)]
pub enum Response {
    AppInfo(AppInfo),
    EngineStatus { engine: EngineState },
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum OsKind {
    Windows,
    Macos,
    Linux,
    Other,
}

impl OsKind {
    pub fn current() -> Self {
        if cfg!(target_os = "windows") {
            Self::Windows
        } else if cfg!(target_os = "macos") {
            Self::Macos
        } else if cfg!(target_os = "linux") {
            Self::Linux
        } else {
            Self::Other
        }
    }
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
    fn engine_response_json_shapes() {
        assert_eq!(
            serde_json::to_value(Response::EngineStatus {
                engine: EngineState::Starting
            })
            .unwrap(),
            json!({"type": "engineStatus", "engine": {"state": "starting"}})
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

    #[test]
    fn current_os_matches_the_build_target() {
        #[cfg(target_os = "macos")]
        assert_eq!(OsKind::current(), OsKind::Macos);
        #[cfg(target_os = "windows")]
        assert_eq!(OsKind::current(), OsKind::Windows);
        #[cfg(target_os = "linux")]
        assert_eq!(OsKind::current(), OsKind::Linux);
    }
}
