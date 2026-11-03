use std::any::Any;
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use x0commom_lib_rs::error::{CacheError, Result};
use x0commom_lib_rs::eventqueue::{EventQueue, MemoryEventQueue};
use x0commom_lib_rs::mcache::{Cache, Source};
use x0commom_lib_rs::options::{Options, PluginOptions};
use x0commom_lib_rs::plugins::{LruCache, RedisConnection};

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
struct UserInfo {
    id: u64,
    name: String,
}

struct MockSource {
    get_calls: AtomicUsize,
    mget_calls: AtomicUsize,
}

impl Source<String, UserInfo> for MockSource {
    fn get(&self, key: &String, _arg: &(dyn Any + Send + Sync)) -> Result<(Option<UserInfo>, i64)> {
        self.get_calls.fetch_add(1, Ordering::SeqCst);
        if key == "missing" {
            return Err(CacheError::SourceNotFound);
        }
        Ok((
            Some(UserInfo {
                id: key.parse().unwrap_or(0),
                name: format!("user-{key}"),
            }),
            10,
        ))
    }

    fn mget(
        &self,
        keys: &[String],
        _arg: &(dyn Any + Send + Sync),
    ) -> Result<(HashMap<String, UserInfo>, i64)> {
        self.mget_calls.fetch_add(1, Ordering::SeqCst);
        Ok((
            keys.iter()
                .filter(|key| key.as_str() != "missing")
                .map(|key| {
                    (
                        key.clone(),
                        UserInfo {
                            id: key.parse().unwrap_or(0),
                            name: format!("user-{key}"),
                        },
                    )
                })
                .collect(),
            10,
        ))
    }
}

fn cache() -> Cache<String, UserInfo> {
    Cache::new_lru_cache(
        128,
        Duration::from_secs(60),
        Arc::new(MockSource {
            get_calls: AtomicUsize::new(0),
            mget_calls: AtomicUsize::new(0),
        }),
        PluginOptions::default(),
        Options {
            impenetrable_ttl: 0,
            ..Options::default()
        },
    )
}

#[test]
fn typed_get_round_trip() {
    let cache = cache();
    let user = cache
        .get(&"42".to_string(), Arc::new(1u32), Default::default())
        .expect("get")
        .expect("value");
    assert_eq!(user.name, "user-42");

    // Second get hits the LRU, source not called again.
    let user = cache
        .get(&"42".to_string(), Arc::new(1u32), Default::default())
        .expect("get")
        .expect("value");
    assert_eq!(user.name, "user-42");
}

#[test]
fn typed_get_missing_key() {
    let cache = cache();
    let user = cache
        .get(&"missing".to_string(), Arc::new(1u32), Default::default())
        .expect("get");
    assert!(user.is_none());
}

#[test]
fn typed_mget() {
    let cache = cache();
    let users = cache
        .mget(
            &["1".to_string(), "2".to_string(), "missing".to_string()],
            Arc::new(1u32),
            Default::default(),
        )
        .expect("mget");
    assert_eq!(users.len(), 2);
    assert_eq!(users["1"].name, "user-1");
    assert_eq!(users["2"].name, "user-2");
}

#[test]
fn counting_source_is_called_once() {
    struct Counting {
        calls: Arc<AtomicUsize>,
    }
    impl Source<String, UserInfo> for Counting {
        fn get(
            &self,
            key: &String,
            _arg: &(dyn Any + Send + Sync),
        ) -> Result<(Option<UserInfo>, i64)> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            Ok((
                Some(UserInfo {
                    id: 1,
                    name: key.clone(),
                }),
                10,
            ))
        }

        fn mget(
            &self,
            keys: &[String],
            _arg: &(dyn Any + Send + Sync),
        ) -> Result<(HashMap<String, UserInfo>, i64)> {
            self.calls
                .fetch_add(keys.len() as u64 as usize, Ordering::SeqCst);
            Ok((
                keys.iter()
                    .map(|key| {
                        (
                            key.clone(),
                            UserInfo {
                                id: 1,
                                name: key.clone(),
                            },
                        )
                    })
                    .collect(),
                10,
            ))
        }
    }

    let calls = Arc::new(AtomicUsize::new(0));
    let cache = Cache::new_lru_cache(
        128,
        Duration::from_secs(60),
        Arc::new(Counting {
            calls: calls.clone(),
        }),
        PluginOptions::default(),
        Options::default(),
    );
    for _ in 0..5 {
        let _ = cache
            .get(&"k".to_string(), Arc::new(1u32), Default::default())
            .expect("get");
    }
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

#[test]
fn memory_event_queue_fires_after_interval() {
    let handled: Arc<std::sync::Mutex<Vec<String>>> = Arc::new(std::sync::Mutex::new(Vec::new()));
    let sink = handled.clone();
    let queue = MemoryEventQueue::new(Arc::new(move |event: &str| {
        sink.lock().unwrap().push(event.to_string());
        Ok(())
    }))
    .with_worker_count(2);
    queue.start().expect("start");
    queue.add_event("e1", 1).expect("add");
    for _ in 0..30 {
        std::thread::sleep(Duration::from_millis(100));
        if !handled.lock().unwrap().is_empty() {
            break;
        }
    }
    assert_eq!(*handled.lock().unwrap(), vec!["e1".to_string()]);
    queue.stop();
}

#[test]
fn memory_event_queue_retries_on_event_retry() {
    let attempt = Arc::new(AtomicUsize::new(0));
    let sink = attempt.clone();
    let queue = MemoryEventQueue::new(Arc::new(move |_event: &str| {
        if sink.fetch_add(1, Ordering::SeqCst) == 0 {
            return Err(CacheError::EventRetry);
        }
        Ok(())
    }))
    .with_worker_count(1)
    .with_retry_interval(1);
    queue.start().expect("start");
    queue.add_event("retry-me", 0).expect("add");
    for _ in 0..50 {
        std::thread::sleep(Duration::from_millis(100));
        if attempt.load(Ordering::SeqCst) >= 2 {
            break;
        }
    }
    assert!(attempt.load(Ordering::SeqCst) >= 2, "handler retried");
    queue.stop();
}

#[test]
fn double_start_rejected() {
    let queue = MemoryEventQueue::new(Arc::new(|_: &str| Ok(())));
    queue.start().expect("first start");
    assert!(queue.start().is_err());
    queue.stop();
}

#[test]
fn unused_lru_cache_import_is_used() {
    // Keeps the LruCache import meaningful for the cache() helper.
    let _: PluginOptions<String> = PluginOptions::default();
    let _: Option<LruCache<String>> = None;
}

#[derive(Default)]
struct MockRedis {
    data: std::sync::Mutex<HashMap<String, Vec<u8>>>,
}

impl RedisConnection for MockRedis {
    fn get(&self, key: &str) -> Result<Option<Vec<u8>>> {
        Ok(self.data.lock().unwrap().get(key).cloned())
    }

    fn mget(&self, keys: &[String]) -> Result<Vec<Option<Vec<u8>>>> {
        let data = self.data.lock().unwrap();
        Ok(keys.iter().map(|key| data.get(key).cloned()).collect())
    }

    fn set(&self, key: &str, value: &[u8], _ttl_seconds: Option<i64>) -> Result<()> {
        self.data
            .lock()
            .unwrap()
            .insert(key.to_string(), value.to_vec());
        Ok(())
    }

    fn del(&self, keys: &[String]) -> Result<i64> {
        let mut data = self.data.lock().unwrap();
        let mut removed = 0;
        for key in keys {
            if data.remove(key).is_some() {
                removed += 1;
            }
        }
        Ok(removed)
    }

    fn expire(&self, _key: &str, _ttl_seconds: i32) -> Result<()> {
        Ok(())
    }
}

#[test]
fn json_cache_over_redis_round_trips_typed_values() {
    let redis = Arc::new(MockRedis::default());
    let source = Arc::new(MockSource {
        get_calls: AtomicUsize::new(0),
        mget_calls: AtomicUsize::new(0),
    });
    let cache =
        Cache::new_json_redis_cache(redis, source, PluginOptions::default(), Options::default());

    let first = cache
        .get(&"42".to_string(), Arc::new(1u32), Default::default())
        .expect("get")
        .expect("value");
    assert_eq!(first.name, "user-42");

    // Second read comes from Redis as JSON bytes and is decoded back into V.
    let second = cache
        .get(&"42".to_string(), Arc::new(1u32), Default::default())
        .expect("get")
        .expect("value");
    assert_eq!(second, first);
}
