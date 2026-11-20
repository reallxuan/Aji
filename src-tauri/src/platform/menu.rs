//! The macOS menu bar (design 5.6): the app menu, 文件 / File, Edit and Window.
//!
//! The Rust side cannot read the interface's locale files, so the menu's labels live in the
//! small table below, in both languages, with the one question the save command asks. It is
//! the only interface text on the Rust side.

use tauri::menu::{
    Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, Submenu, SubmenuBuilder,
};
use tauri::{AppHandle, Runtime};

use super::MenuAction;
use super::recent::RecentEntry;

/// The language the menu is in: the one the interface resolved.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MenuLanguage {
    ZhCn,
    En,
}

impl MenuLanguage {
    /// `zh-CN` and `en`, as the interface names them; anything else is English.
    pub fn from_tag(tag: &str) -> MenuLanguage {
        match tag {
            "zh-CN" => MenuLanguage::ZhCn,
            _ => MenuLanguage::En,
        }
    }
}

/// Every label the menu shows.
pub struct Labels {
    pub about: &'static str,
    pub services: &'static str,
    pub hide: &'static str,
    pub hide_others: &'static str,
    pub show_all: &'static str,
    pub quit: &'static str,
    pub file: &'static str,
    pub new_game: &'static str,
    pub size19: &'static str,
    pub size13: &'static str,
    pub size9: &'static str,
    pub open: &'static str,
    pub open_recent: &'static str,
    pub no_recent: &'static str,
    pub clear_recent: &'static str,
    pub save_as: &'static str,
    pub edit: &'static str,
    pub undo: &'static str,
    pub redo: &'static str,
    pub cut: &'static str,
    pub copy: &'static str,
    pub paste: &'static str,
    pub select_all: &'static str,
    pub window: &'static str,
    pub minimize: &'static str,
    pub zoom: &'static str,
    pub fullscreen: &'static str,
    pub close_window: &'static str,
    /// Asked before a save replaces a file the save dialog did not ask about; `{name}` is its name.
    pub replace_prompt: &'static str,
    pub replace: &'static str,
    pub cancel: &'static str,
}

pub fn labels(language: MenuLanguage) -> Labels {
    match language {
        MenuLanguage::ZhCn => Labels {
            about: "关于 Aji",
            services: "服务",
            hide: "隐藏 Aji",
            hide_others: "隐藏其他",
            show_all: "全部显示",
            quit: "退出 Aji",
            file: "文件",
            new_game: "新建棋局",
            size19: "19 路",
            size13: "13 路",
            size9: "9 路",
            open: "打开棋谱…",
            open_recent: "打开最近",
            no_recent: "暂无最近打开的棋谱",
            clear_recent: "清除最近记录",
            save_as: "另存为…",
            edit: "编辑",
            undo: "撤销",
            redo: "重做",
            cut: "剪切",
            copy: "拷贝",
            paste: "粘贴",
            select_all: "全选",
            window: "窗口",
            minimize: "最小化",
            zoom: "缩放",
            fullscreen: "进入全屏幕",
            close_window: "关闭窗口",
            replace_prompt: "“{name}”已存在。要替换它吗？",
            replace: "替换",
            cancel: "取消",
        },
        MenuLanguage::En => Labels {
            about: "About Aji",
            services: "Services",
            hide: "Hide Aji",
            hide_others: "Hide Others",
            show_all: "Show All",
            quit: "Quit Aji",
            file: "File",
            new_game: "New Game",
            size19: "19×19",
            size13: "13×13",
            size9: "9×9",
            open: "Open…",
            open_recent: "Open Recent",
            no_recent: "No recent games",
            clear_recent: "Clear Menu",
            save_as: "Save As…",
            edit: "Edit",
            undo: "Undo",
            redo: "Redo",
            cut: "Cut",
            copy: "Copy",
            paste: "Paste",
            select_all: "Select All",
            window: "Window",
            minimize: "Minimize",
            zoom: "Zoom",
            fullscreen: "Enter Full Screen",
            close_window: "Close Window",
            replace_prompt: "“{name}” already exists. Do you want to replace it?",
            replace: "Replace",
            cancel: "Cancel",
        },
    }
}

fn item<R: Runtime>(
    app: &AppHandle<R>,
    action: MenuAction,
    label: &str,
) -> tauri::Result<tauri::menu::MenuItem<R>> {
    MenuItemBuilder::with_id(action.id(), label).build(app)
}

fn recent_menu<R: Runtime>(
    app: &AppHandle<R>,
    l: &Labels,
    recent: &[RecentEntry],
) -> tauri::Result<Submenu<R>> {
    let mut menu = SubmenuBuilder::new(app, l.open_recent);
    if recent.is_empty() {
        menu = menu.item(
            &MenuItemBuilder::new(l.no_recent)
                .enabled(false)
                .build(app)?,
        );
    }
    for (i, entry) in recent.iter().enumerate() {
        let index = u32::try_from(i).unwrap_or(u32::MAX);
        let label = match entry.title.is_empty() {
            true => entry.name.as_str(),
            false => entry.title.as_str(),
        };
        menu = menu.item(
            &MenuItemBuilder::with_id(MenuAction::Recent(index).id(), label)
                .enabled(!entry.missing)
                .build(app)?,
        );
    }
    menu.separator()
        .item(
            &MenuItemBuilder::with_id(MenuAction::ClearRecent.id(), l.clear_recent)
                .enabled(!recent.is_empty())
                .build(app)?,
        )
        .build()
}

/// The whole menu bar, with the recent list in 打开最近.
pub fn build<R: Runtime>(
    app: &AppHandle<R>,
    language: MenuLanguage,
    recent: &[RecentEntry],
) -> tauri::Result<Menu<R>> {
    let l = labels(language);
    let app_menu = SubmenuBuilder::new(app, "Aji")
        .item(&PredefinedMenuItem::about(app, Some(l.about), None)?)
        .separator()
        .item(&PredefinedMenuItem::services(app, Some(l.services))?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, Some(l.hide))?)
        .item(&PredefinedMenuItem::hide_others(app, Some(l.hide_others))?)
        .item(&PredefinedMenuItem::show_all(app, Some(l.show_all))?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, Some(l.quit))?)
        .build()?;
    let new_game = SubmenuBuilder::new(app, l.new_game)
        .item(
            &MenuItemBuilder::with_id(MenuAction::New19.id(), l.size19)
                .accelerator("CmdOrCtrl+N")
                .build(app)?,
        )
        .item(&item(app, MenuAction::New13, l.size13)?)
        .item(&item(app, MenuAction::New9, l.size9)?)
        .build()?;
    let file = SubmenuBuilder::new(app, l.file)
        .item(&new_game)
        .item(
            &MenuItemBuilder::with_id(MenuAction::Open.id(), l.open)
                .accelerator("CmdOrCtrl+O")
                .build(app)?,
        )
        .item(&recent_menu(app, &l, recent)?)
        .separator()
        .item(
            &MenuItemBuilder::with_id(MenuAction::SaveAs.id(), l.save_as)
                .accelerator("CmdOrCtrl+Shift+S")
                .build(app)?,
        )
        .build()?;
    let edit = SubmenuBuilder::new(app, l.edit)
        .item(&PredefinedMenuItem::undo(app, Some(l.undo))?)
        .item(&PredefinedMenuItem::redo(app, Some(l.redo))?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, Some(l.cut))?)
        .item(&PredefinedMenuItem::copy(app, Some(l.copy))?)
        .item(&PredefinedMenuItem::paste(app, Some(l.paste))?)
        .item(&PredefinedMenuItem::select_all(app, Some(l.select_all))?)
        .build()?;
    let window = SubmenuBuilder::new(app, l.window)
        .item(&PredefinedMenuItem::minimize(app, Some(l.minimize))?)
        .item(&PredefinedMenuItem::maximize(app, Some(l.zoom))?)
        .item(&PredefinedMenuItem::fullscreen(app, Some(l.fullscreen))?)
        .separator()
        .item(&PredefinedMenuItem::close_window(
            app,
            Some(l.close_window),
        )?)
        .build()?;
    MenuBuilder::new(app)
        .items(&[&app_menu, &file, &edit, &window])
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn languages_from_tags() {
        assert_eq!(MenuLanguage::from_tag("zh-CN"), MenuLanguage::ZhCn);
        assert_eq!(MenuLanguage::from_tag("en"), MenuLanguage::En);
        assert_eq!(MenuLanguage::from_tag("fr"), MenuLanguage::En);
    }

    #[test]
    fn both_languages_label_the_file_menu() {
        let zh = labels(MenuLanguage::ZhCn);
        let en = labels(MenuLanguage::En);
        assert_eq!((zh.file, zh.save_as), ("文件", "另存为…"));
        assert_eq!((en.file, en.save_as), ("File", "Save As…"));
    }
}
