use std::sync::Arc;
use std::time::Duration;

use crate::key::{CacheKey, KeyFormatter};

pub type SlowSourceCallback = Arc<dyn Fn(&str) + Send + Sync>;

/// `ycache.KafkaConfig`
#[derive(Debug, Clone, Default)]
pub struct KafkaConfig {
    pub topic: String,
    pub addrs: Vec<String>,
    pub consumer_co_num: u32,
    pub consumer_queue_len: u32,
    pub group_id: String,
    pub group_id_as_prefix: bool,
}

/// Region used for targeted cache-sync notifications.
pub type Region = String;

/// `ycache.SourceOptions`
#[derive(Debug, Clone, Default)]
pub struct SourceOptions {
    /// 0 means unlimited.
    pub limit: u32,
    pub enable_refresh: bool,
}

/// `ycache.GetterOptions`
#[derive(Debug, Clone, Copy, Default)]
pub struct GetterOptions {
    pub source_only: bool,
    pub refresh: bool,
}

/// `ycache.DeleteOptions`
#[derive(Debug, Clone, Default)]
pub struct DeleteOptions {
    pub disable_sync: bool,
    pub dest: Vec<Region>,
}

/// `ycache.Options`
#[derive(Clone)]
pub struct Options {
    pub source_options: SourceOptions,
    pub report_duration: Duration,
    pub enable_sync: bool,
    pub kafka_config: Option<KafkaConfig>,
    pub cache_id: String,
    pub report_name: String,
    pub extend_ttl: i32,
    pub lookup_source_timeout: Duration,
    pub ignore_source_timeout_err: bool,
    pub enable_loop_check: bool,
    pub impenetrable_ttl: i32,
    pub ignore_not_exist_key: bool,
    pub immediately: bool,
    pub clean_cache_on_source_failed: bool,
    pub slow_source_callback: Option<SlowSourceCallback>,
    pub codec: Option<Arc<dyn crate::codec::Codec>>,
    pub sync_transport: Option<Arc<dyn crate::global_sync::SyncTransport>>,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            source_options: SourceOptions::default(),
            report_duration: Duration::from_secs(60),
            enable_sync: false,
            kafka_config: None,
            cache_id: String::new(),
            report_name: String::new(),
            extend_ttl: 0,
            lookup_source_timeout: Duration::from_secs(5),
            ignore_source_timeout_err: true,
            enable_loop_check: false,
            impenetrable_ttl: 60,
            ignore_not_exist_key: false,
            immediately: false,
            clean_cache_on_source_failed: false,
            slow_source_callback: None,
            codec: None,
            sync_transport: None,
        }
    }
}

impl Options {
    pub fn with_source_limit(mut self, limit: u32) -> Self {
        self.source_options.limit = limit;
        self
    }

    pub fn with_enable_refresh(mut self, enable: bool) -> Self {
        self.source_options.enable_refresh = enable;
        self
    }

    pub fn with_report_name(mut self, name: impl Into<String>) -> Self {
        self.report_name = name.into();
        self
    }

    pub fn with_report_duration(mut self, duration: Duration) -> Self {
        self.report_duration = duration;
        self
    }

    pub fn with_extend_ttl(mut self, ttl: i32) -> Self {
        self.extend_ttl = ttl;
        self
    }

    pub fn with_impenetrable_ttl(mut self, ttl: i32) -> Self {
        self.impenetrable_ttl = ttl;
        self
    }

    pub fn with_enable_loop_check(mut self, enable: bool) -> Self {
        self.enable_loop_check = enable;
        self
    }

    pub fn with_lookup_source_timeout(mut self, timeout: Duration) -> Self {
        self.lookup_source_timeout = timeout;
        self
    }

    pub fn with_ignore_source_timeout_err(mut self, ignore: bool) -> Self {
        self.ignore_source_timeout_err = ignore;
        self
    }

    pub fn with_cache_id(mut self, cache_id: impl Into<String>) -> Self {
        self.cache_id = cache_id.into();
        self
    }

    pub fn with_enable_sync(mut self, enable: bool) -> Self {
        self.enable_sync = enable;
        self
    }

    pub fn with_kafka_config(mut self, config: KafkaConfig) -> Self {
        self.kafka_config = Some(config);
        self
    }

    pub fn with_slow_source_callback(mut self, callback: SlowSourceCallback) -> Self {
        self.slow_source_callback = Some(callback);
        self
    }

    pub fn enable_impenetrable_ttl(&self) -> bool {
        self.impenetrable_ttl != 0
    }
}

/// Options for the LRU-based cache plugins.
pub struct PluginOptions<K: CacheKey> {
    pub ttl: i32,
    pub key_formatter: Option<Arc<dyn KeyFormatter<K>>>,
    pub use_lruk: bool,
    pub retire_interval: Duration,
    pub value_with_ttl: bool,
}

impl<K: CacheKey> Clone for PluginOptions<K> {
    fn clone(&self) -> Self {
        Self {
            ttl: self.ttl,
            key_formatter: self.key_formatter.clone(),
            use_lruk: self.use_lruk,
            retire_interval: self.retire_interval,
            value_with_ttl: self.value_with_ttl,
        }
    }
}

impl<K: CacheKey> Default for PluginOptions<K> {
    fn default() -> Self {
        Self {
            ttl: 0,
            key_formatter: None,
            use_lruk: false,
            retire_interval: Duration::ZERO,
            value_with_ttl: false,
        }
    }
}
