//! Manifest schema v1 and its parser.

use std::collections::{BTreeMap, HashSet};
use std::fmt;

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use ts_rs::TS;

/// The only schema version this build understands.
pub const SCHEMA: u32 = 1;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub schema: u32,
    /// Generation time in seconds since 1970. It only grows.
    pub sequence: u64,
    /// RFC 3339, UTC.
    pub generated: String,
    pub engines: Vec<Engine>,
    pub runtimes: Vec<Runtime>,
    pub networks: Vec<Network>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum Platform {
    #[serde(rename = "windows-x64")]
    #[ts(rename = "windows-x64")]
    WindowsX64,
    #[serde(rename = "macos-arm64")]
    #[ts(rename = "macos-arm64")]
    MacosArm64,
    #[serde(rename = "linux-x64")]
    #[ts(rename = "linux-x64")]
    LinuxX64,
    /// A platform added after this build. Entries carrying it are dropped.
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum Backend {
    Cuda,
    Directml,
    Openvino,
    Rocm,
    Opencl,
    Metal,
    Eigenavx2,
    Eigen,
    /// A backend added after this build (for example `tensorrt`). Entries carrying it are dropped.
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Engine {
    /// The asset file stem, for example `katago-v1.18.2-metal-macos-arm64`.
    pub id: String,
    pub version: semver::Version,
    /// `YYYY-MM-DD`.
    pub released: String,
    pub platform: Platform,
    pub backend: Backend,
    pub variant: String,
    pub runtime: Option<String>,
    pub gpu_family: Option<String>,
    #[serde(default)]
    pub config: BTreeMap<String, String>,
    pub file: FileRef,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileRef {
    pub name: String,
    pub size: u64,
    pub digest: Digest,
    pub urls: Vec<String>,
}

/// A checksum written as one string, `sha256:<64 hex>` or `md5:<32 hex>`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Digest {
    Sha256(String),
    Md5(String),
}

impl Digest {
    /// Parses `sha256:<64 lowercase hex>` or `md5:<32 lowercase hex>`.
    pub fn parse(s: &str) -> Result<Digest, String> {
        let (algo, hex) = s
            .split_once(':')
            .ok_or_else(|| format!("digest {s:?} has no algorithm prefix"))?;
        let want = match algo {
            "sha256" => 64,
            "md5" => 32,
            _ => return Err(format!("unknown digest algorithm {algo:?}")),
        };
        if hex.len() != want || !hex.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')) {
            return Err(format!("{algo} digest must be {want} lowercase hex digits"));
        }
        Ok(if algo == "sha256" {
            Digest::Sha256(hex.to_owned())
        } else {
            Digest::Md5(hex.to_owned())
        })
    }
}

impl fmt::Display for Digest {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Digest::Sha256(h) => write!(f, "sha256:{h}"),
            Digest::Md5(h) => write!(f, "md5:{h}"),
        }
    }
}

impl Serialize for Digest {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.collect_str(self)
    }
}

impl<'de> Deserialize<'de> for Digest {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let s = String::deserialize(d)?;
        Digest::parse(&s).map_err(serde::de::Error::custom)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Runtime {
    pub id: String,
    pub platform: Platform,
    pub min_driver: Option<String>,
    pub min_compute_capability: Option<String>,
    pub components: Vec<RuntimeComponent>,
    pub notice: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeComponent {
    pub product: String,
    pub name: String,
    pub version: String,
    pub nvidia_manifest: String,
    pub archive: Archive,
    /// Hosts the archive can be fetched from; `archive.path` is relative to each.
    pub hosts: Vec<String>,
    /// DLL file names to take out of the archive; `*` is a wildcard.
    pub extract: Vec<String>,
    pub licence: Licence,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Archive {
    pub path: String,
    pub size: u64,
    pub digest: Digest,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Licence {
    pub name: String,
    pub url: String,
    pub text_url: String,
    /// SHA-256 of the licence text. When it changes, Aji asks for acceptance again.
    pub text_sha256: String,
    pub requires_acceptance: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum NetworkKind {
    #[serde(rename = "main")]
    Main,
    #[serde(rename = "humanSl")]
    HumanSl,
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Network {
    pub id: String,
    pub family: String,
    pub kind: NetworkKind,
    pub elo: Option<f64>,
    pub elo_games: Option<u32>,
    pub uploaded: String,
    pub min_engine_version: Option<semver::Version>,
    pub file: FileRef,
    pub licence: NetworkLicence,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NetworkLicence {
    pub name: String,
    pub url: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ManifestError {
    Json(String),
    UnsupportedSchema(u32),
    Invalid(String),
}

impl fmt::Display for ManifestError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ManifestError::Json(e) => write!(f, "manifest is not valid: {e}"),
            ManifestError::UnsupportedSchema(v) => write!(f, "unsupported manifest schema {v}"),
            ManifestError::Invalid(e) => write!(f, "manifest is invalid: {e}"),
        }
    }
}

impl std::error::Error for ManifestError {}

/// Parses and validates a manifest. Unknown fields are ignored, and entries with an unknown
/// platform, backend or network kind are dropped.
pub fn parse_manifest(bytes: &[u8]) -> Result<Manifest, ManifestError> {
    #[derive(Deserialize)]
    struct Head {
        schema: u32,
    }
    let head: Head =
        serde_json::from_slice(bytes).map_err(|e| ManifestError::Json(e.to_string()))?;
    if head.schema != SCHEMA {
        return Err(ManifestError::UnsupportedSchema(head.schema));
    }
    let mut m: Manifest =
        serde_json::from_slice(bytes).map_err(|e| ManifestError::Json(e.to_string()))?;
    m.engines
        .retain(|e| e.platform != Platform::Unknown && e.backend != Backend::Unknown);
    m.runtimes.retain(|r| r.platform != Platform::Unknown);
    m.networks.retain(|n| n.kind != NetworkKind::Unknown);
    validate(&m).map_err(ManifestError::Invalid)?;
    Ok(m)
}

fn validate(m: &Manifest) -> Result<(), String> {
    unique("engine", m.engines.iter().map(|e| &e.id))?;
    unique("runtime", m.runtimes.iter().map(|r| &r.id))?;
    unique("network", m.networks.iter().map(|n| &n.id))?;
    for e in &m.engines {
        file(&e.id, &e.file)?;
        if let Some(rt) = &e.runtime
            && !m.runtimes.iter().any(|r| &r.id == rt)
        {
            return Err(format!("engine {} names missing runtime {rt}", e.id));
        }
    }
    for n in &m.networks {
        file(&n.id, &n.file)?;
    }
    for r in &m.runtimes {
        for c in &r.components {
            let who = format!("runtime {} component {}", r.id, c.name);
            if c.extract.is_empty() {
                return Err(format!("{who} extracts nothing"));
            }
            if c.hosts.is_empty() || !c.hosts.iter().all(|h| h.starts_with("https://")) {
                return Err(format!("{who} needs at least one host, all https"));
            }
            if c.archive.size == 0 {
                return Err(format!("{who} archive size is 0"));
            }
        }
    }
    Ok(())
}

fn file(who: &str, f: &FileRef) -> Result<(), String> {
    if f.size == 0 {
        return Err(format!("{who} file size is 0"));
    }
    if f.urls.is_empty() || !f.urls.iter().all(|u| u.starts_with("https://")) {
        return Err(format!("{who} needs at least one URL, all https"));
    }
    Ok(())
}

fn unique<'a>(kind: &str, ids: impl Iterator<Item = &'a String>) -> Result<(), String> {
    let mut seen = HashSet::new();
    for id in ids {
        if !seen.insert(id) {
            return Err(format!("duplicate {kind} id {id}"));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::BUNDLED;
    use serde_json::{Value, json};

    const SAMPLE: &str = include_str!("../../tests/fixtures/manifest/sample-v1.json");

    fn sample() -> Value {
        serde_json::from_str(SAMPLE).unwrap()
    }

    fn parse(v: &Value) -> Result<Manifest, ManifestError> {
        parse_manifest(v.to_string().as_bytes())
    }

    #[test]
    fn parses_the_sample() {
        let m = parse_manifest(SAMPLE.as_bytes()).unwrap();
        assert_eq!(m.schema, SCHEMA);
        assert_eq!(m.sequence, 1763500000);
        assert_eq!(
            (m.engines.len(), m.runtimes.len(), m.networks.len()),
            (3, 1, 2)
        );
        let e = &m.engines[0];
        assert_eq!(e.file.size, 9825374);
        assert_eq!(
            e.file.digest,
            Digest::Sha256(
                "4b26f1889bed56b91964aa565f324eeab816e77f2ee79197be04f7291a2e7514".into()
            )
        );
        assert_eq!(
            e.runtime.as_deref(),
            Some("nvidia-cuda13.2-cudnn9.24.0-windows-x64")
        );
        assert_eq!(
            (e.platform, e.backend),
            (Platform::WindowsX64, Backend::Cuda)
        );
        let n = &m.networks[0];
        assert_eq!(n.elo, Some(14639.0));
        assert_eq!(n.min_engine_version, Some(semver::Version::new(1, 17, 0)));
        assert_eq!(n.file.size, 262041254);
        assert_eq!(
            n.file.digest,
            Digest::Md5("db954878202524766e2f75ac61ae34c3".into())
        );
        assert_eq!(n.kind, NetworkKind::Main);
        let a = &m.runtimes[0].components[0].archive;
        assert_eq!(a.size, 388113288);
        assert_eq!(
            a.digest,
            Digest::Sha256(
                "bc6f590490134f4dbe29672b72e536c44362cc5f738a0f7e48c8c3c141e9b24a".into()
            )
        );
    }

    #[test]
    fn unknown_fields_are_ignored() {
        let mut v = sample();
        v["future"] = json!({"a": 1});
        v["engines"][0]["extra"] = json!(true);
        assert!(parse(&v).is_ok());
    }

    #[test]
    fn entries_with_unknown_backend_or_platform_are_skipped() {
        let mut v = sample();
        let mut a = v["engines"][1].clone();
        a["id"] = json!("x-vulkan");
        a["backend"] = json!("vulkan");
        let mut b = v["engines"][1].clone();
        b["id"] = json!("x-bsd");
        b["platform"] = json!("freebsd-x64");
        v["engines"].as_array_mut().unwrap().extend([a, b]);
        let m = parse(&v).unwrap();
        assert_eq!(m.engines.len(), 3);
        assert!(m.engines.iter().all(|e| !e.id.starts_with("x-")));
    }

    #[test]
    fn a_newer_schema_is_rejected() {
        let mut v = sample();
        v["schema"] = json!(2);
        assert_eq!(parse(&v), Err(ManifestError::UnsupportedSchema(2)));
        // Checked before the rest is parsed.
        assert_eq!(
            parse_manifest(br#"{"schema":2,"engines":"nonsense"}"#),
            Err(ManifestError::UnsupportedSchema(2))
        );
    }

    #[test]
    fn invalid_entries_reject_the_manifest() {
        type Edit = fn(&mut Value);
        let cases: Vec<(&str, Edit)> = vec![
            ("uppercase sha256", |v| {
                v["engines"][0]["file"]["digest"] = json!(format!("sha256:{}", "A".repeat(64)))
            }),
            ("63-digit sha256", |v| {
                v["engines"][0]["file"]["digest"] = json!(format!("sha256:{}", "a".repeat(63)))
            }),
            ("31-digit md5", |v| {
                v["networks"][0]["file"]["digest"] = json!(format!("md5:{}", "a".repeat(31)))
            }),
            ("sha1", |v| {
                v["engines"][0]["file"]["digest"] = json!(format!("sha1:{}", "a".repeat(40)))
            }),
            ("empty extract", |v| {
                v["runtimes"][0]["components"][0]["extract"] = json!([])
            }),
            ("no hosts", |v| {
                v["runtimes"][0]["components"][0]["hosts"] = json!([])
            }),
            ("http host", |v| {
                v["runtimes"][0]["components"][0]["hosts"] = json!(["http://x.example/"])
            }),
            ("zero size", |v| v["engines"][0]["file"]["size"] = json!(0)),
            ("zero archive size", |v| {
                v["runtimes"][0]["components"][0]["archive"]["size"] = json!(0)
            }),
            ("http url", |v| {
                v["engines"][0]["file"]["urls"] = json!(["http://example.com/a.zip"])
            }),
            ("empty urls", |v| {
                v["networks"][0]["file"]["urls"] = json!([])
            }),
            ("duplicate engine id", |v| {
                v["engines"][1]["id"] = v["engines"][0]["id"].clone()
            }),
            ("duplicate network id", |v| {
                v["networks"][1]["id"] = v["networks"][0]["id"].clone()
            }),
            ("missing runtime", |v| {
                v["engines"][0]["runtime"] = json!("nope")
            }),
        ];
        for (name, edit) in cases {
            let mut v = sample();
            edit(&mut v);
            assert!(parse(&v).is_err(), "case should be rejected: {name}");
        }
    }

    #[test]
    fn digests_round_trip_as_one_string() {
        let d = Digest::Md5("db954878202524766e2f75ac61ae34c3".into());
        let s = serde_json::to_string(&d).unwrap();
        assert_eq!(s, r#""md5:db954878202524766e2f75ac61ae34c3""#);
        assert_eq!(serde_json::from_str::<Digest>(&s).unwrap(), d);
    }

    #[test]
    fn bundled_manifest_parses() {
        assert!(parse_manifest(BUNDLED).is_ok());
    }
}
