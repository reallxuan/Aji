//! The dispatcher behind every transport. It knows nothing about Tauri, so the WebSocket server of
//! Phase 3 can call the same [`handle`] with the same messages.

use std::sync::Arc;

use aji_engine::{Engine, EngineError, EngineEvent};
use aji_manager::Setup;

use crate::protocol::{AppEvent, AppInfo, ErrorCode, OsKind, ProtocolError, Request, Response};

/// Facts about this installation, and the engine, that requests may need.
#[derive(Debug, Clone)]
pub struct AppContext {
    pub version: String,
    pub os: OsKind,
    pub arch: String,
    pub engine: Engine,
    pub setup: Arc<Setup>,
}

impl AppContext {
    pub fn detect(version: String, engine: Engine, setup: Arc<Setup>) -> Self {
        Self {
            version,
            os: OsKind::current(),
            arch: std::env::consts::ARCH.to_string(),
            engine,
            setup,
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
            EngineError::InvalidPosition => ErrorCode::Internal,
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
        Request::EngineStatus => {
            let status = ctx.engine.status();
            Ok(Response::EngineStatus {
                engine: status.state,
                position: status.position,
                analysis: status.analysis,
            })
        }
        Request::EngineRestart => ctx.engine.restart().await.map(|()| Response::Ok),
        Request::EngineStop => ctx.engine.stop().await.map(|()| Response::Ok),
        Request::AnalysisPause => ctx.engine.pause().await.map(|()| Response::Ok),
        Request::AnalysisResume => ctx.engine.resume().await.map(|()| Response::Ok),
        Request::SetupDetect => Ok(Response::SetupDetect {
            hardware: ctx.setup.hardware().await,
        }),
        Request::SetupBackends => Ok(Response::SetupBackends {
            recommendation: ctx.setup.backends().await,
        }),
        Request::SetupVersions { backend } => Ok(Response::SetupVersions {
            versions: ctx.setup.versions(backend).await,
        }),
        Request::SetupNetworks { engine } => {
            return match ctx.setup.networks(&engine).await {
                Some(networks) => Ok(Response::SetupNetworks { networks }),
                None => Err(ProtocolError {
                    code: ErrorCode::SetupUnknownEngine,
                    message: format!("no engine {engine} in the manifest"),
                }),
            };
        }
    }
    .map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    use aji_core::{BoardSize, Komi, Position, Rules};
    use aji_engine::{EngineOptions, EngineState};
    use aji_manager::hardware::{CpuReport, GpuReport, GpuVendor, HardwareReport, OsReport};
    use aji_manager::manifest::{BUNDLED, Backend, ManifestStore};

    fn unconfigured() -> Engine {
        let position =
            Position::empty(BoardSize::NINETEEN, Rules::Chinese, Komi::new(7.5).unwrap());
        Engine::spawn(None, position, EngineOptions::default(), |_| {})
    }

    fn apple_m5() -> HardwareReport {
        HardwareReport {
            os: OsReport {
                kind: OsKind::Macos,
                version: "27.2".into(),
                arch: "aarch64".into(),
            },
            cpu: CpuReport {
                name: "Apple M5".into(),
                cores: 10,
                threads: 10,
                avx2: false,
            },
            memory_bytes: 25_769_803_776,
            gpus: vec![GpuReport {
                vendor: GpuVendor::Apple,
                name: "Apple M5".into(),
                memory_bytes: None,
                driver_version: None,
                pci_device_id: None,
                apple_gpu_cores: Some(10),
                compute_capability: None,
                software: false,
            }],
            problems: Vec::new(),
        }
    }

    fn ctx() -> AppContext {
        // The cache folder does not exist and the store is never refreshed, so the bundled
        // manifest is in use.
        let store = ManifestStore::open(BUNDLED, "no-such-manifest-cache".into(), Vec::new());
        AppContext {
            version: "0.1.0".into(),
            os: OsKind::Macos,
            arch: "aarch64".into(),
            engine: unconfigured(),
            setup: Arc::new(Setup::with_hardware(store, apple_m5())),
        }
    }

    #[tokio::test]
    async fn setup_backends_defaults_to_metal() {
        let Ok(Response::SetupBackends { recommendation }) =
            handle(&ctx(), Request::SetupBackends).await
        else {
            panic!("expected setupBackends");
        };
        assert_eq!(recommendation.default, Some(Backend::Metal));
    }

    #[tokio::test]
    async fn setup_versions_lists_the_metal_engine() {
        let Ok(Response::SetupVersions { versions }) = handle(
            &ctx(),
            Request::SetupVersions {
                backend: Backend::Metal,
            },
        )
        .await
        else {
            panic!("expected setupVersions");
        };
        assert_eq!(versions.len(), 1);
        assert_eq!(versions[0].version, "1.18.2");
    }

    #[tokio::test]
    async fn setup_networks_for_an_unknown_engine_is_an_error() {
        let error = handle(
            &ctx(),
            Request::SetupNetworks {
                engine: "nope".into(),
            },
        )
        .await
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::SetupUnknownEngine);
    }

    #[tokio::test]
    async fn setup_detect_returns_the_report() {
        assert_eq!(
            handle(&ctx(), Request::SetupDetect).await,
            Ok(Response::SetupDetect {
                hardware: apple_m5()
            })
        );
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
                engine: EngineState::NotConfigured,
                position: aji_core::PositionKey(0x4d32_5c64_abd3_78a1),
                analysis: None,
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
