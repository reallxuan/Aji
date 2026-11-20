//! Limits how often non-final updates are passed on.

use std::time::{Duration, Instant};

/// Admits at most one non-final update per `min_interval`, counting one that arrives after
/// 90% of it as on time: reports come every interval with jitter, and a slightly early one
/// must not be dropped. Finals always pass.
#[derive(Debug, Clone)]
pub struct Throttle {
    min_interval: Duration,
    last: Option<Instant>,
}

impl Throttle {
    pub fn new(min_interval: Duration) -> Throttle {
        Throttle {
            min_interval,
            last: None,
        }
    }

    pub fn admit(&mut self, now: Instant, is_final: bool) -> bool {
        let pass = is_final
            || self
                .last
                .is_none_or(|t| now.saturating_duration_since(t) >= self.min_interval * 9 / 10);
        if pass {
            self.last = Some(now);
        }
        pass
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn throttle() {
        let t0 = Instant::now();
        let ms = |n| t0 + Duration::from_millis(n);
        let mut t = Throttle::new(Duration::from_millis(100));
        assert!(t.admit(ms(0), false));
        assert!(!t.admit(ms(50), false));
        assert!(t.admit(ms(120), false));
        assert!(t.admit(ms(121), true));
    }

    /// Reports come every interval with some jitter; one that lands slightly early must not
    /// be dropped, or every other update is lost.
    #[test]
    fn an_update_at_ninety_percent_of_the_interval_is_admitted() {
        let t0 = Instant::now();
        let ms = |n| t0 + Duration::from_millis(n);
        let mut t = Throttle::new(Duration::from_millis(100));
        assert!(t.admit(ms(0), false));
        assert!(!t.admit(ms(89), false));
        assert!(t.admit(ms(90), false));
    }
}
