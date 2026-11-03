use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

/// Sleeps in short slices so background workers observe a stop request
/// promptly instead of waiting out a 1-5 second tick.
pub(crate) fn sleep_interruptible(stop: &AtomicBool, duration: Duration) -> bool {
    let deadline = Instant::now() + duration;
    loop {
        if stop.load(Ordering::Relaxed) {
            return false;
        }
        let now = Instant::now();
        if now >= deadline {
            return true;
        }
        std::thread::sleep((deadline - now).min(Duration::from_millis(50)));
    }
}
