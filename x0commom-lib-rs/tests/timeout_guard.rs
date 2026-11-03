use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};

use x0commom_lib_rs::timeout_guard::do_with_timeout;

#[test]
fn fast_source_does_not_alert() {
    let alerts = Arc::new(AtomicUsize::new(0));
    let sink = alerts.clone();
    let result = do_with_timeout(
        Instant::now(),
        Duration::from_millis(200),
        true,
        Some(Arc::new(move |_label: &str| {
            sink.fetch_add(1, Ordering::SeqCst);
        })),
        "k".to_string(),
        || Ok(42u32),
    )
    .expect("result");
    assert_eq!(result, Some(42));
    // Give a would-be watcher time to fire if it were not cancelled.
    std::thread::sleep(Duration::from_millis(250));
    assert_eq!(alerts.load(Ordering::SeqCst), 0);
}

#[test]
fn slow_sync_source_alerts_but_returns_value() {
    let alerts = Arc::new(AtomicUsize::new(0));
    let sink = alerts.clone();
    let result = do_with_timeout(
        Instant::now(),
        Duration::from_millis(30),
        true,
        Some(Arc::new(move |_label: &str| {
            sink.fetch_add(1, Ordering::SeqCst);
        })),
        "k".to_string(),
        || {
            std::thread::sleep(Duration::from_millis(80));
            Ok(7u32)
        },
    )
    .expect("result");
    assert_eq!(result, Some(7));
    assert_eq!(alerts.load(Ordering::SeqCst), 1);
}

#[test]
fn async_timeout_returns_error() {
    let alerts = Arc::new(AtomicUsize::new(0));
    let sink = alerts.clone();
    let started = Instant::now();
    let result = do_with_timeout(
        Instant::now(),
        Duration::from_millis(30),
        false,
        Some(Arc::new(move |_label: &str| {
            sink.fetch_add(1, Ordering::SeqCst);
        })),
        "k".to_string(),
        || {
            std::thread::sleep(Duration::from_millis(120));
            Ok(7u32)
        },
    );
    assert!(result.is_err());
    assert!(started.elapsed() < Duration::from_millis(110));
    assert_eq!(alerts.load(Ordering::SeqCst), 1);
}
