//! Rust port of Hago's `git.ihago.top/ihago/ycache/v2`.
//!
//! The crate keeps the Go layering: a read-through orchestration layer
//! (`CacheV2`) on top of a pluggable `Cacher` backend (`LruCache`,
//! `RedisShardCache`). Deprecated Sink/ByteView-era APIs are intentionally not
//! ported.

pub mod cache_v2;
pub mod cacheable;
pub mod cacher;
pub mod codec;
pub mod error;
pub mod eventqueue;
pub mod global_sync;
pub mod key;
pub mod lru;
pub mod mcache;
pub mod options;
pub mod plugins;
pub mod ratelimit;
pub mod singleflight;
pub mod stats;
pub mod timeout_guard;
mod util;

pub use cache_v2::{CacheV2, SourceGetter, SourceMGetter, bytes_value, string_value};
pub use cacheable::{ByteView, CacheData, CacheValue, Cacheable, InterfaceView};
pub use cacher::Cacher;
pub use codec::{BytesCodec, Codec, JsonCodec, StringCodec};
pub use error::{CacheError, Result};
pub use eventqueue::{EventQueue, MemoryEventQueue};
pub use global_sync::{GlobalSync, SyncTransport, SyncValue};
pub use key::{CacheKey, DefaultKeyFormatter, DisplayKeyFormatter, KeyFormatter};
pub use mcache::Source;
pub use options::{
    DeleteOptions, GetterOptions, KafkaConfig, Options, PluginOptions, Region, SourceOptions,
};
pub use plugins::{
    LruCache, RedisConnection, RedisPoolFactory, RedisShardCache, RedisShardOption, Slot,
    TOTAL_SLOT_SIZE,
};
pub use stats::{MetricsSink, NoopMetrics, Stats};
