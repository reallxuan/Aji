//! Importing a network file the user already has (design 5.8).

use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::Path;

use serde::Serialize;
use sha2::{Digest as _, Sha256};
use ts_rs::TS;

use super::{InstallRoot, InstalledNetwork, update_installed};
use crate::atomic::temporary;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ImportedNetwork {
    /// `imported-<first 16 hex digits of the file's SHA-256>`.
    pub id: String,
    /// The source file's name without `.gz` and `.bin` or `.txt`.
    pub name: String,
    #[ts(type = "number")]
    pub size_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ImportError {
    /// The file does not start with gzip's magic bytes `1f 8b`.
    NotGzip,
    Io(String),
}

/// Copies `file` while hashing it to `networks/imported-<16 hex>.bin.gz` and records it with
/// `imported: true`. The caller serialises record writes. Blocking: it copies the whole file.
pub fn import_network(root: &InstallRoot, file: &Path) -> Result<ImportedNetwork, ImportError> {
    let (imported, network) = copy_network(root, file)?;
    record_network(root, &imported.id, network)?;
    Ok(imported)
}

/// Records a copied network as imported. The caller serialises record writes.
pub fn record_network(
    root: &InstallRoot,
    id: &str,
    network: InstalledNetwork,
) -> Result<(), ImportError> {
    let record_file = root.record_file();
    update_installed(&record_file, |record| {
        record.networks.insert(id.to_string(), network);
    })
    .map(|_| ())
    .map_err(|e| ImportError::Io(format!("{}: {e}", record_file.display())))
}

/// The copy half of [`import_network`]: no record is touched, so no lock is needed.
pub fn copy_network(
    root: &InstallRoot,
    file: &Path,
) -> Result<(ImportedNetwork, InstalledNetwork), ImportError> {
    let io_error = |path: &Path, e: io::Error| ImportError::Io(format!("{}: {e}", path.display()));
    let mut source = File::open(file).map_err(|e| io_error(file, e))?;
    let mut magic = [0u8; 2];
    match source.read_exact(&mut magic) {
        Ok(()) if magic == [0x1f, 0x8b] => {}
        Ok(()) => return Err(ImportError::NotGzip),
        Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => return Err(ImportError::NotGzip),
        Err(e) => return Err(io_error(file, e)),
    }
    let networks = root.root().join("networks");
    fs::create_dir_all(&networks).map_err(|e| io_error(&networks, e))?;
    let temp = temporary(&networks, "import");
    let copied = copy_hashing(&mut source, magic, &temp).map_err(|e| io_error(&temp, e));
    let (hash, size_bytes) = match copied {
        Ok(copied) => copied,
        Err(e) => {
            let _ = fs::remove_file(&temp);
            return Err(e);
        }
    };
    let id = format!("imported-{}", &hash[..16]);
    let file_name = format!("{id}.bin.gz");
    let dest = root.network_file(&file_name);
    if let Err(e) = fs::rename(&temp, &dest) {
        let _ = fs::remove_file(&temp);
        return Err(io_error(&dest, e));
    }
    let name = display_name(file).unwrap_or_else(|| id.clone());
    let network = InstalledNetwork {
        file: file_name,
        name: name.clone(),
        imported: true,
    };
    Ok((
        ImportedNetwork {
            id,
            name,
            size_bytes,
        },
        network,
    ))
}

/// Writes `magic` and the rest of `source` to `dest`, returning the SHA-256 in hex and the
/// size.
fn copy_hashing(source: &mut File, magic: [u8; 2], dest: &Path) -> io::Result<(String, u64)> {
    let mut out = File::create(dest)?;
    let mut hasher = Sha256::new();
    hasher.update(magic);
    out.write_all(&magic)?;
    let mut size = magic.len() as u64;
    let mut buffer = vec![0; 1024 * 1024];
    loop {
        let n = source.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
        out.write_all(&buffer[..n])?;
        size += n as u64;
    }
    out.sync_all()?;
    let hash = hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    Ok((hash, size))
}

/// The file name without `.gz`, then without `.bin` or `.txt`, KataGo's two network formats.
fn display_name(file: &Path) -> Option<String> {
    let name = file.file_name()?.to_string_lossy().into_owned();
    let strip = |name: &str, suffix: &str| {
        let cut = name.len().checked_sub(suffix.len())?;
        (name.is_char_boundary(cut) && name[cut..].eq_ignore_ascii_case(suffix))
            .then(|| name[..cut].to_string())
    };
    let name = strip(&name, ".gz").unwrap_or(name);
    let name = strip(&name, ".bin")
        .or_else(|| strip(&name, ".txt"))
        .unwrap_or(name);
    (!name.is_empty()).then_some(name)
}
