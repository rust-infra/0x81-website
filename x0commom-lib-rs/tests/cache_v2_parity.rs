use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Barrier, Mutex};
use std::time::Duration;

use x0commom_lib_rs::cache_v2::{CacheV2, SourceGetter, SourceMGetter};
use x0commom_lib_rs::cacheable::{CacheValue, InterfaceView};
use x0commom_lib_rs::cacher::Cacher;
use x0commom_lib_rs::error::CacheError;
use x0commom_lib_rs::options::{DeleteOptions, GetterOptions, Options, PluginOptions};
use x0commom_lib_rs::plugins::LruCache;
use x0commom_lib_rs::stats::NoopMetrics;

fn typed(value: &CacheValue) -> TValue {
    value
        .data()
        .downcast_ref::<TValue>()
        .cloned()
        .expect("typed")
}

type Ttl = i32;

#[derive(Debug, Clone, PartialEq, Eq)]
struct TValue {
    value: String,
}

fn source_getter(calls: Arc<AtomicUsize>, ttl: Ttl) -> Arc<dyn SourceGetter<String>> {
    Arc::new(move |key: &String| {
        calls.fetch_add(1, Ordering::SeqCst);
        Ok(Arc::new(InterfaceView::new(TValue { value: key.clone() }, ttl)) as CacheValue)
    })
}

fn not_found_getter(calls: Arc<AtomicUsize>) -> Arc<dyn SourceGetter<String>> {
    Arc::new(move |_key: &String| {
        calls.fetch_add(1, Ordering::SeqCst);
        Err(CacheError::SourceNotFound)
    })
}

fn cache_with(options: Options) -> Arc<CacheV2<String>> {
    let cacher = LruCache::<String>::new(10, Duration::from_secs(60), PluginOptions::default());
    CacheV2::new(cacher, options, Arc::new(NoopMetrics))
}

#[test]
fn normal_get_set_delete_mget() {
    let cache = cache_with(Options {
        impenetrable_ttl: 0,
        ..Options::default()
    });

    let key = "testkey".to_string();
    let setter = Arc::new(InterfaceView::new(
        TValue {
            value: "testValue".into(),
        },
        1000,
    ));
    cache.set(&key, setter).expect("set");

    // Cached value wins: the source must not be called.
    let calls = Arc::new(AtomicUsize::new(0));
    let hit = cache
        .get(
            &key,
            source_getter(calls.clone(), 10),
            GetterOptions::default(),
        )
        .expect("get")
        .expect("value");
    assert_eq!(typed(&hit).value, "testValue");
    assert_eq!(calls.load(Ordering::SeqCst), 0);

    // Delete, then the source is called and the value round-trips.
    cache
        .delete(&key, DeleteOptions::default())
        .expect("delete");
    let refilled = cache
        .get(
            &key,
            source_getter(calls.clone(), 10),
            GetterOptions::default(),
        )
        .expect("get")
        .expect("value");
    assert_eq!(typed(&refilled).value, "testkey");
    assert_eq!(calls.load(Ordering::SeqCst), 1);

    // MGet: three of four keys are missing, all get sourced.
    let query = [
        "k1".to_string(),
        "k2".to_string(),
        "k3".to_string(),
        "k4".to_string(),
    ];
    let mgetter: Arc<dyn SourceMGetter<String>> = Arc::new(|keys: &[String]| {
        Ok(keys
            .iter()
            .map(|key| {
                (
                    key.clone(),
                    Arc::new(InterfaceView::new(TValue { value: key.clone() }, 10)) as CacheValue,
                )
            })
            .collect())
    });
    let values = cache
        .mget(&query, mgetter, GetterOptions::default())
        .expect("mget");
    assert_eq!(values.len(), 4);
    for key in &query {
        assert_eq!(typed(&values[key]).value, *key);
    }
}

#[test]
fn source_not_found_impenetrable_ttl() {
    let cache = cache_with(Options::default());
    let calls = Arc::new(AtomicUsize::new(0));

    let first = cache
        .get(
            &"missing".to_string(),
            not_found_getter(calls.clone()),
            GetterOptions::default(),
        )
        .expect("get")
        .expect("placeholder");
    assert!(first.data().is_nil());
    assert_eq!(first.ttl(), 60);
    assert_eq!(calls.load(Ordering::SeqCst), 1);

    // Second get is served by the placeholder, source not hit again.
    let second = cache
        .get(
            &"missing".to_string(),
            not_found_getter(calls.clone()),
            GetterOptions::default(),
        )
        .expect("get")
        .expect("placeholder");
    assert!(second.data().is_nil());
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

#[test]
fn source_not_found_without_impenetrable() {
    let cache = cache_with(Options {
        impenetrable_ttl: 0,
        ..Options::default()
    });
    let calls = Arc::new(AtomicUsize::new(0));
    let result = cache
        .get(
            &"missing".to_string(),
            not_found_getter(calls.clone()),
            GetterOptions::default(),
        )
        .expect("get");
    assert!(result.is_none());
    // No placeholder was written, so the source is hit again.
    let _ = cache.get(
        &"missing".to_string(),
        not_found_getter(calls.clone()),
        GetterOptions::default(),
    );
    assert_eq!(calls.load(Ordering::SeqCst), 2);
}

#[test]
fn extend_ttl_serves_old_value_on_source_error() {
    let cache = cache_with(Options {
        extend_ttl: 10,
        ..Options::default()
    });

    // ttl 5 + extend 10 = 15, above the threshold: a normal hit.
    let source_calls = Arc::new(AtomicUsize::new(0));
    let fresh = cache
        .get(
            &"key".to_string(),
            source_getter(source_calls.clone(), 5),
            GetterOptions::default(),
        )
        .expect("get")
        .expect("value");
    // The caller receives the source value; the extended ttl lands in the cache.
    assert_eq!(fresh.ttl(), 5);
    let cached = cache
        .get(
            &"key".to_string(),
            source_getter(source_calls.clone(), 5),
            GetterOptions::default(),
        )
        .expect("get")
        .expect("value");
    let cached_ttl = cached.ttl();
    assert!((13..=15).contains(&cached_ttl), "got {cached_ttl}");

    // Overwrite the cache entry with a stale ttl: the next get re-loads, and
    // when the source fails the old value is served instead of the error.
    let cacher = LruCache::<String>::new(10, Duration::from_secs(60), PluginOptions::default());
    let stale: CacheValue = Arc::new(InterfaceView::new(
        TValue {
            value: "old".into(),
        },
        5,
    ));
    cacher.set(&"key2".to_string(), stale).expect("set");

    let failing: Arc<dyn SourceGetter<String>> =
        Arc::new(|_key: &String| Err(CacheError::Message("db down".to_string())));
    let cache2 = CacheV2::new(
        cacher,
        Options {
            extend_ttl: 10,
            ..Options::default()
        },
        Arc::new(NoopMetrics),
    );
    let old = cache2
        .get(&"key2".to_string(), failing, GetterOptions::default())
        .expect("old value served")
        .expect("value");
    assert_eq!(typed(&old).value, "old");
}

#[test]
fn singleflight_dedupes_concurrent_gets() {
    let cache = cache_with(Options {
        impenetrable_ttl: 0,
        ..Options::default()
    });
    let calls = Arc::new(AtomicUsize::new(0));
    let barrier = Arc::new(Barrier::new(8));
    let mut handles = Vec::new();
    for _ in 0..8 {
        let cache = cache.clone();
        let calls = calls.clone();
        let barrier = barrier.clone();
        handles.push(std::thread::spawn(move || {
            barrier.wait();
            let getter: Arc<dyn SourceGetter<String>> = {
                let calls = calls.clone();
                Arc::new(move |key: &String| {
                    calls.fetch_add(1, Ordering::SeqCst);
                    std::thread::sleep(Duration::from_millis(50));
                    Ok(
                        Arc::new(InterfaceView::new(TValue { value: key.clone() }, 10))
                            as CacheValue,
                    )
                })
            };
            cache
                .get(&"hot".to_string(), getter, GetterOptions::default())
                .expect("get")
        }));
    }
    for handle in handles {
        let value = handle.join().unwrap().expect("value");
        assert_eq!(typed(&value).value, "hot");
    }
    assert_eq!(calls.load(Ordering::SeqCst), 1, "source must run once");
}

#[test]
fn stats_counters_track_hits_and_misses() {
    let cacher = LruCache::<String>::new(10, Duration::from_secs(60), PluginOptions::default());
    let cache = CacheV2::new(cacher, Options::default(), Arc::new(NoopMetrics));
    let calls = Arc::new(AtomicUsize::new(0));
    let _ = cache.get(
        &"k".to_string(),
        source_getter(calls.clone(), 10),
        GetterOptions::default(),
    );
    let _ = cache.get(
        &"k".to_string(),
        source_getter(calls.clone(), 10),
        GetterOptions::default(),
    );

    let stats = cache.stats();
    let hits = stats_string_field(&stats.to_string(), "hits");
    let misses = stats_string_field(&stats.to_string(), "misses");
    assert_eq!(hits, 1);
    assert_eq!(misses, 1);
}

fn stats_string_field(stats: &str, field: &str) -> i64 {
    for part in stats.split(", ") {
        let mut pieces = part.split(": ");
        if pieces.next() == Some(field) {
            return pieces.next().unwrap_or("0").parse().unwrap_or(0);
        }
    }
    0
}

#[test]
fn source_only_skips_cache() {
    let cache = cache_with(Options::default());
    let calls = Arc::new(AtomicUsize::new(0));
    for _ in 0..3 {
        let _ = cache.get(
            &"k".to_string(),
            source_getter(calls.clone(), 10),
            GetterOptions {
                source_only: true,
                refresh: false,
            },
        );
    }
    assert_eq!(calls.load(Ordering::SeqCst), 3);
}

#[test]
fn refresh_option_populates_cache() {
    let cache = cache_with(Options::default());
    let calls = Arc::new(AtomicUsize::new(0));
    let getter = source_getter(calls.clone(), 10);
    let _ = cache.get(
        &"k".to_string(),
        getter.clone(),
        GetterOptions {
            source_only: false,
            refresh: true,
        },
    );
    // A refresh populates the cache, so the next plain get hits it.
    let _ = cache.get(&"k".to_string(), getter, GetterOptions::default());
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

#[test]
fn empty_key_rejected() {
    let cache = cache_with(Options::default());
    let calls = Arc::new(AtomicUsize::new(0));
    match cache.get(
        &"".to_string(),
        source_getter(calls.clone(), 10),
        GetterOptions::default(),
    ) {
        Err(CacheError::ZeroKeys) => {}
        Err(other) => panic!("unexpected error {other}"),
        Ok(_) => panic!("empty key accepted"),
    }
}

#[test]
fn mget_uses_cached_hits() {
    let cache = cache_with(Options {
        impenetrable_ttl: 0,
        ..Options::default()
    });
    cache
        .set(
            &"hit".to_string(),
            Arc::new(InterfaceView::new(
                TValue {
                    value: "cached".into(),
                },
                100,
            )),
        )
        .unwrap();

    let source_keys = Arc::new(Mutex::new(Vec::new()));
    let mgetter: Arc<dyn SourceMGetter<String>> = {
        let source_keys = source_keys.clone();
        Arc::new(move |keys: &[String]| {
            source_keys.lock().unwrap().extend(keys.iter().cloned());
            Ok(HashMap::new())
        })
    };
    let values = cache
        .mget(
            &["hit".to_string(), "miss".to_string()],
            mgetter,
            GetterOptions::default(),
        )
        .expect("mget");
    assert_eq!(*source_keys.lock().unwrap(), vec!["miss".to_string()]);
    assert_eq!(typed(&values["hit"]).value, "cached");
    // No impenetrable TTL: the missing key is simply absent.
    assert!(!values.contains_key("miss"));
}

#[test]
fn report_thread_reports_and_stops() {
    let cacher = LruCache::<String>::new(10, Duration::from_secs(60), PluginOptions::default());
    let cache = CacheV2::new(
        cacher,
        Options {
            report_duration: Duration::from_millis(20),
            ..Options::default()
        },
        Arc::new(NoopMetrics),
    );
    std::thread::sleep(Duration::from_millis(80));
    cache.stop();
}
