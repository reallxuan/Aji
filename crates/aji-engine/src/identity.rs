//! The engine identity that keys the persistent cache (P2 M2 design 5.2): the network file's
//! SHA-256, plus a hash of the config keys that change search results.

use std::fs::File;
use std::io::{self, Read};
use std::path::Path;

use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct EngineIdentity {
    pub network: [u8; 32],
    pub config: u64,
}

/// Reads both files. Blocking: the network is hundreds of megabytes.
pub fn identity_of(model: &Path, config: &Path) -> io::Result<EngineIdentity> {
    let mut file = File::open(model)?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    let text = std::fs::read_to_string(config)?;
    Ok(EngineIdentity {
        network: hasher.finalize().into(),
        config: config_hash(&text),
    })
}

/// `identity_of` for an engine's files, on a blocking thread. `None` when either file cannot be
/// read: the engine then runs without the persistent store. The files are named as KataGo's
/// command line names them, relative to its working folder (an absolute name stays as it is).
pub async fn identity_for(files: &crate::EngineFiles) -> Option<EngineIdentity> {
    let model = files.working_dir.join(&files.model);
    let config = files.working_dir.join(&files.config);
    match tokio::task::spawn_blocking(move || identity_of(&model, &config)).await {
        Ok(Ok(identity)) => Some(identity),
        Ok(Err(e)) => {
            eprintln!("aji: cannot identify the engine's files, so results are not kept: {e}");
            None
        }
        Err(_) => None,
    }
}

/// Whether a config key only changes speed, devices or logging, never results.
fn ignored_key(key: &str) -> bool {
    key.starts_with("numSearchThreads")
        || key.starts_with("log")
        || matches!(
            key,
            "numAnalysisThreads"
                | "nnMaxBatchSize"
                | "nnCacheSizePowerOfTwo"
                | "nnMutexPoolSizePowerOfTwo"
                | "numNNServerThreadsPerModel"
        )
        || key.contains("DeviceToUse")
        || key.ends_with("UseFP16")
        || key.ends_with("UseNHWC")
}

/// FNV-1a 64 of the result-changing `key = value` lines, sorted, so line order, comments and
/// blank lines do not matter.
fn config_hash(text: &str) -> u64 {
    let mut lines: Vec<String> = text
        .lines()
        .filter_map(|line| {
            let line = line.split('#').next().unwrap_or("");
            let (key, value) = line.split_once('=')?;
            let (key, value) = (key.trim(), value.trim());
            (!key.is_empty() && !ignored_key(key)).then(|| format!("{key}={value}"))
        })
        .collect();
    lines.sort();
    lines
        .join("\n")
        .bytes()
        .fold(0xcbf2_9ce4_8422_2325, |h, b| {
            (h ^ u64::from(b)).wrapping_mul(0x0100_0000_01b3)
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identity_ignores_thread_counts() {
        let a = "maxVisits = 500\nnumSearchThreads = 8\nnumAnalysisThreads = 1\n";
        let b = "# a comment\nnumAnalysisThreads = 4\n\nmaxVisits=500\nnumSearchThreadsPerAnalysisThread = 16\n\
                 nnMaxBatchSize = 64\nnnCacheSizePowerOfTwo = 20\nnnMutexPoolSizePowerOfTwo = 14\n\
                 logDir = logs\nlogSearchInfo = true\nmetalDeviceToUseThread0 = 0\n";
        assert_eq!(config_hash(a), config_hash(b));
        assert_ne!(config_hash(a), config_hash("maxVisits = 600\n"));
        assert_ne!(
            config_hash(a),
            config_hash("maxVisits = 500\nwideRootNoise = 0.04\n")
        );
        assert!(ignored_key("numSearchThreads") && !ignored_key("rootPolicyTemperature"));
    }

    #[test]
    fn identity_reads_both_files() {
        let dir = tempfile::tempdir().unwrap();
        let (model, config) = (dir.path().join("m.bin.gz"), dir.path().join("c.cfg"));
        std::fs::write(&model, b"abc").unwrap();
        std::fs::write(&config, "maxVisits = 500\n").unwrap();
        let id = identity_of(&model, &config).unwrap();
        // SHA-256("abc").
        assert_eq!(id.network[..4], [0xba, 0x78, 0x16, 0xbf]);
        assert_eq!(id.config, config_hash("maxVisits = 500"));
        std::fs::write(&model, b"abd").unwrap();
        assert_ne!(identity_of(&model, &config).unwrap(), id);
        assert!(identity_of(&dir.path().join("missing"), &config).is_err());
    }

    #[tokio::test]
    async fn identity_finds_files_named_relative_to_the_working_folder() {
        // Installed sets and the development engine name both files relative to KataGo's
        // working folder (roadmap 3.3); the identity must read them from there, not from
        // wherever Aji itself was started.
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("networks")).unwrap();
        std::fs::write(dir.path().join("networks/m.bin.gz"), b"abc").unwrap();
        std::fs::write(dir.path().join("c.cfg"), "maxVisits = 500\n").unwrap();
        let files = crate::EngineFiles {
            katago: dir.path().join("katago"),
            model: std::path::Path::new("networks").join("m.bin.gz"),
            config: "c.cfg".into(),
            working_dir: dir.path().to_path_buf(),
            path_prepend: Vec::new(),
        };
        let id = identity_for(&files).await.expect("identified");
        assert_eq!(id.network[..4], [0xba, 0x78, 0x16, 0xbf]);
        assert_eq!(id.config, config_hash("maxVisits = 500"));
        // A model kept absolute (outside the config folder) is read where it is.
        let elsewhere = tempfile::tempdir().unwrap();
        std::fs::write(elsewhere.path().join("n.bin.gz"), b"abc").unwrap();
        let files = crate::EngineFiles {
            model: elsewhere.path().join("n.bin.gz"),
            ..files
        };
        assert_eq!(identity_for(&files).await, Some(id));
    }
}
