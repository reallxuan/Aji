//! The rules and komi KataGo analyses a game with, and how they are read from a file (design 5.5).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::coords::{Komi, Rules};
use crate::sgf::SgfNode;
use crate::{HandicapBonus, KataRules, KoRule, ScoringRule, TaxRule};

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

/// The optional custom fields in addition to scoring and komi.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RuleDetails {
    pub ko: KoRule,
    pub tax: TaxRule,
    pub suicide: bool,
    pub has_button: bool,
    pub white_handicap_bonus: HandicapBonus,
    pub friendly_pass_ok: bool,
}

impl From<KataRules> for RuleDetails {
    fn from(rules: KataRules) -> Self {
        Self {
            ko: rules.ko,
            tax: rules.tax,
            suicide: rules.suicide,
            has_button: rules.has_button,
            white_handicap_bonus: rules.white_handicap_bonus,
            friendly_pass_ok: rules.friendly_pass_ok,
        }
    }
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
        #[serde(default)]
        details: Option<RuleDetails>,
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

    pub fn kata_rules(&self) -> KataRules {
        let scoring = self.scoring();
        if let Self::Custom {
            details: Some(details),
            ..
        } = self
        {
            KataRules {
                scoring: scoring.into(),
                ko: details.ko,
                tax: details.tax,
                suicide: details.suicide,
                has_button: details.has_button,
                white_handicap_bonus: details.white_handicap_bonus,
                friendly_pass_ok: details.friendly_pass_ok,
            }
        } else {
            KataRules::from(match scoring {
                Scoring::Area => Rules::Chinese,
                Scoring::Territory => Rules::Japanese,
            })
        }
    }

    pub fn same_effect(&self, other: &Self) -> bool {
        self.komi() == other.komi() && self.kata_rules() == other.kata_rules()
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
            _ => AnalysisRules::Custom {
                komi,
                scoring,
                details: None,
            },
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
    let exact = root.first("RU").and_then(KataRules::from_katago_string);
    let scoring_from_ru = exact
        .map(|r| match r.scoring {
            ScoringRule::Area => Scoring::Area,
            ScoringRule::Territory => Scoring::Territory,
        })
        .or_else(|| {
            root.first("RU")
                .and_then(|ru| match ru.trim().to_ascii_lowercase().as_str() {
                    "chinese" | "cn" | "aga" | "tromp-taylor" | "tt" | "nz" => Some(Scoring::Area),
                    "japanese" | "jp" | "korean" | "ko" => Some(Scoring::Territory),
                    _ => None,
                })
        });
    let komi = km.and_then(|km| {
        if exact.is_some() {
            komi_in_points(km.parse().ok()?)
        } else {
            read_legacy_komi(km, root, scoring_from_ru)
        }
    });
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
    let rules = match exact {
        Some(kata) => AnalysisRules::Custom {
            scoring: rules.scoring(),
            komi: rules.komi(),
            details: Some(kata.into()),
        },
        None => rules,
    };
    RulesReading {
        rules,
        komi_unreadable,
    }
}

/// A `KM` value in points, with Fox's two conventions applied.
fn read_legacy_komi(km: &str, root: &SgfNode, scoring: Option<Scoring>) -> Option<Komi> {
    let mut value: f64 = km.parse().ok().filter(|v: &f64| v.is_finite())?;
    // Fox writes komi in hundredths of a stone: KM[375] is 3.75 stones, 7.5 points.
    if value.abs() > MAX_KOMI && value.fract() == 0.0 && value % 25.0 == 0.0 {
        value /= 50.0;
    }
    // Fox's Japanese-rule even games are played at 6.5 but written as KM[0].
    if value == 0.0 && scoring == Some(Scoring::Territory) && is_fox_even_game(root) {
        value = 6.5;
    }
    komi_in_points(value)
}

pub(super) fn is_fox_even_game(root: &SgfNode) -> bool {
    root.first("HA").is_none_or(|ha| ha.trim() == "0")
        && root.get("AP").is_some_and(|ap| {
            ap.values
                .iter()
                .any(|v| v.trim().eq_ignore_ascii_case("foxwq"))
        })
}

fn komi_in_points(value: f64) -> Option<Komi> {
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
            details: None,
        }
    }

    #[test]
    fn custom_without_details_is_its_scorings_preset() {
        assert_eq!(
            custom(7.0, Scoring::Area).kata_rules(),
            Rules::Chinese.into()
        );
    }

    #[test]
    fn old_custom_json_still_reads() {
        let rules: AnalysisRules =
            serde_json::from_str(r#"{"kind":"custom","komi":7,"scoring":"area"}"#).unwrap();
        assert!(matches!(rules, AnalysisRules::Custom { details: None, .. }));
    }

    #[test]
    fn same_effect_ignores_how_the_rules_were_chosen() {
        let rules = custom(7.5, Scoring::Area);
        assert!(rules.same_effect(&AnalysisRules::Chinese));
        assert!(!rules.same_effect(&custom(7.0, Scoring::Area)));
        let changed = read("RU[koPOSITIONALscoreAREAtaxNONEsui0whbNfpok1]KM[7.5]").rules;
        assert!(!rules.same_effect(&changed));
    }

    #[test]
    fn ru_reads_a_katago_string_as_exact_custom_rules() {
        let rules = read("RU[koPOSITIONALscoreAREAtaxNONEsui1button0whbN]KM[7]").rules;
        assert!(matches!(
            rules,
            AnalysisRules::Custom {
                details: Some(_),
                ..
            }
        ));
        assert_eq!(rules.komi().points(), 7.0);
        assert_eq!(
            rules.kata_rules().katago_string(),
            "koPOSITIONALscoreAREAtaxNONEsui1whbN"
        );
    }

    #[test]
    fn ru_names_read_as_before() {
        for (name, rules, key) in [
            ("AGA", AnalysisRules::Chinese, "3edba656b924370b"),
            ("NZ", AnalysisRules::Chinese, "3edba656b924370b"),
            ("TrompTaylor", AnalysisRules::Chinese, "3edba656b924370b"),
            ("tromp-taylor", AnalysisRules::Chinese, "3edba656b924370b"),
            ("Korean", AnalysisRules::JapaneseKorean, "f090b41a5dc929f9"),
        ] {
            let got = read(&format!("RU[{name}]")).rules;
            assert_eq!(got, rules);
            assert_eq!(
                crate::Position::empty(crate::BoardSize::NINETEEN, got.kata_rules(), got.komi())
                    .key()
                    .to_string(),
                key
            );
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
            custom(7.0, Scoring::Territory).kata_rules(),
            Rules::Japanese.into()
        );
        assert_eq!(
            custom(7.0, Scoring::Area).kata_rules(),
            Rules::Chinese.into()
        );
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
            serde_json::json!({ "kind": "custom", "komi": 7.0, "scoring": "territory", "details": null })
        );
        let back: AnalysisRules = serde_json::from_value(
            serde_json::json!({ "kind": "custom", "komi": 0.5, "scoring": "area" }),
        )
        .unwrap();
        assert_eq!(back, custom(0.5, Scoring::Area));
    }
}
