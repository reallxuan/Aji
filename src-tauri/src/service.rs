//! The dispatcher behind every transport. It knows nothing about Tauri, so the WebSocket server of
//! Phase 3 can call the same [`handle`] with the same messages.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use aji_core::PositionKey;
use aji_core::game::{AnalysisRules, estimate, final_score, suggested_dead};
use aji_core::{Move, ScoringRule};
use aji_engine::{ClearScope, Engine, EngineError, EngineEvent, EngineFiles, Row};
use aji_manager::Setup;
use aji_manager::install::{
    DownloadSource, ImportError, InstallRequest, InstallRoot, Installed, Installer, RemoveError,
    StartError, active_summary, engine_files,
};
use base64::Engine as _;
use tokio::sync::{Mutex, mpsc, watch};

use crate::game::{GameSession, NavTarget, OpenError};
use crate::protocol::{
    AppEvent, AppInfo, CacheScope, ErrorCode, OsKind, ProtocolError, Request, Response,
    RunningEngine, ScoreMode, ScoreView,
};
use crate::settings::{
    Settings, UiSettings, load_settings, record_accepted_licences, save_ui_settings,
    update_settings,
};
use crate::{follow, job, lizzie};

/// Facts about this installation, and the services, that requests may need.
#[derive(Clone)]
pub struct AppContext {
    pub version: String,
    pub os: OsKind,
    pub arch: String,
    pub engine: Engine,
    pub setup: Arc<Setup>,
    pub installer: Arc<Installer>,
    pub settings_path: PathBuf,
    pub files: Arc<dyn FilePicker>,
    /// The download source the installer reads; `setupSetDownloadSource` changes it.
    pub source: watch::Sender<DownloadSource>,
    /// Where events go, for those a request causes (`settingsChanged`).
    pub events: Arc<dyn EventSink>,
    /// The open game. Held across the engine call that follows a change, so positions reach
    /// the engine in the order the requests came.
    pub game: Arc<Mutex<GameSession>>,
    /// The trend's line and the job's passes, as the engine's events update them.
    pub follow: Arc<std::sync::Mutex<crate::follow::Follow>>,
}

/// Asks the user for a file. Blocking: call it through `spawn_blocking`.
pub trait FilePicker: Send + Sync {
    /// A KataGo network file, or `None` when the user cancels.
    fn pick_network(&self) -> Option<PathBuf>;
}

/// The files the engine starts with: the development engine named in the settings, else the
/// active installed set, else none.
pub fn startup_files(
    settings: &Settings,
    installed: &Installed,
    root: &InstallRoot,
) -> Option<EngineFiles> {
    if let Some(dev) = &settings.dev_engine {
        return Some(dev.files());
    }
    engine_files(root, installed, installed.active_set()?)
}

/// What the engine card names: the development engine named in the settings, else the active
/// installed set, as [`startup_files`] chooses.
pub fn running_engine(settings: &Settings, installed: &Installed) -> Option<RunningEngine> {
    if let Some(dev) = &settings.dev_engine {
        let network_name = dev.model.file_name()?.to_string_lossy().into_owned();
        return Some(RunningEngine {
            backend: None,
            network_name,
        });
    }
    active_summary(installed).map(|active| RunningEngine {
        backend: Some(active.backend),
        network_name: active.network_name,
    })
}

/// Pushes the session's trend to every client. Called with the session locked.
async fn push_trend(ctx: &AppContext, session: &GameSession) {
    follow::trend_of(ctx, session, true).await;
}

/// Where pushed events go: the Tauri webview now, a WebSocket in Phase 3.
pub trait EventSink: Send + Sync + 'static {
    fn emit(&self, event: AppEvent);
}

/// The callback to give `Engine::spawn`: it turns engine events into [`AppEvent`]s for `sink`,
/// and hands kept results and job statuses to [`follow::follow_engine`] through `follow`.
pub fn forward_engine_events(
    sink: Arc<dyn EventSink>,
    follow: mpsc::UnboundedSender<EngineEvent>,
) -> impl Fn(EngineEvent) + Send + Sync + 'static {
    move |event| {
        sink.emit(match event {
            EngineEvent::State(engine) => AppEvent::EngineState { engine },
            EngineEvent::Analysis(analysis) => AppEvent::AnalysisUpdate { analysis },
            EngineEvent::Rejected(rejection) => AppEvent::AnalysisRejected { rejection },
            followed @ (EngineEvent::Stored { .. } | EngineEvent::Job(_)) => {
                // A closed follower means the app is shutting down.
                let _ = follow.send(followed);
                return;
            }
        });
    }
}

impl From<EngineError> for ProtocolError {
    fn from(error: EngineError) -> Self {
        let code = match error {
            EngineError::NotConfigured => ErrorCode::EngineNotConfigured,
            EngineError::NotRunning => ErrorCode::EngineNotRunning,
            EngineError::InvalidPosition => ErrorCode::InvalidPosition,
        };
        ProtocolError {
            code,
            message: error.to_string(),
            detail: None,
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
            let running = load_settings(&ctx.settings_path)
                .ok()
                .and_then(|settings| running_engine(&settings, &ctx.installer.installed()));
            Ok(Response::EngineStatus {
                engine: status.state,
                position: status.position,
                analysis: status.analysis,
                rejected: status.rejected,
                running,
            })
        }
        Request::EngineRestart => {
            refuse_while_held(ctx)?;
            ctx.engine.restart().await.map(|()| Response::Ok)
        }
        Request::EngineStop => ctx.engine.stop().await.map(|()| Response::Ok),
        Request::AnalysisPause => ctx.engine.pause().await.map(|()| Response::Ok),
        Request::AnalysisContinue => {
            refuse_while_held(ctx)?;
            ctx.engine.continue_analysis().await.map(|()| Response::Ok)
        }
        Request::AnalysisResume => {
            refuse_while_held(ctx)?;
            ctx.engine.resume().await.map(|()| Response::Ok)
        }
        Request::SetupDetect { refresh } => Ok(Response::SetupDetect {
            hardware: match refresh {
                true => ctx.setup.refresh().await,
                false => ctx.setup.hardware().await,
            },
        }),
        Request::SetupBackends => Ok(Response::SetupBackends {
            recommendation: ctx.setup.backends().await,
        }),
        Request::SetupVersions { backend } => {
            let installed = ctx.installer.installed();
            let mut versions = ctx.setup.versions(backend).await;
            for choice in &mut versions {
                choice.installed = installed.engines.contains_key(&choice.engine);
            }
            Ok(Response::SetupVersions { versions })
        }
        Request::SetupNetworks { engine } => {
            let Some(mut networks) = ctx.setup.networks(&engine).await else {
                return Err(unknown_engine(&engine));
            };
            let installed = ctx.installer.installed();
            for choice in networks.networks.iter_mut().chain(networks.human.as_mut()) {
                choice.installed = installed.networks.contains_key(&choice.network);
            }
            Ok(Response::SetupNetworks { networks })
        }
        Request::SetupLicences { engine } => return setup_licences(ctx, &engine),
        Request::SetupInstall {
            engine,
            network,
            accept_licences,
            benchmark,
        } => return setup_install(ctx, engine, network, accept_licences, benchmark),
        Request::SetupCancel => {
            ctx.installer.cancel();
            Ok(Response::Ok)
        }
        Request::SetupStatus => Ok(Response::SetupStatus {
            job: ctx.installer.status(),
        }),
        Request::SetupSetDownloadSource { source } => return set_download_source(ctx, source),
        Request::SetupImportNetwork => return import_network(ctx).await,
        Request::SetupInstalled => return setup_installed(ctx).await,
        Request::SetupRemoveUnused => return remove_unused(ctx).await,
        Request::SettingsGet => Ok(Response::Settings {
            settings: load_settings(&ctx.settings_path)
                .map(|s| s.ui)
                .unwrap_or_default(),
        }),
        Request::SettingsSet { settings } => return set_settings(ctx, settings).await,
        Request::GameNew { size } => return game_new(ctx, size).await,
        Request::GameOpen { name, bytes } => return game_open(ctx, name, bytes).await,
        Request::GameNavigate { to } => return game_navigate(ctx, to).await,
        Request::GameTrend => {
            let session = ctx.game.lock().await;
            let (revision, nodes) = follow::trend_of(ctx, &session, false).await;
            return Ok(Response::Trend { revision, nodes });
        }
        Request::GamePreview { moves } => return Ok(game_preview(ctx, &moves).await),
        Request::GameSetRules { rules } => return game_set_rules(ctx, rules).await,
        Request::GameSnapshot => {
            let session = ctx.game.lock().await;
            Ok(Response::Game {
                snapshot: Box::new(session.snapshot()),
                warnings: session.warnings().to_vec(),
            })
        }
        Request::GameExport => return game_export(ctx).await,
        Request::JobStart { options } => return follow::job_start(ctx, options).await,
        Request::JobStop => {
            follow::stop_job(ctx).await;
            Ok(Response::Ok)
        }
        Request::CacheClear { scope } => return cache_clear(ctx, scope).await,
        Request::CacheStats => Ok(Response::CacheStats(ctx.engine.cache_stats().await)),
        Request::GameScore { mode } => return game_score(ctx, mode).await,
    }
    .map_err(Into::into)
}

/// Restart and resume would take the GPU back from a job's benchmark or test query.
fn refuse_while_held(ctx: &AppContext) -> Result<(), ProtocolError> {
    match ctx.installer.holds_engine() {
        true => Err(error(
            ErrorCode::EngineBusy,
            "an install job is measuring the engine",
        )),
        false => Ok(()),
    }
}

/// Saves the preferences, hands the visit limit to the engine, and tells every client.
async fn set_settings(ctx: &AppContext, settings: UiSettings) -> Result<Response, ProtocolError> {
    if !settings.default_rules.is_valid() {
        return Err(error(ErrorCode::Internal, "default komi out of range"));
    }
    save_ui_settings(&ctx.settings_path, &settings)
        .map_err(|e| error(ErrorCode::Internal, e.to_string()))?;
    ctx.engine.set_visit_limit(settings.visit_limit).await?;
    ctx.engine
        .set_cache_cap(u64::from(settings.cache_cap_mb.max(1)) * 1024 * 1024);
    ctx.events.emit(AppEvent::SettingsChanged {
        settings: settings.clone(),
    });
    Ok(Response::Settings { settings })
}

/// Walking the install folders blocks, so it runs on the blocking pool.
async fn setup_installed(ctx: &AppContext) -> Result<Response, ProtocolError> {
    let installer = Arc::clone(&ctx.installer);
    tokio::task::spawn_blocking(move || Response::SetupInstalled {
        active: installer.active_summary(),
        unused_bytes: installer.unused_bytes(),
    })
    .await
    .map_err(|e| error(ErrorCode::Internal, e.to_string()))
}

async fn remove_unused(ctx: &AppContext) -> Result<Response, ProtocolError> {
    let installer = Arc::clone(&ctx.installer);
    match tokio::task::spawn_blocking(move || installer.remove_unused()).await {
        Ok(Ok(freed_bytes)) => Ok(Response::SetupRemoved { freed_bytes }),
        Ok(Err(RemoveError::Busy)) => Err(error(ErrorCode::SetupBusy, "an install job is running")),
        Ok(Err(RemoveError::Io(e))) => Err(error(ErrorCode::Internal, e)),
        Err(e) => Err(error(ErrorCode::Internal, e.to_string())),
    }
}

pub(crate) fn error(code: ErrorCode, message: impl Into<String>) -> ProtocolError {
    ProtocolError {
        code,
        message: message.into(),
        detail: None,
    }
}

impl From<OpenError> for ProtocolError {
    fn from(e: OpenError) -> Self {
        match e {
            OpenError::TooLarge => error(ErrorCode::SgfTooLarge, "the file is over 20 MB"),
            OpenError::NotAGame => error(ErrorCode::SgfNotAGame, "no game in the file"),
            OpenError::NotGo => error(ErrorCode::SgfNotGo, "the file records another game"),
            OpenError::UnsupportedSize { width, height } => {
                let size = format!("{width}x{height}");
                ProtocolError {
                    detail: Some(size.clone()),
                    ..error(ErrorCode::SgfUnsupportedSize, size)
                }
            }
        }
    }
}

/// The interface preferences; the defaults when the settings cannot be read.
fn ui_settings(ctx: &AppContext) -> UiSettings {
    load_settings(&ctx.settings_path)
        .map(|s| s.ui)
        .unwrap_or_default()
}

/// The rules new games and rule-less files start with; Chinese when the settings cannot be read.
fn default_rules(ctx: &AppContext) -> AnalysisRules {
    ui_settings(ctx).default_rules
}

/// The file's LizzieYzy analysis as imported rows for the main line's positions (design 5.11).
/// Values that do not read are skipped.
fn lizzie_rows(session: &GameSession) -> Vec<Row> {
    let size = session.size();
    let points = usize::from(size.get()) * usize::from(size.get());
    session
        .line()
        .iter()
        .zip(session.lizzie())
        .filter_map(|(node, text)| {
            let data = aji_core::sgf::parse_lz(&text?, points)?;
            let update = lizzie::update_from_lz(&data, node.key?, size, job::to_move(node)?);
            Some(Row {
                update,
                imported: true,
                katago_version: String::new(),
            })
        })
        .collect()
}

/// Tells every client of the current node, then hands its position to the engine (or idles it
/// on an illegal node). Called with the session locked, so engines and clients see nodes in the
/// same order. The snapshot goes first: an engine that has analysed the position answers at once
/// from its cache, and a client drops analysis for a position it has not been told of. An engine
/// that cannot take the position (shut down) is logged: the board still moves.
async fn publish(ctx: &AppContext, session: &GameSession, warnings: bool) -> Response {
    let snapshot = session.snapshot();
    ctx.events.emit(AppEvent::GameSnapshot {
        snapshot: snapshot.clone(),
    });
    let sent = match session.position() {
        Some(position) => ctx.engine.set_position_next(position, session.next()).await,
        None => ctx.engine.clear_position().await,
    };
    if let Err(e) = sent {
        eprintln!("aji: the engine did not take the position: {e}");
    }
    Response::Game {
        snapshot: Box::new(snapshot),
        warnings: match warnings {
            true => session.warnings().to_vec(),
            false => Vec::new(),
        },
    }
}

fn unchanged(session: &GameSession) -> Response {
    Response::Game {
        snapshot: Box::new(session.snapshot()),
        warnings: Vec::new(),
    }
}

async fn game_new(ctx: &AppContext, size: u8) -> Result<Response, ProtocolError> {
    let next = GameSession::new(size, default_rules(ctx))?;
    let mut session = ctx.game.lock().await;
    follow::stop_job(ctx).await;
    session.replace(next);
    let reply = publish(ctx, &session, false).await;
    push_trend(ctx, &session).await;
    Ok(reply)
}

/// Decoding and parsing a large file takes a while, so they run on the blocking pool, before
/// the session is locked.
async fn game_open(
    ctx: &AppContext,
    name: String,
    bytes: String,
) -> Result<Response, ProtocolError> {
    // Base64 is 4 bytes per 3; anything longer than this decodes to more than the limit.
    if bytes.len() > (crate::game::MAX_SGF_BYTES / 3 + 1) * 4 {
        return Err(OpenError::TooLarge.into());
    }
    let ui = ui_settings(ctx);
    let defaults = ui.default_rules;
    let (next, rows) = tokio::task::spawn_blocking(move || {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(bytes.as_bytes())
            .map_err(|e| error(ErrorCode::Internal, format!("bytes are not base64: {e}")))?;
        let session = GameSession::open(&name, &bytes, defaults).map_err(ProtocolError::from)?;
        let rows = lizzie_rows(&session);
        Ok::<_, ProtocolError>((session, rows))
    })
    .await
    .map_err(|e| error(ErrorCode::Internal, e.to_string()))??;
    let mut session = ctx.game.lock().await;
    follow::stop_job(ctx).await;
    session.replace(next);
    // Before the position goes out, so a stored row shows at once.
    if !rows.is_empty() {
        ctx.engine.import(rows).await;
    }
    let reply = publish(ctx, &session, true).await;
    push_trend(ctx, &session).await;
    if ui.analyse_on_open
        && let Err(e) = follow::start_on(ctx, &session, ui.job_options).await
    {
        eprintln!("aji: cannot analyse the opened game: {}", e.message);
    }
    Ok(reply)
}

async fn game_navigate(ctx: &AppContext, to: NavTarget) -> Result<Response, ProtocolError> {
    let mut session = ctx.game.lock().await;
    Ok(match session.navigate(to) {
        true => publish(ctx, &session, false).await,
        false => unchanged(&session),
    })
}

async fn game_set_rules(
    ctx: &AppContext,
    rules: Option<AnalysisRules>,
) -> Result<Response, ProtocolError> {
    let mut session = ctx.game.lock().await;
    let revision = session.revision();
    match session.set_rules(rules) {
        Ok(true) => {
            follow::stop_job(ctx).await;
            let reply = publish(ctx, &session, false).await;
            push_trend(ctx, &session).await;
            Ok(reply)
        }
        Ok(false) if session.revision() != revision => {
            let snapshot = session.snapshot();
            ctx.events.emit(AppEvent::GameSnapshot {
                snapshot: snapshot.clone(),
            });
            Ok(Response::Game {
                snapshot: Box::new(snapshot),
                warnings: Vec::new(),
            })
        }
        Ok(false) => Ok(unchanged(&session)),
        Err(rules) => Err(error(
            ErrorCode::Internal,
            format!("komi out of range: {rules:?}"),
        )),
    }
}

/// Forgets results. `game` and `all` stop the job: its passes would only search them again.
async fn cache_clear(ctx: &AppContext, scope: CacheScope) -> Result<Response, ProtocolError> {
    let session = ctx.game.lock().await;
    let cleared = match scope {
        CacheScope::Position => match session.position() {
            Some(position) => ClearScope::Keys(vec![position.key()]),
            None => return Ok(Response::Ok),
        },
        CacheScope::Game => {
            follow::stop_job(ctx).await;
            ClearScope::Keys(session.line().iter().filter_map(|n| n.key).collect())
        }
        CacheScope::All => {
            follow::stop_job(ctx).await;
            ClearScope::All
        }
    };
    ctx.engine.clear(cleared).await;
    push_trend(ctx, &session).await;
    ctx.events.emit(AppEvent::CacheStatus {
        status: ctx.engine.cache_stats().await,
    });
    Ok(Response::Ok)
}

/// The current position's ownership: the board's latest analysis, else its kept result.
async fn ownership_of(ctx: &AppContext, key: aji_core::PositionKey) -> Option<Vec<i8>> {
    let status = ctx.engine.status();
    if status.position == Some(key)
        && let Some(ownership) = status.analysis.and_then(|a| a.ownership)
    {
        return Some(ownership);
    }
    ctx.engine
        .updates(vec![key])
        .await
        .pop()
        .flatten()
        .and_then(|u| u.ownership)
}

async fn game_score(ctx: &AppContext, mode: ScoreMode) -> Result<Response, ProtocolError> {
    let session = ctx.game.lock().await;
    let rules = session.rules();
    let (scoring, komi) = (ScoringRule::from(rules.scoring()), rules.komi());
    let board = session.board();
    let ownership = match session.position() {
        Some(position) => ownership_of(ctx, position.key()).await,
        None => None,
    };
    let suggested_dead = ownership
        .as_deref()
        .map(|o| suggested_dead(board, o))
        .unwrap_or_default();
    let score = match mode {
        ScoreMode::Estimate => {
            let ownership = ownership.ok_or_else(|| {
                error(
                    ErrorCode::ScoreUnavailable,
                    "no ownership for this position yet",
                )
            })?;
            estimate(board, &ownership, scoring, komi, board.captures())
        }
        ScoreMode::Final { dead } => final_score(
            board,
            &dead,
            ownership.as_deref(),
            scoring,
            komi,
            board.captures(),
        ),
    };
    Ok(Response::Score(ScoreView {
        score,
        suggested_dead,
    }))
}

async fn game_preview(ctx: &AppContext, moves: &[Move]) -> Response {
    Response::GamePreview {
        preview: ctx.game.lock().await.preview(moves),
    }
}

/// With `saveAnalysis` on, every main-line node with a kept result carries it as LizzieYzy's
/// `LZ` (design 5.11).
async fn game_export(ctx: &AppContext) -> Result<Response, ProtocolError> {
    let session = ctx.game.lock().await;
    let lz = match ui_settings(ctx).save_analysis {
        true => {
            let line = session.line();
            let keys = line
                .iter()
                .map(|n| n.key.unwrap_or(PositionKey(0)))
                .collect();
            let updates = ctx.engine.updates(keys).await;
            line.iter()
                .zip(updates)
                .map(|(node, update)| {
                    node.key?;
                    let data =
                        lizzie::lz_from_update(&update?, session.size(), job::to_move(node)?);
                    Some(aji_core::sgf::write_lz(&data))
                })
                .collect()
        }
        false => Vec::new(),
    };
    let (name, text) = session
        .export_with(&lz)
        .ok_or_else(|| error(ErrorCode::GameEmpty, "the game holds no move"))?;
    Ok(Response::GameExport { name, text })
}

fn unknown_engine(engine: &str) -> ProtocolError {
    error(
        ErrorCode::SetupUnknownEngine,
        format!("no engine {engine} in the manifest"),
    )
}

/// The licence hashes the settings record as accepted. Unreadable settings accept nothing, so
/// the user is asked again.
fn accepted_licences(path: &Path) -> BTreeSet<String> {
    match load_settings(path) {
        Ok(settings) => settings.accepted_licences.into_keys().collect(),
        Err(e) => {
            eprintln!("aji: reading the accepted licences: {e}");
            BTreeSet::new()
        }
    }
}

fn setup_licences(ctx: &AppContext, engine: &str) -> Result<Response, ProtocolError> {
    let licences = ctx
        .installer
        .licences(engine)
        .ok_or_else(|| unknown_engine(engine))?;
    let accepted = accepted_licences(&ctx.settings_path);
    let accepted = licences
        .iter()
        .filter(|l| accepted.contains(&l.text_sha256))
        .map(|l| l.text_sha256.clone())
        .collect();
    Ok(Response::SetupLicences { licences, accepted })
}

/// Records the newly accepted licences of `engine`, then starts the job with every licence
/// accepted so far. Hashes that are not `engine`'s licences are ignored. The acceptance stays
/// recorded when the job then cannot start.
fn setup_install(
    ctx: &AppContext,
    engine: String,
    network: String,
    accept_licences: Vec<String>,
    benchmark: bool,
) -> Result<Response, ProtocolError> {
    let licences = ctx
        .installer
        .licences(&engine)
        .ok_or_else(|| unknown_engine(&engine))?;
    let fresh: Vec<String> = accept_licences
        .into_iter()
        .filter(|hash| licences.iter().any(|l| &l.text_sha256 == hash))
        .collect();
    if !fresh.is_empty() {
        record_accepted_licences(&ctx.settings_path, &fresh)
            .map_err(|e| error(ErrorCode::Internal, e.to_string()))?;
    }
    let mut accepted = accepted_licences(&ctx.settings_path);
    accepted.extend(fresh);
    let request = InstallRequest {
        engine,
        network,
        accepted_licences: accepted,
        benchmark,
    };
    match ctx.installer.start(request.clone()) {
        Ok(()) => Ok(Response::Ok),
        Err(StartError::Busy) => Err(error(
            ErrorCode::SetupBusy,
            "an install job is already running",
        )),
        Err(StartError::UnknownEngine) => Err(unknown_engine(&request.engine)),
        Err(StartError::UnknownNetwork) => Err(error(
            ErrorCode::SetupUnknownNetwork,
            format!(
                "no network {} in the manifest or the record",
                request.network
            ),
        )),
    }
}

/// Writes the source to the settings, then hands it to the installer, which applies it from
/// the next download attempt on.
fn set_download_source(
    ctx: &AppContext,
    source: DownloadSource,
) -> Result<Response, ProtocolError> {
    source
        .validate()
        .map_err(|e| error(ErrorCode::SetupInvalidSource, e))?;
    let value =
        serde_json::to_value(&source).map_err(|e| error(ErrorCode::Internal, e.to_string()))?;
    update_settings(&ctx.settings_path, |map| {
        map.insert("downloadSource".into(), value);
    })
    .map_err(|e| error(ErrorCode::Internal, e.to_string()))?;
    ctx.source.send_replace(source);
    Ok(Response::Ok)
}

/// Opens the file dialog, then copies the chosen file into the install root. Both block, so
/// both run on the blocking pool.
async fn import_network(ctx: &AppContext) -> Result<Response, ProtocolError> {
    let internal = |e: tokio::task::JoinError| error(ErrorCode::Internal, e.to_string());
    let files = Arc::clone(&ctx.files);
    let picked = tokio::task::spawn_blocking(move || files.pick_network())
        .await
        .map_err(internal)?;
    let Some(file) = picked else {
        return Ok(Response::SetupImportNetwork { network: None });
    };
    let installer = Arc::clone(&ctx.installer);
    let imported = tokio::task::spawn_blocking(move || installer.import_network(&file))
        .await
        .map_err(internal)?;
    match imported {
        Ok(network) => Ok(Response::SetupImportNetwork {
            network: Some(network),
        }),
        Err(ImportError::NotGzip) => Err(error(
            ErrorCode::SetupImportFailed,
            "the file is not gzip-compressed",
        )),
        // Reading or copying failed: not the file's fault, so not `setupImportFailed`'s text.
        Err(ImportError::Io(e)) => Err(error(ErrorCode::Internal, e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use aji_engine::EngineState;
    use aji_manager::install::{
        EngineSet, FailureCode, InstalledEngine, InstalledNetwork, JobOutcome, engine_files,
        save_installed,
    };
    use aji_manager::manifest::Backend;

    use crate::settings::{DevEngine, Settings, load_settings};
    use crate::test_support::{apple_m5, installer, setup, unconfigured};

    /// The dialog's answer: a file, or `None` for a cancelled dialog.
    struct Picks(Option<PathBuf>);

    impl FilePicker for Picks {
        fn pick_network(&self) -> Option<PathBuf> {
            self.0.clone()
        }
    }

    /// A context whose install root and `settings.json` live in `dir`. Must run on a Tokio
    /// runtime: the installer runs its jobs there.
    fn ctx_in(dir: &Path, picks: Option<PathBuf>) -> AppContext {
        let setup = setup(apple_m5());
        let engine = unconfigured();
        let source = watch::Sender::new(DownloadSource::Direct);
        let installer = installer(
            &dir.join("data"),
            Arc::clone(&setup),
            engine.clone(),
            source.subscribe(),
        );
        AppContext {
            version: "0.1.0".into(),
            os: OsKind::Macos,
            arch: "aarch64".into(),
            engine,
            setup,
            installer,
            settings_path: dir.join("config").join("settings.json"),
            files: Arc::new(Picks(picks)),
            source,
            events: Arc::new(Recorded::default()),
            game: Arc::new(Mutex::new(
                GameSession::new(19, AnalysisRules::Chinese).unwrap(),
            )),
            follow: Arc::default(),
        }
    }

    /// Keeps every event, for tests that check what a request emits.
    #[derive(Default)]
    struct Recorded(std::sync::Mutex<Vec<AppEvent>>);

    impl EventSink for Recorded {
        fn emit(&self, event: AppEvent) {
            self.0.lock().unwrap().push(event);
        }
    }

    /// A context whose folders are never written.
    fn ctx() -> AppContext {
        ctx_in(Path::new("no-such-aji-folder"), None)
    }

    fn settings_json(ctx: &AppContext) -> serde_json::Value {
        serde_json::from_str(&std::fs::read_to_string(&ctx.settings_path).unwrap()).unwrap()
    }

    const CUDA_ENGINE: &str = "katago-v1.18.2-cuda12.8-cudnn9.8.0-windows-x64";
    const NETWORK: &str = "kata1-tf3-b11c768-s12382M-d6533M";
    const CUDA_EULA: &str = "e2c71babfd18a8e69542dd7e9ca018f9caa438094001a58e6bc4d8c999bf0d07";

    #[tokio::test]
    async fn setup_status_is_empty_before_any_job() {
        assert_eq!(
            handle(&ctx(), Request::SetupStatus).await,
            Ok(Response::SetupStatus { job: None })
        );
    }

    #[tokio::test]
    async fn setup_install_with_an_unknown_engine_is_an_error() {
        let dir = tempfile::tempdir().unwrap();
        let ctx = ctx_in(dir.path(), None);
        let error = handle(
            &ctx,
            Request::SetupInstall {
                engine: "nope".into(),
                network: NETWORK.into(),
                accept_licences: vec![CUDA_EULA.into()],
                benchmark: false,
            },
        )
        .await
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::SetupUnknownEngine);
        assert_eq!(
            handle(&ctx, Request::SetupStatus).await,
            Ok(Response::SetupStatus { job: None })
        );
        assert!(
            !ctx.settings_path.exists(),
            "nothing is recorded for an unknown engine"
        );
    }

    #[tokio::test]
    async fn setup_install_with_an_unknown_network_is_an_error() {
        let dir = tempfile::tempdir().unwrap();
        let ctx = ctx_in(dir.path(), None);
        let error = handle(
            &ctx,
            Request::SetupInstall {
                engine: CUDA_ENGINE.into(),
                network: "nope".into(),
                accept_licences: vec![],
                benchmark: false,
            },
        )
        .await
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::SetupUnknownNetwork);
    }

    #[tokio::test]
    async fn setting_the_download_source_writes_settings() {
        let dir = tempfile::tempdir().unwrap();
        let ctx = ctx_in(dir.path(), None);
        let mirror = DownloadSource::Mirror {
            url: "https://mirror.example/katago".into(),
        };
        let mut seen = ctx.source.subscribe();
        assert_eq!(
            handle(
                &ctx,
                Request::SetupSetDownloadSource {
                    source: mirror.clone()
                }
            )
            .await,
            Ok(Response::Ok)
        );
        assert_eq!(*seen.borrow_and_update(), mirror);
        assert_eq!(
            settings_json(&ctx)["downloadSource"],
            serde_json::json!({"kind": "mirror", "url": "https://mirror.example/katago"})
        );
        assert_eq!(
            load_settings(&ctx.settings_path).unwrap().download_source,
            mirror
        );
    }

    #[tokio::test]
    async fn an_invalid_download_source_is_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let ctx = ctx_in(dir.path(), None);
        let error = handle(
            &ctx,
            Request::SetupSetDownloadSource {
                source: DownloadSource::Mirror {
                    url: "ftp://x".into(),
                },
            },
        )
        .await
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::SetupInvalidSource);
        assert_eq!(*ctx.source.borrow(), DownloadSource::Direct);
        assert!(!ctx.settings_path.exists());
    }

    #[tokio::test]
    async fn accepted_licences_are_recorded_with_a_time() {
        let dir = tempfile::tempdir().unwrap();
        let ctx = ctx_in(dir.path(), None);
        let Ok(Response::SetupLicences { licences, accepted }) = handle(
            &ctx,
            Request::SetupLicences {
                engine: CUDA_ENGINE.into(),
            },
        )
        .await
        else {
            panic!("expected setupLicences");
        };
        assert!(
            licences.iter().any(|l| l.text_sha256 == CUDA_EULA),
            "{licences:?}"
        );
        assert!(accepted.is_empty());

        let response = handle(
            &ctx,
            Request::SetupInstall {
                engine: CUDA_ENGINE.into(),
                network: NETWORK.into(),
                // A hash that is not one of this engine's licences is not recorded.
                accept_licences: vec![CUDA_EULA.into(), "not-a-licence".into()],
                benchmark: false,
            },
        )
        .await;
        assert_eq!(response, Ok(Response::Ok));
        // The job fails its space check without fetching anything.
        let job = ctx.installer.finished().await.expect("a job ran");
        assert!(job.outcome.is_some(), "{job:?}");

        let recorded = settings_json(&ctx)["acceptedLicences"].clone();
        let recorded = recorded.as_object().expect("an object");
        assert_eq!(recorded.keys().collect::<Vec<_>>(), [CUDA_EULA]);
        let time = recorded[CUDA_EULA].as_str().unwrap();
        assert!(
            time.len() == 20 && time.as_bytes()[10] == b'T' && time.ends_with('Z'),
            "{time}"
        );

        let Ok(Response::SetupLicences { accepted, .. }) = handle(
            &ctx,
            Request::SetupLicences {
                engine: CUDA_ENGINE.into(),
            },
        )
        .await
        else {
            panic!("expected setupLicences");
        };
        assert_eq!(accepted, [CUDA_EULA]);
    }

    /// Licences accepted in an earlier session reach the job, so it gets past its licence
    /// check (here to the space check) without the UI sending them again.
    #[tokio::test]
    async fn earlier_acceptances_carry_into_a_later_install() {
        let dir = tempfile::tempdir().unwrap();
        let ctx = ctx_in(dir.path(), None);
        let licences = ctx.installer.licences(CUDA_ENGINE).unwrap();
        assert!(!licences.is_empty());
        let earlier: serde_json::Map<_, _> = licences
            .iter()
            .map(|l| (l.text_sha256.clone(), "2026-01-01T00:00:00Z".into()))
            .collect();
        update_settings(&ctx.settings_path, |map| {
            map.insert("acceptedLicences".into(), earlier.clone().into());
        })
        .unwrap();
        let response = handle(
            &ctx,
            Request::SetupInstall {
                engine: CUDA_ENGINE.into(),
                network: NETWORK.into(),
                accept_licences: vec![],
                benchmark: false,
            },
        )
        .await;
        assert_eq!(response, Ok(Response::Ok));
        let job = ctx.installer.finished().await.expect("a job ran");
        assert!(
            matches!(
                job.outcome,
                Some(JobOutcome::Failed {
                    failure: FailureCode::NotEnoughSpace,
                    ..
                })
            ),
            "{job:?}"
        );
        // Nothing new was accepted, so the earlier times stand.
        assert_eq!(
            settings_json(&ctx)["acceptedLicences"],
            serde_json::Value::from(earlier)
        );
    }

    #[tokio::test]
    async fn setup_licences_for_an_unknown_engine_is_an_error() {
        let error = handle(
            &ctx(),
            Request::SetupLicences {
                engine: "nope".into(),
            },
        )
        .await
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::SetupUnknownEngine);
    }

    #[tokio::test]
    async fn a_cancelled_import_dialog_gives_no_network() {
        assert_eq!(
            handle(&ctx(), Request::SetupImportNetwork).await,
            Ok(Response::SetupImportNetwork { network: None })
        );
    }

    #[tokio::test]
    async fn importing_a_file_that_is_not_gzip_fails() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("notes.txt");
        std::fs::write(&file, "not a network").unwrap();
        let ctx = ctx_in(dir.path(), Some(file));
        let error = handle(&ctx, Request::SetupImportNetwork).await.unwrap_err();
        assert_eq!(error.code, ErrorCode::SetupImportFailed);
    }

    #[tokio::test]
    async fn importing_a_network_records_it() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("my net.bin.gz");
        std::fs::write(&file, [0x1f, 0x8b, 8, 0]).unwrap();
        let ctx = ctx_in(dir.path(), Some(file));
        let Ok(Response::SetupImportNetwork {
            network: Some(network),
        }) = handle(&ctx, Request::SetupImportNetwork).await
        else {
            panic!("expected an imported network");
        };
        assert_eq!(network.name, "my net");
        assert!(ctx.installer.installed().networks.contains_key(&network.id));
    }

    fn installed_with_an_active_set(root: &InstallRoot) -> Installed {
        let mut installed = Installed::default();
        installed.engines.insert(
            "eng".into(),
            InstalledEngine {
                backend: Backend::Metal,
                version: "1.18.2".into(),
                binary: "katago".into(),
            },
        );
        installed.networks.insert(
            "net".into(),
            InstalledNetwork {
                file: "net.bin.gz".into(),
                name: "net".into(),
                imported: false,
            },
        );
        let set = EngineSet {
            engine: "eng".into(),
            network: "net".into(),
            runtime: None,
            config: "configs/eng/net.cfg".into(),
            threads: 8,
            benchmark: vec![],
        };
        installed.active = Some(set.key());
        installed.put_set(set);
        assert!(engine_files(root, &installed, installed.active_set().unwrap()).is_some());
        installed
    }

    #[test]
    fn startup_prefers_the_dev_engine_then_the_active_set() {
        let base = std::env::temp_dir().join("aji-startup");
        let root = InstallRoot::new(base.join("data"));
        let installed = installed_with_an_active_set(&root);
        let dev = DevEngine {
            katago: base.join("dev").join("katago"),
            model: base.join("dev").join("m.bin.gz"),
            config: base.join("dev").join("a.cfg"),
        };
        let with_dev = Settings {
            dev_engine: Some(dev.clone()),
            ..Settings::default()
        };
        assert_eq!(
            startup_files(&with_dev, &installed, &root),
            Some(dev.files())
        );
        let active = startup_files(&Settings::default(), &installed, &root).unwrap();
        assert_eq!(active.katago, root.engine_dir("eng").join("katago"));
        assert_eq!(active.working_dir, root.root());
        assert_eq!(
            startup_files(&Settings::default(), &Installed::default(), &root),
            None
        );
    }

    #[test]
    fn running_names_the_dev_engine_without_a_backend() {
        let root = InstallRoot::new(std::env::temp_dir().join("aji-running").join("data"));
        let installed = installed_with_an_active_set(&root);
        let dev = DevEngine {
            katago: "/dev/katago".into(),
            model: "/dev/models/m.bin.gz".into(),
            config: "/dev/a.cfg".into(),
        };
        let settings = Settings {
            dev_engine: Some(dev),
            ..Settings::default()
        };
        assert_eq!(
            running_engine(&settings, &installed),
            Some(RunningEngine {
                backend: None,
                network_name: "m.bin.gz".into()
            })
        );
    }

    #[test]
    fn running_names_the_active_set() {
        let root = InstallRoot::new(std::env::temp_dir().join("aji-running").join("data"));
        let installed = installed_with_an_active_set(&root);
        assert_eq!(
            running_engine(&Settings::default(), &installed),
            Some(RunningEngine {
                backend: Some(Backend::Metal),
                network_name: "net".into()
            })
        );
        assert_eq!(
            running_engine(&Settings::default(), &Installed::default()),
            None
        );
    }

    #[test]
    fn a_rejection_is_forwarded_as_analysis_rejected() {
        let recorder = Arc::new(Recorder::default());
        let (tx, mut rx) = mpsc::unbounded_channel();
        let forward = forward_engine_events(recorder.clone(), tx);
        let rejection = aji_engine::Rejection {
            position: aji_core::PositionKey(9),
            message: "no".into(),
        };
        forward(EngineEvent::Rejected(rejection.clone()));
        assert_eq!(
            *recorder.0.lock().unwrap(),
            vec![AppEvent::AnalysisRejected { rejection }]
        );
        // Kept results go to the follower, not to clients.
        forward(EngineEvent::Stored {
            key: aji_core::PositionKey(9),
            stats: aji_engine::TrendStats {
                winrate: 0.5,
                score_lead: 0.0,
                visits: 1,
            },
        });
        assert_eq!(recorder.0.lock().unwrap().len(), 1);
        assert!(matches!(rx.try_recv(), Ok(EngineEvent::Stored { .. })));
    }

    #[tokio::test]
    async fn analysis_continue_reaches_the_engine() {
        let error = handle(&ctx(), Request::AnalysisContinue).await.unwrap_err();
        assert_eq!(error.code, ErrorCode::EngineNotRunning);
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

    async fn metal_versions(ctx: &AppContext) -> Vec<aji_manager::recommend::EngineVersionChoice> {
        let Ok(Response::SetupVersions { versions }) = handle(
            ctx,
            Request::SetupVersions {
                backend: Backend::Metal,
            },
        )
        .await
        else {
            panic!("expected setupVersions");
        };
        versions
    }

    #[tokio::test]
    async fn setup_lists_mark_what_is_already_downloaded() {
        let dir = tempfile::tempdir().unwrap();
        let ctx = ctx_in(dir.path(), None);
        let engine = metal_versions(&ctx).await[0].engine.clone();
        let Ok(Response::SetupNetworks { networks }) = handle(
            &ctx,
            Request::SetupNetworks {
                engine: engine.clone(),
            },
        )
        .await
        else {
            panic!("expected setupNetworks");
        };
        assert!(networks.networks.len() > 1);
        assert!(networks.networks.iter().all(|n| !n.installed));
        let network = networks.networks[1].network.clone();

        let root = InstallRoot::new(dir.path().join("data"));
        let mut installed = Installed::default();
        installed.engines.insert(
            engine.clone(),
            InstalledEngine {
                backend: Backend::Metal,
                version: "1.18.2".into(),
                binary: "katago".into(),
            },
        );
        installed.networks.insert(
            network.clone(),
            InstalledNetwork {
                file: format!("{network}.bin.gz"),
                name: network.clone(),
                imported: false,
            },
        );
        save_installed(&root.record_file(), &installed).unwrap();

        assert!(metal_versions(&ctx).await[0].installed);
        let Ok(Response::SetupNetworks { networks }) =
            handle(&ctx, Request::SetupNetworks { engine }).await
        else {
            panic!("expected setupNetworks");
        };
        let marked: Vec<&str> = networks
            .networks
            .iter()
            .filter(|n| n.installed)
            .map(|n| n.network.as_str())
            .collect();
        assert_eq!(marked, [network.as_str()]);
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
            handle(&ctx(), Request::SetupDetect { refresh: false }).await,
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

    #[test]
    fn invalid_position_has_its_own_code() {
        let error = ProtocolError::from(EngineError::InvalidPosition);
        assert_eq!(error.code, ErrorCode::InvalidPosition);
    }

    #[tokio::test]
    async fn engine_status_reports_not_configured() {
        assert_eq!(
            handle(&ctx(), Request::EngineStatus).await,
            Ok(Response::EngineStatus {
                engine: EngineState::NotConfigured,
                position: Some(aji_core::PositionKey(0x3edb_a656_b924_370b)),
                analysis: None,
                rejected: None,
                running: None,
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
    struct Recorder(std::sync::Mutex<Vec<AppEvent>>);

    impl EventSink for Recorder {
        fn emit(&self, event: AppEvent) {
            self.0.lock().unwrap().push(event);
        }
    }

    #[test]
    fn engine_state_events_are_forwarded() {
        let recorder = Arc::new(Recorder::default());
        let forward = forward_engine_events(recorder.clone(), mpsc::unbounded_channel().0);
        forward(EngineEvent::State(EngineState::Starting));
        assert_eq!(
            *recorder.0.lock().unwrap(),
            vec![AppEvent::EngineState {
                engine: EngineState::Starting
            }]
        );
    }

    // ------------------------------------------------------------ M5

    #[tokio::test]
    async fn settings_set_saves_applies_and_emits() {
        use crate::settings::{DiscField, LanguagePreference, ThemePreference};
        let dir = tempfile::tempdir().unwrap();
        let mut ctx = ctx_in(dir.path(), None);
        let recorded = Arc::new(Recorded::default());
        ctx.events = recorded.clone();
        let settings = UiSettings {
            language: LanguagePreference::En,
            theme: ThemePreference::Light,
            disc_lines: [DiscField::ScoreLead, DiscField::Visits],
            visit_limit: Some(800),
            default_rules: AnalysisRules::JapaneseKorean,
            show_coordinates: false,
            perspective: crate::settings::Perspective::White,
            ..UiSettings::default()
        };
        assert_eq!(
            handle(
                &ctx,
                Request::SettingsSet {
                    settings: settings.clone()
                }
            )
            .await,
            Ok(Response::Settings {
                settings: settings.clone()
            })
        );
        assert_eq!(load_settings(&ctx.settings_path).unwrap().ui, settings);
        assert_eq!(
            handle(&ctx, Request::SettingsGet).await,
            Ok(Response::Settings {
                settings: settings.clone()
            })
        );
        assert_eq!(
            *recorded.0.lock().unwrap(),
            [AppEvent::SettingsChanged { settings }]
        );
    }

    #[tokio::test]
    async fn settings_get_without_a_file_gives_the_defaults() {
        assert_eq!(
            handle(&ctx(), Request::SettingsGet).await,
            Ok(Response::Settings {
                settings: UiSettings::default()
            })
        );
    }

    #[tokio::test]
    async fn restart_is_refused_while_the_installer_holds_the_engine() {
        let ctx = ctx();
        ctx.installer.set_holds_engine(true);
        for request in [Request::EngineRestart, Request::AnalysisResume] {
            assert_eq!(
                handle(&ctx, request).await.unwrap_err().code,
                ErrorCode::EngineBusy
            );
        }
        ctx.installer.set_holds_engine(false);
        assert_eq!(
            handle(&ctx, Request::EngineRestart).await.unwrap_err().code,
            ErrorCode::EngineNotConfigured
        );
    }

    #[tokio::test]
    async fn detect_with_refresh_redetects() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let mut ctx = ctx();
        let calls = Arc::new(AtomicUsize::new(0));
        let counted = Arc::clone(&calls);
        ctx.setup = Arc::new(Setup::with_detector(
            aji_manager::manifest::ManifestStore::fixed(
                aji_manager::manifest::parse_manifest(aji_manager::manifest::BUNDLED).unwrap(),
            ),
            Arc::new(move || {
                counted.fetch_add(1, Ordering::SeqCst);
                apple_m5()
            }),
        ));
        handle(&ctx, Request::SetupDetect { refresh: false })
            .await
            .unwrap();
        handle(&ctx, Request::SetupDetect { refresh: false })
            .await
            .unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        handle(&ctx, Request::SetupDetect { refresh: true })
            .await
            .unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn installed_reports_no_active_set_on_an_empty_root() {
        let dir = tempfile::tempdir().unwrap();
        let ctx = ctx_in(dir.path(), None);
        assert_eq!(
            handle(&ctx, Request::SetupInstalled).await,
            Ok(Response::SetupInstalled {
                active: None,
                unused_bytes: 0
            })
        );
        assert_eq!(
            handle(&ctx, Request::SetupRemoveUnused).await,
            Ok(Response::SetupRemoved { freed_bytes: 0 })
        );
    }

    // ------------------------------------------------------------ M6: the game session

    use aji_core::game::{AnalysisRules, Game, Scoring};
    use aji_core::sgf::parse_sgf;
    use aji_core::{BoardSize, Komi, Move, Point};

    use crate::game::{GameWarning, NavTarget};
    use crate::protocol::GameSnapshot;

    const SAMSUNG: &[u8] =
        include_bytes!("../../crates/aji-core/tests/fixtures/sgf/samsung-2025-final-2.sgf");
    const GBK_NO_CA: &[u8] =
        include_bytes!("../../crates/aji-core/tests/fixtures/sgf/gbk-no-ca.sgf");
    const COLLECTION: &[u8] =
        include_bytes!("../../crates/aji-core/tests/fixtures/sgf/collection.sgf");
    const SMALL: &str = "(;GM[1]FF[4]SZ[9]KM[7]RU[Chinese];B[ee];W[gc];B[cg];W[ce])";

    fn b64(bytes: &[u8]) -> String {
        base64::engine::general_purpose::STANDARD.encode(bytes)
    }

    async fn open(ctx: &AppContext, name: &str, bytes: &[u8]) -> Result<Response, ProtocolError> {
        handle(
            ctx,
            Request::GameOpen {
                name: name.into(),
                bytes: b64(bytes),
            },
        )
        .await
    }

    fn snap(response: Result<Response, ProtocolError>) -> (GameSnapshot, Vec<GameWarning>) {
        match response {
            Ok(Response::Game { snapshot, warnings }) => (*snapshot, warnings),
            other => panic!("expected a game reply, got {other:?}"),
        }
    }

    async fn navigate(ctx: &AppContext, to: NavTarget) -> GameSnapshot {
        snap(handle(ctx, Request::GameNavigate { to }).await).0
    }

    /// The game the tests opened, built again, to compute the positions the engine should get.
    fn reference(bytes: &[u8]) -> Game {
        let text = aji_core::sgf::decode(bytes).text;
        let tree = parse_sgf(&text).unwrap().games.remove(0);
        Game::from_sgf(tree, AnalysisRules::Chinese).unwrap().0
    }

    fn main_line_key(game: &Game, index: usize, rules: &AnalysisRules) -> aji_core::PositionKey {
        game.position_at(game.main_line()[index], rules)
            .unwrap()
            .key()
    }

    fn game_events(ctx: &AppContext, recorded: &Recorded) -> Vec<u64> {
        let _ = ctx;
        recorded
            .0
            .lock()
            .unwrap()
            .iter()
            .filter_map(|e| match e {
                AppEvent::GameSnapshot { snapshot } => Some(snapshot.revision),
                _ => None,
            })
            .collect()
    }

    #[tokio::test]
    async fn open_navigate_and_export() {
        let ctx = ctx();
        let (s, warnings) = snap(open(&ctx, "small.sgf", SMALL.as_bytes()).await);
        assert!(warnings.is_empty(), "{warnings:?}");
        assert_eq!(s.name.as_deref(), Some("small"));
        assert_eq!((s.size, s.move_number, s.main_line_length), (9, 0, 4));
        assert!(s.at_start && !s.at_end && s.has_moves);
        let game = reference(SMALL.as_bytes());
        let rules = AnalysisRules::Custom {
            details: None,
            komi: Komi::new(7.0).unwrap(),
            scoring: Scoring::Area,
        };
        assert_eq!(s.rules.current, rules);
        assert_eq!(s.position_key, Some(main_line_key(&game, 0, &rules)));
        assert_eq!(ctx.engine.status().position, s.position_key);

        let s = navigate(&ctx, NavTarget::Last).await;
        assert!(s.at_end && !s.at_start);
        assert_eq!(s.move_number, 4);
        assert_eq!(s.next_color, aji_core::Color::Black);
        assert_eq!(s.last_move, Some(Move::Play(Point { x: 2, y: 4 })));
        assert_eq!(
            ctx.engine.status().position,
            Some(main_line_key(&game, 4, &rules))
        );
        assert_eq!(s.stones.iter().flatten().count(), 4);

        navigate(&ctx, NavTarget::First).await;
        let s = navigate(&ctx, NavTarget::Move(9999)).await;
        assert!(s.at_end);
        let s = navigate(&ctx, NavTarget::Move(2)).await;
        assert_eq!(s.move_number, 2);
        let s = navigate(&ctx, NavTarget::Previous).await;
        assert_eq!(s.move_number, 1);
        let s = navigate(&ctx, NavTarget::Next).await;
        assert_eq!(s.move_number, 2);

        let Ok(Response::GameExport { name, text }) = handle(&ctx, Request::GameExport).await
        else {
            panic!("expected an export");
        };
        assert_eq!(name, "small.sgf");
        let again = Game::from_sgf(
            parse_sgf(&text).unwrap().games.remove(0),
            AnalysisRules::Chinese,
        )
        .unwrap()
        .0;
        let moves =
            |g: &Game| -> Vec<_> { g.main_line().iter().map(|&n| g.last_move(n)).collect() };
        assert_eq!(moves(&again), moves(&game));
        assert!(text.contains("KM[7]"), "{text}");
    }

    #[tokio::test]
    async fn an_illegal_node_keeps_its_move_and_has_no_stats() {
        let ctx = ctx();
        open(&ctx, "illegal.sgf", b"(;GM[1]FF[4]SZ[9];B[cc];W[cc])")
            .await
            .unwrap();
        let Ok(Response::Trend { nodes, .. }) = handle(&ctx, Request::GameTrend).await else {
            panic!("expected a trend");
        };
        assert_eq!(nodes.len(), 3);
        assert_eq!(nodes[2].mover, Some(aji_core::Color::White));
        assert_eq!(nodes[2].mv, Some(Move::Play(Point { x: 2, y: 2 })));
        assert_eq!((nodes[2].stats, nodes[2].loss), (None, None));
    }

    #[tokio::test]
    async fn game_trend_has_a_node_per_main_line_node() {
        let ctx = ctx();
        open(&ctx, "samsung.sgf", SAMSUNG).await.unwrap();
        let Ok(Response::Trend { nodes, .. }) = handle(&ctx, Request::GameTrend).await else {
            panic!("expected a trend");
        };
        let game = reference(SAMSUNG);
        assert_eq!(nodes.len(), game.main_line().len());
        assert!(nodes.iter().all(|n| n.stats.is_none()), "no engine ran");
    }

    fn trend_events(recorded: &Recorded) -> usize {
        recorded
            .0
            .lock()
            .unwrap()
            .iter()
            .filter(|e| matches!(e, AppEvent::GameTrend { .. }))
            .count()
    }

    #[tokio::test]
    async fn game_trend_is_pushed_on_open_new_and_rules_change_not_on_navigate() {
        let mut ctx = ctx();
        let recorded = Arc::new(Recorded::default());
        ctx.events = recorded.clone();
        open(&ctx, "samsung.sgf", SAMSUNG).await.unwrap();
        assert_eq!(trend_events(&recorded), 1);
        navigate(&ctx, NavTarget::Next).await;
        navigate(&ctx, NavTarget::Last).await;
        assert_eq!(trend_events(&recorded), 1);
        handle(
            &ctx,
            Request::GameSetRules {
                rules: Some(AnalysisRules::Custom {
                    details: None,
                    komi: Komi::new(0.5).unwrap(),
                    scoring: Scoring::Area,
                }),
            },
        )
        .await
        .unwrap();
        assert_eq!(trend_events(&recorded), 2);
        handle(&ctx, Request::GameNew { size: 9 }).await.unwrap();
        assert_eq!(trend_events(&recorded), 3);
    }

    #[tokio::test]
    async fn navigation_is_ordered() {
        let ctx = Arc::new(ctx());
        open(&ctx, "samsung.sgf", SAMSUNG).await.unwrap();
        let tasks: Vec<_> = (0..50)
            .map(|_| {
                let ctx = Arc::clone(&ctx);
                tokio::spawn(async move {
                    handle(
                        &ctx,
                        Request::GameNavigate {
                            to: NavTarget::Next,
                        },
                    )
                    .await
                })
            })
            .collect();
        for task in tasks {
            task.await.unwrap().unwrap();
        }
        let s = snap(handle(&ctx, Request::GameSnapshot).await).0;
        assert_eq!(s.move_number, 50);
        let game = reference(SAMSUNG);
        assert_eq!(
            ctx.engine.status().position,
            Some(main_line_key(&game, 50, &s.rules.current))
        );
    }

    #[tokio::test]
    async fn illegal_node_clears_the_engine() {
        let ctx = ctx();
        let text = "(;GM[1]FF[4]SZ[19];B[pd];W[pd];B[dd])";
        open(&ctx, "occupied.sgf", text.as_bytes()).await.unwrap();
        let s = navigate(&ctx, NavTarget::Move(2)).await;
        assert_eq!(s.illegal, Some(aji_core::game::Illegal::Occupied));
        assert_eq!(s.position_key, None);
        assert_eq!(ctx.engine.status().position, None);
        let s = navigate(&ctx, NavTarget::Next).await;
        assert_eq!(s.illegal, None);
        assert!(s.position_key.is_some());
        assert_eq!(ctx.engine.status().position, s.position_key);
    }

    #[tokio::test]
    async fn set_rules() {
        let ctx = ctx();
        open(&ctx, "small.sgf", SMALL.as_bytes()).await.unwrap();
        navigate(&ctx, NavTarget::Next).await;
        let custom = AnalysisRules::Custom {
            details: None,
            komi: Komi::new(7.0).unwrap(),
            scoring: Scoring::Territory,
        };
        let s = snap(
            handle(
                &ctx,
                Request::GameSetRules {
                    rules: Some(custom),
                },
            )
            .await,
        )
        .0;
        assert!(s.rules.changed);
        assert_eq!(s.rules.current, custom);
        assert_eq!(s.rules.ru.as_deref(), Some("Chinese"));
        assert_eq!(s.rules.km.as_deref(), Some("7"));
        let game = reference(SMALL.as_bytes());
        let expected = game.position_at(game.main_line()[1], &custom).unwrap();
        assert_eq!(expected.komi, Komi::new(7.0).unwrap());
        assert_eq!(expected.rules, aji_core::Rules::Japanese.into());
        assert_eq!(ctx.engine.status().position, Some(expected.key()));
        let Ok(Response::GameExport { text, .. }) = handle(&ctx, Request::GameExport).await else {
            panic!("expected an export");
        };
        assert!(
            text.contains("RU[Japanese]") && text.contains("KM[7]"),
            "{text}"
        );

        let s = snap(handle(&ctx, Request::GameSetRules { rules: None }).await).0;
        assert!(!s.rules.changed);
        assert_eq!(s.rules.current, s.rules.from_file);
        let Ok(Response::GameExport { text, .. }) = handle(&ctx, Request::GameExport).await else {
            panic!("expected an export");
        };
        assert!(
            text.contains("RU[Chinese]") && !text.contains("RU[Japanese]"),
            "{text}"
        );

        let wild = AnalysisRules::Custom {
            details: None,
            komi: Komi::new(151.0).unwrap(),
            scoring: Scoring::Area,
        };
        let error = handle(&ctx, Request::GameSetRules { rules: Some(wild) })
            .await
            .unwrap_err();
        assert_eq!(error.code, ErrorCode::Internal);
    }

    #[tokio::test]
    async fn new_game_uses_default_rules() {
        let dir = tempfile::tempdir().unwrap();
        let ctx = ctx_in(dir.path(), None);
        std::fs::create_dir_all(dir.path().join("config")).unwrap();
        std::fs::write(
            &ctx.settings_path,
            r#"{"defaultRules":{"kind":"japaneseKorean"}}"#,
        )
        .unwrap();
        let s = snap(handle(&ctx, Request::GameNew { size: 13 }).await).0;
        assert_eq!(s.size, 13);
        assert_eq!(s.rules.current, AnalysisRules::JapaneseKorean);
        assert!(!s.has_moves && s.at_start && s.at_end);
        assert_eq!(s.name, None);
        let position = aji_core::Position::empty(
            BoardSize::new(13).unwrap(),
            aji_core::Rules::Japanese.into(),
            Komi::new(6.5).unwrap(),
        );
        assert_eq!(ctx.engine.status().position, Some(position.key()));
        let error = handle(&ctx, Request::GameNew { size: 4 })
            .await
            .unwrap_err();
        assert_eq!(error.code, ErrorCode::SgfUnsupportedSize);
        assert_eq!(snap(handle(&ctx, Request::GameSnapshot).await).0.size, 13);
        let error = handle(&ctx, Request::GameExport).await.unwrap_err();
        assert_eq!(error.code, ErrorCode::GameEmpty);
    }

    #[tokio::test]
    async fn open_errors() {
        let ctx = ctx();
        open(&ctx, "small.sgf", SMALL.as_bytes()).await.unwrap();
        let big = vec![b' '; 20 * 1024 * 1024 + 1];
        let cases: [(&[u8], ErrorCode); 4] = [
            (&big, ErrorCode::SgfTooLarge),
            (b"hello", ErrorCode::SgfNotAGame),
            (b"(;GM[2]FF[4]SZ[8];B[aa])", ErrorCode::SgfNotGo),
            (
                b"(;GM[1]FF[4]SZ[19:13];B[aa])",
                ErrorCode::SgfUnsupportedSize,
            ),
        ];
        for (bytes, code) in cases {
            let error = open(&ctx, "bad.sgf", bytes).await.unwrap_err();
            assert_eq!(error.code, code);
            if code == ErrorCode::SgfUnsupportedSize {
                assert_eq!(error.detail.as_deref(), Some("19x13"));
            } else {
                assert_eq!(error.detail, None);
            }
        }
        let error = handle(
            &ctx,
            Request::GameOpen {
                name: "bad.sgf".into(),
                bytes: "not base64!".into(),
            },
        )
        .await
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::Internal);
        let s = snap(handle(&ctx, Request::GameSnapshot).await).0;
        assert_eq!(s.name.as_deref(), Some("small"));
        assert_eq!(s.size, 9);
    }

    #[tokio::test]
    async fn warnings_are_reported() {
        let ctx = ctx();
        let (_, warnings) = snap(open(&ctx, "gbk.sgf", GBK_NO_CA).await);
        assert_eq!(
            warnings,
            [GameWarning::EncodingGuessed {
                encoding: "GBK".into()
            }]
        );
        let (s, warnings) = snap(open(&ctx, "two.sgf", COLLECTION).await);
        assert_eq!(warnings, [GameWarning::ExtraGames { count: 1 }]);
        assert_eq!(s.info.game_name.as_deref(), Some("first"));
        let Ok(Response::GameExport { text, .. }) = handle(&ctx, Request::GameExport).await else {
            panic!("expected an export");
        };
        assert_eq!(parse_sgf(&text).unwrap().games.len(), 2, "{text}");

        let (_, warnings) = snap(open(&ctx, "cut.sgf", b"(;GM[1]SZ[19]KM[x];B[pd];W[dd]").await);
        assert_eq!(
            warnings,
            [GameWarning::Truncated, GameWarning::KomiUnreadable]
        );
        let (_, warnings) = snap(open(&ctx, "bad.sgf", b"(;GM[1]SZ[19];B[pd];W[pd])").await);
        assert_eq!(warnings, [GameWarning::IllegalMoves]);
        // The last open's warnings come with a fresh snapshot, for a client that reloads.
        let (_, warnings) = snap(handle(&ctx, Request::GameSnapshot).await);
        assert_eq!(warnings, [GameWarning::IllegalMoves]);
        let (_, warnings) = snap(
            handle(
                &ctx,
                Request::GameNavigate {
                    to: NavTarget::Next,
                },
            )
            .await,
        );
        assert!(warnings.is_empty());
    }

    #[tokio::test]
    async fn snapshot_events() {
        let mut ctx = ctx();
        let recorded = Arc::new(Recorded::default());
        ctx.events = recorded.clone();
        open(&ctx, "small.sgf", SMALL.as_bytes()).await.unwrap();
        navigate(&ctx, NavTarget::Next).await;
        // No change: already at the start after `first`, so `previous` changes nothing.
        navigate(&ctx, NavTarget::First).await;
        navigate(&ctx, NavTarget::Previous).await;
        handle(
            &ctx,
            Request::GameSetRules {
                rules: Some(AnalysisRules::Chinese),
            },
        )
        .await
        .unwrap();
        handle(&ctx, Request::GameNew { size: 9 }).await.unwrap();
        handle(&ctx, Request::GameSnapshot).await.unwrap();
        let revisions = game_events(&ctx, &recorded);
        assert_eq!(revisions.len(), 5, "{revisions:?}");
        assert!(revisions.windows(2).all(|w| w[0] < w[1]), "{revisions:?}");
        let s = snap(handle(&ctx, Request::GameSnapshot).await).0;
        assert_eq!(s.revision, *revisions.last().unwrap());
    }

    /// Records, for each snapshot event, the position the engine was on as it went out.
    struct EngineAtSnapshot {
        engine: Engine,
        seen: std::sync::Mutex<Vec<(Option<aji_core::PositionKey>, Option<aji_core::PositionKey>)>>,
    }

    impl EventSink for EngineAtSnapshot {
        fn emit(&self, event: AppEvent) {
            if let AppEvent::GameSnapshot { snapshot } = event {
                let engine = self.engine.status().position;
                self.seen
                    .lock()
                    .unwrap()
                    .push((snapshot.position_key, engine));
            }
        }
    }

    #[tokio::test]
    async fn the_interface_hears_of_a_position_before_the_engine_takes_it() {
        // The engine answers a position it has analysed with the cached analysis at once; the
        // interface drops analysis for a position it has not been told of yet.
        let mut ctx = ctx();
        let watcher = Arc::new(EngineAtSnapshot {
            engine: ctx.engine.clone(),
            seen: Default::default(),
        });
        ctx.events = watcher.clone();
        open(&ctx, "small.sgf", SMALL.as_bytes()).await.unwrap();
        let first = navigate(&ctx, NavTarget::Next).await.position_key;
        navigate(&ctx, NavTarget::Previous).await;
        let seen = watcher.seen.lock().unwrap().clone();
        assert_eq!(seen.len(), 3, "{seen:?}");
        // The two moves along the line; the open may land on the position the engine starts on.
        for (shown, engine) in &seen[1..] {
            assert_ne!(
                shown, engine,
                "the engine was already on {shown:?}: {seen:?}"
            );
        }
        assert_eq!(seen[1].0, first);
        assert_eq!(ctx.engine.status().position, seen[2].0);
    }

    #[tokio::test]
    async fn preview_changes_nothing() {
        let ctx = ctx();
        open(&ctx, "small.sgf", SMALL.as_bytes()).await.unwrap();
        let before = snap(handle(&ctx, Request::GameSnapshot).await).0;
        let engine_before = ctx.engine.status().position;
        let moves = vec![Move::Play(Point { x: 0, y: 0 }), Move::Pass];
        let Ok(Response::GamePreview { preview }) =
            handle(&ctx, Request::GamePreview { moves }).await
        else {
            panic!("expected a preview");
        };
        assert_eq!(preview.stones.len(), 81);
        assert_eq!(preview.stones[0], Some(aji_core::Color::Black));
        assert_eq!(preview.illegal_at, None);
        assert_eq!(snap(handle(&ctx, Request::GameSnapshot).await).0, before);
        assert_eq!(ctx.engine.status().position, engine_before);
    }

    #[test]
    fn game_request_json_shapes() {
        use serde_json::json;
        for (value, request) in [
            (
                json!({"type": "gameNew", "size": 9}),
                Request::GameNew { size: 9 },
            ),
            (
                json!({"type": "gameNavigate", "to": "previous"}),
                Request::GameNavigate {
                    to: NavTarget::Previous,
                },
            ),
            (
                json!({"type": "gameNavigate", "to": {"move": 12}}),
                Request::GameNavigate {
                    to: NavTarget::Move(12),
                },
            ),
            (
                json!({"type": "gameSetRules", "rules": null}),
                Request::GameSetRules { rules: None },
            ),
            (
                json!({"type": "gameSetRules", "rules": {"kind": "custom", "komi": 7, "scoring": "area"}}),
                Request::GameSetRules {
                    rules: Some(AnalysisRules::Custom {
                        details: None,
                        komi: Komi::new(7.0).unwrap(),
                        scoring: Scoring::Area,
                    }),
                },
            ),
            (
                json!({"type": "gamePreview", "moves": [{"type": "pass"}]}),
                Request::GamePreview {
                    moves: vec![Move::Pass],
                },
            ),
        ] {
            assert_eq!(serde_json::from_value::<Request>(value).unwrap(), request);
        }
        let warning = serde_json::to_value(GameWarning::ExtraGames { count: 2 }).unwrap();
        assert_eq!(warning, json!({"code": "extraGames", "count": 2}));
        let error = serde_json::to_value(ProtocolError {
            code: ErrorCode::SgfUnsupportedSize,
            message: "19x13".into(),
            detail: Some("19x13".into()),
        })
        .unwrap();
        assert_eq!(
            error,
            json!({"code": "sgfUnsupportedSize", "message": "19x13", "detail": "19x13"})
        );
    }

    // ------------------------------------------------------------ P2 M2: jobs and the trend

    use aji_core::PositionKey;
    use aji_engine::{JobRun, JobStatus, Row};

    use crate::job::{JobOptions, JobProgress, JobState};
    use crate::protocol::{CacheScope, ScoreMode, TrendNodeUpdate};

    const NINE: &str = "(;GM[1]FF[4]SZ[9]KM[7.5]RU[Chinese];B[cc];W[gg];B[cg];W[gc])";

    fn kept(key: PositionKey, winrate: f64, ownership: Option<Vec<i8>>) -> Row {
        Row {
            update: aji_engine::AnalysisUpdate {
                position: key,
                board_size: 9,
                root_visits: 600,
                winrate,
                score_lead: 0.0,
                is_final: true,
                candidates: Vec::new(),
                previous_visits: 0,
                ownership,
                next: None,
            },
            imported: true,
            katago_version: "test".into(),
        }
    }

    fn trend_stats(winrate: f64) -> aji_engine::TrendStats {
        aji_engine::TrendStats {
            winrate,
            score_lead: 0.0,
            visits: 600,
        }
    }

    /// A context on `NINE`, recording events.
    async fn nine(dir: &Path) -> (AppContext, Arc<Recorded>) {
        let mut ctx = ctx_in(dir, None);
        let recorded = Arc::new(Recorded::default());
        ctx.events = recorded.clone();
        open(&ctx, "nine.sgf", NINE.as_bytes()).await.unwrap();
        (ctx, recorded)
    }

    async fn line_keys(ctx: &AppContext) -> Vec<PositionKey> {
        let session = ctx.game.lock().await;
        session.line().iter().map(|n| n.key.unwrap()).collect()
    }

    fn progress_events(recorded: &Recorded) -> Vec<JobProgress> {
        recorded
            .0
            .lock()
            .unwrap()
            .iter()
            .filter_map(|e| match e {
                AppEvent::JobProgress { progress } => Some(progress.clone()),
                _ => None,
            })
            .collect()
    }

    fn trend_node_events(recorded: &Recorded) -> Vec<(u64, Vec<TrendNodeUpdate>)> {
        recorded
            .0
            .lock()
            .unwrap()
            .iter()
            .filter_map(|e| match e {
                AppEvent::TrendNodes { revision, nodes } => Some((*revision, nodes.clone())),
                _ => None,
            })
            .collect()
    }

    /// Starts a job in the service's flow alone: the test engine has no KataGo to run it.
    async fn started(ctx: &AppContext) -> u64 {
        let session = ctx.game.lock().await;
        let plan = ctx.follow.lock().unwrap().flow.start(
            session.line(),
            session.index(),
            JobOptions::default(),
        );
        plan.id
    }

    fn status(id: u64, run: JobRun, done: u32, total: u32) -> JobStatus {
        JobStatus {
            id,
            run,
            done,
            total,
            skipped: 0,
            working: None,
            queued: Vec::new(),
        }
    }

    #[tokio::test]
    async fn job_start_without_an_engine_is_refused_and_leaves_no_job() {
        let dir = tempfile::tempdir().unwrap();
        let (ctx, _) = nine(dir.path()).await;
        let error = handle(
            &ctx,
            Request::JobStart {
                options: JobOptions::default(),
            },
        )
        .await
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::EngineNotConfigured);
        assert!(!ctx.follow.lock().unwrap().flow.is_running());
    }

    #[tokio::test]
    async fn job_start_runs_first_then_boost_then_done() {
        let dir = tempfile::tempdir().unwrap();
        let (ctx, recorded) = nine(dir.path()).await;
        let keys = line_keys(&ctx).await;
        ctx.engine
            .import(keys.iter().map(|&k| kept(k, 0.5, None)).collect())
            .await;
        let id = started(&ctx).await;
        // Another job's status changes nothing.
        follow::on_job(&ctx, status(id + 9, JobRun::Done, 5, 5)).await;
        assert!(ctx.follow.lock().unwrap().flow.is_running());
        follow::on_job(&ctx, status(id, JobRun::Done, 5, 5)).await;
        // No swing: no boost pass.
        let last = progress_events(&recorded).pop().unwrap();
        assert_eq!((last.state, last.done, last.total), (JobState::Done, 5, 5));
        assert!(!ctx.follow.lock().unwrap().flow.is_running());
    }

    #[tokio::test]
    async fn a_big_swing_plans_a_boost_pass() {
        let dir = tempfile::tempdir().unwrap();
        let (ctx, recorded) = nine(dir.path()).await;
        let keys = line_keys(&ctx).await;
        let winrates = [0.5, 0.5, 0.7, 0.7, 0.7];
        ctx.engine
            .import(
                keys.iter()
                    .zip(winrates)
                    .map(|(&k, w)| kept(k, w, None))
                    .collect(),
            )
            .await;
        let id = started(&ctx).await;
        follow::on_job(&ctx, status(id, JobRun::Done, 5, 5)).await;
        // The boost pass has nodes 1 and 2; the test engine cannot run it, so the job stops.
        let last = progress_events(&recorded).pop().unwrap();
        assert_eq!(
            (last.state, last.done, last.boost_total),
            (JobState::Stopped, 5, 2)
        );
        assert!(!ctx.follow.lock().unwrap().flow.is_running());
    }

    #[tokio::test]
    async fn each_stop_event_stops_the_job() {
        let dir = tempfile::tempdir().unwrap();
        let (ctx, recorded) = nine(dir.path()).await;
        let stoppers = [
            Request::JobStop,
            Request::GameNew { size: 9 },
            Request::GameOpen {
                name: "nine.sgf".into(),
                bytes: b64(NINE.as_bytes()),
            },
            Request::GameSetRules {
                rules: Some(AnalysisRules::JapaneseKorean),
            },
            Request::CacheClear {
                scope: CacheScope::Game,
            },
            Request::CacheClear {
                scope: CacheScope::All,
            },
        ];
        for request in stoppers {
            started(&ctx).await;
            let before = progress_events(&recorded).len();
            handle(&ctx, request.clone()).await.unwrap();
            assert!(!ctx.follow.lock().unwrap().flow.is_running(), "{request:?}");
            let events = progress_events(&recorded);
            assert_eq!(events.len(), before + 1, "{request:?}");
            assert_eq!(events.last().unwrap().state, JobState::Stopped);
        }
        // Clearing the current position keeps the job.
        started(&ctx).await;
        handle(
            &ctx,
            Request::CacheClear {
                scope: CacheScope::Position,
            },
        )
        .await
        .unwrap();
        assert!(ctx.follow.lock().unwrap().flow.is_running());
        // The engine stopping it (its files changed).
        let id = started(&ctx).await;
        follow::on_job(&ctx, status(id, JobRun::Stopped, 2, 5)).await;
        assert!(!ctx.follow.lock().unwrap().flow.is_running());
        assert_eq!(
            progress_events(&recorded).last().unwrap().state,
            JobState::Stopped
        );
    }

    #[tokio::test]
    async fn trend_nodes_carry_losses_and_the_revision() {
        let dir = tempfile::tempdir().unwrap();
        let (ctx, recorded) = nine(dir.path()).await;
        let Ok(Response::Trend { revision, nodes }) = handle(&ctx, Request::GameTrend).await else {
            panic!()
        };
        assert!(nodes.iter().all(|n| n.loss.is_none()));
        let keys = line_keys(&ctx).await;
        assert!(follow::stored(&ctx, keys[1], trend_stats(0.5)));
        assert!(follow::stored(&ctx, keys[2], trend_stats(0.62)));
        assert!(!follow::stored(&ctx, PositionKey(7), trend_stats(0.5)));
        follow::flush(&ctx).await;
        let pushed = trend_node_events(&recorded);
        assert_eq!(pushed.len(), 1);
        let (at, nodes) = &pushed[0];
        assert_eq!(*at, revision);
        assert_eq!(
            nodes.iter().map(|n| n.line_index).collect::<Vec<_>>(),
            vec![1, 2, 3]
        );
        assert_eq!(nodes[1].stats, Some(trend_stats(0.62)));
        // White's G3 let Black's win rate rise 12 points.
        assert!((nodes[1].loss.unwrap().winrate - 12.0).abs() < 1e-9);
        assert_eq!(nodes[0].loss, None, "the position before has no result");
        assert_eq!(nodes[2].loss, None, "the position after has no result");
        // Nothing new, nothing pushed.
        follow::flush(&ctx).await;
        assert_eq!(trend_node_events(&recorded).len(), 1);
    }

    #[tokio::test]
    async fn stored_results_reach_the_trend_without_a_refetch() {
        let dir = tempfile::tempdir().unwrap();
        let (mut ctx, recorded) = nine(dir.path()).await;
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
        let position = ctx.game.lock().await.position().unwrap();
        ctx.engine = Engine::spawn(
            None,
            position,
            aji_engine::EngineOptions::default(),
            forward_engine_events(ctx.events.clone(), tx),
        );
        tokio::spawn(follow::follow_engine(ctx.clone(), rx));
        let Ok(Response::Trend { revision, .. }) = handle(&ctx, Request::GameTrend).await else {
            panic!()
        };
        let keys = line_keys(&ctx).await;
        ctx.engine.import(vec![kept(keys[3], 0.4, None)]).await;
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while trend_node_events(&recorded).is_empty() {
            assert!(std::time::Instant::now() < deadline, "no trendNodes");
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        let (at, nodes) = trend_node_events(&recorded).remove(0);
        assert_eq!(at, revision);
        assert_eq!(nodes[0].line_index, 3);
        assert_eq!(nodes[0].stats.map(|s| s.winrate), Some(0.4));
    }

    #[tokio::test]
    async fn game_score_estimate_and_final() {
        let dir = tempfile::tempdir().unwrap();
        let (ctx, _) = nine(dir.path()).await;
        handle(
            &ctx,
            Request::GameNavigate {
                to: NavTarget::Last,
            },
        )
        .await
        .unwrap();
        let estimate = Request::GameScore {
            mode: ScoreMode::Estimate,
        };
        let error = handle(&ctx, estimate.clone()).await.unwrap_err();
        assert_eq!(error.code, ErrorCode::ScoreUnavailable);
        // Black owns the whole board: White's two stones are dead.
        let key = *line_keys(&ctx).await.last().unwrap();
        ctx.engine
            .import(vec![kept(key, 0.9, Some(vec![100; 81]))])
            .await;
        let Ok(Response::Score(view)) = handle(&ctx, estimate).await else {
            panic!()
        };
        assert_eq!(view.suggested_dead.len(), 2);
        assert_eq!(view.score.black.total, 81.0);
        // Final with both White stones marked dead: the board is Black's.
        let Ok(Response::Score(view)) = handle(
            &ctx,
            Request::GameScore {
                mode: ScoreMode::Final {
                    dead: vec![Point { x: 6, y: 2 }, Point { x: 6, y: 6 }],
                },
            },
        )
        .await
        else {
            panic!()
        };
        assert_eq!(view.score.white.stones, 0);
        assert_eq!(view.score.black.dead, 2);
        assert_eq!(view.score.black.total, 81.0);
        assert_eq!(view.suggested_dead.len(), 2);
        assert!(!view.score.open_by_ownership);
        // With White's stones left alive the board's one region touches both colours: the
        // position's ownership gives it to Black, and the score says the game was open.
        let Ok(Response::Score(view)) = handle(
            &ctx,
            Request::GameScore {
                mode: ScoreMode::Final { dead: Vec::new() },
            },
        )
        .await
        else {
            panic!()
        };
        assert_eq!(view.score.white.stones, 2);
        assert_eq!(view.score.black.stones + view.score.black.territory, 79);
        assert!(view.score.open_by_ownership);
    }

    #[tokio::test]
    async fn cache_clear_game_clears_the_main_line_keys() {
        let dir = tempfile::tempdir().unwrap();
        let (ctx, recorded) = nine(dir.path()).await;
        let keys = line_keys(&ctx).await;
        let elsewhere = PositionKey(0x1234);
        let mut rows: Vec<Row> = keys.iter().map(|&k| kept(k, 0.5, None)).collect();
        rows.push(kept(elsewhere, 0.5, None));
        ctx.engine.import(rows).await;
        handle(
            &ctx,
            Request::CacheClear {
                scope: CacheScope::Game,
            },
        )
        .await
        .unwrap();
        let mut asked = keys.clone();
        asked.push(elsewhere);
        let left = ctx.engine.summaries(asked).await;
        assert!(left[..keys.len()].iter().all(Option::is_none));
        assert!(left[keys.len()].is_some());
        let events = recorded.0.lock().unwrap();
        assert!(matches!(events.last(), Some(AppEvent::CacheStatus { .. })));
        assert!(events.iter().any(
            |e| matches!(e, AppEvent::GameTrend { nodes, .. } if nodes.iter().all(|n| n.stats.is_none()))
        ));
    }

    #[tokio::test]
    async fn cache_stats_without_a_store_is_an_empty_memory_cache() {
        let Ok(Response::CacheStats(stats)) = handle(&ctx(), Request::CacheStats).await else {
            panic!()
        };
        assert!(!stats.persistent);
    }

    // ------------------------------------------------------------ P2 M2: LizzieYzy analysis

    const LIZZIE: &[u8] = include_bytes!("../../crates/aji-core/tests/fixtures/sgf/lizzie.sgf");

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-9
    }

    #[tokio::test]
    async fn opening_the_lizzie_fixture_imports_its_rows_as_black_view() {
        let ctx = ctx();
        open(&ctx, "lizzie.sgf", LIZZIE).await.unwrap();
        let Ok(Response::Trend { nodes, .. }) = handle(&ctx, Request::GameTrend).await else {
            panic!()
        };
        let stats: Vec<_> = nodes.iter().map(|n| n.stats).collect();
        // Root (LZOP, Black to move): 100 − 48.6 is Black's 51.4%; the lead is Black's.
        let root = stats[0].unwrap();
        assert!(close(root.winrate, 0.514) && close(root.score_lead, 0.4));
        assert_eq!(root.visits, 850);
        // After B Q16 White is to move: White's 48.7% is Black's 51.3%; White's −0.5 is +0.5.
        let one = stats[1].unwrap();
        assert!(close(one.winrate, 0.513) && close(one.score_lead, 0.5));
        assert_eq!(one.visits, 1300);
        let two = stats[2].unwrap();
        assert!(close(two.winrate, 0.516) && two.visits == 13_000);
        assert_eq!(stats[3], None, "a node without analysis");
        assert_eq!(stats[4].unwrap().visits, 12_500_000);

        let keys = line_keys(&ctx).await;
        let updates = ctx.engine.updates(keys.clone()).await;
        let root = updates[0].as_ref().unwrap();
        assert_eq!(root.candidates[0].mv, Move::Play(Point { x: 15, y: 3 }));
        assert!(close(root.candidates[0].winrate, 0.514));
        assert_eq!(root.candidates[0].pv.len(), 3);
        let one = updates[1].as_ref().unwrap();
        assert_eq!(one.candidates[0].mv, Move::Play(Point { x: 3, y: 15 }));
        assert!(close(one.candidates[0].winrate, 0.513));
        assert!(close(one.candidates[0].score_lead, 0.5));
        // Black is to move after W D16, so the ownership is Black's as written.
        let own = updates[2].as_ref().unwrap().ownership.as_ref().unwrap();
        assert_eq!(own.len(), 361);
        assert_eq!(own[0], aji_engine::quantise_ownership(0.9));
        assert_eq!(own[3 * 19 + 3], aji_engine::quantise_ownership(-0.95));
    }

    #[tokio::test]
    async fn analyse_on_open_starts_a_job_with_the_saved_options() {
        let dir = tempfile::tempdir().unwrap();
        let mut ctx = ctx_in(dir.path(), None);
        // KataGo is missing, but the engine has files, so it takes the job.
        let position = ctx.game.lock().await.position().unwrap();
        ctx.engine = Engine::spawn(
            Some(EngineFiles {
                katago: dir.path().join("no-katago"),
                model: dir.path().join("no-model"),
                config: dir.path().join("no-config"),
                working_dir: dir.path().to_path_buf(),
                path_prepend: Vec::new(),
            }),
            position,
            aji_engine::EngineOptions::default(),
            |_| {},
        );
        let options = JobOptions {
            side: crate::job::JobSide::Black,
            visits: 200,
            ..JobOptions::default()
        };
        open(&ctx, "nine.sgf", NINE.as_bytes()).await.unwrap();
        assert!(
            !ctx.follow.lock().unwrap().flow.is_running(),
            "off by default"
        );
        let settings = UiSettings {
            analyse_on_open: true,
            job_options: options,
            ..UiSettings::default()
        };
        handle(&ctx, Request::SettingsSet { settings })
            .await
            .unwrap();
        open(&ctx, "nine.sgf", NINE.as_bytes()).await.unwrap();
        let running = ctx.follow.lock().unwrap().flow.options();
        assert_eq!(running, Some(options));
        ctx.engine.shutdown().await;
    }

    /// `NINE` with a kept result at every node.
    async fn nine_analysed(dir: &Path) -> (AppContext, Vec<PositionKey>) {
        let (ctx, _) = nine(dir).await;
        let keys = line_keys(&ctx).await;
        let rows = keys
            .iter()
            .enumerate()
            .map(|(i, &k)| {
                let mut row = kept(k, 0.4 + 0.05 * i as f64, Some(vec![-64; 81]));
                row.update.score_lead = -1.5 + i as f64;
                row.update.candidates = vec![aji_engine::Candidate {
                    mv: Move::Play(Point { x: 4, y: 4 }),
                    order: 0,
                    visits: 400,
                    winrate: 0.45,
                    score_lead: -0.5,
                    prior: 0.25,
                    pv: vec![Move::Play(Point { x: 4, y: 4 }), Move::Pass],
                }];
                row
            })
            .collect();
        ctx.engine.import(rows).await;
        (ctx, keys)
    }

    async fn export_text(ctx: &AppContext) -> String {
        let Ok(Response::GameExport { text, .. }) = handle(ctx, Request::GameExport).await else {
            panic!()
        };
        text
    }

    async fn save_analysis(ctx: &AppContext, on: bool) {
        let settings = UiSettings {
            save_analysis: on,
            ..UiSettings::default()
        };
        handle(ctx, Request::SettingsSet { settings })
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn export_writes_lz_only_when_asked() {
        let dir = tempfile::tempdir().unwrap();
        let (ctx, _) = nine_analysed(dir.path()).await;
        let text = export_text(&ctx).await;
        assert!(!text.contains("LZ"), "{text}");
        save_analysis(&ctx, true).await;
        let text = export_text(&ctx).await;
        assert_eq!(text.matches("LZOP[KataGo ").count(), 1, "{text}");
        assert_eq!(text.matches("LZ[KataGo ").count(), 4, "{text}");
        assert!(text.contains(" ownership "), "{text}");
    }

    #[tokio::test]
    async fn export_then_open_round_trips_the_analysis() {
        let dir = tempfile::tempdir().unwrap();
        let (ctx, keys) = nine_analysed(dir.path()).await;
        save_analysis(&ctx, true).await;
        let text = export_text(&ctx).await;
        let before = ctx.engine.updates(keys.clone()).await;

        let again = ctx_in(&dir.path().join("again"), None);
        open(&again, "nine.sgf", text.as_bytes()).await.unwrap();
        let after = again.engine.updates(keys).await;
        for (b, a) in before.iter().zip(&after) {
            let (b, a) = (b.as_ref().unwrap(), a.as_ref().unwrap());
            assert!(
                (a.winrate - b.winrate).abs() < 1e-3,
                "{} {}",
                a.winrate,
                b.winrate
            );
            assert!((a.score_lead - b.score_lead).abs() < 0.05);
            assert_eq!(a.root_visits, b.root_visits);
            assert_eq!(a.candidates.len(), 1);
            assert_eq!(a.candidates[0].mv, b.candidates[0].mv);
            assert_eq!(a.candidates[0].pv, b.candidates[0].pv);
            assert!((a.candidates[0].winrate - b.candidates[0].winrate).abs() < 1e-4);
            assert!((a.candidates[0].prior - b.candidates[0].prior).abs() < 1e-4);
            let (ao, bo) = (a.ownership.as_ref().unwrap(), b.ownership.as_ref().unwrap());
            assert!(ao.iter().zip(bo).all(|(x, y)| (x - y).abs() <= 1));
        }
    }
}
