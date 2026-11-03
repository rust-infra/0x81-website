use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicUsize, Ordering};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use parking_lot::{Mutex, RwLock};

use crate::cacheable::CacheData;
use crate::key::CacheKey;
use crate::lru::list::ArenaList;
use crate::lru::size_checker::SizeChecker;
use crate::stats::Stats;
use crate::util::sleep_interruptible;

pub(crate) const DEFAULT_STEP: usize = 5000;
pub(crate) const DEFAULT_REDUCE_STEP: usize = 500;
pub(crate) const DEFAULT_RESIZE_INTERVAL: Duration = Duration::from_secs(5);
pub(crate) const DEFAULT_CHECK_STEP: usize = 100;

pub type TimeoutCallback<K> = Arc<dyn Fn(&K, &CacheData) + Send + Sync>;

pub struct LruOptions<K: CacheKey> {
    pub timeout_callback: Option<TimeoutCallback<K>>,
    pub retire_interval: Duration,
}

impl<K: CacheKey> Default for LruOptions<K> {
    fn default() -> Self {
        Self {
            timeout_callback: None,
            retire_interval: Duration::ZERO,
        }
    }
}

struct Lru1Inner<K: CacheKey> {
    list: ArenaList<K, CacheData>,
    table: HashMap<K, usize>,
    clean_flag: Option<K>,
    size_checker: SizeChecker,
}

/// `lru.lru1`: a TTL-aware LRU with a dynamically sized capacity.
pub struct Lru1<K: CacheKey> {
    inner: Mutex<Lru1Inner<K>>,
    expiration: Duration,
    max_len: usize,
    cur_len: AtomicUsize,
    step: usize,
    options: LruOptions<K>,
    stats: RwLock<Option<Arc<Stats>>>,
    evicts: AtomicI64,
    stop: Arc<AtomicBool>,
    handles: Mutex<Vec<JoinHandle<()>>>,
}

impl<K: CacheKey> Lru1<K> {
    pub fn new(max_len: usize, expiration: Duration, options: LruOptions<K>) -> Arc<Self> {
        let mut cur_len = DEFAULT_STEP;
        if cur_len > max_len {
            cur_len = max_len;
        }
        let cache = Arc::new(Self {
            inner: Mutex::new(Lru1Inner {
                list: ArenaList::new(),
                table: HashMap::new(),
                clean_flag: None,
                size_checker: SizeChecker::default(),
            }),
            expiration,
            max_len,
            cur_len: AtomicUsize::new(cur_len),
            step: DEFAULT_STEP,
            options,
            stats: RwLock::new(None),
            evicts: AtomicI64::new(0),
            stop: Arc::new(AtomicBool::new(false)),
            handles: Mutex::new(Vec::new()),
        });
        cache.start();
        cache
    }

    fn start(self: &Arc<Self>) {
        let mut handles = Vec::new();

        let weak = Arc::downgrade(self);
        let stop = self.stop.clone();
        handles.push(thread::spawn(move || {
            while sleep_interruptible(&stop, Duration::from_secs(1)) {
                if let Some(cache) = weak.upgrade() {
                    cache.check_ttl(DEFAULT_CHECK_STEP);
                }
            }
        }));

        let weak = Arc::downgrade(self);
        let stop = self.stop.clone();
        handles.push(thread::spawn(move || {
            while sleep_interruptible(&stop, DEFAULT_RESIZE_INTERVAL) {
                if let Some(cache) = weak.upgrade() {
                    cache.check_size();
                }
            }
        }));

        self.handles.lock().extend(handles);
    }

    fn check_ttl(&self, max_size: usize) {
        let mut inner = self.inner.lock();
        let mut current = inner
            .clean_flag
            .as_ref()
            .and_then(|key| inner.table.get(key).copied())
            .or_else(|| inner.list.tail());

        let mut remaining = max_size;
        while remaining > 0 {
            let Some(index) = current else {
                break;
            };
            let next = inner.list.prev(index);
            if inner
                .list
                .get(index)
                .is_some_and(|node| node.expired(Instant::now()))
            {
                if let Some(stats) = self.stats.read().as_ref() {
                    stats.add_expires(1);
                }
                self.delete_element(&mut inner, index);
            }
            current = next;
            remaining -= 1;
        }

        inner.clean_flag =
            current.and_then(|index| inner.list.get(index).map(|node| node.key.clone()));
    }

    fn check_size(&self) {
        let mut inner = self.inner.lock();
        let evicts = self.evicts.swap(0, Ordering::Relaxed) as usize;
        let cur_len = self.cur_len.load(Ordering::Relaxed);
        let next_len = inner.size_checker.calc_next_len(
            cur_len,
            self.max_len,
            evicts,
            self.step,
            DEFAULT_REDUCE_STEP,
        );
        self.cur_len.store(next_len, Ordering::Relaxed);
        if let Some(stats) = self.stats.read().as_ref() {
            stats.set_cache_size(next_len);
        }
    }

    pub fn get(&self, key: &K) -> Option<(CacheData, Duration)> {
        let mut inner = self.inner.lock();
        let index = *inner.table.get(key)?;
        let now = Instant::now();
        let (remaining, expired) = {
            let node = inner.list.get(index)?;
            (node.remaining_ttl(now), node.expired(now))
        };
        if expired {
            if let Some(stats) = self.stats.read().as_ref() {
                stats.add_expires(1);
            }
            self.delete_element(&mut inner, index);
            return None;
        }
        inner.list.move_to_front(index);
        let value = inner.list.get(index)?.value.clone();
        Some((value, remaining))
    }

    pub fn all(&self) -> HashMap<K, CacheData> {
        let inner = self.inner.lock();
        let mut result = HashMap::with_capacity(inner.table.len());
        for (key, index) in &inner.table {
            if let Some(node) = inner.list.get(*index) {
                result.insert(key.clone(), node.value.clone());
            }
        }
        result
    }

    pub fn set(&self, key: K, value: CacheData, ttl: Duration) {
        let ttl = if ttl.is_zero() { self.expiration } else { ttl };
        let mut inner = self.inner.lock();
        if let Some(index) = inner.table.get(&key).copied() {
            if let Some(node) = inner.list.get_mut(index) {
                node.value = value;
                node.ttl = ttl;
                node.added_at = Instant::now();
            }
            inner.list.move_to_front(index);
        } else {
            self.add_new(&mut inner, key, value, ttl);
        }
    }

    pub fn touch(&self, key: &K, ttl: Duration) {
        let ttl = if ttl.is_zero() { self.expiration } else { ttl };
        let mut inner = self.inner.lock();
        if let Some(index) = inner.table.get(key).copied()
            && let Some(node) = inner.list.get_mut(index)
        {
            node.ttl = ttl;
        }
    }

    pub fn delete(&self, key: &K) {
        let mut inner = self.inner.lock();
        if let Some(index) = inner.table.get(key).copied() {
            self.delete_element(&mut inner, index);
        }
    }

    pub fn mdelete(&self, keys: &[K]) {
        let mut inner = self.inner.lock();
        for key in keys {
            if let Some(index) = inner.table.get(key).copied() {
                self.delete_element(&mut inner, index);
            }
        }
    }

    pub fn flush(&self) {
        let mut inner = self.inner.lock();
        inner.list.clear();
        inner.table.clear();
        inner.clean_flag = None;
    }

    pub fn get_ttl(&self) -> Duration {
        self.expiration
    }

    pub fn set_stats(&self, stats: Arc<Stats>) {
        *self.stats.write() = Some(stats);
    }

    pub fn report(&self) -> String {
        String::new()
    }

    pub fn stop(&self) {
        self.stop.store(true, Ordering::Relaxed);
        let handles = std::mem::take(&mut *self.handles.lock());
        for handle in handles {
            let _ = handle.join();
        }
    }

    fn add_new(&self, inner: &mut Lru1Inner<K>, key: K, value: CacheData, ttl: Duration) {
        let index = inner
            .list
            .push_front(key.clone(), value, Instant::now(), ttl);
        inner.table.insert(key, index);
        self.check(inner);
    }

    fn delete_element(&self, inner: &mut Lru1Inner<K>, index: usize) {
        let Some(node) = inner.list.remove(index) else {
            return;
        };
        inner.table.remove(&node.key);
        if let Some(callback) = &self.options.timeout_callback {
            callback(&node.key, &node.value);
        }
    }

    fn check(&self, inner: &mut Lru1Inner<K>) {
        while inner.list.len() > self.cur_len.load(Ordering::Relaxed) {
            let Some(tail) = inner.list.tail() else {
                break;
            };
            let now = Instant::now();
            if inner.list.get(tail).is_some_and(|node| node.expired(now)) {
                if let Some(stats) = self.stats.read().as_ref() {
                    stats.add_expires(1);
                }
            } else {
                if let Some(stats) = self.stats.read().as_ref() {
                    stats.add_evicts(1);
                }
                self.evicts.fetch_add(1, Ordering::Relaxed);
            }
            self.delete_element(inner, tail);
        }
    }
}

impl<K: CacheKey> Drop for Lru1<K> {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}
