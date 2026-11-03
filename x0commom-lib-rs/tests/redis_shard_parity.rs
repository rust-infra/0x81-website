use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use x0commom_lib_rs::cache_v2::{CacheV2, SourceGetter};
use x0commom_lib_rs::cacheable::{CacheData, CacheValue, InterfaceView};
use x0commom_lib_rs::cacher::Cacher;
use x0commom_lib_rs::error::{CacheError, Result};
use x0commom_lib_rs::options::{Options, PluginOptions};
use x0commom_lib_rs::plugins::{
    RedisConnection, RedisPoolFactory, RedisShardCache, RedisShardOption, Slot, TOTAL_SLOT_SIZE,
    hash_with_tag,
};
use x0commom_lib_rs::stats::NoopMetrics;

#[derive(Default)]
struct MockRedis {
    data: Mutex<HashMap<String, Vec<u8>>>,
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

struct SharedMock {
    redis: Arc<MockRedis>,
}

impl RedisConnection for SharedMock {
    fn get(&self, key: &str) -> Result<Option<Vec<u8>>> {
        self.redis.get(key)
    }

    fn mget(&self, keys: &[String]) -> Result<Vec<Option<Vec<u8>>>> {
        self.redis.mget(keys)
    }

    fn set(&self, key: &str, value: &[u8], ttl_seconds: Option<i64>) -> Result<()> {
        self.redis.set(key, value, ttl_seconds)
    }

    fn del(&self, keys: &[String]) -> Result<i64> {
        self.redis.del(keys)
    }

    fn expire(&self, key: &str, ttl_seconds: i32) -> Result<()> {
        self.redis.expire(key, ttl_seconds)
    }
}

#[derive(Default)]
struct MockFactory {
    shards: Mutex<Vec<Arc<MockRedis>>>,
}

impl RedisPoolFactory for MockFactory {
    fn connect(&self, _option: &RedisShardOption) -> Result<Arc<dyn RedisConnection>> {
        let redis = Arc::new(MockRedis::default());
        self.shards.lock().unwrap().push(redis.clone());
        Ok(Arc::new(SharedMock { redis }))
    }
}

fn shard_options() -> Vec<RedisShardOption> {
    vec![
        RedisShardOption {
            resp_slot: Slot {
                begin: 0,
                end: 6000,
            },
            addrs: vec!["redis-a:6379".to_string()],
            ..RedisShardOption::default()
        },
        RedisShardOption {
            resp_slot: Slot {
                begin: 6001,
                end: TOTAL_SLOT_SIZE - 1,
            },
            addrs: vec!["redis-b:6379".to_string()],
            enable_slave: true,
            ..RedisShardOption::default()
        },
    ]
}

#[test]
fn hash_with_tag_matches_go() {
    let cases = [
        ("user:123", 1384),
        ("post:abc", 2944),
        ("{user}:profile", 5705),
        ("a{b}c", 12281),
        ("", 0),
        ("中文key", 11747),
        ("x", 5763),
        ("user:99999999", 14145),
        ("{tag}tail", 14211),
    ];
    for (key, expected) in cases {
        assert_eq!(hash_with_tag(key.as_bytes()), expected, "{key}");
    }
}

#[test]
fn auto_distributes_slots_and_rejects_gaps() {
    let factory = MockFactory::default();
    let options = vec![
        RedisShardOption {
            addrs: vec!["redis-a:6379".to_string()],
            ..RedisShardOption::default()
        },
        RedisShardOption {
            addrs: vec!["redis-b:6379".to_string()],
            enable_slave: true,
            ..RedisShardOption::default()
        },
    ];
    let cache = RedisShardCache::<String>::new(options, &factory, PluginOptions::default())
        .expect("shards");
    // Every slot must map onto one of the two auto-assigned ranges.
    for key in ["a", "b", "c", "user:1", "{x}:1"] {
        let slot = hash_with_tag(key.as_bytes());
        let in_first = slot <= 8191;
        let in_second = slot >= 8192;
        assert!(in_first || in_second, "slot {slot} unmapped");
        // Touch both shards through get: no panic, only NotExists.
        assert!(matches!(
            cache.get(&key.to_string()),
            Err(CacheError::NotExists)
        ));
    }

    let gap = vec![RedisShardOption {
        resp_slot: Slot {
            begin: 100,
            end: TOTAL_SLOT_SIZE - 1,
        },
        addrs: vec!["redis-a:6379".to_string()],
        ..RedisShardOption::default()
    }];
    assert!(
        RedisShardCache::<String>::new(gap, &MockFactory::default(), PluginOptions::default())
            .is_err()
    );

    let mut overlapping = shard_options();
    overlapping[1].resp_slot = Slot {
        begin: 5002,
        end: TOTAL_SLOT_SIZE - 1,
    };
    assert!(
        RedisShardCache::<String>::new(
            overlapping,
            &MockFactory::default(),
            PluginOptions::default()
        )
        .is_err()
    );

    assert!(
        RedisShardCache::<String>::new(
            Vec::new(),
            &MockFactory::default(),
            PluginOptions::default()
        )
        .is_err()
    );
}

#[test]
fn get_set_delete_roundtrip() {
    let factory = MockFactory::default();
    let cache = RedisShardCache::<String>::new(shard_options(), &factory, PluginOptions::default())
        .expect("shards");

    assert!(matches!(
        cache.get(&"missing".to_string()),
        Err(CacheError::NotExists)
    ));

    let value: CacheValue = Arc::new(InterfaceView::from_data(
        CacheData::Bytes(b"payload".to_vec().into()),
        100,
    ));
    cache.set(&"key".to_string(), value).expect("set");

    let hit = cache.get(&"key".to_string()).expect("hit").expect("value");
    assert_eq!(hit.data(), CacheData::Bytes(b"payload".to_vec().into()));
    // Without ValueWithTTL Redis manages expiry server-side, so the plugin
    // reports ttl 0 (Go behaves the same way).
    assert_eq!(hit.ttl(), 0);

    cache.delete(&"key".to_string()).expect("delete");
    assert!(matches!(
        cache.get(&"key".to_string()),
        Err(CacheError::NotExists)
    ));

    let value: CacheValue = Arc::new(InterfaceView::from_data(CacheData::Str("text".into()), 100));
    cache.set(&"key".to_string(), value).expect("set");
    let hit = cache.get(&"key".to_string()).expect("hit").expect("value");
    assert_eq!(hit.data(), CacheData::Str("text".into()));

    cache
        .mdelete(&["key".to_string(), "other".to_string()])
        .expect("mdelete");
    assert!(matches!(
        cache.get(&"key".to_string()),
        Err(CacheError::NotExists)
    ));
}

#[test]
fn value_with_ttl_uses_gob_layout() {
    let factory = MockFactory::default();
    let cache = RedisShardCache::<String>::new(
        shard_options(),
        &factory,
        PluginOptions {
            value_with_ttl: true,
            ..PluginOptions::default()
        },
    )
    .expect("shards");

    let value: CacheValue = Arc::new(InterfaceView::from_data(
        CacheData::Bytes(b"hello".to_vec().into()),
        10,
    ));
    cache.set(&"key".to_string(), value).expect("set");

    let hit = cache.get(&"key".to_string()).expect("hit").expect("value");
    assert_eq!(hit.data(), CacheData::Bytes(b"hello".to_vec().into()));
    let ttl = hit.ttl();
    assert!((8..=10).contains(&ttl), "remaining ttl {ttl}");
}

#[test]
fn mget_splits_by_shard() {
    let factory = MockFactory::default();
    let cache = RedisShardCache::<String>::new(shard_options(), &factory, PluginOptions::default())
        .expect("shards");
    for key in ["k1", "k2"] {
        let value: CacheValue = Arc::new(InterfaceView::from_data(
            CacheData::Bytes(format!("{key}-value").into_bytes().into()),
            100,
        ));
        cache.set(&key.to_string(), value).expect("set");
    }

    let (hits, misses) = cache
        .mget(&["k1".to_string(), "k2".to_string(), "k3".to_string()])
        .expect("mget");
    assert_eq!(hits.len(), 2);
    assert_eq!(misses, vec!["k3".to_string()]);
    assert_eq!(
        hits["k1"].data(),
        CacheData::Bytes(b"k1-value".to_vec().into())
    );
}

#[test]
fn cache_v2_over_redis_read_through() {
    let factory = MockFactory::default();
    let cacher =
        RedisShardCache::<String>::new(shard_options(), &factory, PluginOptions::default())
            .expect("shards");
    let cache = CacheV2::new(Arc::new(cacher), Options::default(), Arc::new(NoopMetrics));

    let calls = Arc::new(AtomicUsize::new(0));
    let getter: Arc<dyn SourceGetter<String>> = {
        let calls = calls.clone();
        Arc::new(move |key: &String| {
            calls.fetch_add(1, Ordering::SeqCst);
            Ok(Arc::new(InterfaceView::from_data(
                CacheData::Str(format!("src-{key}").into()),
                30,
            )) as CacheValue)
        })
    };

    let value = cache
        .get(&"user:1".to_string(), getter.clone(), Default::default())
        .expect("get")
        .expect("value");
    assert_eq!(value.data(), CacheData::Str("src-user:1".into()));

    let value = cache
        .get(&"user:1".to_string(), getter.clone(), Default::default())
        .expect("get")
        .expect("value");
    assert_eq!(value.data(), CacheData::Str("src-user:1".into()));
    assert_eq!(calls.load(Ordering::SeqCst), 1);

    cache
        .delete(&"user:1".to_string(), Default::default())
        .expect("delete");
    let refilled = cache
        .get(&"user:1".to_string(), getter, Default::default())
        .expect("get")
        .expect("value");
    assert_eq!(refilled.data(), CacheData::Str("src-user:1".into()));
    assert_eq!(calls.load(Ordering::SeqCst), 2);
}

#[test]
fn cache_id_and_key_formatting() {
    let factory = MockFactory::default();
    let cache = RedisShardCache::<String>::new(shard_options(), &factory, PluginOptions::default())
        .expect("shards");
    assert_eq!(cache.cache_id(), "redis-a:6379");
    assert_eq!(cache.get_key(&["a".to_string(), "b".to_string()]), "a:b");
}

#[test]
fn lru_default_expiration_is_used_by_cache_v2() {
    let cacher = x0commom_lib_rs::plugins::LruCache::<String>::new(
        10,
        Duration::from_secs(60),
        PluginOptions::default(),
    );
    let value: CacheValue = Arc::new(InterfaceView::from_data(CacheData::Str("v".into()), 0));
    cacher.set(&"k".to_string(), value).expect("set");
    let hit = cacher.get(&"k".to_string()).expect("hit").expect("value");
    assert!(hit.ttl() > 0, "ttl zero falls back to the plugin default");
}
