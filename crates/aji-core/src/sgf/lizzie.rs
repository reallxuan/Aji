//! LizzieYzy's analysis text, as stored in the SGF properties `LZ` (a move node: the position
//! after its move) and `LZOP` (the root: the starting position).
//!
//! The format is implemented from the description in P2 M2 design 5.11. No LizzieYzy code is
//! copied or translated (it is GPL; CLAUDE.md).

/// One candidate. `winrate` and `prior` are 0..1, from the side to move.
#[derive(Debug, Clone, PartialEq)]
pub struct LzMove {
    /// The point as written: a GTP vertex such as `Q16`, or `pass`.
    pub point: String,
    pub visits: u32,
    pub winrate: f64,
    pub prior: f64,
    /// The side to move's lead, when written.
    pub score_lead: Option<f64>,
    pub pv: Vec<String>,
}

/// One `LZ` or `LZOP` value.
#[derive(Debug, Clone, PartialEq)]
pub struct LzData {
    pub engine: String,
    /// A percentage as written: 100 minus the side to move's win rate.
    pub mover_winrate: f64,
    pub visits: u32,
    /// The side to move's lead.
    pub score_lead: Option<f64>,
    pub score_stdev: Option<f64>,
    pub moves: Vec<LzMove>,
    /// One value per point in KataGo's order (row by row from the top), −1..1 from the side to
    /// move.
    pub ownership: Option<Vec<f64>>,
}

/// Reads an abbreviated visit count: `850`, `1.3k`, `13k`, `1.5m`.
pub fn parse_visits(text: &str) -> Option<u32> {
    let (digits, scale) = match text.as_bytes().last()? {
        b'k' => (&text[..text.len() - 1], 1e3),
        b'm' => (&text[..text.len() - 1], 1e6),
        _ => (text, 1.0),
    };
    let dots = digits.bytes().filter(|&b| b == b'.').count();
    let plain = digits.bytes().all(|b| b.is_ascii_digit() || b == b'.');
    if digits.is_empty() || !plain || dots > 1 || (dots == 1 && scale == 1.0) {
        return None;
    }
    let visits = (digits.parse::<f64>().ok()? * scale).round();
    (visits <= f64::from(u32::MAX)).then_some(visits as u32)
}

/// Abbreviates a visit count: exact under 1,000; one decimal and `k` to 9,949; whole thousands
/// and `k` from 9,950; one decimal and `m` from 10 million.
pub fn format_visits(visits: u32) -> String {
    let v = f64::from(visits);
    match visits {
        0..=999 => visits.to_string(),
        1000..=9949 => format!("{:.1}k", v / 1e3),
        9950..=9_999_999 => format!("{}k", (v / 1e3).round()),
        _ => format!("{:.1}m", v / 1e6),
    }
}

/// Keys whose value runs to the next key.
const LIST_KEYS: [&str; 4] = ["pv", "pvVisits", "pvEdgeVisits", "ownership"];
/// Keys with one value that Aji reads or knows to skip.
const ONE_KEYS: [&str; 10] = [
    "move",
    "visits",
    "winrate",
    "prior",
    "scoreMean",
    "scoreLead",
    "scoreStdev",
    "lcb",
    "order",
    "utility",
];

fn number(text: &str) -> Option<f64> {
    text.parse::<f64>().ok().filter(|v| v.is_finite())
}

/// Parses one value for a board of `points` points. `None` when anything is malformed.
pub fn parse_lz(text: &str, points: usize) -> Option<LzData> {
    let mut lines = text.lines();
    let head: Vec<&str> = lines.next()?.split_whitespace().collect();
    let body: Vec<&str> = lines.next()?.split_whitespace().collect();

    // The engine name may hold spaces; the numbers start at the first number followed by a
    // visit count.
    let at = (0..head.len().saturating_sub(1))
        .find(|&i| number(head[i]).is_some() && parse_visits(head[i + 1]).is_some())?;
    let rest = head[at + 2..]
        .iter()
        .take(3)
        .map(|t| number(t))
        .collect::<Option<Vec<f64>>>()?;
    let mut data = LzData {
        engine: head[..at].join(" "),
        mover_winrate: number(head[at])?,
        visits: parse_visits(head[at + 1])?,
        score_lead: rest.first().copied(),
        score_stdev: rest.get(1).copied(),
        moves: Vec::new(),
        ownership: None,
    };

    for entry in body.split(|&t| t == "info") {
        if entry.is_empty() {
            continue;
        }
        let (mut point, mut visits, mut winrate) = (None, None, None);
        let mut lz = LzMove {
            point: String::new(),
            visits: 0,
            winrate: 0.0,
            prior: 0.0,
            score_lead: None,
            pv: Vec::new(),
        };
        let mut i = 0;
        while i < entry.len() {
            let key = entry[i];
            i += 1;
            if LIST_KEYS.contains(&key) {
                let start = i;
                while i < entry.len()
                    && !LIST_KEYS.contains(&entry[i])
                    && !ONE_KEYS.contains(&entry[i])
                {
                    i += 1;
                }
                let values = &entry[start..i];
                match key {
                    "pv" => lz.pv = values.iter().map(|v| (*v).to_owned()).collect(),
                    "ownership" => {
                        let own = values
                            .iter()
                            .map(|v| number(v))
                            .collect::<Option<Vec<f64>>>()?;
                        if own.len() != points {
                            return None;
                        }
                        data.ownership = Some(own);
                    }
                    _ => {}
                }
                continue;
            }
            let value = *entry.get(i)?;
            i += 1;
            match key {
                "move" => point = Some(value.to_owned()),
                "visits" => visits = Some(parse_visits(value)?),
                "winrate" => winrate = Some(number(value)? / 1e4),
                "prior" => lz.prior = number(value)? / 1e4,
                "scoreMean" | "scoreLead" => lz.score_lead = Some(number(value)?),
                _ => {}
            }
        }
        lz.point = point?;
        lz.visits = visits?;
        lz.winrate = winrate?;
        data.moves.push(lz);
    }
    (!data.moves.is_empty()).then_some(data)
}

/// Writes one value in the same format.
pub fn write_lz(data: &LzData) -> String {
    let mut out = format!(
        "{} {:.1} {}",
        data.engine,
        data.mover_winrate,
        format_visits(data.visits)
    );
    if let Some(lead) = data.score_lead {
        out.push_str(&format!(" {lead:.1}"));
        if let Some(stdev) = data.score_stdev {
            out.push_str(&format!(" {stdev:.1}"));
        }
    }
    out.push('\n');
    let moves: Vec<String> = data
        .moves
        .iter()
        .map(|m| {
            let mut s = format!(
                "move {} visits {} winrate {} prior {}",
                m.point,
                m.visits,
                (m.winrate * 1e4).round(),
                (m.prior * 1e4).round()
            );
            if let Some(lead) = m.score_lead {
                s.push_str(&format!(" scoreMean {lead}"));
            }
            s.push_str(" pv");
            for p in &m.pv {
                s.push(' ');
                s.push_str(p);
            }
            s
        })
        .collect();
    out.push_str(&moves.join(" info "));
    if let Some(own) = &data.ownership {
        out.push_str(" ownership");
        for v in own {
            out.push_str(&format!(" {v}"));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn visits_parse_every_form() {
        assert_eq!(parse_visits("850"), Some(850));
        assert_eq!(parse_visits("1.3k"), Some(1300));
        assert_eq!(parse_visits("13k"), Some(13000));
        assert_eq!(parse_visits("1.5m"), Some(1_500_000));
        assert_eq!(parse_visits("12.5m"), Some(12_500_000));
        for bad in ["", "1.2x", "-5", "54.2", "k", "1e3", "99999999m"] {
            assert_eq!(parse_visits(bad), None, "{bad}");
        }
    }

    #[test]
    fn visits_format_round_trips_at_the_boundaries() {
        for (n, text) in [
            (999, "999"),
            (1000, "1.0k"),
            (9949, "9.9k"),
            (9950, "10k"),
            (9_999_999, "10000k"),
            (10_000_000, "10.0m"),
        ] {
            assert_eq!(format_visits(n), text, "{n}");
            let back = parse_visits(text).unwrap();
            assert!(
                (f64::from(back) - f64::from(n)).abs() / f64::from(n) < 0.01,
                "{n}"
            );
        }
    }

    #[test]
    fn header_winrate_is_the_movers() {
        let d = parse_lz(
            "KataGo 1.18.2 45.8 2.9k -1.6 12.0\nmove D4 visits 9 winrate 5420 pv D4",
            361,
        )
        .unwrap();
        assert_eq!(d.engine, "KataGo 1.18.2");
        assert_eq!(d.mover_winrate, 45.8);
        assert_eq!(d.visits, 2900);
        assert_eq!(d.score_lead, Some(-1.6));
        assert_eq!(d.score_stdev, Some(12.0));
        // Without a score: Leela Zero's line 1.
        let lz = parse_lz("Leela 54.2 850\nmove D4 visits 9 winrate 5420 pv D4", 361).unwrap();
        assert_eq!((lz.score_lead, lz.score_stdev), (None, None));
    }

    #[test]
    fn candidate_lines_parse_with_and_without_pv_visits() {
        let d = parse_lz(
            "KataGo 51.3 1.3k -0.5 15.0\nmove D4 visits 610 winrate 4870 prior 2010 scoreMean -0.5 \
             pv D4 Q4 pvVisits 610 300 info move Q4 visits 500 winrate 4860 lcb 4800 prior 1900 \
             scoreMean -0.5 pv Q4 D4",
            361,
        )
        .unwrap();
        assert_eq!(d.moves.len(), 2);
        let a = &d.moves[0];
        assert_eq!((a.point.as_str(), a.visits), ("D4", 610));
        assert!((a.winrate - 0.487).abs() < 1e-9 && (a.prior - 0.201).abs() < 1e-9);
        assert_eq!(a.score_lead, Some(-0.5));
        assert_eq!(a.pv, ["D4", "Q4"]);
        assert_eq!(d.moves[1].pv, ["Q4", "D4"]);
        assert!((d.moves[1].prior - 0.19).abs() < 1e-9);
        assert_eq!(d.ownership, None);
    }

    #[test]
    fn ownership_parses_when_present() {
        let own: Vec<String> = (0..81)
            .map(|i| if i < 40 { "0.5" } else { "-0.25" }.into())
            .collect();
        let text = format!(
            "KataGo 50.0 100 0.0 1.0\nmove E5 visits 100 winrate 5000 pv E5 ownership {}",
            own.join(" ")
        );
        let d = parse_lz(&text, 81).unwrap();
        let o = d.ownership.unwrap();
        assert_eq!((o.len(), o[0], o[80]), (81, 0.5, -0.25));
        assert_eq!(d.moves[0].pv, ["E5"]);
    }

    #[test]
    fn write_then_parse_is_identity() {
        let data = LzData {
            engine: "KataGo".into(),
            mover_winrate: 48.4,
            visits: 13000,
            score_lead: Some(0.6),
            score_stdev: Some(14.8),
            moves: vec![
                LzMove {
                    point: "Q4".into(),
                    visits: 6400,
                    winrate: 0.516,
                    prior: 0.22,
                    score_lead: Some(0.6),
                    pv: vec!["Q4".into(), "D4".into()],
                },
                LzMove {
                    point: "pass".into(),
                    visits: 3,
                    winrate: 0.0125,
                    prior: 0.0001,
                    score_lead: Some(-30.25),
                    pv: vec!["pass".into()],
                },
            ],
            ownership: Some((0..81).map(|i| f64::from(i % 5) * 0.25 - 0.5).collect()),
        };
        assert_eq!(parse_lz(&write_lz(&data), 81), Some(data));
    }

    #[test]
    fn malformed_lz_is_skipped_not_fatal() {
        let ok = "KataGo 50.0 100 0.0 1.0\nmove E5 visits 100 winrate 5000 pv E5";
        assert!(parse_lz(ok, 81).is_some());
        for bad in [
            "",
            "KataGo 50.0 100 0.0 1.0",   // no line 2
            "KataGo 50.0 100 0.0 1.0\n", // empty line 2
            "KataGo fifty 100\nmove E5 visits 100 winrate 5000 pv E5", // no win rate
            "KataGo 50.0 1.2x\nmove E5 visits 100 winrate 5000 pv E5", // bad visits
            "KataGo 50.0 100\nmove E5 visits many winrate 5000 pv E5", // bad candidate
            "KataGo 50.0 100\nvisits 100 winrate 5000 pv E5", // no move
            "KataGo 50.0 100\nmove E5 visits 100 winrate 5000 pv E5 ownership 0.1 0.2", // short
            "KataGo 50.0 100\nmove E5 visits 100 winrate 5000 pv E5 ownership x",
        ] {
            assert_eq!(parse_lz(bad, 81), None, "{bad:?}");
        }
    }
}
