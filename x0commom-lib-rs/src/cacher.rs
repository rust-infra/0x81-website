use std::collections::HashMap;
use std::sync::Arc;

use crate::cacheable::CacheValue;
use crate::error::Result;
use crate::key::CacheKey;
use crate::stats::Stats;

/// Cache backend plugin. Mirrors `ycache.Cacher` for the non-deprecated
/// `Cacheable` API.
pub trait Cacher<K: CacheKey>: Send + Sync {
    fn get(&self, key: &K) -> Result<Option<CacheValue>>;

    fn mget(&self, keys: &[K]) -> Result<(HashMap<K, CacheValue>, Vec<K>)>;

    fn set(&self, key: &K, value: CacheValue) -> Result<()>;

    fn delete(&self, key: &K) -> Result<()>;

    fn mdelete(&self, keys: &[K]) -> Result<()>;

    fn touch(&self, _key: &K, _ttl: i32) -> Result<()> {
        Ok(())
    }

    fn stop(&self) -> Result<()> {
        Ok(())
    }

    fn cache_id(&self) -> String;

    fn get_key(&self, keys: &[K]) -> String;

    fn set_stats(&self, stats: Arc<Stats>);
}
