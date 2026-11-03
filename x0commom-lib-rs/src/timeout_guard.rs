use std::sync::Arc;
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use crate::error::{CacheError, Result};

pub type AlertCallback = Arc<dyn Fn(&str) + Send + Sync>;

/// Runs a source lookup with the timeout semantics of
/// `ycache.TimedValueWrapper.DoWithTimeoutAt`.
///
/// * `sync == true` waits for the source and reports a slow lookup through the
///   callback.
/// * `sync == false` returns `Err(SourceTimeout)` when the deadline passes; the
///   source thread keeps running and its result is discarded.
pub fn do_with_timeout<T, F>(
    start: Instant,
    timeout: Duration,
    sync: bool,
    alert: Option<AlertCallback>,
    label: String,
    f: F,
) -> Result<Option<T>>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T> + Send + 'static,
{
    let deadline = start + timeout;
    if sync {
        let (cancel_sender, cancel_receiver) = mpsc::channel::<()>();
        let alert_thread = alert.map(|callback| {
            let label = label.clone();
            thread::spawn(move || {
                let now = Instant::now();
                let remaining = deadline.saturating_duration_since(now);
                match cancel_receiver.recv_timeout(remaining) {
                    Ok(()) | Err(mpsc::RecvTimeoutError::Disconnected) => {}
                    Err(mpsc::RecvTimeoutError::Timeout) => callback(&label),
                }
            })
        });
        let result = f();
        let _ = cancel_sender.send(());
        if let Some(handle) = alert_thread {
            let _ = handle.join();
        }
        return result.map(Some);
    }

    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let result = f();
        let _ = sender.send(result);
    });

    let now = Instant::now();
    let remaining = deadline.saturating_duration_since(now);
    match receiver.recv_timeout(remaining) {
        Ok(result) => Ok(Some(result?)),
        Err(mpsc::RecvTimeoutError::Timeout) => {
            if let Some(callback) = alert {
                callback(&label);
            }
            Err(CacheError::SourceTimeout)
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            Err(CacheError::Message("source thread panicked".to_string()))
        }
    }
}
