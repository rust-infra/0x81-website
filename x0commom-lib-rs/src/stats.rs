use std::sync::Arc;
use std::sync::atomic::{AtomicI64, AtomicUsize, Ordering};

/// Metric backend. Go reports to `ymetrics` under the `WaterMark` topic.
pub trait MetricsSink: Send + Sync {
    fn gauge(&self, metric: &str, name: &str, value: i64);
}

#[derive(Debug, Default, Clone, Copy)]
pub struct NoopMetrics;

impl MetricsSink for NoopMetrics {
    fn gauge(&self, _metric: &str, _name: &str, _value: i64) {}
}

/// `stat.AtomicInt`
pub type AtomicInt = AtomicI64;

#[derive(Default)]
struct InnerStats {
    hits: AtomicInt,
    misses: AtomicInt,
    sources_deduped: AtomicInt,
    source_hits: AtomicInt,
    source_errs: AtomicInt,
    source_not_found: AtomicInt,
    set_errs: AtomicInt,
    evicts: AtomicInt,
    expires: AtomicInt,
    source_costs: AtomicInt,
    cache_size: AtomicInt,
}

impl InnerStats {
    fn reset(&self) {
        for counter in [
            &self.hits,
            &self.misses,
            &self.sources_deduped,
            &self.source_hits,
            &self.source_errs,
            &self.source_not_found,
            &self.set_errs,
            &self.evicts,
            &self.expires,
            &self.source_costs,
        ] {
            counter.store(0, Ordering::Relaxed);
        }
    }

    fn report(&self, name: &str, metrics: &dyn MetricsSink) {
        let hits = self.hits.load(Ordering::Relaxed);
        let misses = self.misses.load(Ordering::Relaxed);
        metrics.gauge("WaterMark", &format!("{name}_hits"), hits);
        metrics.gauge("WaterMark", &format!("{name}_misses"), misses);
        let rate = hit_rate(hits, misses);
        if rate > 0 {
            metrics.gauge("WaterMark", &format!("{name}_CacheHitRate"), rate);
        }
        let source_calls = self.sources_deduped.load(Ordering::Relaxed);
        let avg_source_cost = if source_calls > 0 {
            self.source_costs.load(Ordering::Relaxed) / source_calls
        } else {
            0
        };
        metrics.gauge("WaterMark", &format!("{name}_sourcesDeduped"), source_calls);
        metrics.gauge(
            "WaterMark",
            &format!("{name}_sourceHits"),
            self.source_hits.load(Ordering::Relaxed),
        );
        metrics.gauge(
            "WaterMark",
            &format!("{name}_sourceErrs"),
            self.source_errs.load(Ordering::Relaxed),
        );
        metrics.gauge(
            "WaterMark",
            &format!("{name}_setErrs"),
            self.set_errs.load(Ordering::Relaxed),
        );
        metrics.gauge(
            "WaterMark",
            &format!("{name}_evicts"),
            self.evicts.load(Ordering::Relaxed),
        );
        metrics.gauge(
            "WaterMark",
            &format!("{name}_expries"),
            self.expires.load(Ordering::Relaxed),
        );
        metrics.gauge("WaterMark", &format!("{name}_sourceCosts"), avg_source_cost);
        metrics.gauge(
            "WaterMark",
            &format!("{name}_cacheSize"),
            self.cache_size.load(Ordering::Relaxed),
        );
    }

    fn describe(&self) -> String {
        format!(
            "hits: {}, misses: {}, sourceHits: {}, sourceErrs: {}, sourcesDeduped: {}, setErr: {}, evicts: {}, expires: {}",
            self.hits.load(Ordering::Relaxed),
            self.misses.load(Ordering::Relaxed),
            self.source_hits.load(Ordering::Relaxed),
            self.source_errs.load(Ordering::Relaxed),
            self.sources_deduped.load(Ordering::Relaxed),
            self.set_errs.load(Ordering::Relaxed),
            self.evicts.load(Ordering::Relaxed),
            self.expires.load(Ordering::Relaxed),
        )
    }
}

/// `stat.Stats`: two buffers are swapped on report so counters keep working
/// while the previous period is being reported.
pub struct Stats {
    name: String,
    inner: [InnerStats; 2],
    index: AtomicUsize,
    metrics: Arc<dyn MetricsSink>,
}

impl Stats {
    pub fn new(name: impl Into<String>, metrics: Arc<dyn MetricsSink>) -> Arc<Self> {
        Arc::new(Self {
            name: name.into(),
            inner: [InnerStats::default(), InnerStats::default()],
            index: AtomicUsize::new(0),
            metrics,
        })
    }

    fn current(&self) -> &InnerStats {
        &self.inner[self.index.load(Ordering::Acquire) % 2]
    }

    pub fn add_cache_hit(&self, count: i64) {
        self.current().hits.fetch_add(count, Ordering::Relaxed);
    }

    pub fn add_cache_miss(&self, count: i64) {
        self.current().misses.fetch_add(count, Ordering::Relaxed);
    }

    pub fn add_sources_deduped(&self, count: i64) {
        self.current()
            .sources_deduped
            .fetch_add(count, Ordering::Relaxed);
    }

    pub fn add_source_err(&self, count: i64) {
        self.current()
            .source_errs
            .fetch_add(count, Ordering::Relaxed);
    }

    pub fn add_source_hit(&self, count: i64) {
        self.current()
            .source_hits
            .fetch_add(count, Ordering::Relaxed);
    }

    pub fn add_set_err(&self, count: i64) {
        self.current().set_errs.fetch_add(count, Ordering::Relaxed);
    }

    pub fn add_source_not_found(&self, count: i64) {
        self.current()
            .source_not_found
            .fetch_add(count, Ordering::Relaxed);
    }

    pub fn add_evicts(&self, count: i64) {
        self.current().evicts.fetch_add(count, Ordering::Relaxed);
    }

    pub fn add_source_costs(&self, count: i64) {
        self.current()
            .source_costs
            .fetch_add(count, Ordering::Relaxed);
    }

    pub fn add_expires(&self, count: i64) {
        self.current().expires.fetch_add(count, Ordering::Relaxed);
    }

    pub fn source_errs(&self) -> i64 {
        self.current().source_errs.load(Ordering::Relaxed)
    }

    pub fn report(&self) {
        let current_index = self.index.load(Ordering::Acquire) % 2;
        let next_index = (current_index + 1) % 2;
        self.index.store(next_index, Ordering::Release);
        let previous = &self.inner[current_index];
        previous.report(&self.name, self.metrics.as_ref());
        previous.reset();
    }

    pub fn report_name(&self) -> &str {
        &self.name
    }

    pub fn metrics(&self) -> Arc<dyn MetricsSink> {
        self.metrics.clone()
    }

    pub fn evicts(&self) -> i64 {
        self.current().evicts.load(Ordering::Relaxed)
    }

    pub fn set_cache_size(&self, size: usize) {
        self.current()
            .cache_size
            .store(size as i64, Ordering::Relaxed);
    }
}

impl std::fmt::Display for Stats {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.current().describe())
    }
}

fn hit_rate(hit: i64, miss: i64) -> i64 {
    let total = hit + miss;
    if total > 0 { hit * 10000 / total } else { 0 }
}

static LAST_NAME_ID: AtomicInt = AtomicInt::new(0);

pub fn next_id() -> i64 {
    LAST_NAME_ID.fetch_add(1, Ordering::Relaxed) + 1
}
