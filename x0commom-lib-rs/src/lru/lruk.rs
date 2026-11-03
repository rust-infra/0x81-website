use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use parking_lot::{Mutex, RwLock};

use crate::cacheable::CacheData;
use crate::key::CacheKey;
use crate::lru::list::ArenaList;
use crate::lru::lru1::{DEFAULT_REDUCE_STEP, DEFAULT_STEP, LruOptions};
use crate::lru::size_checker::SizeChecker;
use crate::stats::{MetricsSink, Stats};
use crate::util::sleep_interruptible;

#[derive(Clone, Copy)]
struct FreqElem {
    index: usize,
    freq: usize,
}

struct LruKSettings {
    max_size: usize,
    max_level: usize,
    max_lens: Vec<AtomicI64>,
    retire_interval: AtomicI64,
    retire_rates: Vec<AtomicI64>,
    promote_thresholds: Vec<AtomicI64>,
    evicts: Vec<AtomicI64>,
    promotes: Vec<AtomicI64>,
    downgrades: Vec<AtomicI64>,
    switchs: Vec<AtomicI64>,
    reducers: Mutex<Vec<SizeChecker>>,
    stop: Arc<AtomicBool>,
    handle: Mutex<Option<JoinHandle<()>>>,
}

impl LruKSettings {
    fn new(max_level: usize) -> Self {
        Self {
            max_size: 0,
            max_level,
            max_lens: (0..max_level).map(|_| AtomicI64::new(0)).collect(),
            retire_interval: AtomicI64::new(0),
            retire_rates: (0..max_level).map(|_| AtomicI64::new(0)).collect(),
            promote_thresholds: (0..max_level).map(|_| AtomicI64::new(0)).collect(),
            evicts: (0..max_level).map(|_| AtomicI64::new(0)).collect(),
            promotes: (0..max_level).map(|_| AtomicI64::new(0)).collect(),
            downgrades: (0..max_level).map(|_| AtomicI64::new(0)).collect(),
            switchs: (0..max_level).map(|_| AtomicI64::new(0)).collect(),
            reducers: Mutex::new((0..max_level).map(|_| SizeChecker::default()).collect()),
            stop: Arc::new(AtomicBool::new(false)),
            handle: Mutex::new(None),
        }
    }

    fn add_evict(&self, level: usize) {
        self.evicts[level].fetch_add(1, Ordering::Relaxed);
    }

    fn add_promote(&self, level: usize) {
        self.promotes[level].fetch_add(1, Ordering::Relaxed);
    }

    fn add_downgrade(&self, level: usize, count: usize) {
        self.downgrades[level].fetch_add(count as i64, Ordering::Relaxed);
    }

    fn add_switch(&self, level: usize) {
        self.switchs[level].fetch_add(1, Ordering::Relaxed);
    }

    fn update_settings(&self, stats: &Stats, metrics: &dyn MetricsSink) {
        let name = stats.report_name().to_string();
        let mut total_size = 0usize;
        let mut reducers = self.reducers.lock();
        for level in (0..self.max_level).rev() {
            let prefix = format!("{name}_{level}");
            let cur_size = reducers[level].calc_next_len(
                self.max_lens[level].load(Ordering::Relaxed).max(0) as usize,
                self.max_size,
                self.evicts[level].load(Ordering::Relaxed).max(0) as usize,
                DEFAULT_STEP,
                DEFAULT_REDUCE_STEP,
            );
            self.max_lens[level].store(cur_size as i64, Ordering::Relaxed);
            total_size += cur_size;

            metrics.gauge("WaterMark", &format!("{prefix}/size"), cur_size as i64);
            metrics.gauge(
                "WaterMark",
                &format!("{prefix}/evicts"),
                self.evicts[level].load(Ordering::Relaxed),
            );
            metrics.gauge(
                "WaterMark",
                &format!("{prefix}/promotes"),
                self.promotes[level].load(Ordering::Relaxed),
            );
            metrics.gauge(
                "WaterMark",
                &format!("{prefix}/downgrades"),
                self.downgrades[level].load(Ordering::Relaxed),
            );
            metrics.gauge(
                "WaterMark",
                &format!("{prefix}/switchs"),
                self.switchs[level].load(Ordering::Relaxed),
            );

            self.evicts[level].store(0, Ordering::Relaxed);
            self.promotes[level].store(0, Ordering::Relaxed);
            self.downgrades[level].store(0, Ordering::Relaxed);
            self.switchs[level].store(0, Ordering::Relaxed);
        }
        drop(reducers);
        stats.set_cache_size(total_size);
    }

    fn start(self: &Arc<Self>, stats: Arc<Stats>, metrics: Arc<dyn MetricsSink>) {
        let mut handle = self.handle.lock();
        if let Some(old) = handle.take() {
            self.stop.store(true, Ordering::Relaxed);
            let _ = old.join();
        }
        self.stop.store(false, Ordering::Relaxed);
        let stop = self.stop.clone();
        let settings = Arc::clone(self);
        *handle = Some(thread::spawn(move || {
            while sleep_interruptible(&stop, Duration::from_secs(5)) {
                settings.update_settings(&stats, metrics.as_ref());
            }
        }));
    }

    fn stop(&self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(handle) = self.handle.lock().take() {
            let _ = handle.join();
        }
    }
}

impl Drop for LruKSettings {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(handle) = self.handle.get_mut().take() {
            let _ = handle.join();
        }
    }
}

struct LruKInner<K: CacheKey> {
    lists: Vec<ArenaList<K, CacheData>>,
    base_table: HashMap<K, usize>,
    freq_tables: Vec<HashMap<K, FreqElem>>,
    clean_flags: Vec<Option<K>>,
}

/// `lru.lruK`: a three-level LRU-K cache.
pub struct LruK<K: CacheKey> {
    inner: Mutex<LruKInner<K>>,
    expiration: Duration,
    options: LruOptions<K>,
    stats: RwLock<Option<Arc<Stats>>>,
    settings: Arc<LruKSettings>,
    stop: Arc<AtomicBool>,
    handles: Mutex<Vec<JoinHandle<()>>>,
}

impl<K: CacheKey> LruK<K> {
    pub fn new(max_len: usize, expiration: Duration, options: LruOptions<K>) -> Arc<Self> {
        Self::from_settings(Arc::new(default_settings(max_len)), expiration, options)
    }

    pub fn new_with_config(
        expiration: Duration,
        config: LruKConfig,
        options: LruOptions<K>,
    ) -> Arc<Self> {
        Self::from_settings(Arc::new(config_settings(config)), expiration, options)
    }

    fn from_settings(
        settings: Arc<LruKSettings>,
        expiration: Duration,
        options: LruOptions<K>,
    ) -> Arc<Self> {
        if !options.retire_interval.is_zero() {
            settings
                .retire_interval
                .store(options.retire_interval.as_secs() as i64, Ordering::Relaxed);
        }

        let max_level = settings.max_level;
        let mut lists = Vec::with_capacity(max_level);
        let mut freq_tables = Vec::with_capacity(max_level);
        let mut clean_flags = Vec::with_capacity(max_level);
        for level in 0..max_level {
            lists.push(ArenaList::new());
            freq_tables.push(HashMap::with_capacity(
                settings.max_lens[level].load(Ordering::Relaxed).max(0) as usize,
            ));
            clean_flags.push(None);
        }
        freq_tables[0] = HashMap::new();

        let cache = Arc::new(Self {
            inner: Mutex::new(LruKInner {
                lists,
                base_table: HashMap::with_capacity(
                    settings.max_lens[0].load(Ordering::Relaxed).max(0) as usize,
                ),
                freq_tables,
                clean_flags,
            }),
            expiration,
            options,
            stats: RwLock::new(None),
            settings,
            stop: Arc::new(AtomicBool::new(false)),
            handles: Mutex::new(Vec::new()),
        });
        cache.start();
        cache
    }

    fn max_level(&self) -> usize {
        self.settings.max_level
    }

    fn max_len(&self, level: usize) -> usize {
        self.settings.max_lens[level].load(Ordering::Relaxed).max(0) as usize
    }

    fn get_promote_threshold(&self, level: usize) -> usize {
        self.settings.promote_thresholds[level]
            .load(Ordering::Relaxed)
            .max(0) as usize
    }

    fn start(self: &Arc<Self>) {
        let mut handles = Vec::new();

        let retire_interval = self.settings.retire_interval.load(Ordering::Relaxed);
        if retire_interval != 0 {
            let weak = Arc::downgrade(self);
            let stop = self.stop.clone();
            handles.push(thread::spawn(move || {
                let interval = Duration::from_secs(retire_interval.max(1) as u64);
                while sleep_interruptible(&stop, interval) {
                    if let Some(cache) = weak.upgrade() {
                        cache.retire_level();
                    }
                }
            }));
        }

        let weak = Arc::downgrade(self);
        let stop = self.stop.clone();
        handles.push(thread::spawn(move || {
            while sleep_interruptible(&stop, Duration::from_secs(1)) {
                if let Some(cache) = weak.upgrade() {
                    let levels = cache.max_level();
                    for level in 0..levels {
                        cache.check_level_ttl(level, 1000);
                    }
                }
            }
        }));

        self.handles.lock().extend(handles);
    }

    fn check_level_ttl(&self, level: usize, max_size: usize) {
        let mut inner = self.inner.lock();
        let mut current = inner.clean_flags[level]
            .as_ref()
            .and_then(|key| table_index(&inner, level, key))
            .or_else(|| inner.lists[level].tail());

        let mut remaining = max_size;
        while remaining > 0 {
            let Some(index) = current else {
                break;
            };
            let next = inner.lists[level].prev(index);
            if inner.lists[level]
                .get(index)
                .is_some_and(|node| node.expired(Instant::now()))
            {
                if let Some(stats) = self.stats.read().as_ref() {
                    stats.add_expires(1);
                }
                self.delete_level_elem(&mut inner, level, index, true);
            }
            current = next;
            remaining -= 1;
        }

        inner.clean_flags[level] =
            current.and_then(|index| inner.lists[level].get(index).map(|node| node.key.clone()));
    }

    pub fn retire_level(&self) {
        for level in 0..self.max_level() {
            self.downgrade_level(level);
        }
    }

    fn downgrade_level(&self, level: usize) {
        if level == 0 {
            return;
        }
        let mut inner = self.inner.lock();
        if level == 1 {
            self.downgrade_level1(&mut inner);
        } else {
            self.downgrade_level_n(&mut inner, level);
        }
    }

    fn downgrade_level1(&self, inner: &mut LruKInner<K>) {
        let total = inner.freq_tables[1].len();
        let mut count = total
            .saturating_mul(self.settings.retire_rates[1].load(Ordering::Relaxed).max(0) as usize)
            / 100;
        let entries: Vec<(K, usize)> = inner.freq_tables[1]
            .iter()
            .map(|(key, elem)| (key.clone(), elem.index))
            .collect();
        let mut retired = Vec::new();

        for (key, index) in entries {
            if count == 0 {
                break;
            }
            count -= 1;

            if inner.lists[1]
                .get(index)
                .is_some_and(|node| node.expired(Instant::now()))
            {
                if let Some(stats) = self.stats.read().as_ref() {
                    stats.add_expires(1);
                }
                self.delete_level_list_elem(inner, 1, index, true);
            } else if let Some(node) = inner.lists[1].remove(index) {
                let new_index = inner.lists[0].push_front(
                    node.key.clone(),
                    node.value,
                    node.added_at,
                    node.ttl,
                );
                inner.base_table.insert(key.clone(), new_index);
            }
            retired.push(key);
        }

        for key in &retired {
            inner.freq_tables[1].remove(key);
        }
        self.settings.add_downgrade(1, retired.len());
    }

    fn downgrade_level_n(&self, inner: &mut LruKInner<K>, level: usize) {
        let total = inner.freq_tables[level].len();
        let mut count = total.saturating_mul(
            self.settings.retire_rates[level]
                .load(Ordering::Relaxed)
                .max(0) as usize,
        ) / 100;
        let entries: Vec<(K, usize)> = inner.freq_tables[level]
            .iter()
            .map(|(key, elem)| (key.clone(), elem.index))
            .collect();
        let mut retired = Vec::new();

        for (key, index) in entries {
            if count == 0 {
                break;
            }
            count -= 1;

            if inner.lists[level]
                .get(index)
                .is_some_and(|node| node.expired(Instant::now()))
            {
                if let Some(stats) = self.stats.read().as_ref() {
                    stats.add_expires(1);
                }
                self.delete_level_list_elem(inner, level, index, true);
            } else if let Some(node) = inner.lists[level].remove(index) {
                let new_index = inner.lists[level - 1].push_front(
                    node.key.clone(),
                    node.value,
                    node.added_at,
                    node.ttl,
                );
                inner.freq_tables[level - 1].insert(
                    key.clone(),
                    FreqElem {
                        index: new_index,
                        freq: 0,
                    },
                );
            }
            retired.push(key);
        }

        for key in &retired {
            inner.freq_tables[level].remove(key);
        }
        self.settings.add_downgrade(level, retired.len());
    }

    /// Returns the value and remaining TTL.
    pub fn get(&self, key: &K) -> Option<(CacheData, Duration)> {
        let mut inner = self.inner.lock();
        for level in (0..self.max_level()).rev() {
            if let Some((actual_level, index)) = self.get_level(&mut inner, level, key) {
                let node = inner.lists[actual_level].get(index)?;
                return Some((node.value.clone(), node.remaining_ttl(Instant::now())));
            }
        }
        None
    }

    fn get_level(&self, inner: &mut LruKInner<K>, level: usize, key: &K) -> Option<(usize, usize)> {
        let (index, should_promote) = if level == 0 {
            (inner.base_table.get(key).copied()?, true)
        } else {
            let elem = inner.freq_tables[level].get_mut(key)?;
            elem.freq += 1;
            let should_promote = elem.freq > self.get_promote_threshold(level);
            (elem.index, should_promote)
        };

        if inner.lists[level]
            .get(index)
            .is_some_and(|node| node.expired(Instant::now()))
        {
            if let Some(stats) = self.stats.read().as_ref() {
                stats.add_expires(1);
            }
            self.delete_level_elem(inner, level, index, true);
            return None;
        }

        let (actual_level, actual_index) = if should_promote {
            self.promote_level(inner, level, index, key)
        } else {
            inner.lists[level].move_to_front(index);
            (level, index)
        };

        self.check_level(inner, level);
        Some((actual_level, actual_index))
    }

    fn promote_level(
        &self,
        inner: &mut LruKInner<K>,
        level: usize,
        index: usize,
        key: &K,
    ) -> (usize, usize) {
        if level >= self.max_level() - 1 {
            inner.lists[level].move_to_front(index);
            return (level, index);
        }

        let next_level = level + 1;

        if inner.lists[next_level].len() >= self.max_len(next_level)
            && let Some(down_node) = inner.lists[next_level].pop_back()
        {
            inner.freq_tables[next_level].remove(&down_node.key);
            let down_index = inner.lists[level].push_front(
                down_node.key.clone(),
                down_node.value,
                down_node.added_at,
                down_node.ttl,
            );
            if level == 0 {
                inner.base_table.insert(down_node.key, down_index);
            } else {
                inner.freq_tables[level].insert(
                    down_node.key,
                    FreqElem {
                        index: down_index,
                        freq: 0,
                    },
                );
            }
            self.settings.add_switch(level);
        }

        let Some(node) = inner.lists[level].remove(index) else {
            return (level, index);
        };
        let new_index = inner.lists[next_level].push_front(
            node.key.clone(),
            node.value,
            node.added_at,
            node.ttl,
        );
        inner.freq_tables[next_level].insert(
            key.clone(),
            FreqElem {
                index: new_index,
                freq: 0,
            },
        );
        if level == 0 {
            inner.base_table.remove(key);
        } else {
            inner.freq_tables[level].remove(key);
        }
        self.settings.add_promote(level);
        (next_level, new_index)
    }

    pub fn all(&self) -> HashMap<K, CacheData> {
        let inner = self.inner.lock();
        let mut result = HashMap::new();
        for (key, index) in &inner.base_table {
            if let Some(node) = inner.lists[0].get(*index) {
                result.insert(key.clone(), node.value.clone());
            }
        }
        for level in (1..self.max_level()).rev() {
            for (key, elem) in &inner.freq_tables[level] {
                if let Some(node) = inner.lists[level].get(elem.index) {
                    result.insert(key.clone(), node.value.clone());
                }
            }
        }
        result
    }

    pub fn set(&self, key: K, value: CacheData, ttl: Duration) {
        let ttl = if ttl.is_zero() { self.expiration } else { ttl };
        let mut inner = self.inner.lock();
        for level in (0..self.max_level()).rev() {
            if let Some((actual_level, index)) = self.get_level(&mut inner, level, &key) {
                if let Some(node) = inner.lists[actual_level].get_mut(index) {
                    node.value = value;
                    node.ttl = ttl;
                }
                return;
            }
        }
        self.add_new(&mut inner, key, value, ttl);
    }

    pub fn touch(&self, key: &K, ttl: Duration) {
        let ttl = if ttl.is_zero() { self.expiration } else { ttl };
        let mut inner = self.inner.lock();
        for level in (0..self.max_level()).rev() {
            if let Some((actual_level, index)) = self.get_level(&mut inner, level, key) {
                if let Some(node) = inner.lists[actual_level].get_mut(index) {
                    node.ttl = ttl;
                }
                return;
            }
        }
    }

    pub fn delete(&self, key: &K) {
        let mut inner = self.inner.lock();
        for level in (0..self.max_level()).rev() {
            if let Some((actual_level, index)) = self.get_level(&mut inner, level, key) {
                self.delete_level_elem(&mut inner, actual_level, index, true);
                break;
            }
        }
    }

    pub fn mdelete(&self, keys: &[K]) {
        for key in keys {
            self.delete(key);
        }
    }

    pub fn flush(&self) {
        let mut inner = self.inner.lock();
        let max_level = self.max_level();
        inner.lists = (0..max_level).map(|_| ArenaList::new()).collect();
        inner.base_table.clear();
        inner.freq_tables = (0..max_level).map(|_| HashMap::new()).collect();
        inner.clean_flags = (0..max_level).map(|_| None).collect();
    }

    pub fn get_ttl(&self) -> Duration {
        self.expiration
    }

    pub fn set_stats(&self, stats: Arc<Stats>) {
        *self.stats.write() = Some(stats.clone());
        let metrics = stats.metrics();
        Arc::clone(&self.settings).start(stats, metrics);
    }

    pub fn report(&self) -> String {
        let inner = self.inner.lock();
        let mut out = String::new();
        for level in 0..self.max_level() {
            out.push_str(&format!("level {level}: "));
            if level == 0 {
                out.push_str(&inner.base_table.len().to_string());
            } else {
                out.push_str(&inner.freq_tables[level].len().to_string());
            }
            out.push_str(&format!(
                "[m: {}, p:{}, d:{}, s:{}];",
                self.settings.max_lens[level].load(Ordering::Relaxed),
                self.settings.promotes[level].load(Ordering::Relaxed),
                self.settings.downgrades[level].load(Ordering::Relaxed),
                self.settings.switchs[level].load(Ordering::Relaxed),
            ));
        }
        out
    }

    pub fn stop(&self) {
        self.stop.store(true, Ordering::Relaxed);
        let handles = std::mem::take(&mut *self.handles.lock());
        for handle in handles {
            let _ = handle.join();
        }
        self.settings.stop();
        self.flush();
    }

    fn add_new(&self, inner: &mut LruKInner<K>, key: K, value: CacheData, ttl: Duration) {
        let index = inner.lists[0].push_front(key.clone(), value, Instant::now(), ttl);
        inner.base_table.insert(key, index);
        self.check_level(inner, 0);
    }

    fn delete_level_list_elem(
        &self,
        inner: &mut LruKInner<K>,
        level: usize,
        index: usize,
        call_callback: bool,
    ) {
        if let Some(node) = inner.lists[level].remove(index)
            && call_callback
            && let Some(callback) = &self.options.timeout_callback
        {
            callback(&node.key, &node.value);
        }
    }

    fn delete_level_elem(
        &self,
        inner: &mut LruKInner<K>,
        level: usize,
        index: usize,
        call_callback: bool,
    ) {
        let key = inner.lists[level].get(index).map(|node| node.key.clone());
        self.delete_level_list_elem(inner, level, index, call_callback);
        if let Some(key) = key {
            if level == 0 {
                inner.base_table.remove(&key);
            } else {
                inner.freq_tables[level].remove(&key);
            }
        }
    }

    fn check_level(&self, inner: &mut LruKInner<K>, level: usize) -> bool {
        if inner.lists[level].len() > self.max_len(level) {
            let Some(tail) = inner.lists[level].tail() else {
                return false;
            };
            let now = Instant::now();
            if inner.lists[level]
                .get(tail)
                .is_some_and(|node| !node.expired(now))
            {
                if let Some(stats) = self.stats.read().as_ref() {
                    stats.add_evicts(1);
                }
                self.settings.add_evict(level);
            } else if let Some(stats) = self.stats.read().as_ref() {
                stats.add_expires(1);
            }
            self.delete_level_elem(inner, level, tail, true);
            return true;
        }
        false
    }
}

impl<K: CacheKey> Drop for LruK<K> {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        self.settings.stop();
    }
}

fn default_settings(max_len: usize) -> LruKSettings {
    let max_level = 3;
    let mut settings = LruKSettings::new(max_level);
    settings.max_size = max_len;
    let default_len = DEFAULT_STEP.min(max_len);
    for level in 0..max_level {
        settings.max_lens[level].store(default_len as i64, Ordering::Relaxed);
        if level > 0 {
            settings.promote_thresholds[level].store(2, Ordering::Relaxed);
            settings.retire_rates[level].store(10, Ordering::Relaxed);
        }
    }
    settings
}

/// Explicit level configuration, mainly for parity tests and tuning.
#[derive(Clone, Debug)]
pub struct LruKConfig {
    pub max_size: usize,
    pub max_level: usize,
    pub max_lens: Vec<usize>,
    pub promote_thresholds: Vec<usize>,
    pub retire_rates: Vec<usize>,
    pub retire_interval: Duration,
}

fn config_settings(config: LruKConfig) -> LruKSettings {
    let max_level = config.max_level.max(1);
    let mut settings = LruKSettings::new(max_level);
    settings.max_size = config.max_size;
    for level in 0..max_level {
        settings.max_lens[level].store(
            config
                .max_lens
                .get(level)
                .copied()
                .unwrap_or(config.max_size) as i64,
            Ordering::Relaxed,
        );
        if level > 0 {
            settings.promote_thresholds[level].store(
                config.promote_thresholds.get(level).copied().unwrap_or(2) as i64,
                Ordering::Relaxed,
            );
            settings.retire_rates[level].store(
                config.retire_rates.get(level).copied().unwrap_or(10) as i64,
                Ordering::Relaxed,
            );
        }
    }
    settings
        .retire_interval
        .store(config.retire_interval.as_secs() as i64, Ordering::Relaxed);
    settings
}

fn table_index<K: CacheKey>(inner: &LruKInner<K>, level: usize, key: &K) -> Option<usize> {
    if level == 0 {
        inner.base_table.get(key).copied()
    } else {
        inner.freq_tables[level].get(key).map(|elem| elem.index)
    }
}
