//! KataGo's full rule set, as its `rules` object names the fields.
//!
//! The interface offers only the four presets (until P2 M3). The cache keys positions by the
//! full rule set, so two presets that KataGo plays identically share their results.

use crate::Rules;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum KoRule {
    Simple,
    Positional,
    Situational,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ScoringRule {
    Area,
    Territory,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum TaxRule {
    None,
    Seki,
    All,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum HandicapBonus {
    Zero,
    N,
    NMinusOne,
}

/// The fields of KataGo's `rules` object (`kata-get-rules`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
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
