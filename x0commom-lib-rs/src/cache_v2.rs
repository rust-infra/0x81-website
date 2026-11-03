use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use parking_lot::{Mutex, RwLock};

use crate::cacheable::{CacheData, CacheValue, InterfaceView};
use crate::cacher::Cacher;
use crate::error::{CacheError, Result};
use crate::eventqueue::{EventQueue, MemoryEventQueue};
use crate::global_sync::GlobalSync;
use crate::key::CacheKey;
use crate::options::{DeleteOptions, GetterOptions, Options};
use crate::ratelimit::RateLimiter;
use crate::singleflight::SingleFlight;
use crate::stats::{MetricsSink, Stats, next_id};
use crate::timeout_guard::do_with_timeout;

const SINGLEFLIGHT_MGET_PREFIX: &str = "sfmgets:";

thread_local! {
    static LOOP_CHECK: RefCell<HashSet<String>> = RefCell::new(HashSet::new());
}

struct LoopGuard {
    key: String,
}

impl LoopGuard {
    fn enter(key: String) -> Self {
        LOOP_CHECK.with(|set| {
            let mut set = set.borrow_mut();
            if set.contains(&key) {
                panic!("find loop: {key}");
            }
            set.insert(key.clone());
        });
        Self { key }
    }
}

impl Drop for LoopGuard {
    fn drop(&mut self) {
        LOOP_CHECK.with(|set| {
            set.borrow_mut().remove(&self.key);
        });
    }
}

/// `ycache.SourceGetter`
pub trait SourceGetter<K: CacheKey>: Send + Sync {
    fn get(&self, key: &K) -> Result<CacheValue>;
}

impl<K: CacheKey, F> SourceGetter<K> for F
where
    F: Fn(&K) -> Result<CacheValue> + Send + Sync,
{
    fn get(&self, key: &K) -> Result<CacheValue> {
        self(key)
    }
}

/// `ycache.SourceMGetter`
pub trait SourceMGetter<K: CacheKey>: Send + Sync {
    fn mget(&self, keys: &[K]) -> Result<HashMap<K, CacheValue>>;
}

impl<K: CacheKey, F> SourceMGetter<K> for F
where
    F: Fn(&[K]) -> Result<HashMap<K, CacheValue>> + Send + Sync,
{
    fn mget(&self, keys: &[K]) -> Result<HashMap<K, CacheValue>> {
        self(keys)
    }
}

#[derive(Clone)]
struct LoadedPair {
    cache_value: Option<CacheValue>,
    source_value: Option<CacheValue>,
}

#[derive(Clone)]
struct LoadedMapPair<K: CacheKey> {
    cache_values: HashMap<K, CacheValue>,
    source_values: HashMap<K, CacheValue>,
}

/// `ycache.CacheV2`: read-through cache with singleflight, penetration
/// protection, TTL extension, refresh queues and delete sync.
pub struct CacheV2<K: CacheKey> {
    options: Options,
    cache: RwLock<Arc<dyn Cacher<K>>>,
    stats: Arc<Stats>,
    load_group: SingleFlight,
    rate_limiter: Option<RateLimiter>,
    refresh_queues: RwLock<HashMap<String, Arc<dyn EventQueue>>>,
    sync: Option<GlobalSync>,
    stop: Arc<AtomicBool>,
    report_handle: Mutex<Option<JoinHandle<()>>>,
    report_sender: Mutex<Option<std::sync::mpsc::Sender<()>>>,
}

impl<K: CacheKey> CacheV2<K> {
    pub fn new(
        cache: Arc<dyn Cacher<K>>,
        mut options: Options,
        metrics: Arc<dyn MetricsSink>,
    ) -> Arc<Self> {
        if options.cache_id.is_empty() {
            options.cache_id = cache.cache_id();
        }
        if options.report_name.is_empty() {
            options.report_name = format!("{}_{}", options.cache_id, next_id());
        }

        let stats = Stats::new(options.report_name.clone(), metrics);
        cache.set_stats(stats.clone());

        let rate_limiter = if options.source_options.limit > 0 {
            Some(RateLimiter::new(options.source_options.limit))
        } else {
            None
        };

        let sync = if options.enable_sync {
            options.kafka_config.clone().map(|config| {
                GlobalSync::new(
                    config,
                    options.cache_id.clone(),
                    options.sync_transport.clone(),
                )
            })
        } else {
            None
        };

        let stop = Arc::new(AtomicBool::new(false));
        let (report_sender, report_receiver) = std::sync::mpsc::channel::<()>();
        let report_handle = if !options.report_duration.is_zero() {
            let stats = stats.clone();
            let stop = stop.clone();
            let duration = options.report_duration;
            Some(thread::spawn(move || {
                while !stop.load(Ordering::Relaxed) {
                    match report_receiver.recv_timeout(duration) {
                        Ok(()) | Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
                        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => stats.report(),
                    }
                }
            }))
        } else {
            None
        };

        Arc::new(Self {
            options,
            cache: RwLock::new(cache),
            stats,
            load_group: SingleFlight::new(),
            rate_limiter,
            refresh_queues: RwLock::new(HashMap::new()),
            sync,
            stop,
            report_handle: Mutex::new(report_handle),
            report_sender: Mutex::new(Some(report_sender)),
        })
    }

    pub fn stats(&self) -> &Arc<Stats> {
        &self.stats
    }

    pub fn options(&self) -> &Options {
        &self.options
    }

    fn cacher(&self) -> Arc<dyn Cacher<K>> {
        self.cache.read().clone()
    }

    pub fn reload_cacher(&self, cache: Arc<dyn Cacher<K>>) -> Result<()> {
        let old = self.cacher();
        old.stop()?;
        cache.set_stats(self.stats.clone());
        *self.cache.write() = cache;
        Ok(())
    }

    pub fn set(&self, key: &K, value: CacheValue) -> Result<()> {
        self.populate_cache(key, Some(&value))
    }

    /// `CacheV2.Get`. Returns `None` when the source has no value and
    /// penetration protection is disabled.
    pub fn get(
        self: &Arc<Self>,
        key: &K,
        getter: Arc<dyn SourceGetter<K>>,
        options: GetterOptions,
    ) -> Result<Option<CacheValue>> {
        if key.is_empty_key() {
            return Err(CacheError::ZeroKeys);
        }

        if options.source_only || options.refresh {
            let value = getter.get(key)?;
            if options.refresh {
                self.populate_cache(key, Some(&value))?;
            }
            return Ok(Some(value));
        }

        match self.lookup_cache(key) {
            Ok(Some(value)) if !self.exceed_extend_ttl(value.ttl()) => {
                self.stats.add_cache_hit(1);
                return self.apply_unmarshal(value).map(Some);
            }
            Ok(Some(_)) => {}
            Ok(None) => {}
            Err(CacheError::RequireString) => return Err(CacheError::RequireString),
            Err(_) => {}
        }

        self.load(key, getter, options)
    }

    fn load(
        self: &Arc<Self>,
        key: &K,
        getter: Arc<dyn SourceGetter<K>>,
        options: GetterOptions,
    ) -> Result<Option<CacheValue>> {
        self.stats.add_cache_miss(1);
        let cache_key = self.cacher().get_key(std::slice::from_ref(key));
        let _loop_guard = if self.options.enable_loop_check {
            Some(LoopGuard::enter(cache_key.clone()))
        } else {
            None
        };

        let this = Arc::clone(self);
        let key_owned = key.clone();
        let result = self.load_group.do_call(&cache_key, move || {
            let mut cache_value = None;
            match this.lookup_cache(&key_owned) {
                Ok(Some(value)) => {
                    if !this.exceed_extend_ttl(value.ttl()) {
                        this.stats.add_cache_hit(1);
                        return Ok(LoadedPair {
                            cache_value: Some(value),
                            source_value: None,
                        });
                    }
                    cache_value = Some(value);
                }
                Ok(None) => {}
                Err(CacheError::RequireString) => {
                    return Err(CacheError::RequireString);
                }
                Err(_) => {}
            }

            this.stats.add_sources_deduped(1);
            let start = Instant::now();
            let source_result =
                this.lookup_source_with_timeout(&key_owned, getter.clone(), options);
            this.stats
                .add_source_costs(start.elapsed().as_millis() as i64);

            let source_value = match source_result {
                Ok(value) => value,
                Err(error) => {
                    this.stats.add_source_err(1);
                    if cache_value.is_some() && this.enable_extend_ttl() {
                        return Ok(LoadedPair {
                            cache_value,
                            source_value: None,
                        });
                    }
                    return Err(error);
                }
            };

            cache_value = None;
            this.stats.add_source_hit(1);
            if let Err(_error) = this.populate_cache(&key_owned, source_value.as_ref()) {
                this.stats.add_set_err(1);
            }
            Ok(LoadedPair {
                cache_value,
                source_value,
            })
        })?;

        if let Some(value) = result.cache_value {
            return self.apply_unmarshal(value).map(Some);
        }
        Ok(result.source_value)
    }

    fn lookup_source_with_timeout(
        self: &Arc<Self>,
        key: &K,
        getter: Arc<dyn SourceGetter<K>>,
        _options: GetterOptions,
    ) -> Result<Option<CacheValue>> {
        if self.options.lookup_source_timeout.is_zero() {
            return self.lookup_source(key, getter.as_ref());
        }
        let this = Arc::clone(self);
        let key = key.clone();
        let alert = self.options.slow_source_callback.clone();
        let label = key.as_key_string();
        do_with_timeout(
            Instant::now(),
            self.options.lookup_source_timeout,
            self.options.ignore_source_timeout_err,
            alert,
            label,
            move || this.lookup_source(&key, getter.as_ref()),
        )
        .map(|value| value.flatten())
    }

    fn lookup_source(&self, key: &K, getter: &dyn SourceGetter<K>) -> Result<Option<CacheValue>> {
        if let Some(limiter) = &self.rate_limiter
            && limiter.take_available(1) == 0
        {
            return Err(CacheError::TooManyRequests);
        }

        match getter.get(key) {
            Ok(value) => Ok(Some(value)),
            Err(CacheError::SourceNotFound) => {
                self.stats.add_source_not_found(1);
                if self.options.enable_impenetrable_ttl() {
                    Ok(Some(Arc::new(InterfaceView::nil(
                        self.options.impenetrable_ttl,
                    ))))
                } else {
                    Ok(None)
                }
            }
            Err(error) => Err(error),
        }
    }

    fn lookup_cache(&self, key: &K) -> Result<Option<CacheValue>> {
        self.cacher().get(key)
    }

    fn populate_cache(&self, key: &K, value: Option<&CacheValue>) -> Result<()> {
        let Some(value) = value else {
            if self.options.enable_impenetrable_ttl() {
                return self.cacher().set(
                    key,
                    Arc::new(InterfaceView::nil(self.options.impenetrable_ttl)),
                );
            }
            return Ok(());
        };

        let mut data = value.data();
        if let Some(codec) = &self.options.codec {
            data = codec.marshal(value.as_ref())?;
        }
        let ttl = value.ttl() + self.options.extend_ttl;
        self.cacher()
            .set(key, Arc::new(InterfaceView::from_data(data, ttl)))
    }

    fn apply_unmarshal(&self, value: CacheValue) -> Result<CacheValue> {
        let Some(codec) = &self.options.codec else {
            return Ok(value);
        };
        let data = codec.unmarshal(value.data())?;
        Ok(Arc::new(InterfaceView::from_data(data, value.ttl())))
    }

    pub fn delete(&self, key: &K, options: DeleteOptions) -> Result<()> {
        self.cacher().delete(key)?;
        if let Some(sync) = &self.sync
            && self.options.enable_sync
            && !options.disable_sync
        {
            return sync.notify_delete(&key.as_key_string(), &options.dest);
        }
        Ok(())
    }

    pub fn mdelete(&self, keys: &[K], options: DeleteOptions) -> Result<()> {
        if keys.is_empty() {
            return Ok(());
        }
        self.cacher().mdelete(keys)?;
        if let Some(sync) = &self.sync
            && self.options.enable_sync
            && !options.disable_sync
        {
            let keys: Vec<String> = keys.iter().map(|key| key.as_key_string()).collect();
            return sync.mnotify(&keys, &options.dest);
        }
        Ok(())
    }

    /// Handles an incoming cache-sync message. Returns `Ok(false)` when the
    /// message came from this instance.
    pub fn handle_sync_message(&self, message_key: &[u8], message_value: &[u8]) -> Result<bool> {
        let Some(sync) = &self.sync else {
            return Ok(false);
        };
        let Some(value) = sync.decode(message_key, message_value)? else {
            return Ok(false);
        };
        match value.op.as_str() {
            "Delete" => {
                if let Some(key) = value.keys.first()
                    && let Some(key) = K::from_key_string(key)
                {
                    self.cacher().delete(&key)?;
                }
            }
            "MDelete" => {
                let keys: Vec<K> = value
                    .keys
                    .iter()
                    .filter_map(|key| K::from_key_string(key))
                    .collect();
                self.cacher().mdelete(&keys)?;
            }
            other => {
                return Err(CacheError::Message(format!("handle op not exist {other}")));
            }
        }
        Ok(true)
    }

    pub fn mget(
        self: &Arc<Self>,
        keys: &[K],
        mgetter: Arc<dyn SourceMGetter<K>>,
        _options: GetterOptions,
    ) -> Result<HashMap<K, CacheValue>> {
        let (mut result, miss_keys) = match self.m_lookup_cache(keys) {
            Ok((hits, misses)) => {
                self.stats.add_cache_hit(1);
                (hits, misses)
            }
            Err(CacheError::RequireString) => return Err(CacheError::RequireString),
            Err(_) => (HashMap::new(), keys.to_vec()),
        };
        let source_values = self.m_load(&miss_keys, mgetter)?;
        for (key, value) in source_values {
            result.insert(key, value);
        }
        Ok(result)
    }

    fn m_load(
        self: &Arc<Self>,
        keys: &[K],
        mgetter: Arc<dyn SourceMGetter<K>>,
    ) -> Result<HashMap<K, CacheValue>> {
        if keys.is_empty() {
            return Ok(HashMap::new());
        }
        self.stats.add_cache_miss(1);
        let cache_key = self.cacher().get_key(keys);
        let _loop_guard = if self.options.enable_loop_check {
            Some(LoopGuard::enter(cache_key.clone()))
        } else {
            None
        };

        let this = Arc::clone(self);
        let keys_owned = keys.to_vec();
        let pair = self.load_group.do_call(
            &format!("{SINGLEFLIGHT_MGET_PREFIX}{cache_key}"),
            move || {
                let (cache_values, miss_keys) = match this.m_lookup_cache(&keys_owned) {
                    Ok((hits, misses)) => {
                        this.stats.add_cache_hit(1);
                        (hits, misses)
                    }
                    Err(CacheError::RequireString) => {
                        return Err(CacheError::RequireString);
                    }
                    Err(_) => (HashMap::new(), keys_owned.clone()),
                };
                if miss_keys.is_empty() {
                    return Ok(LoadedMapPair {
                        cache_values,
                        source_values: HashMap::new(),
                    });
                }

                this.stats.add_sources_deduped(1);
                let start = Instant::now();
                let source_result = this.m_lookup_source_with_timeout(&miss_keys, mgetter.clone());
                this.stats
                    .add_source_costs(start.elapsed().as_millis() as i64);

                let source_values = match source_result {
                    Ok(values) => values,
                    Err(error) => {
                        this.stats.add_source_err(1);
                        if !cache_values.is_empty() && this.enable_extend_ttl() {
                            return Ok(LoadedMapPair {
                                cache_values,
                                source_values: HashMap::new(),
                            });
                        }
                        return Err(error);
                    }
                };

                this.stats.add_source_hit(1);
                if this.m_populate_cache(&source_values).is_err() {
                    this.stats.add_set_err(1);
                }

                Ok(LoadedMapPair {
                    cache_values,
                    source_values,
                })
            },
        )?;

        let mut result = HashMap::with_capacity(pair.cache_values.len() + pair.source_values.len());
        for (key, value) in pair.cache_values {
            result.insert(key, self.apply_unmarshal(value)?);
        }
        for (key, value) in pair.source_values {
            result.insert(key, value);
        }
        Ok(result)
    }

    fn m_lookup_cache(&self, keys: &[K]) -> Result<(HashMap<K, CacheValue>, Vec<K>)> {
        let (hits, mut misses) = self.cacher().mget(keys)?;
        for (key, value) in &hits {
            if self.exceed_extend_ttl(value.ttl()) {
                misses.push(key.clone());
            }
        }
        Ok((hits, misses))
    }

    fn m_lookup_source_with_timeout(
        self: &Arc<Self>,
        keys: &[K],
        mgetter: Arc<dyn SourceMGetter<K>>,
    ) -> Result<HashMap<K, CacheValue>> {
        if self.options.lookup_source_timeout.is_zero() {
            return self.m_lookup_source(keys, mgetter.as_ref());
        }
        let this = Arc::clone(self);
        let keys = keys.to_vec();
        let alert = self.options.slow_source_callback.clone();
        let label = format!("{} keys", keys.len());
        do_with_timeout(
            Instant::now(),
            self.options.lookup_source_timeout,
            self.options.ignore_source_timeout_err,
            alert,
            label,
            move || this.m_lookup_source(&keys, mgetter.as_ref()),
        )
        .map(|values| values.unwrap_or_default())
    }

    fn m_lookup_source(
        &self,
        keys: &[K],
        mgetter: &dyn SourceMGetter<K>,
    ) -> Result<HashMap<K, CacheValue>> {
        if let Some(limiter) = &self.rate_limiter
            && limiter.take_available(1) == 0
        {
            return Err(CacheError::TooManyRequests);
        }

        let mut values = match mgetter.mget(keys) {
            Ok(values) => values,
            Err(CacheError::SourceNotFound) => HashMap::new(),
            Err(error) => return Err(error),
        };

        for key in keys {
            if !values.contains_key(key) {
                self.stats.add_source_not_found(1);
                if self.options.enable_impenetrable_ttl() {
                    values.insert(
                        key.clone(),
                        Arc::new(InterfaceView::nil(self.options.impenetrable_ttl)),
                    );
                }
            }
        }
        Ok(values)
    }

    fn m_populate_cache(&self, values: &HashMap<K, CacheValue>) -> Result<()> {
        let mut last_error = None;
        for (key, value) in values {
            if let Err(error) = self.populate_cache(key, Some(value)) {
                last_error = Some(error);
            }
        }
        match last_error {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }

    fn enable_extend_ttl(&self) -> bool {
        self.options.extend_ttl != 0
    }

    fn exceed_extend_ttl(&self, ttl: i32) -> bool {
        self.options.extend_ttl != 0 && ttl < self.options.extend_ttl
    }

    pub fn register_refresh_func(
        self: &Arc<Self>,
        prefix_key: &str,
        getter: Arc<dyn SourceGetter<K>>,
    ) -> Result<()> {
        if !self.options.source_options.enable_refresh {
            return Ok(());
        }
        {
            let queues = self.refresh_queues.read();
            for key in queues.keys() {
                if prefix_key.starts_with(key) || key.starts_with(prefix_key) {
                    return Err(CacheError::Message("prefix key exist".to_string()));
                }
            }
        }

        let weak = Arc::downgrade(self);
        let handler = move |event: &str| -> Result<()> {
            let Some(cache) = weak.upgrade() else {
                return Ok(());
            };
            let Some(key) = K::from_key_string(event) else {
                return Ok(());
            };
            cache.get(
                &key,
                getter.clone(),
                GetterOptions {
                    refresh: true,
                    source_only: false,
                },
            )?;
            Ok(())
        };
        let queue: Arc<dyn EventQueue> = Arc::new(MemoryEventQueue::new(Arc::new(handler)));
        queue.start()?;
        self.refresh_queues
            .write()
            .insert(prefix_key.to_string(), queue);
        Ok(())
    }

    pub fn refresh(&self, key: &str, ttl: i64) -> Result<()> {
        if !self.options.source_options.enable_refresh {
            return Ok(());
        }
        let queues = self.refresh_queues.read();
        for (prefix, queue) in queues.iter() {
            if key.starts_with(prefix) {
                return queue.add_event(key, ttl);
            }
        }
        Ok(())
    }

    pub fn unrefresh(&self, key: &str) -> Result<()> {
        if !self.options.source_options.enable_refresh {
            return Ok(());
        }
        let queues = self.refresh_queues.read();
        for (prefix, queue) in queues.iter() {
            if key.starts_with(prefix) {
                return queue.remove_event(key);
            }
        }
        Ok(())
    }

    pub fn stop(&self) {
        self.stop.store(true, Ordering::Relaxed);
        let _ = self.report_sender.lock().take();
        let queues: Vec<Arc<dyn EventQueue>> =
            self.refresh_queues.read().values().cloned().collect();
        for queue in queues {
            queue.stop();
        }
        if let Some(handle) = self.report_handle.lock().take() {
            let _ = handle.join();
        }
        let _ = self.cacher().stop();
    }
}

impl<K: CacheKey> Drop for CacheV2<K> {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        let _ = self.report_sender.get_mut().take();
    }
}

/// Convenience constructor for `CacheData::Bytes` values.
pub fn bytes_value(bytes: impl Into<Arc<[u8]>>, ttl: i32) -> CacheValue {
    Arc::new(InterfaceView::from_data(
        CacheData::Bytes(bytes.into()),
        ttl,
    ))
}

/// Convenience constructor for `CacheData::Str` values.
pub fn string_value(value: impl Into<Arc<str>>, ttl: i32) -> CacheValue {
    Arc::new(InterfaceView::from_data(CacheData::Str(value.into()), ttl))
}

#[allow(dead_code)]
fn unused_duration(_: Duration) {}
