//! The desktop half of the UI's `PlatformFiles` (design 5.6): file dialogs, drops, the recent
//! list and the macOS menu. These are Tauri commands outside `rpc`: a browser client opens and
//! saves files its own way.

pub mod menu;
pub mod recent;

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
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

/// A menu item the UI acts on, sent on [`MENU_CHANNEL`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum MenuAction {
    New19,
    New13,
    New9,
    Open,
    SaveAs,
    /// The recent file at this index.
    Recent(u32),
    ClearRecent,
    /// A layout preset, one of [`LAYOUT_PRESETS`].
    Layout(String),
}

impl MenuAction {
    /// The menu item id.
    pub fn id(&self) -> String {
        match self {
            MenuAction::Recent(n) => format!("recent:{n}"),
            MenuAction::Layout(preset) => format!("layout:{preset}"),
            other => serde_json::to_value(other)
                .ok()
                .and_then(|v| v.as_str().map(str::to_owned))
                .unwrap_or_default(),
        }
    }

    pub fn from_id(id: &str) -> Option<MenuAction> {
        if let Some(n) = id.strip_prefix("recent:") {
            return n.parse().ok().map(MenuAction::Recent);
        }
        if let Some(preset) = id.strip_prefix("layout:") {
            return LAYOUT_PRESETS
                .contains(&preset)
                .then(|| MenuAction::Layout(preset.to_owned()));
        }
        [
            MenuAction::New19,
            MenuAction::New13,
            MenuAction::New9,
            MenuAction::Open,
            MenuAction::SaveAs,
            MenuAction::ClearRecent,
        ]
        .into_iter()
        .find(|action| action.id() == id)
    }
}

fn has_sgf_extension(path: &Path) -> bool {
    path.extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("sgf"))
}

/// Reads an SGF file for `gameOpen`: its name and bytes. Refuses other extensions, files over
/// 20 MB, and missing files.
pub fn read_sgf_file(path: &Path) -> Result<(String, Vec<u8>), ProtocolError> {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    if !has_sgf_extension(path) {
        return Err(error(ErrorCode::FileNotSgf, format!("{name} is not .sgf")));
    }
    let read_failed = |e: io::Error| match e.kind() {
        io::ErrorKind::NotFound => error(ErrorCode::FileMissing, e.to_string()),
        _ => error(ErrorCode::FileReadFailed, e.to_string()),
    };
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
    Ok((name, bytes))
}

/// Writes `text` to a temporary file beside `path`, then renames it over `path`, so a crash
/// leaves the old file or the new one, whole. The folder must exist.
pub fn write_atomically(path: &Path, text: &str) -> io::Result<()> {
    let dir = match path.parent() {
        Some(dir) if !dir.as_os_str().is_empty() => dir,
        _ => Path::new("."),
    };
    let name = path.file_name().unwrap_or_default().to_string_lossy();
    let temp = dir.join(format!(".{name}.{}.tmp", std::process::id()));
    let written = File::create(&temp).and_then(|mut file| {
        file.write_all(text.as_bytes())?;
        file.sync_all()
    });
    let result = written.and_then(|()| fs::rename(&temp, path));
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

/// `path`, with `.sgf` added when it has another extension or none.
pub fn with_sgf_extension(path: &Path) -> PathBuf {
    match has_sgf_extension(path) {
        true => path.to_path_buf(),
        false => {
            let mut name = path.as_os_str().to_owned();
            name.push(".sgf");
            PathBuf::from(name)
        }
    }
}

/// The existing file a save would replace without the dialog having asked: the user typed a
/// name without `.sgf`, the dialog checked that name, and `<name>.sgf` is already there.
pub fn unasked_overwrite(picked: &Path) -> Option<PathBuf> {
    let target = with_sgf_extension(picked);
    (target != picked && target.exists()).then_some(target)
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
    tokens: Mutex<HashMap<String, PathBuf>>,
    next_token: AtomicU64,
    language: Mutex<MenuLanguage>,
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
        }
    }

    fn token(&self, path: PathBuf) -> String {
        let token = format!("f{}", self.next_token.fetch_add(1, Ordering::Relaxed));
        lock(&self.tokens).insert(token.clone(), path);
        token
    }

    fn opened(&self, path: &Path) -> Result<OpenedFile, ProtocolError> {
        let (name, bytes) = read_sgf_file(path)?;
        Ok(OpenedFile {
            token: self.token(path.to_path_buf()),
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
        let built = menu::build(app, language, entries).and_then(|m| app.set_menu(m));
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
    platform.update_recent(&app, |recent| recent.push(&path, &title, now_ms()));
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
    let path = with_sgf_extension(&path);
    let write = path.clone();
    tauri::async_runtime::spawn_blocking(move || write_atomically(&write, &text))
        .await
        .map_err(join_failed)?
        .map_err(|e| error(ErrorCode::FileWriteFailed, e.to_string()))?;
    Ok(Some(platform.token(path)))
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
    platform: State<'_, DesktopFiles>,
) -> Result<(), ProtocolError> {
    let language = MenuLanguage::from_tag(&language);
    let changed = {
        let mut current = lock(&platform.language);
        std::mem::replace(&mut *current, language) != language
    };
    if changed {
        platform.rebuild_menu(&app, &platform.recent_entries());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::ErrorCode;

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
    fn menu_actions_json_shape() {
        use serde_json::json;
        assert_eq!(
            serde_json::to_value(MenuAction::New13).unwrap(),
            json!("new13")
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
        for action in [MenuAction::New19, MenuAction::Open, MenuAction::Recent(0)] {
            assert_eq!(MenuAction::from_id(&action.id()), Some(action));
        }
    }
}
