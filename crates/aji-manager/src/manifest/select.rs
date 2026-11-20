//! Choosing between the bundled, cached and fetched copies of the manifest.

use minisign_verify::PublicKey;
use serde::Serialize;

use super::{Manifest, ManifestError, parse_manifest, verify};

/// Where a copy of the manifest came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    Bundled,
    Cache,
    Fetched,
}

/// A copy of the manifest that has not been checked yet.
#[derive(Debug, Clone)]
pub struct Candidate {
    pub bytes: Vec<u8>,
    pub signature: Option<String>,
    pub source: Source,
}

/// Why a candidate was not used.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Rejection {
    Unsigned,
    UnknownKey,
    BadSignature,
    Unparsable(String),
    UnsupportedSchema(u32),
    NotNewer { sequence: u64, current: u64 },
}

/// The manifest in use, and what was turned away on the way to it.
#[derive(Debug)]
pub struct Selected {
    pub manifest: Manifest,
    pub source: Source,
    pub rejected: Vec<(Source, Rejection)>,
    /// The winning candidate, or `None` when the bundled copy won.
    candidate: Option<Candidate>,
}

impl Selected {
    pub(super) fn candidate(&self) -> Option<&Candidate> {
        self.candidate.as_ref()
    }

    /// `manifest` as given, reported as bundled.
    pub(super) fn fixed(manifest: Manifest) -> Selected {
        Selected {
            manifest,
            source: Source::Bundled,
            rejected: Vec::new(),
            candidate: None,
        }
    }
}

fn check(
    candidate: &Candidate,
    bundled_sequence: u64,
    keys: &[PublicKey],
) -> Result<Manifest, Rejection> {
    let signature = candidate.signature.as_deref().ok_or(Rejection::Unsigned)?;
    verify(&candidate.bytes, signature, keys)?;
    let manifest = parse_manifest(&candidate.bytes).map_err(|e| match e {
        ManifestError::UnsupportedSchema(n) => Rejection::UnsupportedSchema(n),
        ManifestError::Json(m) | ManifestError::Invalid(m) => Rejection::Unparsable(m),
    })?;
    if manifest.sequence <= bundled_sequence {
        return Err(Rejection::NotNewer {
            sequence: manifest.sequence,
            current: bundled_sequence,
        });
    }
    Ok(manifest)
}

/// Picks the copy to use. The bundled copy needs no signature. Any other copy must be signed by
/// a trusted key, parse, and have a sequence strictly above the bundled one. The highest sequence
/// wins, and a tie goes to a fetched copy over a cached one.
pub fn select(bundled: &[u8], others: Vec<Candidate>, keys: &[PublicKey]) -> Selected {
    let bundled_manifest =
        parse_manifest(bundled).expect("the bundled manifest parses (bundled_manifest_parses)");
    let bundled_sequence = bundled_manifest.sequence;
    let mut best: Option<(Manifest, Candidate)> = None;
    let mut rejected = Vec::new();
    for candidate in others {
        match check(&candidate, bundled_sequence, keys) {
            Err(why) => rejected.push((candidate.source, why)),
            Ok(manifest) => {
                let wins = best.as_ref().is_none_or(|(held, held_candidate)| {
                    manifest.sequence > held.sequence
                        || (manifest.sequence == held.sequence
                            && candidate.source == Source::Fetched
                            && held_candidate.source != Source::Fetched)
                });
                if wins {
                    best = Some((manifest, candidate));
                }
            }
        }
    }
    match best {
        Some((manifest, candidate)) => Selected {
            manifest,
            source: candidate.source,
            rejected,
            candidate: Some(candidate),
        },
        None => Selected {
            manifest: bundled_manifest,
            source: Source::Bundled,
            rejected,
            candidate: None,
        },
    }
}
