//! The dispatcher behind every transport. It knows nothing about Tauri, so the WebSocket server of
//! Phase 3 can call the same [`handle`] with the same messages.

use std::sync::Arc;

use aji_engine::{Engine, EngineError, EngineEvent};

use crate::protocol::{AppEvent, AppInfo, ErrorCode, OsKind, ProtocolError, Request, Response};

/// Facts about this installation, and the engine, that requests may need.
#[derive(Debug, Clone)]
pub struct AppContext {
    pub version: String,
    pub os: OsKind,
    pub arch: String,
    pub engine: Engine,
}

impl AppContext {
    pub fn detect(version: String, engine: Engine) -> Self {
        Self {
            version,
            os: OsKind::current(),
            arch: std::env::consts::ARCH.to_string(),
            engine,
        }
    }
}

/// Where pushed events go: the Tauri webview now, a WebSocket in Phase 3.
pub trait EventSink: Send + Sync + 'static {
    fn emit(&self, event: AppEvent);
}

/// The callback to give `Engine::spawn`: it turns engine events into [`AppEvent`]s for `sink`.
pub fn forward_engine_events(
    sink: Arc<dyn EventSink>,
) -> impl Fn(EngineEvent) + Send + Sync + 'static {
    move |event| {
        sink.emit(match event {
            EngineEvent::State(engine) => AppEvent::EngineState { engine },
            EngineEvent::Analysis(analysis) => AppEvent::AnalysisUpdate { analysis },
        });
    }
}

impl From<EngineError> for ProtocolError {
    fn from(error: EngineError) -> Self {
        let code = match error {
            EngineError::NotConfigured => ErrorCode::EngineNotConfigured,
            EngineError::NotRunning => ErrorCode::EngineNotRunning,
        };
        ProtocolError {
            code,
            message: error.to_string(),
        }
    }
}

pub async fn handle(ctx: &AppContext, request: Request) -> Result<Response, ProtocolError> {
    match request {
        Request::AppInfo => Ok(Response::AppInfo(AppInfo {
            version: ctx.version.clone(),
            os: ctx.os,
            arch: ctx.arch.clone(),
        })),
        Request::EngineStatus => Ok(Response::EngineStatus {
            engine: ctx.engine.state(),
        }),
        Request::EngineRestart => ctx.engine.restart().await.map(|()| Response::Ok),
        Request::EngineStop => ctx.engine.stop().await.map(|()| Response::Ok),
        Request::AnalysisPause => ctx.engine.pause().await.map(|()| Response::Ok),
        Request::AnalysisResume => ctx.engine.resume().await.map(|()| Response::Ok),
    }
    .map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    use aji_core::{BoardSize, Komi, Position, Rules};
    use aji_engine::{EngineOptions, EngineState};

    fn unconfigured() -> Engine {
        let position =
            Position::empty(BoardSize::NINETEEN, Rules::Chinese, Komi::new(7.5).unwrap());
        Engine::spawn(None, position, EngineOptions::default(), |_| {})
    }

    fn ctx() -> AppContext {
        AppContext {
            version: "0.1.0".into(),
            os: OsKind::Macos,
            arch: "aarch64".into(),
            engine: unconfigured(),
        }
    }

    #[tokio::test]
    async fn app_info_reports_the_context() {
        assert_eq!(
            handle(&ctx(), Request::AppInfo).await,
            Ok(Response::AppInfo(AppInfo {
                version: "0.1.0".into(),
                os: OsKind::Macos,
                arch: "aarch64".into(),
            }))
        );
    }

    #[tokio::test]
    async fn engine_status_reports_not_configured() {
        assert_eq!(
            handle(&ctx(), Request::EngineStatus).await,
            Ok(Response::EngineStatus {
                engine: EngineState::NotConfigured
            })
        );
    }

    #[tokio::test]
    async fn restart_without_an_engine_is_not_configured() {
        let error = handle(&ctx(), Request::EngineRestart).await.unwrap_err();
        assert_eq!(error.code, ErrorCode::EngineNotConfigured);
    }

    #[tokio::test]
    async fn pause_without_an_engine_is_not_running() {
        let error = handle(&ctx(), Request::AnalysisPause).await.unwrap_err();
        assert_eq!(error.code, ErrorCode::EngineNotRunning);
    }

    #[derive(Default)]
    struct Recorder(Mutex<Vec<AppEvent>>);

    impl EventSink for Recorder {
        fn emit(&self, event: AppEvent) {
            self.0.lock().unwrap().push(event);
        }
    }

    #[test]
    fn engine_state_events_are_forwarded() {
        let recorder = Arc::new(Recorder::default());
        let forward = forward_engine_events(recorder.clone());
        forward(EngineEvent::State(EngineState::Starting));
        assert_eq!(
            *recorder.0.lock().unwrap(),
            vec![AppEvent::EngineState {
                engine: EngineState::Starting
            }]
        );
    }
}
