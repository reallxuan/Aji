//! The development trigger: `AJI_DEV_INSTALL` installs an engine at startup, before the setup
//! wizard of M5 exists, and logs the job's progress. Release builds read it too, so the exit
//! check can run on a packaged app.

use std::sync::Arc;

use aji_manager::Setup;
use aji_manager::install::{InstallRequest, Installer, JobOutcome, JobSnapshot, TaskState};
use aji_manager::manifest::Backend;
use serde::Serialize;

/// `recommended`, or a backend name such as `directml`.
pub const DEV_INSTALL_VAR: &str = "AJI_DEV_INSTALL";

/// The trigger's value, when it is set and not empty.
pub fn dev_install_value() -> Option<String> {
    std::env::var(DEV_INSTALL_VAR)
        .ok()
        .filter(|value| !value.is_empty())
}

/// The job `value` asks for, or `None` when an engine is `configured` (a `devEngine` or an
/// active set). `recommended` takes the default backend; another value must be a backend the
/// recommendation lists. The engine is that backend's newest, the network its preselected one.
/// The request accepts every licence the engine needs, for this job only: nothing is written
/// to `settings.json`.
pub async fn dev_install_request(
    value: &str,
    configured: bool,
    setup: &Setup,
    installer: &Installer,
) -> Result<Option<InstallRequest>, String> {
    if configured {
        return Ok(None);
    }
    let recommendation = setup.backends().await;
    let backend = if value == "recommended" {
        recommendation
            .default
            .ok_or("no backend is recommended for this machine")?
    } else {
        // An unknown name parses as `Backend::Unknown`, which no recommendation lists.
        let backend: Backend = serde_json::from_value(value.into())
            .map_err(|_| format!("{value:?} is not a backend name"))?;
        if !recommendation.backends.iter().any(|c| c.backend == backend) {
            let listed: Vec<String> = recommendation
                .backends
                .iter()
                .map(|c| name(&c.backend))
                .collect();
            return Err(format!(
                "{value:?} is not a backend for this machine; it can use {}",
                listed.join(", ")
            ));
        }
        backend
    };
    // Newest first.
    let engine = setup
        .versions(backend)
        .await
        .into_iter()
        .next()
        .ok_or_else(|| format!("no {} engine for this machine", name(&backend)))?
        .engine;
    let network = setup
        .networks(&engine)
        .await
        .and_then(|list| list.preselected)
        .ok_or_else(|| format!("no network for {engine}"))?;
    let accepted_licences = installer
        .licences(&engine)
        .ok_or_else(|| format!("no engine {engine} in the manifest"))?
        .into_iter()
        .map(|licence| licence.text_sha256)
        .collect();
    Ok(Some(InstallRequest {
        engine,
        network,
        accepted_licences,
    }))
}

/// Starts the job `value` asks for on the async runtime, and logs what happens.
pub fn start(value: String, configured: bool, setup: Arc<Setup>, installer: Arc<Installer>) {
    tauri::async_runtime::spawn(async move {
        match dev_install_request(&value, configured, &setup, &installer).await {
            Ok(None) => eprintln!("aji: {DEV_INSTALL_VAR} ignored: an engine is already set up"),
            Ok(Some(request)) => {
                eprintln!(
                    "aji: dev install {} with {}",
                    request.engine, request.network
                );
                if let Err(e) = installer.start(request) {
                    eprintln!("aji: dev install did not start: {e:?}");
                }
            }
            Err(e) => eprintln!("aji: {DEV_INSTALL_VAR}={value:?}: {e}"),
        }
    });
}

/// Log lines for what changed between two snapshots of one job: one per task whose state
/// changed (byte counts alone are no change), and one for the outcome when it arrives.
/// `before` is `None` for a job's first snapshot, whose waiting tasks are not reported.
pub fn progress_lines(before: Option<&JobSnapshot>, now: &JobSnapshot) -> Vec<String> {
    let mut lines = Vec::new();
    for row in &now.tasks {
        let was = before
            .and_then(|b| b.tasks.iter().find(|r| r.task == row.task))
            .map_or(TaskState::Waiting, |r| r.state);
        let same = match (was, row.state) {
            (TaskState::Running { .. }, TaskState::Running { .. }) => true,
            (was, state) => was == state,
        };
        if same {
            continue;
        }
        let state = match row.state {
            TaskState::Waiting => "waiting".to_string(),
            TaskState::Running { done, total } => format!("running ({done} of {total})"),
            TaskState::Done => "done".to_string(),
            TaskState::Reused => "reused".to_string(),
            TaskState::Failed { failure } => format!("failed: {}", name(&failure)),
        };
        lines.push(format!("aji: install {}: {state}", name(&row.task)));
    }
    let outcome = now.outcome.as_ref();
    if let Some(outcome) = outcome
        && before.and_then(|b| b.outcome.as_ref()) != Some(outcome)
    {
        lines.push(match outcome {
            JobOutcome::Installed => "aji: install installed".to_string(),
            JobOutcome::Cancelled => "aji: install cancelled".to_string(),
            JobOutcome::Failed { failure, offer, .. } => {
                let offer = match offer {
                    None => "no offer".to_string(),
                    Some(offer) => {
                        let runtime = offer
                            .runtime_bytes
                            .map(|bytes| format!(", runtime {bytes} bytes"))
                            .unwrap_or_default();
                        format!(
                            "offer: {} ({}, {} bytes{runtime})",
                            name(&offer.backend),
                            offer.engine,
                            offer.download_bytes
                        )
                    }
                };
                format!("aji: install failed: {}; {offer}", name(failure))
            }
        });
    }
    lines
}

/// The protocol's name for a unit variant: `outOfMemory`, `directml`, `testQuery`.
fn name(value: &impl Serialize) -> String {
    match serde_json::to_value(value) {
        Ok(serde_json::Value::String(name)) => name,
        other => format!("{other:?}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use aji_manager::hardware::HardwareReport;
    use aji_manager::install::{
        DownloadSource, FailureCode, FallbackOffer, JobOutcome, TaskKind, TaskRow, TaskState,
    };
    use aji_manager::manifest::Backend;
    use tokio::sync::watch;

    use crate::test_support::{apple_m5, installer, rtx_5070, setup, unconfigured};

    const CUDA_EULA: &str = "e2c71babfd18a8e69542dd7e9ca018f9caa438094001a58e6bc4d8c999bf0d07";
    const CUDNN_SLA_PREFIX: &str = "4fce5a3b1eca";

    async fn request(
        value: &str,
        configured: bool,
        report: HardwareReport,
    ) -> Result<Option<InstallRequest>, String> {
        let setup = setup(report);
        let source = watch::Sender::new(DownloadSource::Direct);
        let installer = installer(
            std::path::Path::new("no-such-aji-folder"),
            Arc::clone(&setup),
            unconfigured(),
            source.subscribe(),
        );
        dev_install_request(value, configured, &setup, &installer).await
    }

    #[tokio::test]
    async fn the_trigger_does_nothing_when_an_engine_is_configured() {
        assert_eq!(request("recommended", true, apple_m5()).await, Ok(None));
    }

    #[tokio::test]
    async fn recommended_on_the_m5_picks_metal_and_the_top_network() {
        let request = request("recommended", false, apple_m5())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(request.engine, "katago-v1.18.2-metal-macos-arm64");
        assert_eq!(request.network, "kata1-tf3-b11c768-s12382M-d6533M");
        assert!(request.accepted_licences.is_empty());
    }

    #[tokio::test]
    async fn a_named_backend_picks_its_newest_engine() {
        let request = request("directml", false, rtx_5070())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            request.engine,
            "katago-v1.18.1-onnx1.24.4-directml-windows-x64"
        );
        assert_eq!(request.network, "kata1-tf3-b11c768-s12382M-d6533M");
    }

    #[tokio::test]
    async fn an_unlisted_backend_is_an_error() {
        for value in ["metal", "nope", ""] {
            let result = request(value, false, rtx_5070()).await;
            assert!(result.is_err(), "{value:?}: {result:?}");
        }
    }

    #[tokio::test]
    async fn the_trigger_accepts_licences_for_its_job_only() {
        let request = request("cuda", false, rtx_5070()).await.unwrap().unwrap();
        assert_eq!(
            request.engine,
            "katago-v1.18.2-cuda13.2-cudnn9.24.0-windows-x64"
        );
        assert_eq!(request.accepted_licences.len(), 2, "{request:?}");
        assert!(request.accepted_licences.contains(CUDA_EULA));
        assert!(
            request
                .accepted_licences
                .iter()
                .any(|h| h.starts_with(CUDNN_SLA_PREFIX))
        );
    }

    fn snapshot(states: [TaskState; 3], outcome: Option<JobOutcome>) -> JobSnapshot {
        let tasks = [TaskKind::Engine, TaskKind::Network, TaskKind::Benchmark]
            .into_iter()
            .zip(states)
            .map(|(task, state)| TaskRow { task, state })
            .collect();
        JobSnapshot {
            id: 1,
            engine: "katago-v1.18.2-cuda13.2-cudnn9.24.0-windows-x64".into(),
            backend: Backend::Cuda,
            network: "net".into(),
            tasks,
            outcome,
        }
    }

    #[test]
    fn progress_lines_report_changes_and_the_offer() {
        use TaskState::{Done, Running, Waiting};
        let first = snapshot(
            [
                Running {
                    done: 0,
                    total: 100,
                },
                Waiting,
                Waiting,
            ],
            None,
        );
        assert_eq!(
            progress_lines(None, &first),
            ["aji: install engine: running (0 of 100)"]
        );
        // Bytes alone are not a change.
        let bytes = snapshot(
            [
                Running {
                    done: 60,
                    total: 100,
                },
                Waiting,
                Waiting,
            ],
            None,
        );
        assert!(progress_lines(Some(&first), &bytes).is_empty());

        let moved = snapshot([Done, Running { done: 0, total: 9 }, Waiting], None);
        assert_eq!(
            progress_lines(Some(&bytes), &moved),
            [
                "aji: install engine: done",
                "aji: install network: running (0 of 9)"
            ]
        );

        let offer = FallbackOffer {
            backend: Backend::Directml,
            engine: "katago-v1.18.1-onnx1.24.4-directml-windows-x64".into(),
            download_bytes: 23_584_379,
            runtime_bytes: None,
        };
        let failed = snapshot(
            [
                Done,
                Done,
                TaskState::Failed {
                    failure: FailureCode::OutOfMemory,
                },
            ],
            Some(JobOutcome::Failed {
                failure: FailureCode::OutOfMemory,
                stderr_tail: vec!["CUDA error: out of memory".into()],
                offer: Some(offer),
                driver: None,
            }),
        );
        assert_eq!(
            progress_lines(Some(&moved), &failed),
            [
                "aji: install network: done",
                "aji: install benchmark: failed: outOfMemory",
                "aji: install failed: outOfMemory; offer: directml \
                 (katago-v1.18.1-onnx1.24.4-directml-windows-x64, 23584379 bytes)",
            ]
        );
        // The outcome is reported once.
        assert!(progress_lines(Some(&failed), &failed).is_empty());

        let done = snapshot([Done, Done, Done], Some(JobOutcome::Installed));
        assert_eq!(
            progress_lines(Some(&moved), &done)
                .last()
                .map(String::as_str),
            Some("aji: install installed")
        );
        let none = snapshot(
            [Done, Done, Done],
            Some(JobOutcome::Failed {
                failure: FailureCode::Crashed,
                stderr_tail: vec![],
                offer: None,
                driver: None,
            }),
        );
        assert_eq!(
            progress_lines(Some(&done), &none),
            ["aji: install failed: crashed; no offer"]
        );
    }
}
