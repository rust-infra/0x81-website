use std::sync::{Arc, Mutex};
use std::time::Duration;

use x0commom_lib_rs::cacheable::CacheData;
use x0commom_lib_rs::lru::{Lru1, LruK, LruKConfig, LruOptions};

fn data(value: &str) -> CacheData {
    CacheData::from_str(value)
}

#[test]
fn lru1_get_set_and_default_ttl() {
    let lru = Lru1::<String>::new(1000, Duration::from_secs(600), LruOptions::default());
    lru.set("testKey".to_string(), data("testValue"), Duration::ZERO);

    let (value, ttl) = lru.get(&"testKey".to_string()).expect("hit");
    assert_eq!(value, data("testValue"));
    assert!(ttl <= Duration::from_secs(600) && ttl > Duration::from_secs(590));
}

#[test]
fn lru1_eviction_calls_callback() {
    let evicted: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let captured = evicted.clone();
    let options = LruOptions {
        timeout_callback: Some(Arc::new(move |key: &String, _value: &CacheData| {
            captured.lock().unwrap().push(key.clone());
        })),
        retire_interval: Duration::ZERO,
    };
    let lru = Lru1::<String>::new(1, Duration::from_secs(600), options);

    lru.set(
        "testKey1".to_string(),
        data("testValue1"),
        Duration::from_secs(10),
    );
    lru.set("testKey2".to_string(), data("testValue2"), Duration::ZERO);
    lru.set(
        "testKey2".to_string(),
        data("testValue2"),
        Duration::from_secs(10),
    );

    assert!(lru.get(&"testKey1".to_string()).is_none());
    let (value, ttl) = lru.get(&"testKey2".to_string()).expect("hit");
    assert_eq!(value, data("testValue2"));
    assert!(ttl <= Duration::from_secs(10) && ttl > Duration::ZERO);
    assert_eq!(*evicted.lock().unwrap(), vec!["testKey1".to_string()]);
}

#[test]
fn lru1_expires_and_deletes() {
    let lru = Lru1::<String>::new(1000, Duration::from_secs(600), LruOptions::default());
    lru.set(
        "testKey".to_string(),
        data("testValue"),
        Duration::from_millis(50),
    );
    std::thread::sleep(Duration::from_millis(80));
    assert!(lru.get(&"testKey".to_string()).is_none());

    lru.set(
        "testKey".to_string(),
        data("testValue"),
        Duration::from_secs(600),
    );
    lru.delete(&"testKeyNotExists".to_string());
    lru.delete(&"testKey".to_string());
    assert!(lru.get(&"testKey".to_string()).is_none());
}

#[test]
fn lru1_flush_and_all() {
    let lru = Lru1::<String>::new(10, Duration::from_secs(600), LruOptions::default());
    lru.set("a".to_string(), data("1"), Duration::ZERO);
    lru.set("b".to_string(), data("2"), Duration::ZERO);
    assert_eq!(lru.all().len(), 2);
    lru.flush();
    assert!(lru.all().is_empty());
    assert!(lru.get(&"a".to_string()).is_none());
}

/// Mirrors Go `lru.Test_lruK_Get`, including the exact level sizes.
#[test]
fn lruk_level_promotion_and_retire() {
    let config = LruKConfig {
        max_size: 100,
        max_level: 3,
        max_lens: vec![60, 30, 10],
        promote_thresholds: vec![0, 2, 0],
        retire_rates: vec![0, 10, 10],
        retire_interval: Duration::ZERO,
    };
    let lruk = LruK::<String>::new_with_config(Duration::ZERO, config, LruOptions::default());

    let keys: Vec<String> = (1..=100).map(|index| index.to_string()).collect();
    for key in &keys {
        lruk.set(key.clone(), data(key), Duration::ZERO);
    }

    let levels = lruk_levels(&lruk);
    assert_eq!(levels, (60, 0, 0), "after fill");

    for key in &keys[..40] {
        assert!(lruk.get(key).is_none(), "{key} should be evicted");
    }
    for key in &keys[40..] {
        let (value, _) = lruk.get(key).expect("hit");
        assert_eq!(value, data(key));
    }
    assert_eq!(lruk_levels(&lruk), (30, 30, 0), "after level1 promotion");

    for _ in 0..2 {
        for key in &keys[70..80] {
            let (value, _) = lruk.get(key).expect("hit");
            assert_eq!(value, data(key));
        }
    }
    for key in &keys[70..80] {
        let (value, _) = lruk.get(key).expect("hit");
        assert_eq!(value, data(key));
    }
    assert_eq!(lruk_levels(&lruk), (30, 20, 10), "after level2 promotion");

    lruk.retire_level();
    assert_eq!(lruk_levels(&lruk), (32, 19, 9), "after first retire");

    lruk.retire_level();
    assert_eq!(lruk_levels(&lruk), (33, 18, 9), "after second retire");
}

fn lruk_levels(lruk: &LruK<String>) -> (usize, usize, usize) {
    let report = lruk.report();
    let parse = |needle: &str| -> usize {
        let start = report.find(needle).expect(needle) + needle.len();
        let rest = &report[start..];
        let end = rest
            .find(|c: char| !c.is_ascii_digit())
            .unwrap_or(rest.len());
        rest[..end].parse().expect("number")
    };
    (parse("level 0: "), parse("level 1: "), parse("level 2: "))
}
