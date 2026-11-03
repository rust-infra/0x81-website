use std::time::Instant;

use parking_lot::Mutex;

/// Token bucket matching `juju/ratelimit.NewBucketWithRate(rate, capacity)`
/// with `TakeAvailable(1)` semantics.
pub struct RateLimiter {
    rate: f64,
    capacity: f64,
    state: Mutex<BucketState>,
}

struct BucketState {
    tokens: f64,
    last: Instant,
}

impl RateLimiter {
    pub fn new(rate: u32) -> Self {
        let rate = f64::from(rate);
        Self {
            rate,
            capacity: rate,
            state: Mutex::new(BucketState {
                tokens: rate,
                last: Instant::now(),
            }),
        }
    }

    /// Returns the number of tokens taken, 0 when the bucket is empty.
    pub fn take_available(&self, count: u32) -> u32 {
        if self.rate <= 0.0 {
            return count;
        }
        let mut state = self.state.lock();
        let now = Instant::now();
        let elapsed = now.duration_since(state.last).as_secs_f64();
        state.last = now;
        state.tokens = (state.tokens + elapsed * self.rate).min(self.capacity);
        let requested = f64::from(count);
        if state.tokens >= requested {
            state.tokens -= requested;
            count
        } else {
            0
        }
    }
}
