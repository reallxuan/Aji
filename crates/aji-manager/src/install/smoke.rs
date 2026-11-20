//! The test query: the last step of an install proves the engine answers a real position.

use std::time::Duration;

use aji_core::{BoardSize, Komi, Position, Rules};
use aji_engine::{CrashReason, Engine, EngineEvent, EngineFiles, EngineOptions, EngineState};
use tokio::sync::mpsc;

use super::{FailureCode, StepFailure, classify};

/// Starts `files` through `aji_engine::Engine` with visit cap 50 on the empty 19×19 board,
/// Chinese, 7.5. Ok once an update with at least one candidate arrives; a crash is
/// classified; no update in `timeout` is TimedOut.
///
/// KataGo is shut down before this returns, whatever the outcome. A timeout has no stderr
/// tail: the engine keeps one only for a crash.
pub async fn run_test_query(files: EngineFiles, timeout: Duration) -> Result<(), StepFailure> {
    let komi = Komi::new(7.5).expect("7.5 is a valid komi");
    let position = Position::empty(BoardSize::NINETEEN, Rules::Chinese, komi);
    let options = EngineOptions {
        visit_limit: Some(50),
        ..EngineOptions::default()
    };
    let (events, mut received) = mpsc::unbounded_channel();
    let engine = Engine::spawn(Some(files), position, options, move |event| {
        // The receiver is gone only once this function has returned.
        let _ = events.send(event);
    });
    let outcome = tokio::time::timeout(timeout, async {
        while let Some(event) = received.recv().await {
            match event {
                EngineEvent::Analysis(update) if !update.candidates.is_empty() => return Ok(()),
                EngineEvent::State(EngineState::Crashed {
                    reason,
                    exit,
                    stderr_tail,
                }) => {
                    let code = match reason {
                        CrashReason::NotResponding => FailureCode::TimedOut,
                        CrashReason::SpawnFailed | CrashReason::Exited => {
                            classify(exit, &stderr_tail)
                        }
                    };
                    return Err(StepFailure { code, stderr_tail });
                }
                _ => {}
            }
        }
        // The actor ended without a crash report.
        Err(StepFailure {
            code: FailureCode::Crashed,
            stderr_tail: Vec::new(),
        })
    })
    .await;
    engine.shutdown().await;
    outcome.unwrap_or_else(|_| {
        Err(StepFailure {
            code: FailureCode::TimedOut,
            stderr_tail: Vec::new(),
        })
    })
}
