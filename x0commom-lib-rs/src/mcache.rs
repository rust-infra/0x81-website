use std::any::Any;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use crate::cache_v2::{CacheV2, SourceGetter, SourceMGetter};
use crate::cacheable::{CacheValue, InterfaceView};
use crate::cacher::Cacher;
use crate::codec::JsonCodec;
use crate::error::Result;
use crate::key::CacheKey;
use crate::options::{DeleteOptions, GetterOptions, Options, PluginOptions};
use crate::plugins::{LruCache, RedisConnection, RedisShardCache};
use crate::stats::{MetricsSink, NoopMetrics};

/// `mcache.Source`: typed source lookup used by the ergonomic wrapper.
pub trait Source<K: CacheKey, V>: Send + Sync {
    fn get(&self, key: &K, arg: &(dyn Any + Send + Sync)) -> Result<(Option<V>, i64)>;

    fn mget(&self, keys: &[K], arg: &(dyn Any + Send + Sync)) -> Result<(HashMap<K, V>, i64)>;
}

type JsonWrap<V> = fn(V, i32) -> CacheValue;
type JsonDecode<V> = fn(&[u8]) -> Option<V>;

fn json_wrap<V: serde::Serialize + PartialEq + Send + Sync + 'static>(
    value: V,
    ttl: i32,
) -> CacheValue {
    Arc::new(InterfaceView::new_json(value, ttl))
}

fn json_decode<V: serde::de::DeserializeOwned>(bytes: &[u8]) -> Option<V> {
    serde_json::from_slice(bytes).ok()
}

/// `mcache.Cache`: typed `Get`/`MGet` over `CacheV2`.
pub struct Cache<K: CacheKey, V: Clone + PartialEq + Send + Sync + 'static> {
    yc: Arc<CacheV2<K>>,
    src: Arc<dyn Source<K, V>>,
    json_wrap: Option<JsonWrap<V>>,
    json_decode: Option<JsonDecode<V>>,
}

impl<K: CacheKey, V: Clone + PartialEq + Send + Sync + 'static> Cache<K, V> {
    pub fn new(cacher: Arc<dyn Cacher<K>>, src: Arc<dyn Source<K, V>>, options: Options) -> Self {
        Self::new_with_metrics(cacher, src, options, Arc::new(NoopMetrics))
    }

    pub fn new_with_metrics(
        cacher: Arc<dyn Cacher<K>>,
        src: Arc<dyn Source<K, V>>,
        options: Options,
        metrics: Arc<dyn MetricsSink>,
    ) -> Self {
        Self {
            yc: CacheV2::new(cacher, options, metrics),
            src,
            json_wrap: None,
            json_decode: None,
        }
    }

    pub fn new_lru_cache(
        max_len: usize,
        expiration: Duration,
        src: Arc<dyn Source<K, V>>,
        plugin_options: PluginOptions<K>,
        options: Options,
    ) -> Self {
        let cacher = LruCache::new(max_len, expiration, plugin_options);
        Self::new(cacher, src, options)
    }

    pub fn new_redis_cache(
        connection: Arc<dyn RedisConnection>,
        src: Arc<dyn Source<K, V>>,
        plugin_options: PluginOptions<K>,
        options: Options,
    ) -> Self {
        let cacher = RedisShardCache::new_with_pool(connection, plugin_options);
        Self::new(Arc::new(cacher), src, options)
    }

    pub fn cache(&self) -> &Arc<CacheV2<K>> {
        &self.yc
    }

    fn decode(&self, value: &CacheValue) -> Option<V> {
        let data = value.data();
        if let Some(value) = data.downcast_ref::<V>() {
            return Some(value.clone());
        }
        if let Some(bytes) = data.as_bytes()
            && let Some(decode) = self.json_decode
        {
            return decode(bytes);
        }
        None
    }

    pub fn get(
        &self,
        key: &K,
        arg: Arc<dyn Any + Send + Sync>,
        options: GetterOptions,
    ) -> Result<Option<V>> {
        let src = self.src.clone();
        let wrap = self.json_wrap;
        let getter: Arc<dyn SourceGetter<K>> = Arc::new(move |key: &K| {
            let (value, ttl) = src.get(key, arg.as_ref())?;
            Ok(match value {
                Some(value) => match wrap {
                    Some(wrap) => wrap(value, ttl as i32),
                    None => Arc::new(InterfaceView::new(value, ttl as i32)),
                },
                None => Arc::new(InterfaceView::nil(ttl as i32)),
            })
        });
        let value = self.yc.get(key, getter, options)?;
        Ok(value.as_ref().and_then(|value| self.decode(value)))
    }

    pub fn mget(
        &self,
        keys: &[K],
        arg: Arc<dyn Any + Send + Sync>,
        options: GetterOptions,
    ) -> Result<HashMap<K, V>> {
        let src = self.src.clone();
        let wrap = self.json_wrap;
        let getter: Arc<dyn SourceMGetter<K>> = Arc::new(move |keys: &[K]| {
            let (values, ttl) = src.mget(keys, arg.as_ref())?;
            let mut result = HashMap::with_capacity(values.len());
            for (key, value) in values {
                result.insert(
                    key,
                    match wrap {
                        Some(wrap) => wrap(value, ttl as i32),
                        None => Arc::new(InterfaceView::new(value, ttl as i32)),
                    },
                );
            }
            Ok(result)
        });
        let values = self.yc.mget(keys, getter, options)?;
        Ok(values
            .iter()
            .filter_map(|(key, value)| self.decode(value).map(|value| (key.clone(), value)))
            .collect())
    }

    pub fn delete(&self, key: &K, options: DeleteOptions) -> Result<()> {
        self.yc.delete(key, options)
    }

    pub fn mdelete(&self, keys: &[K], options: DeleteOptions) -> Result<()> {
        self.yc.mdelete(keys, options)
    }
}

impl<K, V> Cache<K, V>
where
    K: CacheKey,
    V: serde::Serialize + serde::de::DeserializeOwned + Clone + PartialEq + Send + Sync + 'static,
{
    /// JSON-serializing LRU cache. Values are stored as JSON bytes so the same
    /// typed API also works with byte-only backends.
    pub fn new_json_lru_cache(
        max_len: usize,
        expiration: Duration,
        src: Arc<dyn Source<K, V>>,
        plugin_options: PluginOptions<K>,
        mut options: Options,
    ) -> Self {
        options.codec = Some(Arc::new(JsonCodec));
        let mut cache = Self::new_lru_cache(max_len, expiration, src, plugin_options, options);
        cache.json_wrap = Some(json_wrap::<V>);
        cache.json_decode = Some(json_decode::<V>);
        cache
    }

    /// JSON-serializing Redis cache.
    pub fn new_json_redis_cache(
        connection: Arc<dyn RedisConnection>,
        src: Arc<dyn Source<K, V>>,
        plugin_options: PluginOptions<K>,
        mut options: Options,
    ) -> Self {
        options.codec = Some(Arc::new(JsonCodec));
        let mut cache = Self::new_redis_cache(connection, src, plugin_options, options);
        cache.json_wrap = Some(json_wrap::<V>);
        cache.json_decode = Some(json_decode::<V>);
        cache
    }
}
