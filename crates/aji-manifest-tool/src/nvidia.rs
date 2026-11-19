//! The NVIDIA runtime sets, built from NVIDIA's redistributable JSON files.
//!
//! Which sets exist is decided here, as constants. Each archive's size and SHA-256 come from the
//! JSON, so no NVIDIA archive is downloaded to be hashed.

use std::collections::{BTreeMap, BTreeSet};

use aji_manager::manifest::{Archive, Digest, Licence, Platform, Runtime, RuntimeComponent};
use serde_json::Value;

/// NVIDIA's redist JSON files by file name, for example `redistrib_13.2.2.json`.
pub type Redist = BTreeMap<String, Value>;

const HOSTS: [&str; 2] = [
    "https://developer.download.nvidia.com/",
    "https://developer.download.nvidia.cn/",
];

#[derive(Clone, Copy, PartialEq)]
enum Root {
    Cuda,
    Cudnn,
}

impl Root {
    fn dir(self) -> &'static str {
        match self {
            Root::Cuda => "compute/cuda/redist/",
            Root::Cudnn => "compute/cudnn/redist/",
        }
    }
}

struct Component {
    root: Root,
    /// The redist JSON file name.
    json: &'static str,
    /// The component's key in the JSON.
    key: &'static str,
    /// The CUDA variant cuDNN nests its archives under.
    cuda_variant: Option<&'static str>,
    extract: &'static [&'static str],
}

struct Set {
    id: &'static str,
    min_driver: &'static str,
    min_compute_capability: &'static str,
    components: &'static [Component],
}

const SETS: &[Set] = &[
    Set {
        id: "nvidia-cuda13.2-cudnn9.24.0-windows-x64",
        min_driver: "580.00",
        min_compute_capability: "7.5",
        components: &[
            Component {
                root: Root::Cuda,
                json: "redistrib_13.2.2.json",
                key: "libcublas",
                cuda_variant: None,
                extract: &["cublas64_13.dll", "cublasLt64_13.dll"],
            },
            Component {
                root: Root::Cuda,
                json: "redistrib_13.2.2.json",
                key: "cuda_nvrtc",
                cuda_variant: None,
                extract: &["nvrtc64_130_0.dll", "nvrtc-builtins64_132.dll"],
            },
            Component {
                root: Root::Cudnn,
                json: "redistrib_9.24.0.json",
                key: "cudnn",
                cuda_variant: Some("cuda13"),
                extract: &["cudnn*64_9.dll"],
            },
        ],
    },
    Set {
        id: "nvidia-cuda12.8-cudnn9.8.0-windows-x64",
        min_driver: "572.61",
        min_compute_capability: "5.0",
        components: &[
            Component {
                root: Root::Cuda,
                json: "redistrib_12.8.1.json",
                key: "libcublas",
                cuda_variant: None,
                extract: &["cublas64_12.dll", "cublasLt64_12.dll"],
            },
            Component {
                root: Root::Cuda,
                json: "redistrib_12.8.1.json",
                key: "cuda_nvrtc",
                cuda_variant: None,
                extract: &["nvrtc64_120_0.dll", "nvrtc-builtins64_128.dll"],
            },
            Component {
                root: Root::Cudnn,
                json: "redistrib_9.8.0.json",
                key: "cudnn",
                cuda_variant: Some("cuda12"),
                extract: &["cudnn*64_9.dll"],
            },
        ],
    },
];

/// The JSON file names the sets need, each with the URL to fetch it from.
pub fn json_urls() -> BTreeMap<String, String> {
    SETS.iter()
        .flat_map(|s| s.components)
        .map(|c| (c.json.to_owned(), json_url(c)))
        .collect()
}

fn json_url(c: &Component) -> String {
    format!("{}{}{}", HOSTS[0], c.root.dir(), c.json)
}

fn redist_root(c: &Component) -> String {
    format!("{}{}", HOSTS[0], c.root.dir())
}

/// The licence name and page for the JSON's `license` value.
fn licence_of(name: &str) -> Result<(&'static str, &'static str), String> {
    match name {
        "CUDA Toolkit" => Ok((
            "NVIDIA CUDA Toolkit EULA",
            "https://docs.nvidia.com/cuda/eula/index.html",
        )),
        "cudnn" => Ok((
            "NVIDIA cuDNN Software License Agreement",
            "https://docs.nvidia.com/deeplearning/cudnn/latest/reference/eula.html",
        )),
        other => Err(format!("NVIDIA licence {other:?} is not known")),
    }
}

fn entry<'a>(redist: &'a Redist, c: &Component) -> Result<&'a Value, String> {
    redist
        .get(c.json)
        .ok_or_else(|| format!("{} is missing", c.json))?
        .get(c.key)
        .ok_or_else(|| format!("{} has no {}", c.json, c.key))
}

fn text_url(redist: &Redist, c: &Component) -> Result<String, String> {
    let path = str_of(entry(redist, c)?, "license_path", c)?;
    Ok(format!("{}{path}", redist_root(c)))
}

fn str_of<'a>(v: &'a Value, field: &str, c: &Component) -> Result<&'a str, String> {
    v.get(field)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("{} {} has no {field}", c.json, c.key))
}

/// The licence text URLs of every component, whose texts [`runtimes`] needs hashed.
pub fn text_urls(redist: &Redist) -> Result<BTreeSet<String>, String> {
    SETS.iter()
        .flat_map(|s| s.components)
        .map(|c| text_url(redist, c))
        .collect()
}

/// Builds the runtime sets. `text_sha256` maps each licence text URL to the SHA-256 of its text.
pub fn runtimes(
    redist: &Redist,
    text_sha256: &BTreeMap<String, String>,
) -> Result<Vec<Runtime>, String> {
    let mut out = Vec::new();
    for set in SETS {
        let mut components = Vec::new();
        let mut notice = Vec::new();
        for c in set.components {
            let e = entry(redist, c)?;
            let name = str_of(e, "name", c)?;
            let version = str_of(e, "version", c)?;
            let (licence_name, licence_url) = licence_of(str_of(e, "license", c)?)?;
            let mut file = e
                .get("windows-x86_64")
                .ok_or_else(|| format!("{} {} has no windows-x86_64", c.json, c.key))?;
            if let Some(v) = c.cuda_variant {
                file = file
                    .get(v)
                    .ok_or_else(|| format!("{} {} has no {v} archive", c.json, c.key))?;
            }
            let size = str_of(file, "size", c)?
                .parse()
                .map_err(|_| format!("{} {}: bad archive size", c.json, c.key))?;
            let sha = str_of(file, "sha256", c)?;
            let digest = Digest::parse(&format!("sha256:{sha}"))
                .map_err(|e| format!("{} {}: {e}", c.json, c.key))?;
            let text_url = text_url(redist, c)?;
            let text_sha256 = text_sha256
                .get(&text_url)
                .ok_or_else(|| format!("no hash for the licence text {text_url}"))?
                .clone();
            // NVIDIA's own names already start with "NVIDIA" for cuDNN.
            let who = name.strip_prefix("NVIDIA ").unwrap_or(name);
            notice.push(format!(
                "NVIDIA {who} {version}, \u{a9} NVIDIA Corporation. Licensed under the {licence_name}. Not covered by Aji's AGPL licence."
            ));
            components.push(RuntimeComponent {
                product: if c.root == Root::Cuda {
                    "CUDA Toolkit"
                } else {
                    "cuDNN"
                }
                .to_owned(),
                name: name.to_owned(),
                version: version.to_owned(),
                nvidia_manifest: json_url(c),
                archive: Archive {
                    path: format!("{}{}", c.root.dir(), str_of(file, "relative_path", c)?),
                    size,
                    digest,
                },
                hosts: HOSTS.iter().map(|h| (*h).to_owned()).collect(),
                extract: c.extract.iter().map(|x| (*x).to_owned()).collect(),
                licence: Licence {
                    name: licence_name.to_owned(),
                    url: licence_url.to_owned(),
                    text_url,
                    text_sha256,
                    requires_acceptance: true,
                },
            });
        }
        out.push(Runtime {
            id: set.id.to_owned(),
            platform: Platform::WindowsX64,
            min_driver: Some(set.min_driver.to_owned()),
            min_compute_capability: Some(set.min_compute_capability.to_owned()),
            components,
            notice: notice.join("\n"),
        });
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(out)
}
