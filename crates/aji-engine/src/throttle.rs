//! Limits how often non-final updates are passed on.

use std::time::{Duration, Instant};

/// Admits at most one non-final update per `min_interval`. Finals always pass.
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
                .is_none_or(|t| now.saturating_duration_since(t) >= self.min_interval);
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
}
