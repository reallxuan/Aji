//! The engine's state as the interface sees it.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Where the engine is. One `State` event is emitted per transition.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "state",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export)]
pub enum EngineState {
    /// No KataGo is configured.
    NotConfigured,
    /// KataGo is starting and has not answered its version query yet.
    Starting,
    /// KataGo is idle: the visit cap is reached or nothing is queued.
    Ready {
        version: String,
        /// The current position stopped at its visit limit; `analysisContinue` searches on.
        limit_reached: bool,
    },
    /// KataGo is searching the current position.
    Analysing { version: String },
    /// The user paused the analysis.
    Paused { version: String },
    /// KataGo was stopped on request.
    Stopped,
    /// KataGo could not start, exited on its own, or stopped answering.
    Crashed {
        reason: CrashReason,
        /// `null` when there was no process to exit (`spawnFailed`).
        exit: Option<ExitInfo>,
        /// The last lines of KataGo's stderr: diagnostic text for display only.
        stderr_tail: Vec<String>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum CrashReason {
    SpawnFailed,
    Exited,
    NotResponding,
}

/// How a process ended. On Unix a process killed by a signal has `code: null`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ExitInfo {
    pub code: Option<i32>,
    pub signal: Option<i32>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    fn json_of(state: EngineState) -> Value {
        serde_json::to_value(state).unwrap()
    }

    #[test]
    fn engine_state_json_shapes() {
        let v = || "1.18.2".to_owned();
        assert_eq!(
            json_of(EngineState::NotConfigured),
            json!({"state":"notConfigured"})
        );
        assert_eq!(json_of(EngineState::Starting), json!({"state":"starting"}));
        assert_eq!(
            json_of(EngineState::Ready {
                version: v(),
                limit_reached: true
            }),
            json!({"state":"ready","version":"1.18.2","limitReached":true})
        );
        assert_eq!(
            json_of(EngineState::Analysing { version: v() }),
            json!({"state":"analysing","version":"1.18.2"})
        );
        assert_eq!(
            json_of(EngineState::Paused { version: v() }),
            json!({"state":"paused","version":"1.18.2"})
        );
        assert_eq!(json_of(EngineState::Stopped), json!({"state":"stopped"}));
        assert_eq!(
            json_of(EngineState::Crashed {
                reason: CrashReason::Exited,
                exit: Some(ExitInfo {
                    code: None,
                    signal: Some(6),
                }),
                stderr_tail: vec!["…".into()],
            }),
            json!({"state":"crashed","reason":"exited","exit":{"code":null,"signal":6},"stderrTail":["…"]})
        );
    }

    #[test]
    fn spawn_failed_and_not_responding_shapes() {
        assert_eq!(
            json_of(EngineState::Crashed {
                reason: CrashReason::SpawnFailed,
                exit: None,
                stderr_tail: vec!["aji: could not start KataGo: NotFound".into()],
            }),
            json!({"state":"crashed","reason":"spawnFailed","exit":null,"stderrTail":["aji: could not start KataGo: NotFound"]})
        );
        assert_eq!(
            serde_json::to_value(CrashReason::NotResponding).unwrap(),
            json!("notResponding")
        );
    }

    #[test]
    fn engine_state_round_trips() {
        let state = EngineState::Crashed {
            reason: CrashReason::NotResponding,
            exit: Some(ExitInfo {
                code: None,
                signal: Some(9),
            }),
            stderr_tail: vec![],
        };
        let back: EngineState =
            serde_json::from_value(serde_json::to_value(&state).unwrap()).unwrap();
        assert_eq!(back, state);
    }
}
