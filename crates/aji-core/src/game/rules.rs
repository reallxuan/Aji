//! The rules and komi KataGo analyses a game with, and how they are read from a file (design 5.5).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::coords::{Komi, Rules};
use crate::sgf::SgfNode;

/// How the game is counted.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Scoring {
    /// Stones plus territory (数子).
    Area,
    /// Territory plus captures (数目).
    Territory,
}

/// The rules and komi KataGo analyses with. The presets fix the komi; only Custom frees it.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum AnalysisRules {
    /// Area scoring, komi 7.5. The default for new games until the user picks another.
    #[default]
    Chinese,
    /// Territory scoring, komi 6.5.
    JapaneseKorean,
    Custom {
        #[ts(type = "number")]
        komi: Komi,
        scoring: Scoring,
    },
}

/// The largest komi either way that Aji sends.
pub const MAX_KOMI: f64 = 150.0;

impl AnalysisRules {
    pub fn komi(&self) -> Komi {
        match self {
            AnalysisRules::Chinese => Komi::new(7.5).expect("valid"),
            AnalysisRules::JapaneseKorean => Komi::new(6.5).expect("valid"),
            AnalysisRules::Custom { komi, .. } => *komi,
        }
    }

    pub fn scoring(&self) -> Scoring {
        match self {
            AnalysisRules::Chinese => Scoring::Area,
            AnalysisRules::JapaneseKorean => Scoring::Territory,
            AnalysisRules::Custom { scoring, .. } => *scoring,
        }
    }

    /// The rule set sent to KataGo: `chinese` for area scoring, `japanese` for territory.
    pub fn katago_rules(&self) -> Rules {
        match self.scoring() {
            Scoring::Area => Rules::Chinese,
            Scoring::Territory => Rules::Japanese,
        }
    }

    /// Whether the komi is within [-150, 150], as the interface allows.
    pub fn is_valid(&self) -> bool {
        self.komi().points().abs() <= MAX_KOMI
    }

    /// The preset that matches `komi` and `scoring`, else Custom.
    pub fn from_parts(komi: Komi, scoring: Scoring) -> AnalysisRules {
        match (scoring, komi.points()) {
            (Scoring::Area, 7.5) => AnalysisRules::Chinese,
            (Scoring::Territory, 6.5) => AnalysisRules::JapaneseKorean,
            _ => AnalysisRules::Custom { komi, scoring },
        }
    }
}

/// The rules read from a file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RulesReading {
    pub rules: AnalysisRules,
    /// `KM` was present but not a usable komi.
    pub komi_unreadable: bool,
}

/// Reads `RU`, `KM`, `HA` and `AP` from a game's root (design 5.5). With neither rules nor a
/// usable komi, `default` applies.
pub fn read_rules(root: &SgfNode, default: AnalysisRules) -> RulesReading {
    let km = root.first("KM").map(str::trim);
    let scoring_from_ru =
        root.first("RU")
            .and_then(|ru| match ru.trim().to_ascii_lowercase().as_str() {
                "chinese" | "cn" | "aga" | "tromp-taylor" | "tt" | "nz" => Some(Scoring::Area),
                "japanese" | "jp" | "korean" | "ko" => Some(Scoring::Territory),
                _ => None,
            });
    let komi = km.and_then(|km| read_komi(km, root, scoring_from_ru));
    let komi_unreadable = km.is_some() && komi.is_none();

    let rules = match (scoring_from_ru, komi) {
        (Some(scoring), Some(komi)) => AnalysisRules::from_parts(komi, scoring),
        (Some(Scoring::Area), None) => AnalysisRules::Chinese,
        (Some(Scoring::Territory), None) => AnalysisRules::JapaneseKorean,
        (None, Some(komi)) => {
            let scoring = match komi.points() {
                7.5 => Scoring::Area,
                6.5 => Scoring::Territory,
                _ => default.scoring(),
            };
            AnalysisRules::from_parts(komi, scoring)
        }
        (None, None) => default,
    };
    RulesReading {
        rules,
        komi_unreadable,
    }
}

/// A `KM` value in points, with Fox's two conventions applied.
fn read_komi(km: &str, root: &SgfNode, scoring: Option<Scoring>) -> Option<Komi> {
    let mut value: f64 = km.parse().ok().filter(|v: &f64| v.is_finite())?;
    // Fox writes komi in hundredths of a stone: KM[375] is 3.75 stones, 7.5 points.
    if value.abs() > MAX_KOMI && value.fract() == 0.0 && value % 25.0 == 0.0 {
        value /= 50.0;
    }
    // Fox's Japanese-rule even games are played at 6.5 but written as KM[0].
    let from_fox = root.get("AP").is_some_and(|ap| {
        ap.values
            .iter()
            .any(|v| v.trim().eq_ignore_ascii_case("foxwq"))
    });
    let even = root.first("HA").is_none_or(|ha| ha.trim() == "0");
    if value == 0.0 && from_fox && even && scoring == Some(Scoring::Territory) {
        value = 6.5;
    }
    if value.abs() > MAX_KOMI {
        return None;
    }
    Komi::new(value).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sgf::parse_sgf;

    fn read(root: &str) -> RulesReading {
        let c = parse_sgf(&format!("(;{root})")).unwrap();
        read_rules(&c.games[0].nodes[0], AnalysisRules::Chinese)
    }

    fn custom(komi: f64, scoring: Scoring) -> AnalysisRules {
        AnalysisRules::Custom {
            komi: Komi::new(komi).unwrap(),
            scoring,
        }
    }

    #[test]
    fn presets_from_files() {
        assert_eq!(read("RU[Chinese]KM[7.5]").rules, AnalysisRules::Chinese);
        assert_eq!(
            read("RU[Japanese]KM[6.5]").rules,
            AnalysisRules::JapaneseKorean
        );
        assert_eq!(read("KM[6.5]").rules, AnalysisRules::JapaneseKorean);
        assert_eq!(read("KM[7.5]").rules, AnalysisRules::Chinese);
        assert_eq!(
            read("RU[Korean]KM[5.5]").rules,
            custom(5.5, Scoring::Territory)
        );
        assert_eq!(read("RU[Chinese]KM[6.5]").rules, custom(6.5, Scoring::Area));
        assert_eq!(read("RU[japanese]").rules, AnalysisRules::JapaneseKorean);
        assert_eq!(read("GN[x]").rules, AnalysisRules::Chinese);
        let c = parse_sgf("(;GN[x])").unwrap();
        let default = custom(7.0, Scoring::Territory);
        assert_eq!(read_rules(&c.games[0].nodes[0], default).rules, default);
    }

    #[test]
    fn fox_komi() {
        assert_eq!(
            read("RU[Chinese]KM[375]AP[foxwq]").rules,
            AnalysisRules::Chinese
        );
        assert_eq!(read("KM[325]RU[Chinese]").rules, custom(6.5, Scoring::Area));
        assert_eq!(
            read("KM[0]HA[0]RU[Japanese]AP[GNU Go:3.8]AP[foxwq]").rules,
            AnalysisRules::JapaneseKorean
        );
        assert_eq!(
            read("KM[0]HA[0]RU[Japanese]AP[GNU Go:3.8]").rules,
            custom(0.0, Scoring::Territory)
        );
    }

    #[test]
    fn bad_komi() {
        let r = read("KM[abc]");
        assert_eq!(r.rules, AnalysisRules::Chinese);
        assert!(r.komi_unreadable);
        assert!(read("KM[999.3]").komi_unreadable);
        assert!(!read("KM[7.5]").komi_unreadable);
    }

    #[test]
    fn katago_mapping() {
        assert_eq!(
            custom(7.0, Scoring::Territory).katago_rules(),
            Rules::Japanese
        );
        assert_eq!(custom(7.0, Scoring::Area).katago_rules(), Rules::Chinese);
        assert_eq!(AnalysisRules::Chinese.komi(), Komi::new(7.5).unwrap());
        assert_eq!(
            AnalysisRules::JapaneseKorean.komi(),
            Komi::new(6.5).unwrap()
        );
        assert_eq!(AnalysisRules::JapaneseKorean.scoring(), Scoring::Territory);
    }

    #[test]
    fn validity() {
        assert!(custom(150.0, Scoring::Area).is_valid());
        assert!(!custom(150.5, Scoring::Area).is_valid());
        assert!(AnalysisRules::Chinese.is_valid());
    }

    #[test]
    fn json_shape() {
        assert_eq!(
            serde_json::to_value(AnalysisRules::JapaneseKorean).unwrap(),
            serde_json::json!({ "kind": "japaneseKorean" })
        );
        assert_eq!(
            serde_json::to_value(custom(7.0, Scoring::Territory)).unwrap(),
            serde_json::json!({ "kind": "custom", "komi": 7.0, "scoring": "territory" })
        );
        let back: AnalysisRules = serde_json::from_value(
            serde_json::json!({ "kind": "custom", "komi": 0.5, "scoring": "area" }),
        )
        .unwrap();
        assert_eq!(back, custom(0.5, Scoring::Area));
    }
}
