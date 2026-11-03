# x0commom-lib-rs

`git.ihago.top/ihago/ycache/v2` 的 Rust 实现，对齐 **v2 最新版本（v2.6.3-rc2，v2 API 与 v2.6.2 一致）** 的功能与算法。

## 分层

与 Go 版保持一致：

| 层 | Rust | 说明 |
|---|---|---|
| 回源编排 | `CacheV2` | read-through、singleflight 归并、回源限流、穿透占位、ExtendTTL、回源超时、删除同步 |
| 缓存插件 | `LruCache` / `RedisShardCache` | 进程内 LRU1 / LRU-K，或 CRC32 16384 槽 Redis 分片 |
| 易用封装 | `mcache::Cache` | 类型化 `Get` / `MGet`，屏蔽 `Cacheable` |
| 基础组件 | `singleflight`、`stats`、`eventqueue`、`timeout_guard`、`codec` | 与 Go 同名模块一一对应 |

已适配、未适配和刻意调整的部分见文末「与 Go 版的差异」。

## 快速开始

```rust
use std::sync::Arc;
use std::time::Duration;
use x0commom_lib_rs::*;

#[derive(Clone, PartialEq)]
struct User { name: String }

let cacher = plugins::LruCache::<String>::new(
    10_000,
    Duration::from_secs(60),
    PluginOptions::default(),
);
let cache = CacheV2::new(cacher, Options::default(), Arc::new(NoopMetrics));

let getter: Arc<dyn SourceGetter<String>> = Arc::new(|key: &String| {
    Ok(Arc::new(InterfaceView::new(
        User { name: key.clone() },
        30,
    )) as CacheValue)
});

let user = cache.get(&"u:1".to_string(), getter, GetterOptions::default())?;
let user: &User = user.unwrap().data().downcast_ref().unwrap();
```

`mcache` 写法：

```rust
struct UserSource;

impl mcache::Source<String, User> for UserSource {
    fn get(&self, key: &String, _arg: &(dyn std::any::Any + Send + Sync))
        -> Result<(Option<User>, i64)>
    {
        Ok((Some(User { name: key.clone() }), 30))
    }

    fn mget(&self, keys: &[String], _arg: &(dyn std::any::Any + Send + Sync))
        -> Result<(std::collections::HashMap<String, User>, i64)>
    {
        Ok((keys.iter().map(|k| (k.clone(), User { name: k.clone() })).collect(), 30))
    }
}

let cache = mcache::Cache::new_lru_cache(
    10_000,
    Duration::from_secs(60),
    Arc::new(UserSource),
    PluginOptions::default(),
    Options::default(),
);
let user = cache.get(&"u:1".to_string(), Arc::new(()), GetterOptions::default())?;

// Redis 等只接受字节的后端：自动 JSON 序列化 / 反序列化
// let cache = mcache::Cache::new_json_redis_cache(redis, Arc::new(UserSource), PluginOptions::default(), Options::default());
```

Redis 分片通过 `RedisConnection` / `RedisPoolFactory` 接入现有客户端：

```rust
let cacher = RedisShardCache::<String>::new(
    vec![RedisShardOption {
        resp_slot: Slot { begin: 0, end: TOTAL_SLOT_SIZE - 1 },
        addrs: vec!["127.0.0.1:6379".into()],
        ..Default::default()
    }],
    &factory, // impl RedisPoolFactory
    PluginOptions::default(),
)?;
```

## 已实现的 Go 行为

- `CacheV2` 的 read-through、二次查缓存、singleflight 归并、回源限流（`SourceOptions.limit`）。
- `ErrSourceNotFound` 占位（`ImpenetrableTTL`，默认 60 秒）。
- `ExtendTTL`：写入 `ttl + extend_ttl`，剩余 TTL 小于阈值时提前回源；回源失败时返回旧值。
- 回源超时 `LookupSourceTimeout` / `IgnoreSourceTimeoutErr`，以及慢回源回调。
- `SourceOnly` / `GetterRefresh`。
- `Delete` / `MDelete` 与跨区同步消息（`SyncValue` JSON 字段名与 Go 一致，传输层通过 `SyncTransport` 注入）。
- `LRU1`：TTL、淘汰回调、动态容量（`sizeChecker`，5 秒周期，扩容步长与收缩阈值一致）。
- `LRU-K`：三层默认配置、访问计数提升、按比例降级、`retireInterval`、逐层 TTL 清理。
- `RedisShardCache`：槽位自动均分、连续性校验、`{hash tag}`、CRC32-IEEE、MGET 按分片分组、`TTL` / `ValueWithTTL`。
- `ValueWithTTL` 的 gob 编码与 Go `encoding/gob` 字节级一致（`src/plugins/gob.rs` 内置 Go 生成的黄金向量）。
- 统计项、命中率、回源耗时、缓存大小上报，通过 `MetricsSink` 输出。
- `Codec` / `JsonCodec`：`InterfaceView::new_json` 的值会序列化成 JSON 字节，便于 Redis 等只接受字节的后端；`mcache::Cache::new_json_lru_cache` / `new_json_redis_cache` 自动完成序列化与反序列化。
- 内存版 `EventQueue`：延迟事件、100 协程等价 worker、`ErrEventRetry` 重试、`EventLength`。

## 与 Go 版的差异

1. **未移植 deprecated API**：`Sink`/`StringSink`/`ByteSink`/`Getter`/`MGetter`/`GetByteView`/`MGetByteView` 等旧接口。对外统一返回 `CacheValue`。
2. **未移植 v3 泛型 API**（`CacheV3`、`genericplugins`），按“v2 最新版本”范围处理。
3. **Kafka 同步只保留协议与编排**：`GlobalSync` 负责消息编解码、自身消息过滤、`Delete`/`MDelete` 分发；实际发送由 `SyncTransport` 实现。`KafkaConfig.GroupIDAsPrefix` 的 UUID 逻辑在传输层。
4. **Redis 刷新队列**（`SourceOptions.RedisRefresh`）未移植，当前提供内存版 `EventQueue`；如有需要可在 `EventQueue` trait 上补 Redis 实现。
5. **Redis 客户端不绑定具体 crate**：通过 `RedisConnection` trait 适配 `redis`、`fred` 或内部客户端，便于服务选型与测试。
6. **反射型 Sink 改为类型化返回值**：`CacheV2::get` 返回 `Option<CacheValue>`，`mcache` 再 downcast 为 `V`。`CacheData::Any` 的相等比较使用构造时提供的 `PartialEq`；经过缓存后端后（尤其是 Redis 字节）类型信息不再保留，需要 JSON 序列化时用 `InterfaceView::new_json` 或 `mcache` 的 `new_json_*` 构造器。
7. **刷新队列回填 key** 需要 `K: CacheKey::from_key_string`（`String`、数字、`Vec<u8>`、`Arc<str>` 已实现）；自定义 key 需自行实现。
8. **`CacheV2::mget` 在缓存后端报错时** 把全部 key 视为 miss 回源（Go 版会带着空 miss 列表继续），避免缓存故障时直接返回空结果。

## 测试

```bash
cargo test
cargo clippy --all-targets
```

测试覆盖：

- `tests/lru_parity.rs`：复刻 Go `Test_lruK_Get` 的层级演进 `60/0/0 → 30/30/0 → 30/20/10 → 32/19/9 → 33/18/9`。
- `tests/cache_v2_parity.rs`：读穿、删除回源、MGET、穿透占位、ExtendTTL 旧值、singleflight 并发去重、统计。
- `tests/redis_shard_parity.rs`：槽位均分/校验、CRC32 黄金向量、MGET 分片、`ValueWithTTL` gob 往返。
- `tests/mcache_parity.rs`：类型化 Get/MGet、事件队列延迟与重试。
- `src/plugins/gob.rs`：Go `encoding/gob` 字节级黄金向量。
