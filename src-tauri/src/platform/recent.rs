//! `recent.json`: the files opened or saved lately, newest first.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::write_atomically;

/// How many files the list keeps.
pub const RECENT_CAP: usize = 10;

/// A recent file, as the game menu lists it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RecentEntry {
    /// The game's title when it was opened.
    pub title: String,
    /// The file name, with its extension.
    pub name: String,
    /// The full path, shown on hover.
    pub path: String,
    /// Unix time in milliseconds.
    #[ts(type = "number")]
    pub opened_at: u64,
    /// The file is no longer there; checked when the list is read.
    pub missing: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Stored {
    path: PathBuf,
    title: String,
    opened_at: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecentList {
    entries: Vec<Stored>,
}

impl RecentList {
    /// The list in `path`; empty when the file is missing or unreadable (logged).
    pub fn load(path: &Path) -> RecentList {
        let text = match fs::read_to_string(path) {
            Ok(text) => text,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return RecentList::default(),
            Err(e) => {
                eprintln!("aji: cannot read {}: {e}", path.display());
                return RecentList::default();
            }
        };
        serde_json::from_str(&text).unwrap_or_else(|e| {
            eprintln!("aji: ignoring {}: {e}", path.display());
            RecentList::default()
        })
    }

    pub fn save(&self, path: &Path) -> io::Result<()> {
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir)?;
        }
        let mut text = serde_json::to_string_pretty(self).map_err(io::Error::other)?;
        text.push('\n');
        write_atomically(path, &text)
    }

    /// Puts `path` at the top, dropping an older entry for it and the oldest past the cap.
    pub fn push(&mut self, path: &Path, title: &str, now: u64) {
        self.entries.retain(|e| e.path != path);
        self.entries.insert(
            0,
            Stored {
                path: path.to_path_buf(),
                title: title.to_owned(),
                opened_at: now,
            },
        );
        self.entries.truncate(RECENT_CAP);
    }

    /// The path of entry `index`.
    pub fn path(&self, index: usize) -> Option<PathBuf> {
        self.entries.get(index).map(|e| e.path.clone())
    }

    /// Drops a file even if its position in the list changed while it was being opened.
    pub fn remove(&mut self, path: &Path) {
        self.entries.retain(|entry| entry.path != path);
    }

    pub fn clear(&mut self) {
        self.entries.clear();
    }

    pub fn entries(&self) -> Vec<RecentEntry> {
        self.entries
            .iter()
            .map(|e| RecentEntry {
                title: e.title.clone(),
                name: e
                    .path
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default(),
                path: e.path.display().to_string(),
                opened_at: e.opened_at,
                missing: !e.path.is_file(),
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn file(dir: &tempfile::TempDir, name: &str) -> PathBuf {
        let path = dir.path().join(name);
        std::fs::write(&path, "(;)").unwrap();
        path
    }

    #[test]
    fn recent_moves_to_top_and_caps_at_10() {
        let dir = tempfile::tempdir().unwrap();
        let mut list = RecentList::default();
        for i in 0..12 {
            list.push(
                &file(&dir, &format!("{i}.sgf")),
                &format!("game {i}"),
                1000 + i,
            );
        }
        let entries = list.entries();
        assert_eq!(entries.len(), 10);
        assert_eq!(entries[0].name, "11.sgf");
        assert_eq!(entries[0].title, "game 11");
        assert_eq!(entries[0].opened_at, 1011);
        assert_eq!(entries[9].name, "2.sgf");
        list.push(&dir.path().join("5.sgf"), "again", 2000);
        let entries = list.entries();
        assert_eq!(entries.len(), 10);
        assert_eq!(
            (entries[0].name.as_str(), entries[0].title.as_str()),
            ("5.sgf", "again")
        );
        assert_eq!(entries.iter().filter(|e| e.name == "5.sgf").count(), 1);
        let selected = list.path(0).unwrap();
        assert_eq!(selected, dir.path().join("5.sgf"));
        list.push(&file(&dir, "12.sgf"), "newer", 3000);
        list.remove(&selected);
        list.remove(&dir.path().join("absent.sgf"));
        let entries = list.entries();
        assert_eq!(entries[0].name, "12.sgf");
        assert_eq!(entries[1].name, "11.sgf");
        assert!(!entries.iter().any(|e| e.name == "5.sgf"));
        list.clear();
        assert!(list.entries().is_empty());
    }

    #[test]
    fn recent_marks_missing_files() {
        let dir = tempfile::tempdir().unwrap();
        let mut list = RecentList::default();
        let here = file(&dir, "here.sgf");
        list.push(&dir.path().join("gone.sgf"), "gone", 1);
        list.push(&here, "here", 2);
        let entries = list.entries();
        assert!(!entries[0].missing);
        assert!(entries[1].missing);
        assert_eq!(entries[0].path, here.display().to_string());
    }

    #[test]
    fn recent_survives_a_corrupt_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("recent.json");
        std::fs::write(&path, "{garbage").unwrap();
        let mut list = RecentList::load(&path);
        assert!(list.entries().is_empty());
        list.push(&file(&dir, "a.sgf"), "a", 5);
        list.save(&path).unwrap();
        let again = RecentList::load(&path);
        assert_eq!(again.entries().len(), 1);
        assert_eq!(again.entries()[0].title, "a");
        assert!(
            RecentList::load(&dir.path().join("none.json"))
                .entries()
                .is_empty()
        );
    }
}
