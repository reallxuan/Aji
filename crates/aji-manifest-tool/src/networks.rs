//! Networks from the katagotraining.org page and the model server's `HEAD` answers.
//!
//! The page lists every network with its Elo and games. Aji lists the strongest of each family,
//! plus the human SL network. A network's digest is the model server's ETag, which equals the
//! file's MD5, so no network is downloaded to be hashed.

use std::collections::BTreeMap;
use std::sync::LazyLock;

use aji_manager::manifest::{Digest, FileRef, Network, NetworkKind, NetworkLicence};
use regex::Regex;
use scraper::{Html, Selector};
use serde::Deserialize;

/// The human SL network, which is not on the page.
pub const HUMAN_SL_URL: &str =
    "https://media.katagotraining.org/uploaded/networks/models_extra/b18c384nbt-humanv0.bin.gz";
const HUMAN_SL_ID: &str = "b18c384nbt-humanv0";

const LICENCE_NAME: &str = "KataGo network license";
const LICENCE_URL: &str = "https://katagotraining.org/network_license/";

/// How many main networks are listed.
const LISTED: usize = 8;
/// Fewer rated games than this and a network's Elo is too uncertain to rank.
const MIN_GAMES: u32 = 1000;
/// Networks of this family prefix are transformers, which need KataGo 1.17.0.
const TRANSFORMER_PREFIX: &str = "tf";

/// What the model server answered to `HEAD` for one file.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Head {
    pub url: String,
    pub content_length: u64,
    pub etag: String,
    pub last_modified: String,
}

/// Parses the recorded `HEAD` answers.
pub fn heads_from_json(json: &str) -> Result<Vec<Head>, String> {
    serde_json::from_str(json).map_err(|e| format!("network HEAD answers: {e}"))
}

#[derive(Debug, Clone)]
struct Row {
    name: String,
    family: String,
    uploaded: String,
    elo: f64,
    games: u32,
    url: String,
}

static ELO: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(?<elo>-?[0-9]+(?:\.[0-9]+)?) ± [0-9.]+ - \((?<games>[0-9,]+) games\)$").unwrap()
});
static FAMILY: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^kata1-(?<family>.*?b[0-9]+c[0-9]+(?:nbt)?(?:x2)?)(?:-|$)").unwrap()
});

fn rows(html: &str) -> Result<Vec<Row>, String> {
    let doc = Html::parse_document(html);
    let tr = Selector::parse("tr.normalNetworkStyle, tr.strongestNetworkStyle").unwrap();
    let td = Selector::parse("td").unwrap();
    let a = Selector::parse("a[href]").unwrap();
    let mut out = Vec::new();
    for row in doc.select(&tr) {
        let cells: Vec<_> = row.select(&td).collect();
        if cells.len() < 4 {
            return Err("a network row has fewer than four cells".into());
        }
        let name = cells[0]
            .text()
            .map(str::trim)
            .find(|t| !t.is_empty())
            .ok_or("a network row has no name")?
            .to_owned();
        // `kata1-random` has no file.
        let Some(url) = cells[3]
            .select(&a)
            .next()
            .and_then(|l| l.value().attr("href"))
        else {
            continue;
        };
        let elo_text = cells[2].text().collect::<String>();
        let c = ELO
            .captures(elo_text.trim())
            .ok_or_else(|| format!("network {name}: cannot read the Elo cell {elo_text:?}"))?;
        let games = c["games"]
            .replace(',', "")
            .parse()
            .map_err(|_| format!("network {name}: bad game count"))?;
        let elo = c["elo"]
            .parse()
            .map_err(|_| format!("network {name}: bad Elo"))?;
        let Some(f) = FAMILY.captures(&name) else {
            // Two old `kata-` networks sit outside the `kata1-` line. A `kata1-` network that
            // does not parse means the naming changed, and it must not be dropped silently.
            if name.starts_with("kata1-") {
                return Err(format!("network {name}: its family name is not recognised"));
            }
            continue;
        };
        let when = cells[1].text().collect::<String>();
        let uploaded = when
            .trim()
            .get(..10)
            .ok_or_else(|| format!("network {name}: bad upload time"))?
            .to_owned();
        out.push(Row {
            family: f["family"].to_owned(),
            name,
            uploaded,
            elo,
            games,
            url: url.to_owned(),
        });
    }
    if out.is_empty() {
        return Err("the networks page has no network rows".into());
    }
    Ok(out)
}

/// The best-rated network of each family among those with enough games, strongest first.
fn choose(rows: Vec<Row>) -> Vec<Row> {
    let mut best: BTreeMap<String, Row> = BTreeMap::new();
    for r in rows.into_iter().filter(|r| r.games >= MIN_GAMES) {
        match best.get(&r.family) {
            Some(b) if (b.elo, &b.name) >= (r.elo, &r.name) => {}
            _ => {
                best.insert(r.family.clone(), r);
            }
        }
    }
    let mut v: Vec<Row> = best.into_values().collect();
    v.sort_by(|a, b| b.elo.total_cmp(&a.elo).then_with(|| a.name.cmp(&b.name)));
    v.truncate(LISTED);
    v
}

/// The rows to list. Fewer than [`LISTED`] means the page changed shape, and no partial list is
/// ever written.
fn chosen(html: &str) -> Result<Vec<Row>, String> {
    let chosen = choose(rows(html)?);
    if chosen.len() < LISTED {
        return Err(format!(
            "only {} networks qualify, expected {LISTED}: the networks page may have changed",
            chosen.len()
        ));
    }
    Ok(chosen)
}

/// The files whose `HEAD` answers [`networks`] needs: the chosen networks and the human SL one.
pub fn head_urls(html: &str) -> Result<Vec<String>, String> {
    let mut urls: Vec<String> = chosen(html)?.into_iter().map(|r| r.url).collect();
    urls.push(HUMAN_SL_URL.to_owned());
    Ok(urls)
}

/// The listed networks, strongest first, then the human SL network.
pub fn networks(html: &str, heads: &[Head]) -> Result<Vec<Network>, String> {
    let head = |url: &str, who: &str| {
        heads
            .iter()
            .find(|h| h.url == url)
            .ok_or_else(|| format!("network {who}: no HEAD answer for {url}"))
    };
    let mut out = Vec::new();
    for r in chosen(html)? {
        let h = head(&r.url, &r.name)?;
        out.push(Network {
            id: r.name.clone(),
            min_engine_version: r
                .family
                .starts_with(TRANSFORMER_PREFIX)
                .then(|| semver::Version::new(1, 17, 0)),
            family: r.family,
            kind: NetworkKind::Main,
            elo: Some(r.elo),
            elo_games: Some(r.games),
            uploaded: r.uploaded,
            file: file(&r.name, &r.url, h)?,
            licence: licence(),
        });
    }
    let h = head(HUMAN_SL_URL, HUMAN_SL_ID)?;
    out.push(Network {
        id: HUMAN_SL_ID.to_owned(),
        family: HUMAN_SL_ID.to_owned(),
        kind: NetworkKind::HumanSl,
        elo: None,
        elo_games: None,
        uploaded: http_date(&h.last_modified).ok_or_else(|| {
            format!(
                "network {HUMAN_SL_ID}: bad last-modified {:?}",
                h.last_modified
            )
        })?,
        min_engine_version: None,
        file: file(HUMAN_SL_ID, HUMAN_SL_URL, h)?,
        licence: licence(),
    });
    Ok(out)
}

fn licence() -> NetworkLicence {
    NetworkLicence {
        name: LICENCE_NAME.to_owned(),
        url: LICENCE_URL.to_owned(),
    }
}

fn file(id: &str, url: &str, head: &Head) -> Result<FileRef, String> {
    let etag = head
        .etag
        .strip_prefix('"')
        .and_then(|e| e.strip_suffix('"'));
    let hex = etag
        .filter(|e| e.len() == 32 && e.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')))
        .ok_or_else(|| {
            format!(
                "network {id}: the ETag {:?} is not a plain MD5 (32 lowercase hex digits)",
                head.etag
            )
        })?;
    Ok(FileRef {
        name: url.rsplit('/').next().unwrap_or(url).to_owned(),
        size: head.content_length,
        digest: Digest::Md5(hex.to_owned()),
        urls: vec![url.to_owned()],
    })
}

/// `YYYY-MM-DD` of an HTTP date such as `Tue, 22 Apr 2025 14:33:10 GMT`.
fn http_date(s: &str) -> Option<String> {
    const MONTHS: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    let mut p = s.split_whitespace().skip(1);
    let day: u32 = p.next()?.parse().ok()?;
    let month_name = p.next()?;
    let month = MONTHS.iter().position(|m| *m == month_name)? + 1;
    let year: u32 = p.next()?.parse().ok()?;
    Some(format!("{year:04}-{month:02}-{day:02}"))
}
