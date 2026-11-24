//! The macOS menu bar (design 5.6): the app menu, 文件 / File, Edit, 显示 / View (its 布局
//! submenu, P2 M1 design 5.3, and 形势判断), 分析 / Analysis (P2 M2 design 5.10) and Window.
//!
//! The Rust side cannot read the interface's locale files, so the menu's labels live in the
//! small table below, in both languages, with the one question the save command asks. It is
//! the only interface text on the Rust side.

use tauri::menu::{
    Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, Submenu, SubmenuBuilder,
};
use tauri::{AppHandle, Runtime};

use super::recent::RecentEntry;
use super::{LAYOUT_PRESETS, MenuAction, SHOT_TARGETS};

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
    pub other_sizes: &'static str,
    pub size_label: &'static str,
    pub size19: &'static str,
    pub size13: &'static str,
    pub size9: &'static str,
    pub open: &'static str,
    pub open_recent: &'static str,
    pub no_recent: &'static str,
    pub clear_recent: &'static str,
    pub save_as: &'static str,
    pub export_image: &'static str,
    /// Save and copy, in the order of [`SHOT_TARGETS`].
    pub save_image: [&'static str; 3],
    pub copy_image: [&'static str; 3],
    pub edit: &'static str,
    pub undo: &'static str,
    pub redo: &'static str,
    pub cut: &'static str,
    pub copy: &'static str,
    pub paste: &'static str,
    pub select_all: &'static str,
    pub view: &'static str,
    pub layout: &'static str,
    /// The presets' names, in the order of [`LAYOUT_PRESETS`].
    pub presets: [&'static str; 5],
    pub window: &'static str,
    pub minimize: &'static str,
    pub zoom: &'static str,
    pub fullscreen: &'static str,
    pub close_window: &'static str,
    /// Asked before a save replaces a file the save dialog did not ask about; `{name}` is its name.
    pub replace_prompt: &'static str,
    pub replace: &'static str,
    pub cancel: &'static str,
    pub analysis: &'static str,
    pub analyse_game: &'static str,
    pub stop_game: &'static str,
    pub clear_analysis: &'static str,
    pub clear_position: &'static str,
    pub clear_game: &'static str,
    pub final_scoring: &'static str,
    pub estimate: &'static str,
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
            other_sizes: "其他路数",
            size_label: "{n} 路",
            size19: "19 路",
            size13: "13 路",
            size9: "9 路",
            open: "打开棋谱…",
            open_recent: "打开最近",
            no_recent: "暂无最近打开的棋谱",
            clear_recent: "清除最近记录",
            save_as: "另存为…",
            export_image: "导出图片",
            save_image: ["保存棋盘图片…", "保存副盘图片…", "保存走势图图片…"],
            copy_image: ["拷贝棋盘图片", "拷贝副盘图片", "拷贝走势图图片"],
            edit: "编辑",
            undo: "撤销",
            redo: "重做",
            cut: "剪切",
            copy: "拷贝",
            paste: "粘贴",
            select_all: "全选",
            view: "显示",
            layout: "布局",
            presets: ["默认", "经典", "极简", "思考", "四盘"],
            window: "窗口",
            minimize: "最小化",
            zoom: "缩放",
            fullscreen: "进入全屏幕",
            close_window: "关闭窗口",
            replace_prompt: "“{name}”已存在。要替换它吗？",
            replace: "替换",
            cancel: "取消",
            analysis: "分析",
            analyse_game: "分析全局…",
            stop_game: "停止全局分析",
            clear_analysis: "清除分析结果",
            clear_position: "本局面",
            clear_game: "整局",
            final_scoring: "终局点目",
            estimate: "形势判断",
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
            other_sizes: "Other Sizes",
            size_label: "{n}×{n}",
            size19: "19×19",
            size13: "13×13",
            size9: "9×9",
            open: "Open…",
            open_recent: "Open Recent",
            no_recent: "No recent games",
            clear_recent: "Clear Menu",
            save_as: "Save As…",
            export_image: "Export Image",
            save_image: [
                "Save Board Image…",
                "Save Sub-board Image…",
                "Save Graph Image…",
            ],
            copy_image: [
                "Copy Board Image",
                "Copy Sub-board Image",
                "Copy Graph Image",
            ],
            edit: "Edit",
            undo: "Undo",
            redo: "Redo",
            cut: "Cut",
            copy: "Copy",
            paste: "Paste",
            select_all: "Select All",
            view: "View",
            layout: "Layout",
            presets: ["Default", "Classic", "Minimal", "Thinking", "Four Boards"],
            window: "Window",
            minimize: "Minimize",
            zoom: "Zoom",
            fullscreen: "Enter Full Screen",
            close_window: "Close Window",
            replace_prompt: "“{name}” already exists. Do you want to replace it?",
            replace: "Replace",
            cancel: "Cancel",
            analysis: "Analysis",
            analyse_game: "Analyse Game…",
            stop_game: "Stop Game Analysis",
            clear_analysis: "Clear Analysis",
            clear_position: "This Position",
            clear_game: "Whole Game",
            final_scoring: "Final Scoring",
            estimate: "Position Estimate",
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

/// 文件 → 导出图片 (owner, 2026-11-22): save, then copy, each of the board, the sub-board and the
/// graph. The interface finds the target on screen and says so when it is not there.
fn export_menu<R: Runtime>(app: &AppHandle<R>, l: &Labels) -> tauri::Result<Submenu<R>> {
    let mut menu = SubmenuBuilder::new(app, l.export_image);
    for (target, label) in SHOT_TARGETS.into_iter().zip(l.save_image) {
        menu = menu.item(&item(app, MenuAction::SaveImage(target.to_owned()), label)?);
    }
    menu = menu.separator();
    for (target, label) in SHOT_TARGETS.into_iter().zip(l.copy_image) {
        menu = menu.item(&item(app, MenuAction::CopyImage(target.to_owned()), label)?);
    }
    menu.build()
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
    let mut other_sizes = SubmenuBuilder::new(app, l.other_sizes);
    for n in 5..=18 {
        let label = l.size_label.replace("{n}", &n.to_string());
        other_sizes = other_sizes.item(&item(app, MenuAction::New(n), &label)?);
    }
    let new_game = SubmenuBuilder::new(app, l.new_game)
        .item(
            &MenuItemBuilder::with_id(MenuAction::New(19).id(), l.size19)
                .accelerator("CmdOrCtrl+N")
                .build(app)?,
        )
        .item(&item(app, MenuAction::New(13), l.size13)?)
        .item(&item(app, MenuAction::New(9), l.size9)?)
        .item(&other_sizes.build()?)
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
        .item(&export_menu(app, &l)?)
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
    let mut layout = SubmenuBuilder::new(app, l.layout);
    for (preset, label) in LAYOUT_PRESETS.into_iter().zip(l.presets) {
        layout = layout.item(&item(app, MenuAction::Layout(preset.to_owned()), label)?);
    }
    // The estimate's key, T, is the interface's: a one-letter accelerator would fire while typing.
    let view = SubmenuBuilder::new(app, l.view)
        .item(&layout.build()?)
        .separator()
        .item(&item(app, MenuAction::Estimate, l.estimate)?)
        .build()?;
    let clear = SubmenuBuilder::new(app, l.clear_analysis)
        .item(&item(app, MenuAction::ClearPosition, l.clear_position)?)
        .item(&item(app, MenuAction::ClearGame, l.clear_game)?)
        .build()?;
    let analysis = SubmenuBuilder::new(app, l.analysis)
        .item(
            &MenuItemBuilder::with_id(MenuAction::AnalyseGame.id(), l.analyse_game)
                .accelerator("CmdOrCtrl+Shift+A")
                .build(app)?,
        )
        .item(&item(app, MenuAction::StopGame, l.stop_game)?)
        .separator()
        .item(&clear)
        .separator()
        .item(&item(app, MenuAction::FinalScoring, l.final_scoring)?)
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
        .items(&[&app_menu, &file, &edit, &view, &analysis, &window])
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
        assert_eq!(zh.other_sizes, "其他路数");
        assert_eq!(en.other_sizes, "Other Sizes");
        assert_eq!((zh.file, zh.save_as), ("文件", "另存为…"));
        assert_eq!((en.file, en.save_as), ("File", "Save As…"));
    }

    #[test]
    fn new_size_ids_round_trip() {
        for n in 5..=19 {
            let action = MenuAction::New(n);
            assert_eq!(action.id(), format!("new:{n}"));
            assert_eq!(MenuAction::from_id(&action.id()), Some(action));
        }
        for invalid in ["new:4", "new:20", "new:-1", "new:huge", "new:09"] {
            assert_eq!(MenuAction::from_id(invalid), None);
        }
    }

    #[test]
    fn layout_ids_round_trip() {
        for preset in LAYOUT_PRESETS {
            let action = MenuAction::Layout(preset.to_owned());
            assert_eq!(action.id(), format!("layout:{preset}"));
            assert_eq!(MenuAction::from_id(&action.id()), Some(action));
        }
        assert_eq!(MenuAction::from_id("layout:custom"), None);
        assert_eq!(MenuAction::from_id("layout:"), None);
    }

    #[test]
    fn image_ids_round_trip() {
        for target in SHOT_TARGETS {
            for action in [
                MenuAction::SaveImage(target.to_owned()),
                MenuAction::CopyImage(target.to_owned()),
            ] {
                assert_eq!(MenuAction::from_id(&action.id()), Some(action));
            }
        }
        assert_eq!(
            MenuAction::SaveImage("graph".into()).id(),
            "saveImage:graph"
        );
        assert_eq!(MenuAction::from_id("copyImage:window"), None);
    }

    #[test]
    fn both_languages_label_the_export_menu() {
        // 文件 → 导出图片 (owner, 2026-11-22): the screenshots live in the menu bar on the Mac.
        let zh = labels(MenuLanguage::ZhCn);
        let en = labels(MenuLanguage::En);
        assert_eq!(zh.export_image, "导出图片");
        assert_eq!(
            zh.save_image,
            ["保存棋盘图片…", "保存副盘图片…", "保存走势图图片…"]
        );
        assert_eq!(
            zh.copy_image,
            ["拷贝棋盘图片", "拷贝副盘图片", "拷贝走势图图片"]
        );
        assert_eq!(en.export_image, "Export Image");
        assert_eq!(en.save_image[0], "Save Board Image…");
        assert_eq!(en.copy_image[2], "Copy Graph Image");
    }

    #[test]
    fn both_languages_label_the_layout_menu() {
        let zh = labels(MenuLanguage::ZhCn);
        let en = labels(MenuLanguage::En);
        assert_eq!((zh.view, zh.layout), ("显示", "布局"));
        assert_eq!(zh.presets, ["默认", "经典", "极简", "思考", "四盘"]);
        assert_eq!((en.view, en.layout), ("View", "Layout"));
        assert_eq!(en.presets[4], "Four Boards");
    }

    fn every_label(l: &Labels) -> Vec<&'static str> {
        let mut all = vec![
            l.about,
            l.services,
            l.hide,
            l.hide_others,
            l.show_all,
            l.quit,
            l.file,
            l.new_game,
            l.other_sizes,
            l.size_label,
            l.size19,
            l.size13,
            l.size9,
            l.open,
            l.open_recent,
            l.no_recent,
            l.clear_recent,
            l.save_as,
            l.export_image,
            l.edit,
            l.undo,
            l.redo,
            l.cut,
            l.copy,
            l.paste,
            l.select_all,
            l.view,
            l.layout,
            l.window,
            l.minimize,
            l.zoom,
            l.fullscreen,
            l.close_window,
            l.replace_prompt,
            l.replace,
            l.cancel,
            l.analysis,
            l.analyse_game,
            l.stop_game,
            l.clear_analysis,
            l.clear_position,
            l.clear_game,
            l.final_scoring,
            l.estimate,
        ];
        all.extend(l.save_image);
        all.extend(l.copy_image);
        all.extend(l.presets);
        all
    }

    #[test]
    fn menu_labels_have_no_middle_dot() {
        for language in [MenuLanguage::ZhCn, MenuLanguage::En] {
            for label in every_label(&labels(language)) {
                assert!(!label.contains('·'), "{label}");
            }
        }
    }

    #[test]
    fn both_languages_label_the_analysis_menu() {
        let zh = labels(MenuLanguage::ZhCn);
        assert_eq!(
            [
                zh.analysis,
                zh.analyse_game,
                zh.stop_game,
                zh.clear_analysis
            ],
            ["分析", "分析全局…", "停止全局分析", "清除分析结果"]
        );
        assert_eq!(
            [
                zh.clear_position,
                zh.clear_game,
                zh.final_scoring,
                zh.estimate
            ],
            ["本局面", "整局", "终局点目", "形势判断"]
        );
        let en = labels(MenuLanguage::En);
        assert_eq!(
            (en.analysis, en.analyse_game),
            ("Analysis", "Analyse Game…")
        );
        assert_eq!(en.estimate, "Position Estimate");
    }

    #[test]
    fn analysis_ids_round_trip() {
        for action in [
            MenuAction::AnalyseGame,
            MenuAction::StopGame,
            MenuAction::ClearPosition,
            MenuAction::ClearGame,
            MenuAction::FinalScoring,
            MenuAction::Estimate,
        ] {
            assert_eq!(MenuAction::from_id(&action.id()), Some(action));
        }
        assert_eq!(MenuAction::AnalyseGame.id(), "analyseGame");
    }
}
