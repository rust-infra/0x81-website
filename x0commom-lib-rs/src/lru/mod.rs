mod list;
mod lru1;
mod lruk;
mod size_checker;

pub use lru1::{Lru1, LruOptions, TimeoutCallback};
pub use lruk::{LruK, LruKConfig};

use std::sync::Arc;
use std::time::Duration;

use crate::cacheable::CacheData;
use crate::key::CacheKey;
use crate::stats::Stats;

/// Raw cache interface shared by `Lru1` and `LruK`.
pub trait RawLru<K: CacheKey>: Send + Sync {
    fn get(&self, key: &K) -> Option<(CacheData, Duration)>;
    fn set(&self, key: K, value: CacheData, ttl: Duration);
    fn touch(&self, key: &K, ttl: Duration);
    fn delete(&self, key: &K);
    fn mdelete(&self, keys: &[K]);
    fn all(&self) -> std::collections::HashMap<K, CacheData>;
    fn flush(&self);
    fn get_ttl(&self) -> Duration;
    fn set_stats(&self, stats: Arc<Stats>);
    fn report(&self) -> String;
    fn stop(&self);
}

impl<K: CacheKey> RawLru<K> for Lru1<K> {
    fn get(&self, key: &K) -> Option<(CacheData, Duration)> {
        Lru1::get(self, key)
    }

    fn set(&self, key: K, value: CacheData, ttl: Duration) {
        Lru1::set(self, key, value, ttl);
    }

    fn touch(&self, key: &K, ttl: Duration) {
        Lru1::touch(self, key, ttl);
    }

    fn delete(&self, key: &K) {
        Lru1::delete(self, key);
    }

    fn mdelete(&self, keys: &[K]) {
        Lru1::mdelete(self, keys);
    }

    fn all(&self) -> std::collections::HashMap<K, CacheData> {
        Lru1::all(self)
    }

    fn flush(&self) {
        Lru1::flush(self);
    }

    fn get_ttl(&self) -> Duration {
        Lru1::get_ttl(self)
    }

    fn set_stats(&self, stats: Arc<Stats>) {
        Lru1::set_stats(self, stats);
    }

    fn report(&self) -> String {
        Lru1::report(self)
    }

    fn stop(&self) {
        Lru1::stop(self);
    }
}

impl<K: CacheKey> RawLru<K> for LruK<K> {
    fn get(&self, key: &K) -> Option<(CacheData, Duration)> {
        LruK::get(self, key)
    }

    fn set(&self, key: K, value: CacheData, ttl: Duration) {
        LruK::set(self, key, value, ttl);
    }

    fn touch(&self, key: &K, ttl: Duration) {
        LruK::touch(self, key, ttl);
    }

    fn delete(&self, key: &K) {
        LruK::delete(self, key);
    }

    fn mdelete(&self, keys: &[K]) {
        LruK::mdelete(self, keys);
    }

    fn all(&self) -> std::collections::HashMap<K, CacheData> {
        LruK::all(self)
    }

    fn flush(&self) {
        LruK::flush(self);
    }

    fn get_ttl(&self) -> Duration {
        LruK::get_ttl(self)
    }

    fn set_stats(&self, stats: Arc<Stats>) {
        LruK::set_stats(self, stats);
    }

    fn report(&self) -> String {
        LruK::report(self)
    }

    fn stop(&self) {
        LruK::stop(self);
    }
}
