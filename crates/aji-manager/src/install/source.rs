//! The download source setting (design 5.3): which URLs are tried, in which order.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Where engine and network files are fetched from. NVIDIA archives always come from NVIDIA.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum DownloadSource {
    /// The manifest's URLs in order.
    #[default]
    Direct,
    /// A GitHub acceleration prefix, put in front of `https://github.com/` URLs.
    Prefix { url: String },
    /// A mirror serving `<url>/<file name>`.
    Mirror { url: String },
}

impl DownloadSource {
    /// A prefix or mirror must be an `http://` or `https://` URL.
    pub fn validate(&self) -> Result<(), String> {
        let url = match self {
            DownloadSource::Direct => return Ok(()),
            DownloadSource::Prefix { url } | DownloadSource::Mirror { url } => url,
        };
        let rest = url
            .strip_prefix("https://")
            .or_else(|| url.strip_prefix("http://"))
            .ok_or_else(|| format!("{url:?} is not an http:// or https:// URL"))?;
        if rest.is_empty() || rest.starts_with('/') {
            return Err(format!("{url:?} has no host"));
        }
        if url.chars().any(|c| c.is_whitespace() || c.is_control()) {
            return Err(format!("{url:?} contains a space or control character"));
        }
        Ok(())
    }
}

/// Who publishes a file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Origin {
    /// KataGo's packages, Aji's Metal build and the networks.
    Package,
    /// NVIDIA's runtime archives: never rewritten.
    Nvidia,
}

/// The URLs to try, in order. `Direct` keeps `urls`. `Prefix` puts `<prefix><url>` first for
/// each `https://github.com/` URL; `Mirror` puts `<mirror>/<file_name>` first. NVIDIA files
/// are never rewritten.
pub fn candidate_urls(
    source: &DownloadSource,
    origin: Origin,
    file_name: &str,
    urls: &[String],
) -> Vec<String> {
    let first: Vec<String> = match (source, origin) {
        (_, Origin::Nvidia) | (DownloadSource::Direct, _) => Vec::new(),
        (DownloadSource::Prefix { url }, Origin::Package) => {
            let prefix = if url.ends_with('/') {
                url.clone()
            } else {
                format!("{url}/")
            };
            urls.iter()
                .filter(|u| u.starts_with("https://github.com/"))
                .map(|u| format!("{prefix}{u}"))
                .collect()
        }
        (DownloadSource::Mirror { url }, Origin::Package) => {
            vec![format!("{}/{file_name}", url.trim_end_matches('/'))]
        }
    };
    first.into_iter().chain(urls.iter().cloned()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn urls(list: &[&str]) -> Vec<String> {
        list.iter().map(|u| u.to_string()).collect()
    }

    const GITHUB: &str = "https://github.com/a/b.zip";
    const NETWORK: &str =
        "https://media.katagotraining.org/uploaded/networks/models/kata1/n.bin.gz";

    #[test]
    fn direct_keeps_the_manifest_order() {
        let list = urls(&[GITHUB, NETWORK]);
        assert_eq!(
            candidate_urls(&DownloadSource::Direct, Origin::Package, "b.zip", &list),
            list
        );
    }

    #[test]
    fn a_prefix_goes_first_for_github_urls_only() {
        let prefix = DownloadSource::Prefix {
            url: "https://p.example/".into(),
        };
        assert_eq!(
            candidate_urls(&prefix, Origin::Package, "b.zip", &urls(&[GITHUB])),
            urls(&["https://p.example/https://github.com/a/b.zip", GITHUB])
        );
        assert_eq!(
            candidate_urls(&prefix, Origin::Package, "n.bin.gz", &urls(&[NETWORK])),
            urls(&[NETWORK])
        );
        // A prefix written without its last slash still makes a URL.
        let bare = DownloadSource::Prefix {
            url: "https://p.example".into(),
        };
        assert_eq!(
            candidate_urls(&bare, Origin::Package, "b.zip", &urls(&[GITHUB]))[0],
            "https://p.example/https://github.com/a/b.zip"
        );
    }

    #[test]
    fn a_mirror_goes_first_for_packages() {
        let mirror = DownloadSource::Mirror {
            url: "https://m.example/".into(),
        };
        assert_eq!(
            candidate_urls(&mirror, Origin::Package, "net.bin.gz", &urls(&[NETWORK])),
            urls(&["https://m.example/net.bin.gz", NETWORK])
        );
    }

    #[test]
    fn nvidia_urls_are_never_rewritten() {
        let list = urls(&[
            "https://developer.download.nvidia.com/x.zip",
            "https://developer.download.nvidia.cn/x.zip",
        ]);
        for source in [
            DownloadSource::Prefix {
                url: "https://p.example/".into(),
            },
            DownloadSource::Mirror {
                url: "https://m.example".into(),
            },
        ] {
            assert_eq!(
                candidate_urls(&source, Origin::Nvidia, "x.zip", &list),
                list
            );
        }
    }

    #[test]
    fn a_source_url_must_be_http_or_https() {
        let bad = [
            DownloadSource::Mirror {
                url: "ftp://x".into(),
            },
            DownloadSource::Prefix { url: "".into() },
            DownloadSource::Prefix {
                url: "https://".into(),
            },
            DownloadSource::Mirror {
                url: "https://m.example/\n".into(),
            },
        ];
        for source in bad {
            assert!(source.validate().is_err(), "{source:?}");
        }
        for source in [
            DownloadSource::Direct,
            DownloadSource::Prefix {
                url: "https://p.example/".into(),
            },
            DownloadSource::Mirror {
                url: "http://192.168.1.2:8080/aji".into(),
            },
        ] {
            assert!(source.validate().is_ok(), "{source:?}");
        }
    }

    #[test]
    fn the_source_serialises_with_a_kind() {
        let json = serde_json::to_value(DownloadSource::Mirror {
            url: "https://m.example".into(),
        })
        .unwrap();
        assert_eq!(
            json,
            serde_json::json!({"kind": "mirror", "url": "https://m.example"})
        );
        assert_eq!(
            serde_json::to_value(DownloadSource::Direct).unwrap(),
            serde_json::json!({"kind": "direct"})
        );
    }
}
