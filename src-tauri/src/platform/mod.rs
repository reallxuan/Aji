//! The desktop half of the UI's `PlatformFiles` (design 5.6): file dialogs, drops, the recent
//! list and the macOS menu. These are Tauri commands outside `rpc`: a browser client opens and
//! saves files its own way.

pub mod menu;
pub mod recent;

use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri_plugin_clipboard_manager::ClipboardExt;

use base64::Engine as _;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_dialog::{
    DialogExt, MessageDialogButtons, MessageDialogKind, MessageDialogResult,
};
use ts_rs::TS;

use crate::game::MAX_SGF_BYTES;
use crate::protocol::{ErrorCode, ProtocolError};
use crate::service::error;
use menu::MenuLanguage;
use recent::{RecentEntry, RecentList};

/// The event name menu clicks go out on.
pub const MENU_CHANNEL: &str = "aji://menu";

/// A file read for `gameOpen`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct OpenedFile {
    /// Names the file for `files_remember`, so the UI never handles its path.
    pub token: String,
    /// The file name, with its extension.
    pub name: String,
    /// The file's bytes, base64-encoded, as `gameOpen` takes them.
    pub bytes: String,
}

/// The layout presets the 显示 → 布局 menu offers, as the interface names them (P2 M1 design 5.2).
pub const LAYOUT_PRESETS: [&str; 5] = ["default", "classic", "minimal", "thinking", "four"];

/// What 文件 → 导出图片 can save or copy, as the interface names them (P2 M1 design 5.9).
pub const SHOT_TARGETS: [&str; 3] = ["board", "subboard", "graph"];

/// A menu item the UI acts on, sent on [`MENU_CHANNEL`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum MenuAction {
    New(u8),
    Open,
    SaveAs,
    Save,
    SaveBranch,
    SaveClean,
    Undo,
    Redo,
    Quit,
    /// The recent file at this index.
    Recent(u32),
    ClearRecent,
    /// A layout preset, one of [`LAYOUT_PRESETS`].
    Layout(String),
    /// Save one of [`SHOT_TARGETS`] as an image.
    SaveImage(String),
    /// Copy one of [`SHOT_TARGETS`] to the clipboard as an image.
    CopyImage(String),
    /// 分析 → 分析全局… (P2 M2 design 5.10).
    AnalyseGame,
    StopGame,
    ClearPosition,
    ClearGame,
    FinalScoring,
    /// 显示 → 形势判断.
    Estimate,
    RotateCw,
    RotateCcw,
    FlipH,
    FlipV,
    ResetOrientation,
    NumbersOff,
    NumbersAll,
    NumbersLast,
    NumbersRestart,
}

impl MenuAction {
    /// The menu item id.
    pub fn id(&self) -> String {
        match self {
            MenuAction::New(n) => format!("new:{n}"),
            MenuAction::Recent(n) => format!("recent:{n}"),
            MenuAction::Layout(preset) => format!("layout:{preset}"),
            MenuAction::SaveImage(target) => format!("saveImage:{target}"),
            MenuAction::CopyImage(target) => format!("copyImage:{target}"),
            other => serde_json::to_value(other)
                .ok()
                .and_then(|v| v.as_str().map(str::to_owned))
                .unwrap_or_default(),
        }
    }

    pub fn from_id(id: &str) -> Option<MenuAction> {
        if let Some(n) = id.strip_prefix("new:") {
            let size = n.parse::<u8>().ok()?;
            return ((5..=19).contains(&size) && size.to_string() == n)
                .then_some(MenuAction::New(size));
        }
        if let Some(n) = id.strip_prefix("recent:") {
            return n.parse().ok().map(MenuAction::Recent);
        }
        let target = |t: &str| SHOT_TARGETS.contains(&t).then(|| t.to_owned());
        if let Some(t) = id.strip_prefix("saveImage:") {
            return target(t).map(MenuAction::SaveImage);
        }
        if let Some(t) = id.strip_prefix("copyImage:") {
            return target(t).map(MenuAction::CopyImage);
        }
        if let Some(preset) = id.strip_prefix("layout:") {
            return LAYOUT_PRESETS
                .contains(&preset)
                .then(|| MenuAction::Layout(preset.to_owned()));
        }
        [
            MenuAction::Open,
            MenuAction::SaveAs,
            MenuAction::Save,
            MenuAction::SaveBranch,
            MenuAction::SaveClean,
            MenuAction::Undo,
            MenuAction::Redo,
            MenuAction::Quit,
            MenuAction::ClearRecent,
            MenuAction::AnalyseGame,
            MenuAction::StopGame,
            MenuAction::ClearPosition,
            MenuAction::ClearGame,
            MenuAction::FinalScoring,
            MenuAction::Estimate,
            MenuAction::RotateCw,
            MenuAction::RotateCcw,
            MenuAction::FlipH,
            MenuAction::FlipV,
            MenuAction::ResetOrientation,
            MenuAction::NumbersOff,
            MenuAction::NumbersAll,
            MenuAction::NumbersLast,
            MenuAction::NumbersRestart,
        ]
        .into_iter()
        .find(|action| action.id() == id)
    }
}

fn has_extension(path: &Path, extension: &str) -> bool {
    path.extension()
        .is_some_and(|e| e.eq_ignore_ascii_case(extension))
}

fn has_sgf_extension(path: &Path) -> bool {
    has_extension(path, "sgf")
}

/// `path`, with `.{extension}` added when it has another extension or none.
fn with_extension_added(path: &Path, extension: &str) -> PathBuf {
    if has_extension(path, extension) {
        return path.to_path_buf();
    }
    let mut name = path.as_os_str().to_owned();
    name.push(".");
    name.push(extension);
    PathBuf::from(name)
}

/// Reads an SGF file for `gameOpen`: its name and bytes. Refuses other extensions, files over
/// 20 MB, and missing files.
pub fn read_sgf_file(path: &Path) -> Result<(String, Vec<u8>), ProtocolError> {
    let file = GameFile::existing(path)?;
    Ok((file.name(), file.read()?))
}

fn read_failed(e: io::Error) -> ProtocolError {
    match e.kind() {
        io::ErrorKind::NotFound => error(ErrorCode::FileMissing, e.to_string()),
        _ => error(ErrorCode::FileReadFailed, e.to_string()),
    }
}

#[derive(Clone)]
struct GameFile {
    selected: PathBuf,
    target: PathBuf,
}
impl GameFile {
    fn existing(path: &Path) -> Result<Self, ProtocolError> {
        if !has_sgf_extension(path) {
            return Err(error(ErrorCode::FileNotSgf, "expected an SGF file"));
        }
        Ok(Self {
            selected: path.to_path_buf(),
            target: fs::canonicalize(path).map_err(read_failed)?,
        })
    }
    fn for_save(selected: PathBuf) -> io::Result<Self> {
        let target = match fs::canonicalize(&selected) {
            Ok(target) => target,
            Err(e) if e.kind() == io::ErrorKind::NotFound => {
                let parent = selected
                    .parent()
                    .filter(|p| !p.as_os_str().is_empty())
                    .unwrap_or(Path::new("."));
                fs::canonicalize(parent)?.join(selected.file_name().unwrap_or_default())
            }
            Err(e) => return Err(e),
        };
        Ok(Self { selected, target })
    }

    fn name(&self) -> String {
        self.selected
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned()
    }
    fn read(&self) -> Result<Vec<u8>, ProtocolError> {
        let path = &self.target;
        let name = self.name();
        let metadata = fs::metadata(path).map_err(read_failed)?;
        if !metadata.is_file() {
            return Err(error(
                ErrorCode::FileReadFailed,
                format!("{name} is not a file"),
            ));
        }
        if metadata.len() > MAX_SGF_BYTES as u64 {
            return Err(error(
                ErrorCode::SgfTooLarge,
                format!("{name} is over 20 MB"),
            ));
        }
        let bytes = fs::read(path).map_err(read_failed)?;
        if bytes.len() > MAX_SGF_BYTES {
            return Err(error(
                ErrorCode::SgfTooLarge,
                format!("{name} is over 20 MB"),
            ));
        }
        Ok(bytes)
    }
}

/// Writes `bytes` to a temporary file beside `path`, then renames it over `path`, so a crash
/// leaves the old file or the new one, whole. The folder must exist.
pub fn write_atomically(path: &Path, bytes: impl AsRef<[u8]>) -> io::Result<()> {
    let dir = match path.parent() {
        Some(dir) if !dir.as_os_str().is_empty() => dir,
        _ => Path::new("."),
    };
    let name = path.file_name().unwrap_or_default().to_string_lossy();
    let permissions = match fs::metadata(path) {
        Ok(metadata) => Some(metadata.permissions()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => None,
        Err(e) => return Err(e),
    };
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let (temp, mut file) = loop {
        let id = NEXT.fetch_add(1, Ordering::Relaxed);
        let temp = dir.join(format!(".{name}.{}.{id}.tmp", std::process::id()));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        if let Some(mode) = &permissions {
            use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
            options.mode(mode.mode());
        }
        match options.open(&temp) {
            Ok(file) => break (temp, file),
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e),
        }
    };
    let result = (|| {
        if let Some(permissions) = permissions {
            file.set_permissions(permissions)?;
        }
        file.write_all(bytes.as_ref())?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temp, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

/// `path`, with `.sgf` added when it has another extension or none.
pub fn with_sgf_extension(path: &Path) -> PathBuf {
    with_extension_added(path, "sgf")
}

/// The existing file a save would replace without the dialog having asked: the user typed a
/// name without `.{extension}`, the dialog checked that name, and `<name>.{extension}` is
/// already there.
fn unasked_overwrite_of(picked: &Path, extension: &str) -> Option<PathBuf> {
    let target = with_extension_added(picked, extension);
    (target != picked && target.exists()).then_some(target)
}

/// [`unasked_overwrite_of`] for a game record.
pub fn unasked_overwrite(picked: &Path) -> Option<PathBuf> {
    unasked_overwrite_of(picked, "sgf")
}

/// Writes a screenshot (P2 M1 design 5.9): base64 PNG bytes from the UI, to `path` with `.png`
/// added when missing. Returns the path written.
pub fn write_image(path: &Path, base64: &str) -> Result<PathBuf, ProtocolError> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64)
        .map_err(|e| error(ErrorCode::FileWriteFailed, format!("bad image bytes: {e}")))?;
    let path = with_extension_added(path, "png");
    write_atomically(&path, bytes).map_err(|e| error(ErrorCode::FileWriteFailed, e.to_string()))?;
    Ok(path)
}

/// A screenshot for the clipboard: base64 PNG bytes from the UI, decoded to pixels.
pub fn clipboard_image(base64: &str) -> Result<tauri::image::Image<'static>, ProtocolError> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64)
        .map_err(|e| error(ErrorCode::FileWriteFailed, format!("bad image bytes: {e}")))?;
    tauri::image::Image::from_bytes(&bytes)
        .map(|image| image.to_owned())
        .map_err(|e| error(ErrorCode::FileWriteFailed, format!("not a PNG: {e}")))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}

/// The recent list, the tokens handed to the UI, and the menu's language.
pub struct DesktopFiles {
    recent_path: PathBuf,
    recent: Mutex<RecentList>,
    tokens: Mutex<HashMap<String, GameFile>>,
    next_token: AtomicU64,
    language: Mutex<MenuLanguage>,
    numbers: Mutex<menu::NumberDisplay>,
}

impl DesktopFiles {
    pub fn new(config_dir: &Path, language: MenuLanguage) -> DesktopFiles {
        let recent_path = config_dir.join("recent.json");
        DesktopFiles {
            recent: Mutex::new(RecentList::load(&recent_path)),
            recent_path,
            tokens: Mutex::new(HashMap::new()),
            next_token: AtomicU64::new(1),
            language: Mutex::new(language),
            numbers: Mutex::default(),
        }
    }

    fn token(&self, file: GameFile) -> String {
        let token = format!("f{}", self.next_token.fetch_add(1, Ordering::Relaxed));
        lock(&self.tokens).insert(token.clone(), file);
        token
    }

    fn opened(&self, path: &Path) -> Result<OpenedFile, ProtocolError> {
        let file = GameFile::existing(path)?;
        let name = file.name();
        let bytes = file.read()?;
        Ok(OpenedFile {
            token: self.token(file),
            name,
            bytes: base64::engine::general_purpose::STANDARD.encode(bytes),
        })
    }

    /// Changes the recent list, saves it and rebuilds the menu.
    fn update_recent<R: Runtime>(&self, app: &AppHandle<R>, f: impl FnOnce(&mut RecentList)) {
        let entries = {
            let mut recent = lock(&self.recent);
            f(&mut recent);
            if let Err(e) = recent.save(&self.recent_path) {
                eprintln!("aji: cannot save {}: {e}", self.recent_path.display());
            }
            recent.entries()
        };
        self.rebuild_menu(app, &entries);
    }

    /// Sets the macOS menu bar from the recent list. Other systems have none (interface
    /// design 4).
    pub fn rebuild_menu<R: Runtime>(&self, app: &AppHandle<R>, entries: &[RecentEntry]) {
        if !cfg!(target_os = "macos") {
            return;
        }
        let language = *lock(&self.language);
        let built =
            menu::build(app, language, entries, *lock(&self.numbers)).and_then(|m| app.set_menu(m));
        if let Err(e) = built {
            eprintln!("aji: cannot build the menu: {e}");
        }
    }

    pub fn recent_entries(&self) -> Vec<RecentEntry> {
        lock(&self.recent).entries()
    }
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

/// Sends menu clicks to the UI.
pub fn forward_menu_events<R: Runtime>(app: &AppHandle<R>, id: &str) {
    if let Some(action) = MenuAction::from_id(id)
        && let Err(e) = app.emit(MENU_CHANNEL, action)
    {
        eprintln!("aji: cannot emit {MENU_CHANNEL}: {e}");
    }
}

fn join_failed(e: tauri::Error) -> ProtocolError {
    error(ErrorCode::Internal, e.to_string())
}

/// The native open dialog, filtered to `.sgf`; `None` when the user cancels.
#[tauri::command]
pub async fn files_pick_open<R: Runtime>(
    app: AppHandle<R>,
    platform: State<'_, DesktopFiles>,
) -> Result<Option<OpenedFile>, ProtocolError> {
    let dialog_app = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = dialog_app
            .dialog()
            .file()
            .add_filter("SGF", &["sgf", "SGF"]);
        if let Some(main) = dialog_app.get_webview_window("main") {
            dialog = dialog.set_parent(&main);
        }
        dialog.blocking_pick_file().and_then(|p| p.into_path().ok())
    })
    .await
    .map_err(join_failed)?;
    picked.map(|path| platform.opened(&path)).transpose()
}

/// A file dropped on the window.
#[tauri::command]
pub async fn files_open_path(
    path: String,
    platform: State<'_, DesktopFiles>,
) -> Result<OpenedFile, ProtocolError> {
    platform.opened(Path::new(&path))
}

/// Refreshes a previously selected file after a save may have replaced its bytes.
#[tauri::command]
pub async fn files_reread(
    token: String,
    platform: State<'_, DesktopFiles>,
) -> Result<String, ProtocolError> {
    let file = lock(&platform.tokens)
        .get(&token)
        .cloned()
        .ok_or_else(|| error(ErrorCode::FileReadFailed, "unknown file token"))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(file.read()?))
}

/// Entry `index` of the recent list. A file that is gone leaves the list.
#[tauri::command]
pub async fn files_open_recent<R: Runtime>(
    app: AppHandle<R>,
    index: u32,
    platform: State<'_, DesktopFiles>,
) -> Result<OpenedFile, ProtocolError> {
    let index = usize::try_from(index).unwrap_or(usize::MAX);
    let path = lock(&platform.recent)
        .path(index)
        .ok_or_else(|| error(ErrorCode::Internal, format!("no recent file {index}")))?;
    let opened = platform.opened(&path);
    if opened
        .as_ref()
        .is_err_and(|e| e.code == ErrorCode::FileMissing)
    {
        platform.update_recent(&app, |recent| recent.remove(index));
    }
    opened
}

/// Puts the file behind `token` at the top of the recent list, under `title`.
#[tauri::command]
pub async fn files_remember<R: Runtime>(
    app: AppHandle<R>,
    token: String,
    title: String,
    platform: State<'_, DesktopFiles>,
) -> Result<(), ProtocolError> {
    let path = lock(&platform.tokens)
        .get(&token)
        .cloned()
        .ok_or_else(|| error(ErrorCode::Internal, format!("unknown file token {token}")))?;
    platform.update_recent(&app, |recent| recent.push(&path.selected, &title, now_ms()));
    Ok(())
}

#[tauri::command]
pub async fn files_recent(
    platform: State<'_, DesktopFiles>,
) -> Result<Vec<RecentEntry>, ProtocolError> {
    Ok(platform.recent_entries())
}

#[tauri::command]
pub async fn files_clear_recent<R: Runtime>(
    app: AppHandle<R>,
    platform: State<'_, DesktopFiles>,
) -> Result<(), ProtocolError> {
    platform.update_recent(&app, RecentList::clear);
    Ok(())
}

/// Overwrites the file previously opened or saved under this opaque token.
#[tauri::command]
pub async fn files_save(
    token: String,
    bytes: String,
    platform: State<'_, DesktopFiles>,
) -> Result<bool, ProtocolError> {
    let path = lock(&platform.tokens)
        .get(&token)
        .cloned()
        .ok_or_else(|| error(ErrorCode::FileWriteFailed, "unknown file token"))?;
    tauri::async_runtime::spawn_blocking(move || {
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(bytes)
            .map_err(|e| error(ErrorCode::FileWriteFailed, e.to_string()))?;
        write_atomically(&path.target, decoded)
            .map_err(|e| error(ErrorCode::FileWriteFailed, e.to_string()))?;
        Ok(true)
    })
    .await
    .map_err(join_failed)?
}

#[tauri::command]
pub async fn confirm_discard<R: Runtime>(
    app: AppHandle<R>,
    platform: State<'_, DesktopFiles>,
) -> Result<&'static str, ProtocolError> {
    let l = menu::labels(*lock(&platform.language));
    tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = app
            .dialog()
            .message(l.unsaved)
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::YesNoCancelCustom(
                l.save.into(),
                l.discard.into(),
                l.cancel.into(),
            ));
        if let Some(main) = app.get_webview_window("main") {
            dialog = dialog.parent(&main);
        }
        match dialog.blocking_show_with_result() {
            MessageDialogResult::Yes => "save",
            MessageDialogResult::No => "discard",
            MessageDialogResult::Custom(label) if label == l.save => "save",
            MessageDialogResult::Custom(label) if label == l.discard => "discard",
            _ => "cancel",
        }
    })
    .await
    .map_err(join_failed)
}

/// The native save dialog, then an atomic write. Returns the saved file's token for
/// `files_remember`; `None` when the user cancels.
#[tauri::command]
pub async fn files_save_as<R: Runtime>(
    app: AppHandle<R>,
    suggested_name: String,
    text: String,
    platform: State<'_, DesktopFiles>,
) -> Result<Option<String>, ProtocolError> {
    let dialog_app = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = dialog_app
            .dialog()
            .file()
            .add_filter("SGF", &["sgf"])
            .set_file_name(suggested_name);
        if let Some(main) = dialog_app.get_webview_window("main") {
            dialog = dialog.set_parent(&main);
        }
        dialog.blocking_save_file().and_then(|p| p.into_path().ok())
    })
    .await
    .map_err(join_failed)?;
    let Some(path) = picked else {
        return Ok(None);
    };
    if let Some(existing) = unasked_overwrite(&path)
        && !confirm_replace(&app, &platform, &existing).await?
    {
        return Ok(None);
    }
    let file = tauri::async_runtime::spawn_blocking(move || {
        let file = GameFile::for_save(with_sgf_extension(&path))?;
        write_atomically(&file.target, &text)?;
        Ok::<_, io::Error>(file)
    })
    .await
    .map_err(join_failed)?
    .map_err(|e| error(ErrorCode::FileWriteFailed, e.to_string()))?;
    Ok(Some(platform.token(file)))
}

/// Copies a screenshot to the system clipboard (P2 M1 design 5.9). The app writes it rather than
/// the webview, since a click in the macOS menu bar is no click in the page, and WebKit refuses a
/// page's clipboard write without one. `bytes` is the PNG in base64.
#[tauri::command]
pub async fn files_copy_image<R: Runtime>(
    app: AppHandle<R>,
    bytes: String,
) -> Result<(), ProtocolError> {
    let image = clipboard_image(&bytes)?;
    app.clipboard()
        .write_image(&image)
        .map_err(|e| error(ErrorCode::Internal, format!("clipboard: {e}")))
}

/// The save dialog for a screenshot, then the write (P2 M1 design 5.9). `bytes` is the PNG in
/// base64. `false` when the user cancels.
#[tauri::command]
pub async fn files_save_image<R: Runtime>(
    app: AppHandle<R>,
    suggested_name: String,
    bytes: String,
    platform: State<'_, DesktopFiles>,
) -> Result<bool, ProtocolError> {
    let dialog_app = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = dialog_app
            .dialog()
            .file()
            .add_filter("PNG", &["png"])
            .set_file_name(suggested_name);
        if let Some(main) = dialog_app.get_webview_window("main") {
            dialog = dialog.set_parent(&main);
        }
        dialog.blocking_save_file().and_then(|p| p.into_path().ok())
    })
    .await
    .map_err(join_failed)?;
    let Some(path) = picked else {
        return Ok(false);
    };
    if let Some(existing) = unasked_overwrite_of(&path, "png")
        && !confirm_replace(&app, &platform, &existing).await?
    {
        return Ok(false);
    }
    tauri::async_runtime::spawn_blocking(move || write_image(&path, &bytes))
        .await
        .map_err(join_failed)??;
    Ok(true)
}

/// Asks, in the interface's language, before replacing a file the save dialog did not ask about.
async fn confirm_replace<R: Runtime>(
    app: &AppHandle<R>,
    platform: &DesktopFiles,
    existing: &Path,
) -> Result<bool, ProtocolError> {
    let l = menu::labels(*lock(&platform.language));
    let name = existing
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let message = l.replace_prompt.replace("{name}", &name);
    let buttons = MessageDialogButtons::OkCancelCustom(l.replace.into(), l.cancel.into());
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = app
            .dialog()
            .message(message)
            .kind(MessageDialogKind::Warning)
            .buttons(buttons);
        if let Some(main) = app.get_webview_window("main") {
            dialog = dialog.parent(&main);
        }
        dialog.blocking_show()
    })
    .await
    .map_err(join_failed)
}

/// The interface's resolved language (`zh-CN` or `en`), for the menu's labels.
#[tauri::command]
pub async fn menu_set_language<R: Runtime>(
    app: AppHandle<R>,
    language: String,
    numbers: Option<menu::NumberDisplay>,
    platform: State<'_, DesktopFiles>,
) -> Result<(), ProtocolError> {
    let language = MenuLanguage::from_tag(&language);
    let changed = {
        let mut current = lock(&platform.language);
        std::mem::replace(&mut *current, language) != language
    };
    let numbers_changed = numbers.is_some_and(|next| {
        let mut current = lock(&platform.numbers);
        std::mem::replace(&mut *current, next) != next
    });
    if changed || numbers_changed {
        platform.rebuild_menu(&app, &platform.recent_entries());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::ErrorCode;

    #[test]
    fn a_png_from_the_ui_becomes_a_clipboard_image() {
        // A 2×1 PNG: one opaque red pixel, one transparent.
        let png = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAD0lEQVR4nGP4z8AARAwMAAz8Af9c/RSVAAAAAElFTkSuQmCC";
        let image = clipboard_image(png).unwrap();
        assert_eq!((image.width(), image.height()), (2, 1));
        assert_eq!(image.rgba(), &[255, 0, 0, 255, 0, 0, 0, 0]);
        assert_eq!(
            clipboard_image("not base64!").unwrap_err().code,
            ErrorCode::FileWriteFailed
        );
        assert_eq!(
            clipboard_image("bm90IGEgcG5n").unwrap_err().code,
            ErrorCode::FileWriteFailed
        );
    }

    #[test]
    fn an_added_extension_that_names_an_existing_file_needs_asking() {
        let dir = tempfile::tempdir().unwrap();
        let typed = dir.path().join("game");
        // Nothing there yet: write `game.sgf` without asking.
        assert_eq!(unasked_overwrite(&typed), None);
        std::fs::write(dir.path().join("game.sgf"), "(;)").unwrap();
        // The dialog asked about `game`, not `game.sgf`.
        assert_eq!(unasked_overwrite(&typed), Some(dir.path().join("game.sgf")));
        // A name with the extension was the dialog's to ask about.
        assert_eq!(unasked_overwrite(&dir.path().join("game.sgf")), None);
    }

    #[test]
    fn read_rejects_other_extensions_and_large_files() {
        let dir = tempfile::tempdir().unwrap();
        let txt = dir.path().join("a.txt");
        std::fs::write(&txt, "(;)").unwrap();
        assert_eq!(read_sgf_file(&txt).unwrap_err().code, ErrorCode::FileNotSgf);
        let big = dir.path().join("big.sgf");
        std::fs::write(&big, vec![b' '; 20 * 1024 * 1024 + 1]).unwrap();
        assert_eq!(
            read_sgf_file(&big).unwrap_err().code,
            ErrorCode::SgfTooLarge
        );
        let gone = dir.path().join("gone.sgf");
        assert_eq!(
            read_sgf_file(&gone).unwrap_err().code,
            ErrorCode::FileMissing
        );
        let folder = dir.path().join("folder.sgf");
        std::fs::create_dir(&folder).unwrap();
        assert_eq!(
            read_sgf_file(&folder).unwrap_err().code,
            ErrorCode::FileReadFailed
        );
    }

    #[test]
    fn read_accepts_upper_case_extension() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("三星杯.SGF");
        std::fs::write(&path, "(;B[pd])").unwrap();
        let (name, bytes) = read_sgf_file(&path).unwrap();
        assert_eq!(name, "三星杯.SGF");
        assert_eq!(bytes, b"(;B[pd])");
    }

    #[test]
    fn write_atomically_replaces_and_leaves_no_temp() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("game.sgf");
        std::fs::write(&path, "old").unwrap();
        write_atomically(&path, "(;GM[1]PB[丁浩])").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "(;GM[1]PB[丁浩])");
        let names: Vec<_> = std::fs::read_dir(dir.path()).unwrap().collect();
        assert_eq!(names.len(), 1, "{names:?}");
        let missing = dir.path().join("no-folder").join("x.sgf");
        assert!(write_atomically(&missing, "x").is_err());
    }

    #[test]
    fn save_names_get_the_extension() {
        assert_eq!(
            with_sgf_extension("a".as_ref()),
            std::path::PathBuf::from("a.sgf")
        );
        assert_eq!(
            with_sgf_extension("a.SGF".as_ref()),
            std::path::PathBuf::from("a.SGF")
        );
        assert_eq!(
            with_sgf_extension("a.txt".as_ref()),
            std::path::PathBuf::from("a.txt.sgf")
        );
    }

    #[test]
    fn save_image_writes_the_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let png = [0x89, b'P', b'N', b'G', 0, 1, 2, 255];
        let encoded = base64::engine::general_purpose::STANDARD.encode(png);
        // A name typed without the extension gets `.png`.
        let written = write_image(&dir.path().join("board"), &encoded).unwrap();
        assert_eq!(written, dir.path().join("board.png"));
        assert_eq!(std::fs::read(&written).unwrap(), png);
        let error = write_image(&dir.path().join("x.png"), "not base64!").unwrap_err();
        assert_eq!(error.code, ErrorCode::FileWriteFailed);
        assert!(!dir.path().join("x.png").exists());
    }

    #[test]
    fn menu_actions_json_shape() {
        use serde_json::json;
        assert_eq!(
            serde_json::to_value(MenuAction::New(13)).unwrap(),
            json!({"new":13})
        );
        assert_eq!(
            serde_json::to_value(MenuAction::SaveAs).unwrap(),
            json!("saveAs")
        );
        assert_eq!(
            serde_json::to_value(MenuAction::Recent(2)).unwrap(),
            json!({"recent": 2})
        );
        assert_eq!(MenuAction::from_id("recent:3"), Some(MenuAction::Recent(3)));
        assert_eq!(
            MenuAction::from_id("clearRecent"),
            Some(MenuAction::ClearRecent)
        );
        assert_eq!(MenuAction::from_id("about"), None);
        for action in [
            MenuAction::New(19),
            MenuAction::Open,
            MenuAction::Recent(0),
            MenuAction::Save,
            MenuAction::SaveBranch,
            MenuAction::SaveClean,
            MenuAction::Quit,
            MenuAction::Undo,
            MenuAction::Redo,
        ] {
            assert_eq!(MenuAction::from_id(&action.id()), Some(action));
        }
    }
}
