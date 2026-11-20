//! Free space before a download or an unpack (design 5.3).

use std::io;
use std::path::Path;

/// Free bytes for unprivileged users on the volume that holds a path.
pub trait FreeSpace: Send + Sync {
    fn available(&self, path: &Path) -> io::Result<u64>;
}

/// The operating system's answer.
pub struct SystemFreeSpace;

impl FreeSpace for SystemFreeSpace {
    /// The install root may not exist yet: its nearest existing ancestor is on the same volume.
    fn available(&self, path: &Path) -> io::Result<u64> {
        let mut probe = path;
        loop {
            match std::fs::metadata(probe) {
                Ok(_) => return fs4::available_space(probe),
                Err(e) if e.kind() == io::ErrorKind::NotFound => {}
                Err(e) => return Err(e),
            }
            probe = probe.parent().ok_or_else(|| {
                io::Error::new(
                    io::ErrorKind::NotFound,
                    format!("no existing folder holds {}", path.display()),
                )
            })?;
        }
    }
}

/// Room left over after the estimate, so the disk is never filled to the last byte.
pub const SPACE_MARGIN: u64 = 256 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NotEnoughSpace {
    /// The estimate plus `SPACE_MARGIN`.
    pub need: u64,
    pub available: u64,
}

/// Fails when the volume holding `root` has less than `need` plus `SPACE_MARGIN` free. A probe
/// that fails does not block the install: it is logged, and a full disk then shows as a write
/// error.
pub fn check_space(space: &dyn FreeSpace, root: &Path, need: u64) -> Result<(), NotEnoughSpace> {
    let need = need.saturating_add(SPACE_MARGIN);
    match space.available(root) {
        Ok(available) if available < need => Err(NotEnoughSpace { need, available }),
        Ok(_) => Ok(()),
        Err(e) => {
            eprintln!(
                "aji: cannot read the free space for {}: {e}",
                root.display()
            );
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixed(io::Result<u64>);

    impl FreeSpace for Fixed {
        fn available(&self, _: &Path) -> io::Result<u64> {
            match &self.0 {
                Ok(n) => Ok(*n),
                Err(e) => Err(io::Error::new(e.kind(), e.to_string())),
            }
        }
    }

    #[test]
    fn not_enough_space_names_need_and_available() {
        let root = Path::new("/aji");
        assert_eq!(
            check_space(&Fixed(Ok(100)), root, 50),
            Err(NotEnoughSpace {
                need: 50 + SPACE_MARGIN,
                available: 100
            })
        );
        assert_eq!(check_space(&Fixed(Ok(50 + SPACE_MARGIN)), root, 50), Ok(()));
        // A huge estimate saturates instead of overflowing.
        assert_eq!(
            check_space(&Fixed(Ok(u64::MAX - 1)), root, u64::MAX - 10),
            Err(NotEnoughSpace {
                need: u64::MAX,
                available: u64::MAX - 1
            })
        );
    }

    #[test]
    fn a_failed_probe_does_not_block() {
        let failed = Fixed(Err(io::Error::other("no statvfs")));
        assert_eq!(check_space(&failed, Path::new("/aji"), 50), Ok(()));
    }

    #[test]
    fn the_system_probe_answers_for_a_root_that_does_not_exist_yet() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("not yet").join("aji");
        assert!(SystemFreeSpace.available(&root).unwrap() > 0);
    }
}
