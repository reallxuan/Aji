//! Unpacking engine packages and NVIDIA runtime archives (design 5.4): every entry checked,
//! everything written into a staging folder, then one rename into place.

use std::fs::{self, File};
use std::io;
use std::path::{Path, PathBuf};

use zip::ZipArchive;
use zip::result::ZipError;

use super::InstallRoot;
use crate::manifest::is_plain_name;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UnpackError {
    /// An entry whose name could leave its folder, or a link.
    UnsafeEntry(String),
    /// The package has no KataGo binary at its top.
    NoKatago,
    /// A runtime pattern that took nothing from its archive.
    PatternMatchedNothing(String),
    Zip(String),
    Io(String),
}

/// KataGo's binary at the top of its package.
pub const KATAGO_BINARY: &str = if cfg!(windows) {
    "katago.exe"
} else {
    "katago"
};

/// Uncompressed bytes of the entries `unpack_runtime` would take (or every entry when
/// `patterns` is None), read from the central directory without unpacking.
pub fn extract_size(zip: &Path, patterns: Option<&[String]>) -> Result<u64, UnpackError> {
    let mut archive = open(zip)?;
    let mut total = 0u64;
    for i in 0..archive.len() {
        let entry = archive.by_index_raw(i).map_err(zip_error)?;
        if entry.is_dir() {
            continue;
        }
        let name = entry.name().map_err(zip_error)?;
        let file_name = name.rsplit('/').next().unwrap_or(&name);
        if patterns.is_none_or(|list| list.iter().any(|p| pattern_matches(p, file_name))) {
            total = total.saturating_add(entry.size());
        }
    }
    Ok(total)
}

/// Unpacks into a new staging dir, then renames it to engines/<engine>. Returns the binary's
/// file name.
pub fn unpack_engine(zip: &Path, root: &InstallRoot, engine: &str) -> Result<String, UnpackError> {
    if !is_plain_name(engine) {
        return Err(UnpackError::UnsafeEntry(engine.into()));
    }
    let mut archive = open(zip)?;
    in_staging(root, &root.engine_dir(engine), |staging| {
        for i in 0..archive.len() {
            let mut entry = archive.by_index(i).map_err(zip_error)?;
            let (name, parts) = checked_name(&entry)?;
            if entry.is_symlink() {
                return Err(UnpackError::UnsafeEntry(name));
            }
            let dest = parts.iter().fold(staging.to_path_buf(), |p, c| p.join(c));
            if entry.is_dir() {
                fs::create_dir_all(&dest).map_err(|e| io_error(&dest, e))?;
            } else {
                write_entry(&mut entry, &dest)?;
            }
        }
        let binary = staging.join(KATAGO_BINARY);
        if !binary.is_file() {
            return Err(UnpackError::NoKatago);
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&binary, fs::Permissions::from_mode(0o755))
                .map_err(|e| io_error(&binary, e))?;
        }
        Ok(())
    })?;
    Ok(KATAGO_BINARY.into())
}

/// Takes each archive's entries whose last path component matches one of its patterns (`*`
/// wildcard, ASCII case-insensitive), flat, then renames the staging dir to
/// runtimes/<runtime>.
pub fn unpack_runtime(
    archives: &[(PathBuf, Vec<String>)],
    root: &InstallRoot,
    runtime: &str,
) -> Result<(), UnpackError> {
    if !is_plain_name(runtime) {
        return Err(UnpackError::UnsafeEntry(runtime.into()));
    }
    in_staging(root, &root.runtime_dir(runtime), |staging| {
        for (zip, patterns) in archives {
            let mut archive = open(zip)?;
            let mut used = vec![false; patterns.len()];
            for i in 0..archive.len() {
                let mut entry = archive.by_index(i).map_err(zip_error)?;
                let (name, parts) = checked_name(&entry)?;
                if entry.is_dir() {
                    continue;
                }
                let file_name = parts.last().map_or("", String::as_str);
                let mut taken = false;
                for (used, pattern) in used.iter_mut().zip(patterns) {
                    if pattern_matches(pattern, file_name) {
                        *used = true;
                        taken = true;
                    }
                }
                if !taken {
                    continue;
                }
                if entry.is_symlink() {
                    return Err(UnpackError::UnsafeEntry(name));
                }
                write_entry(&mut entry, &staging.join(file_name))?;
            }
            if let Some(unused) = used.iter().position(|u| !u) {
                return Err(UnpackError::PatternMatchedNothing(patterns[unused].clone()));
            }
        }
        Ok(())
    })
}

/// Runs `fill` on a new staging folder, then moves the folder to `dest`, replacing what is
/// there. On failure the staging folder is removed and `dest` is left as it was.
fn in_staging(
    root: &InstallRoot,
    dest: &Path,
    fill: impl FnOnce(&Path) -> Result<(), UnpackError>,
) -> Result<(), UnpackError> {
    let staging = root
        .new_staging_dir()
        .map_err(|e| io_error(&root.root().join("staging"), e))?;
    let result = fill(&staging).and_then(|()| {
        #[cfg(target_os = "macos")]
        match clear_quarantine(&staging) {
            Ok(0) => eprintln!("aji: no unpacked file carried com.apple.quarantine"),
            Ok(n) => eprintln!("aji: removed com.apple.quarantine from {n} unpacked files"),
            Err(e) => eprintln!("aji: cannot check com.apple.quarantine: {e}"),
        }
        move_into_place(&staging, dest)
    });
    if result.is_err()
        && let Err(e) = fs::remove_dir_all(&staging)
    {
        eprintln!("aji: cannot remove {}: {e}", staging.display());
    }
    result
}

/// The caller only unpacks what is not recorded, so a folder already at `dest` is a leftover.
fn move_into_place(staging: &Path, dest: &Path) -> Result<(), UnpackError> {
    match fs::symlink_metadata(dest) {
        Ok(meta) if meta.is_dir() => fs::remove_dir_all(dest),
        Ok(_) => fs::remove_file(dest),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
    }
    .map_err(|e| io_error(dest, e))?;
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| io_error(parent, e))?;
    }
    // On Windows a virus scanner can hold a just-written file open for a moment, which makes
    // renaming its folder fail with "access denied".
    let tries = if cfg!(windows) { 10 } else { 1 };
    for attempt in 1.. {
        match fs::rename(staging, dest) {
            Err(e) if e.kind() == io::ErrorKind::PermissionDenied && attempt < tries => {
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            result => return result.map_err(|e| io_error(dest, e)),
        }
    }
    unreachable!()
}

/// The entry's name and its `/` components, when it stays inside its folder: accepted by
/// `enclosed_name` and with every component a plain name (no `..`, `\`, `:` or empty part).
fn checked_name<R: io::Read>(
    entry: &zip::read::ZipFile<'_, R>,
) -> Result<(String, Vec<String>), UnpackError> {
    let name = entry.name().map_err(zip_error)?.into_owned();
    let trimmed = name.strip_suffix('/').unwrap_or(&name);
    let parts: Vec<String> = trimmed.split('/').map(str::to_string).collect();
    if entry.enclosed_name().is_none() || !parts.iter().all(|p| is_plain_name(p)) {
        return Err(UnpackError::UnsafeEntry(name));
    }
    Ok((name, parts))
}

fn write_entry(entry: &mut impl io::Read, dest: &Path) -> Result<(), UnpackError> {
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| io_error(parent, e))?;
    }
    let mut file = File::create(dest).map_err(|e| io_error(dest, e))?;
    io::copy(entry, &mut file).map_err(|e| io_error(dest, e))?;
    // On disk before the folder is renamed into place and recorded: a power cut must not leave
    // a recorded engine or runtime with empty files.
    file.sync_all().map_err(|e| io_error(dest, e))?;
    // The file closes here, before its folder is renamed.
    drop(file);
    Ok(())
}

/// `pattern` against the whole of `name`: `*` matches any run of characters, the rest
/// matches ASCII letters in either case.
fn pattern_matches(pattern: &str, name: &str) -> bool {
    let (p, n) = (pattern.as_bytes(), name.as_bytes());
    let (mut pi, mut ni) = (0, 0);
    // Where the last `*` was, and where in `name` it is matching up to.
    let mut star: Option<(usize, usize)> = None;
    while ni < n.len() {
        if p.get(pi) == Some(&b'*') {
            star = Some((pi, ni));
            pi += 1;
        } else if p.get(pi).is_some_and(|c| c.eq_ignore_ascii_case(&n[ni])) {
            pi += 1;
            ni += 1;
        } else if let Some((sp, sn)) = star {
            star = Some((sp, sn + 1));
            pi = sp + 1;
            ni = sn + 1;
        } else {
            return false;
        }
    }
    p[pi..].iter().all(|&c| c == b'*')
}

fn open(zip: &Path) -> Result<ZipArchive<File>, UnpackError> {
    let file = File::open(zip).map_err(|e| io_error(zip, e))?;
    ZipArchive::new(file).map_err(zip_error)
}

fn zip_error(e: ZipError) -> UnpackError {
    UnpackError::Zip(e.to_string())
}

fn io_error(path: &Path, e: io::Error) -> UnpackError {
    UnpackError::Io(format!("{}: {e}", path.display()))
}

/// Whether `dir` still holds a runtime: each pattern matches at least one file in it that is
/// not empty. That is what `unpack_runtime` left there.
pub(crate) fn runtime_is_complete<'p>(
    dir: &Path,
    patterns: impl IntoIterator<Item = &'p str>,
) -> bool {
    let Ok(entries) = fs::read_dir(dir) else {
        return false;
    };
    let files: Vec<String> = entries
        .filter_map(Result::ok)
        .filter(|entry| entry.metadata().is_ok_and(|m| m.is_file() && m.len() > 0))
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect();
    patterns
        .into_iter()
        .all(|pattern| files.iter().any(|name| pattern_matches(pattern, name)))
}

/// Removes `com.apple.quarantine` from everything under `dir`. Returns how many carried it.
#[cfg(target_os = "macos")]
pub fn clear_quarantine(dir: &Path) -> io::Result<usize> {
    let mut count = usize::from(clear_quarantine_on(dir)?);
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if entry.file_type()?.is_dir() {
            count += clear_quarantine(&path)?;
        } else {
            count += usize::from(clear_quarantine_on(&path)?);
        }
    }
    Ok(count)
}

/// Removes the attribute from one file or folder (not through a link). True if it was there.
#[cfg(target_os = "macos")]
fn clear_quarantine_on(path: &Path) -> io::Result<bool> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    const NAME: &std::ffi::CStr = c"com.apple.quarantine";
    let c_path = CString::new(path.as_os_str().as_bytes())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "a NUL in a path"))?;
    // SAFETY: both strings are NUL-terminated; a null buffer of size 0 only asks the size.
    let size = unsafe {
        libc::getxattr(
            c_path.as_ptr(),
            NAME.as_ptr(),
            std::ptr::null_mut(),
            0,
            0,
            libc::XATTR_NOFOLLOW,
        )
    };
    if size < 0 {
        let e = io::Error::last_os_error();
        return match e.raw_os_error() {
            Some(libc::ENOATTR | libc::ENOTSUP) => Ok(false),
            _ => Err(e),
        };
    }
    // SAFETY: both strings are NUL-terminated.
    if unsafe { libc::removexattr(c_path.as_ptr(), NAME.as_ptr(), libc::XATTR_NOFOLLOW) } != 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use zip::write::SimpleFileOptions;

    use super::*;

    /// A deflate zip at `dir/name` holding `entries` (a name ending in `/` is a folder).
    fn zip_at(dir: &Path, name: &str, entries: &[(&str, &[u8])]) -> PathBuf {
        let path = dir.join(name);
        let mut writer = zip::ZipWriter::new(File::create(&path).unwrap());
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        for (entry, bytes) in entries {
            if entry.ends_with('/') {
                writer.add_directory(*entry, options).unwrap();
            } else {
                writer.start_file(*entry, options).unwrap();
                writer.write_all(bytes).unwrap();
            }
        }
        writer.finish().unwrap();
        path
    }

    /// A temporary folder holding the zips, with the install root inside it at `aji/`.
    fn setup() -> (tempfile::TempDir, InstallRoot) {
        let dir = tempfile::tempdir().unwrap();
        let root = InstallRoot::new(dir.path().join("aji"));
        fs::create_dir_all(root.root()).unwrap();
        (dir, root)
    }

    fn staging_is_empty(root: &InstallRoot) -> bool {
        fs::read_dir(root.root().join("staging")).map_or(true, |mut d| d.next().is_none())
    }

    fn names_in(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    /// Every path under `dir` whose file name is `name`.
    fn find(dir: &Path, name: &str) -> Vec<PathBuf> {
        let mut found = Vec::new();
        for entry in fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.file_name().is_some_and(|n| n == name) {
                found.push(path.clone());
            }
            if path.is_dir() {
                found.extend(find(&path, name));
            }
        }
        found
    }

    #[test]
    fn an_engine_unpacks_into_its_folder_in_one_rename() {
        let (dir, root) = setup();
        let zip = zip_at(
            dir.path(),
            "e.zip",
            &[
                (KATAGO_BINARY, b"binary"),
                ("default_gtp.cfg", b"cfg"),
                ("docs/", b""),
                ("docs/README.txt", b"readme"),
            ],
        );
        assert_eq!(unpack_engine(&zip, &root, "e"), Ok(KATAGO_BINARY.into()));
        let engine = root.engine_dir("e");
        assert_eq!(fs::read(engine.join(KATAGO_BINARY)).unwrap(), b"binary");
        assert_eq!(fs::read(engine.join("docs/README.txt")).unwrap(), b"readme");
        assert!(staging_is_empty(&root));
    }

    #[test]
    fn an_entry_escaping_the_folder_fails_the_unpack() {
        for bad in [
            "../evil",
            "/abs",
            "a/../../evil",
            "a/../b",
            "a\\..\\..\\evil",
            "C:/evil",
        ] {
            let (dir, root) = setup();
            let zip = zip_at(
                dir.path(),
                "e.zip",
                &[(KATAGO_BINARY, b"binary"), (bad, b"evil")],
            );
            assert_eq!(
                unpack_engine(&zip, &root, "e"),
                Err(UnpackError::UnsafeEntry(bad.into())),
                "{bad}"
            );
            assert!(find(dir.path(), "evil").is_empty(), "{bad}");
            assert!(find(dir.path(), "abs").is_empty(), "{bad}");
            assert!(!root.engine_dir("e").exists(), "{bad}");
            assert!(staging_is_empty(&root), "{bad}");
        }
    }

    #[test]
    fn a_package_without_katago_fails() {
        let (dir, root) = setup();
        let zip = zip_at(
            dir.path(),
            "e.zip",
            &[("bin/", b""), (&format!("bin/{KATAGO_BINARY}"), b"binary")],
        );
        assert_eq!(unpack_engine(&zip, &root, "e"), Err(UnpackError::NoKatago));
        assert!(!root.engine_dir("e").exists());
        assert!(staging_is_empty(&root));
    }

    #[cfg(unix)]
    #[test]
    fn the_katago_binary_is_executable() {
        use std::os::unix::fs::PermissionsExt;
        let (dir, root) = setup();
        let zip = zip_at(dir.path(), "e.zip", &[(KATAGO_BINARY, b"binary")]);
        unpack_engine(&zip, &root, "e").unwrap();
        let mode = fs::metadata(root.engine_dir("e").join(KATAGO_BINARY))
            .unwrap()
            .permissions()
            .mode();
        assert_ne!(mode & 0o111, 0, "mode {mode:o}");
    }

    fn patterns(list: &[&str]) -> Vec<String> {
        list.iter().map(|p| p.to_string()).collect()
    }

    #[test]
    fn runtime_dlls_are_extracted_flat_by_pattern() {
        let (dir, root) = setup();
        let cudnn = zip_at(
            dir.path(),
            "cudnn.zip",
            &[
                ("cudnn/lib/bin/x64/cudnn_ops64_9.dll", b"ops"),
                ("cudnn/bin/CUDNN64_9.DLL", b"main"),
                ("cudnn/include/cudnn.h", b"header"),
                ("cudnn/LICENSE", b"licence"),
            ],
        );
        let cudart = zip_at(
            dir.path(),
            "cudart.zip",
            &[("cuda_cudart/bin/cudart64_12.dll", b"cudart")],
        );
        let archives = [
            (cudnn, patterns(&["cudnn*64_9.dll"])),
            (cudart, patterns(&["cudart64_*.dll"])),
        ];
        unpack_runtime(&archives, &root, "r").unwrap();
        let runtime = root.runtime_dir("r");
        assert_eq!(
            names_in(&runtime),
            ["CUDNN64_9.DLL", "cudart64_12.dll", "cudnn_ops64_9.dll"]
        );
        assert_eq!(fs::read(runtime.join("cudnn_ops64_9.dll")).unwrap(), b"ops");
        assert!(staging_is_empty(&root));
    }

    #[test]
    fn patterns_match_the_whole_file_name() {
        assert!(pattern_matches("cudnn*64_9.dll", "cudnn64_9.dll"));
        assert!(pattern_matches(
            "cudnn*64_9.dll",
            "CUDNN_engines_precompiled64_9.DLL"
        ));
        assert!(!pattern_matches("cudnn*64_9.dll", "cudnn64_9.dll.bak"));
        assert!(!pattern_matches("cudnn*64_9.dll", "xcudnn64_9.dll"));
        assert!(pattern_matches("*", "anything"));
        assert!(pattern_matches("a*b*c", "aXbYbZc"));
        assert!(!pattern_matches("a*b*c", "aXbYbZ"));
        assert!(!pattern_matches("cudart64_12.dll", "cudart64_13.dll"));
    }

    #[test]
    fn a_pattern_matching_nothing_fails() {
        let (dir, root) = setup();
        let cudnn = zip_at(dir.path(), "cudnn.zip", &[("bin/cudnn64_9.dll", b"main")]);
        let archives = [(cudnn, patterns(&["cudnn64_9.dll", "cublas64_*.dll"]))];
        assert_eq!(
            unpack_runtime(&archives, &root, "r"),
            Err(UnpackError::PatternMatchedNothing("cublas64_*.dll".into()))
        );
        assert!(!root.runtime_dir("r").exists());
        assert!(staging_is_empty(&root));
    }

    #[test]
    fn an_unrecorded_leftover_folder_is_replaced() {
        let (dir, root) = setup();
        let engine = root.engine_dir("e");
        fs::create_dir_all(engine.join("old")).unwrap();
        fs::write(engine.join("old/stale.txt"), b"stale").unwrap();
        let zip = zip_at(dir.path(), "e.zip", &[(KATAGO_BINARY, b"binary")]);
        unpack_engine(&zip, &root, "e").unwrap();
        assert_eq!(names_in(&engine), [KATAGO_BINARY]);

        let runtime = root.runtime_dir("r");
        fs::create_dir_all(&runtime).unwrap();
        fs::write(runtime.join("stale.dll"), b"stale").unwrap();
        let cudnn = zip_at(dir.path(), "cudnn.zip", &[("bin/cudnn64_9.dll", b"main")]);
        unpack_runtime(&[(cudnn, patterns(&["cudnn64_9.dll"]))], &root, "r").unwrap();
        assert_eq!(names_in(&runtime), ["cudnn64_9.dll"]);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn quarantine_is_removed() {
        use std::ffi::CString;
        use std::os::unix::ffi::OsStrExt;
        const NAME: &std::ffi::CStr = c"com.apple.quarantine";
        let c_path = |p: &Path| CString::new(p.as_os_str().as_bytes()).unwrap();
        let has = |p: &Path| {
            // SAFETY: both strings are NUL-terminated; a null buffer of size 0 only asks the size.
            unsafe {
                libc::getxattr(
                    c_path(p).as_ptr(),
                    NAME.as_ptr(),
                    std::ptr::null_mut(),
                    0,
                    0,
                    libc::XATTR_NOFOLLOW,
                ) >= 0
            }
        };
        let dir = tempfile::tempdir().unwrap();
        let sub = dir.path().join("运行库 x");
        fs::create_dir(&sub).unwrap();
        let marked = [dir.path().join(KATAGO_BINARY), sub.join("lib.dylib")];
        for path in &marked {
            fs::write(path, b"x").unwrap();
            let value = b"0083;00000000;Safari;";
            // SAFETY: the strings are NUL-terminated and `value` outlives the call.
            let rc = unsafe {
                libc::setxattr(
                    c_path(path).as_ptr(),
                    NAME.as_ptr(),
                    value.as_ptr().cast(),
                    value.len(),
                    0,
                    0,
                )
            };
            assert_eq!(rc, 0, "{}", io::Error::last_os_error());
            assert!(has(path));
        }
        fs::write(dir.path().join("clean.txt"), b"x").unwrap();
        assert_eq!(clear_quarantine(dir.path()).unwrap(), 2);
        for path in &marked {
            assert!(!has(path), "{}", path.display());
        }
        assert_eq!(clear_quarantine(dir.path()).unwrap(), 0);
    }

    #[test]
    fn extract_size_reads_the_central_directory() {
        let (dir, _root) = setup();
        let zeros = vec![0u8; 100_000];
        let zip = zip_at(
            dir.path(),
            "cudnn.zip",
            &[
                ("bin/", b""),
                ("bin/cudnn64_9.dll", &zeros[..60_000]),
                ("bin/cudnn_ops64_9.dll", &zeros[..30_000]),
                ("include/cudnn.h", &zeros[..10_000]),
            ],
        );
        assert!(fs::metadata(&zip).unwrap().len() < 10_000, "deflated");
        assert_eq!(extract_size(&zip, None), Ok(100_000));
        assert_eq!(
            extract_size(&zip, Some(&patterns(&["cudnn*64_9.dll"]))),
            Ok(90_000)
        );
        assert!(matches!(
            extract_size(&dir.path().join("missing.zip"), None),
            Err(UnpackError::Io(_))
        ));
    }
}
