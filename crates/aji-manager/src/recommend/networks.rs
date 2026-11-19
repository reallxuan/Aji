//! The network list for one engine.

use std::cmp::Ordering;

use super::{NetworkChoice, NetworkList};
use crate::hardware::HardwareReport;
use crate::manifest::{Manifest, Network, NetworkKind};

/// Lists the networks `engine_id` can load. `None` for an unknown engine.
///
/// The preselected network is the first row: the highest Elo among the main networks the engine
/// can load. The hardware does not change it, so `_report` is unused.
pub fn networks(
    _report: &HardwareReport,
    manifest: &Manifest,
    engine_id: &str,
) -> Option<NetworkList> {
    let engine = manifest.engines.iter().find(|e| e.id == engine_id)?;
    let loadable = |n: &&Network| {
        n.min_engine_version
            .as_ref()
            .is_none_or(|min| *min <= engine.version)
    };
    let mut main: Vec<&Network> = manifest
        .networks
        .iter()
        .filter(|n| n.kind == NetworkKind::Main)
        .filter(loadable)
        .collect();
    // Highest Elo first; a network with no Elo goes last.
    main.sort_by(|a, b| match (a.elo, b.elo) {
        (Some(x), Some(y)) => y.partial_cmp(&x).unwrap_or(Ordering::Equal),
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (None, None) => Ordering::Equal,
    });
    let networks: Vec<NetworkChoice> = main.into_iter().map(choice).collect();
    let human = manifest
        .networks
        .iter()
        .filter(|n| n.kind == NetworkKind::HumanSl)
        .find(loadable)
        .map(choice);
    Some(NetworkList {
        preselected: networks.first().map(|n| n.network.clone()),
        networks,
        human,
    })
}

fn choice(n: &Network) -> NetworkChoice {
    NetworkChoice {
        network: n.id.clone(),
        family: n.family.clone(),
        elo: n.elo,
        uploaded: n.uploaded.clone(),
        size_bytes: n.file.size,
    }
}
