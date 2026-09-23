use std::collections::HashMap;
use std::time::{Duration, Instant};

pub const MAX_ATTEMPTS: u32 = 5;
pub const WINDOW_SECS: u64 = 300;
pub const LOCKOUT_SECS: u64 = 300;

#[derive(Default)]
pub struct AttemptTracker {
    attempts: HashMap<String, Vec<Instant>>,
}

impl AttemptTracker {
    /// Returns Ok when another attempt is allowed, Err(retry_after_secs) when locked out.
    pub fn check(&mut self, key: &str) -> Result<(), u64> {
        let now = Instant::now();
        let window = Duration::from_secs(WINDOW_SECS);
        let entries = self.attempts.entry(key.to_string()).or_default();
        entries.retain(|t| now.duration_since(*t) <= window);
        if entries.len() as u32 >= MAX_ATTEMPTS {
            let oldest = entries[0];
            let retry = LOCKOUT_SECS.saturating_sub(now.duration_since(oldest).as_secs());
            return Err(retry.max(1));
        }
        Ok(())
    }

    /// Records an attempt outcome; success clears the key's history.
    pub fn record(&mut self, key: &str, success: bool) {
        if success {
            self.attempts.remove(key);
        } else {
            self.attempts.entry(key.to_string()).or_default().push(Instant::now());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_fewer_than_max_attempts() {
        let mut t = AttemptTracker::default();
        for _ in 0..MAX_ATTEMPTS {
            assert!(t.check("k").is_ok());
            t.record("k", false);
        }
    }

    #[test]
    fn blocks_at_max_attempts_with_retry_hint() {
        let mut t = AttemptTracker::default();
        for _ in 0..MAX_ATTEMPTS {
            let _ = t.check("k");
            t.record("k", false);
        }
        let err = t.check("k").expect_err("must be locked out");
        assert!(err >= 1 && err <= LOCKOUT_SECS);
    }

    #[test]
    fn success_clears_history() {
        let mut t = AttemptTracker::default();
        for _ in 0..MAX_ATTEMPTS {
            let _ = t.check("k");
            t.record("k", false);
        }
        assert!(t.check("k").is_err());
        t.record("k", true);
        assert!(t.check("k").is_ok());
    }

    #[test]
    fn keys_are_independent() {
        let mut t = AttemptTracker::default();
        for _ in 0..MAX_ATTEMPTS {
            let _ = t.check("a");
            t.record("a", false);
        }
        assert!(t.check("a").is_err());
        assert!(t.check("b").is_ok());
    }
}
