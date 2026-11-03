use std::collections::HashMap;
use std::hash::Hash;
use std::sync::Arc;
use std::time::Duration;

use parking_lot::RwLock;

use crate::cacheable::{CacheData, CacheValue, InterfaceView};
use crate::cacher::Cacher;
use crate::error::{CacheError, Result};
use crate::key::{CacheKey, KeyFormatter};
use crate::lru::{Lru1, LruK, LruOptions, RawLru};
use crate::options::PluginOptions;
use crate::stats::Stats;

#[derive(Clone, Eq, PartialEq, Hash, Debug)]
pub enum LruKey<K: CacheKey> {
    Raw(K),
    Formatted(String),
}

impl<K: CacheKey> CacheKey for LruKey<K> {
    fn as_key_string(&self) -> String {
        match self {
            LruKey::Raw(key) => key.as_key_string(),
            LruKey::Formatted(key) => key.clone(),
        }
    }
}

/// `plugins.LRUCache`: local cache plugin backed by LRU1 or LRU-K.
pub struct LruCache<K: CacheKey> {
    lru: Arc<dyn RawLru<LruKey<K>>>,
    options: PluginOptions<K>,
    stats: RwLock<Option<Arc<Stats>>>,
}

impl<K: CacheKey> LruCache<K> {
    pub fn new(max_len: usize, expiration: Duration, options: PluginOptions<K>) -> Arc<Self> {
        let lru_options = LruOptions {
            timeout_callback: None,
            retire_interval: options.retire_interval,
        };
        let lru: Arc<dyn RawLru<LruKey<K>>> = if options.use_lruk {
            LruK::new(max_len, expiration, lru_options)
        } else {
            Lru1::new(max_len, expiration, lru_options)
        };
        Arc::new(Self {
            lru,
            options,
            stats: RwLock::new(None),
        })
    }

    fn translate(&self, key: &K) -> LruKey<K> {
        match &self.options.key_formatter {
            Some(formatter) => LruKey::Formatted(formatter.format(key)),
            None => LruKey::Raw(key.clone()),
        }
    }

    pub fn flush(&self) -> Result<()> {
        self.lru.flush();
        Ok(())
    }

    pub fn raw_all(&self) -> HashMap<LruKey<K>, CacheData> {
        self.lru.all()
    }
}

impl<K: CacheKey> Cacher<K> for LruCache<K> {
    fn get(&self, key: &K) -> Result<Option<CacheValue>> {
        let translated = self.translate(key);
        Ok(self.lru.get(&translated).map(|(data, ttl)| {
            Arc::new(InterfaceView::from_data(data, ttl.as_secs() as i32)) as CacheValue
        }))
    }

    fn mget(&self, keys: &[K]) -> Result<(HashMap<K, CacheValue>, Vec<K>)> {
        let mut hits = HashMap::with_capacity(keys.len());
        let mut misses = Vec::new();
        for key in keys {
            let translated = self.translate(key);
            match self.lru.get(&translated) {
                Some((data, ttl)) => {
                    hits.insert(
                        key.clone(),
                        Arc::new(InterfaceView::from_data(data, ttl.as_secs() as i32))
                            as CacheValue,
                    );
                }
                None => misses.push(key.clone()),
            }
        }
        Ok((hits, misses))
    }

    fn set(&self, key: &K, value: CacheValue) -> Result<()> {
        let translated = self.translate(key);
        let ttl = value.ttl();
        let ttl = if ttl < 0 {
            Duration::from_nanos(1)
        } else {
            Duration::from_secs(ttl as u64)
        };
        self.lru.set(translated, value.data(), ttl);
        Ok(())
    }

    fn delete(&self, key: &K) -> Result<()> {
        let translated = self.translate(key);
        self.lru.delete(&translated);
        Ok(())
    }

    fn mdelete(&self, keys: &[K]) -> Result<()> {
        let translated: Vec<LruKey<K>> = keys.iter().map(|key| self.translate(key)).collect();
        self.lru.mdelete(&translated);
        Ok(())
    }

    fn touch(&self, key: &K, ttl: i32) -> Result<()> {
        let translated = self.translate(key);
        let ttl = if ttl < 0 {
            Duration::from_nanos(1)
        } else {
            Duration::from_secs(ttl as u64)
        };
        self.lru.touch(&translated, ttl);
        Ok(())
    }

    fn stop(&self) -> Result<()> {
        self.flush()
    }

    fn cache_id(&self) -> String {
        "LRUCache".to_string()
    }

    fn get_key(&self, keys: &[K]) -> String {
        keys.iter()
            .map(|key| match &self.options.key_formatter {
                Some(formatter) => formatter.format(key),
                None => key.as_key_string(),
            })
            .collect::<Vec<_>>()
            .join(":")
    }

    fn set_stats(&self, stats: Arc<Stats>) {
        *self.stats.write() = Some(stats.clone());
        self.lru.set_stats(stats);
    }
}

impl<K: CacheKey> Drop for LruCache<K> {
    fn drop(&mut self) {
        self.lru.stop();
    }
}

impl<K: CacheKey> std::fmt::Debug for LruCache<K> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("LruCache")
    }
}

/// Helper for tests and callers that only need the default formatter.
pub fn string_key<K: CacheKey>(key: &K) -> String {
    key.as_key_string()
}

/// Kept for API symmetry with `plugins.NewStringFormatter`.
pub fn new_string_formatter<K: CacheKey>() -> Arc<dyn KeyFormatter<K>> {
    Arc::new(crate::key::DefaultKeyFormatter)
}

#[allow(dead_code)]
fn assert_error_is_send(_: &CacheError) {}
