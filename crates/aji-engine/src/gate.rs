//! Limits how often analysis queries are submitted, so a burst of navigation does not queue
//! a query per position.

use std::time::Duration;

use tokio::time::Instant;

/// Leading and trailing edge: the first query after a quiet `interval` goes out at once; within
/// the interval the caller waits until it has passed since the last submission.
#[derive(Debug, Clone)]
pub(crate) struct SubmitGate {
    interval: Duration,
    last: Option<Instant>,
}

impl SubmitGate {
    pub(crate) fn new(interval: Duration) -> SubmitGate {
        SubmitGate {
            interval,
            last: None,
        }
    }

    /// `None`: submit now. `Some(t)`: not before `t`.
    pub(crate) fn earliest(&self, now: Instant) -> Option<Instant> {
        let ready_at = self.last? + self.interval;
        (now < ready_at).then_some(ready_at)
    }

    pub(crate) fn submitted(&mut self, now: Instant) {
        self.last = Some(now);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const INTERVAL: Duration = Duration::from_millis(100);

    #[test]
    fn first_submission_is_immediate() {
        let gate = SubmitGate::new(INTERVAL);
        assert_eq!(gate.earliest(Instant::now()), None);
    }

    #[test]
    fn a_second_within_the_interval_waits_for_the_rest() {
        let t = Instant::now();
        let mut gate = SubmitGate::new(INTERVAL);
        gate.submitted(t);
        assert_eq!(
            gate.earliest(t + Duration::from_millis(30)),
            Some(t + INTERVAL)
        );
    }

    #[test]
    fn after_the_interval_it_is_immediate_again() {
        let t = Instant::now();
        let mut gate = SubmitGate::new(INTERVAL);
        gate.submitted(t);
        assert_eq!(gate.earliest(t + INTERVAL), None);
        assert_eq!(gate.earliest(t + Duration::from_millis(250)), None);
    }

    #[test]
    fn zero_interval_never_waits() {
        let t = Instant::now();
        let mut gate = SubmitGate::new(Duration::ZERO);
        gate.submitted(t);
        assert_eq!(gate.earliest(t), None);
    }
}
