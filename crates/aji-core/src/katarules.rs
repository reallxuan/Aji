//! KataGo's full rule set, shared by positions, engine queries and game records.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::Rules;

// The interface uses camelCase. KataGo uses its own tokens in both its JSON and SGF formats.
macro_rules! rule_enum {
    ($name:ident { $($variant:ident => $token:literal),+ }) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
        #[serde(rename_all = "camelCase")]
        #[ts(export)]
        pub enum $name { $($variant),+ }

        impl $name {
            pub fn katago_token(self) -> &'static str {
                match self { $(Self::$variant => $token),+ }
            }

            fn read_token(value: &str) -> Option<Self> {
                match value { $($token => Some(Self::$variant),)+ _ => None }
            }
        }
    };
}

rule_enum!(KoRule { Simple => "SIMPLE", Positional => "POSITIONAL", Situational => "SITUATIONAL" });
rule_enum!(ScoringRule { Area => "AREA", Territory => "TERRITORY" });
rule_enum!(TaxRule { None => "NONE", Seki => "SEKI", All => "ALL" });
rule_enum!(HandicapBonus { Zero => "0", N => "N", NMinusOne => "N-1" });

/// The fields of KataGo's `rules` object (`kata-get-rules`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct KataRules {
    pub ko: KoRule,
    pub scoring: ScoringRule,
    pub tax: TaxRule,
    pub suicide: bool,
    pub has_button: bool,
    pub white_handicap_bonus: HandicapBonus,
    pub friendly_pass_ok: bool,
}

impl From<Rules> for KataRules {
    /// The values KataGo 1.18.2 reports from `kata-get-rules` after `kata-set-rules <name>`.
    fn from(rules: Rules) -> KataRules {
        match rules {
            Rules::Chinese => KataRules {
                ko: KoRule::Simple,
                scoring: ScoringRule::Area,
                tax: TaxRule::None,
                suicide: false,
                has_button: false,
                white_handicap_bonus: HandicapBonus::N,
                friendly_pass_ok: true,
            },
            Rules::Japanese | Rules::Korean => KataRules {
                ko: KoRule::Simple,
                scoring: ScoringRule::Territory,
                tax: TaxRule::Seki,
                suicide: false,
                has_button: false,
                white_handicap_bonus: HandicapBonus::Zero,
                friendly_pass_ok: false,
            },
            Rules::TrompTaylor => KataRules {
                ko: KoRule::Positional,
                scoring: ScoringRule::Area,
                tax: TaxRule::None,
                suicide: true,
                has_button: false,
                white_handicap_bonus: HandicapBonus::Zero,
                friendly_pass_ok: false,
            },
        }
    }
}

impl KataRules {
    pub fn preset(&self) -> Option<Rules> {
        [Rules::Chinese, Rules::Japanese, Rules::TrompTaylor]
            .into_iter()
            .find(|&preset| Self::from(preset) == *self)
    }

    /// KataGo's SGF RU spelling (Rules::toStringNoKomi).
    pub fn katago_string(&self) -> String {
        let mut value = format!(
            "ko{}score{}tax{}sui{}",
            self.ko.katago_token(),
            self.scoring.katago_token(),
            self.tax.katago_token(),
            u8::from(self.suicide)
        );
        if self.has_button {
            value.push_str("button1");
        }
        if self.white_handicap_bonus != HandicapBonus::Zero {
            value.push_str("whb");
            value.push_str(self.white_handicap_bonus.katago_token());
        }
        if self.friendly_pass_ok {
            value.push_str("fpok1");
        }
        value
    }

    pub fn from_katago_string(value: &str) -> Option<Self> {
        let (ko, rest) = value.trim().strip_prefix("ko")?.split_once("score")?;
        let (scoring, rest) = rest.split_once("tax")?;
        let (tax, rest) = rest.split_once("sui")?;
        let (suicide, mut rest) = read_bit(rest)?;
        let mut has_button = false;
        let mut white_handicap_bonus = HandicapBonus::Zero;
        let mut friendly_pass_ok = false;
        if let Some(value) = rest.strip_prefix("button") {
            (has_button, rest) = read_bit(value)?;
        }
        if let Some(value) = rest.strip_prefix("whb") {
            let end = value.find("fpok").unwrap_or(value.len());
            white_handicap_bonus = HandicapBonus::read_token(&value[..end])?;
            rest = &value[end..];
        }
        if let Some(value) = rest.strip_prefix("fpok") {
            (friendly_pass_ok, rest) = read_bit(value)?;
        }
        if !rest.is_empty() {
            return None;
        }
        Some(Self {
            ko: KoRule::read_token(ko)?,
            scoring: ScoringRule::read_token(scoring)?,
            tax: TaxRule::read_token(tax)?,
            suicide,
            has_button,
            white_handicap_bonus,
            friendly_pass_ok,
        })
    }

    /// A fixed encoding for the position key: one byte per field, in declaration order.
    pub fn key_bytes(&self) -> [u8; 7] {
        [
            match self.ko {
                KoRule::Simple => 0,
                KoRule::Positional => 1,
                KoRule::Situational => 2,
            },
            match self.scoring {
                ScoringRule::Area => 0,
                ScoringRule::Territory => 1,
            },
            match self.tax {
                TaxRule::None => 0,
                TaxRule::Seki => 1,
                TaxRule::All => 2,
            },
            u8::from(self.suicide),
            u8::from(self.has_button),
            match self.white_handicap_bonus {
                HandicapBonus::Zero => 0,
                HandicapBonus::N => 1,
                HandicapBonus::NMinusOne => 2,
            },
            u8::from(self.friendly_pass_ok),
        ]
    }
}

fn read_bit(input: &str) -> Option<(bool, &str)> {
    if let Some(rest) = input.strip_prefix('1') {
        Some((true, rest))
    } else {
        input.strip_prefix('0').map(|rest| (false, rest))
    }
}

/// How a game's rules score, as KataGo's scoring field.
impl From<crate::game::Scoring> for ScoringRule {
    fn from(scoring: crate::game::Scoring) -> Self {
        match scoring {
            crate::game::Scoring::Area => ScoringRule::Area,
            crate::game::Scoring::Territory => ScoringRule::Territory,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn katago_string_round_trips_every_combination() {
        for ko in [KoRule::Simple, KoRule::Positional, KoRule::Situational] {
            for scoring in [ScoringRule::Area, ScoringRule::Territory] {
                for tax in [TaxRule::None, TaxRule::Seki, TaxRule::All] {
                    for suicide in [false, true] {
                        for has_button in [false, true] {
                            for white_handicap_bonus in [
                                HandicapBonus::Zero,
                                HandicapBonus::N,
                                HandicapBonus::NMinusOne,
                            ] {
                                for friendly_pass_ok in [false, true] {
                                    let rules = KataRules {
                                        ko,
                                        scoring,
                                        tax,
                                        suicide,
                                        has_button,
                                        white_handicap_bonus,
                                        friendly_pass_ok,
                                    };
                                    assert_eq!(
                                        KataRules::from_katago_string(&rules.katago_string()),
                                        Some(rules)
                                    );
                                }
                            }
                        }
                    }
                }
            }
        }
        assert_eq!(
            KataRules::from(Rules::Chinese).katago_string(),
            "koSIMPLEscoreAREAtaxNONEsui0whbNfpok1"
        );
        assert_eq!(
            KataRules::from(Rules::TrompTaylor).katago_string(),
            "koPOSITIONALscoreAREAtaxNONEsui1"
        );
    }

    #[test]
    fn presets_map_to_katagos_documented_rules() {
        let c = KataRules::from(Rules::Chinese);
        assert_eq!(
            (
                c.ko,
                c.scoring,
                c.tax,
                c.suicide,
                c.has_button,
                c.white_handicap_bonus,
                c.friendly_pass_ok
            ),
            (
                KoRule::Simple,
                ScoringRule::Area,
                TaxRule::None,
                false,
                false,
                HandicapBonus::N,
                true
            )
        );
        let j = KataRules::from(Rules::Japanese);
        assert_eq!(
            (
                j.ko,
                j.scoring,
                j.tax,
                j.suicide,
                j.has_button,
                j.white_handicap_bonus,
                j.friendly_pass_ok
            ),
            (
                KoRule::Simple,
                ScoringRule::Territory,
                TaxRule::Seki,
                false,
                false,
                HandicapBonus::Zero,
                false
            )
        );
        let t = KataRules::from(Rules::TrompTaylor);
        assert_eq!(
            (
                t.ko,
                t.scoring,
                t.tax,
                t.suicide,
                t.has_button,
                t.white_handicap_bonus,
                t.friendly_pass_ok
            ),
            (
                KoRule::Positional,
                ScoringRule::Area,
                TaxRule::None,
                true,
                false,
                HandicapBonus::Zero,
                false
            )
        );
        assert_eq!(KataRules::from(Rules::Korean), j);
    }

    #[test]
    fn game_scoring_converts() {
        use crate::game::Scoring;
        assert_eq!(ScoringRule::from(Scoring::Area), ScoringRule::Area);
        assert_eq!(
            ScoringRule::from(Scoring::Territory),
            ScoringRule::Territory
        );
    }

    #[test]
    fn key_bytes_follow_field_order() {
        assert_eq!(
            KataRules::from(Rules::Chinese).key_bytes(),
            [0, 0, 0, 0, 0, 1, 1]
        );
        assert_eq!(
            KataRules::from(Rules::Japanese).key_bytes(),
            [0, 1, 1, 0, 0, 0, 0]
        );
        assert_eq!(
            KataRules::from(Rules::TrompTaylor).key_bytes(),
            [1, 0, 0, 1, 0, 0, 0]
        );
    }
}
