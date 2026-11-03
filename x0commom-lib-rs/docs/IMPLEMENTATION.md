# ycache v2 Rust 实现原理

本文解释 `x0commom-lib-rs` 如何实现 `git.ihago.top/ihago/ycache/v2`。参考版本是 v2.6.3-rc2，v2 API 与 v2.6.2 一致。文档面向要维护、扩展或审查这个库的工程师。

范围说明：

- 覆盖 `CacheV2`、`LruCache`、`RedisShardCache`、`mcache`、`singleflight`、`stats`、事件队列、回源超时、gob 兼容和删除同步。
- 不覆盖 deprecated 的 Sink/ByteView 旧接口，也不覆盖 v3 泛型 API。原因见[与 Go 的差异](#15-与-go-的差异)。

## 阅读路径

- 先看[设计目标](#1-设计目标)和[分层与模块](#2-分层与模块)，建立整体结构。
- 再看[读路径](#4-读路径)、[LRU1](#7-lru1)、[LRU-K](#8-lru-k)和[Redis 分片](#9-redis-分片)，理解核心算法。
- 需要排查线上行为时看[TTL 语义](#5-ttl-语义)、[并发控制](#6-并发控制)和[统计](#11-统计)。
- 准备改造或扩展时看[与 Go 的差异](#15-与-go-的差异)和[扩展点](#17-扩展点)。

## 1. 设计目标

移植的目标不是逐行翻译 Go 代码，而是保持可观察行为一致，同时让 Rust 的类型系统承担边界检查。三条约束决定了实现方式。

1. **行为一致优先。** 读穿顺序、归并回源、TTL 计算、淘汰顺序、分片路由、统计口径都与 Go 对齐。测试直接复刻 Go 用例和黄金向量。
2. **后端可替换。** 缓存后端、Redis 客户端、指标上报、同步传输都通过 trait 注入。核心库不绑定具体网络客户端或运行时。
3. **并发安全靠所有权。** 共享值使用 `Arc`，可变状态使用 `Mutex` 或 `RwLock`，后台线程持有 `Weak`，不出现悬垂指针或未定义行为。

## 2. 分层与模块

运行时只有一条主链路：`CacheV2` 负责回源编排，`Cacher` 负责存取。`LruCache` 和 `RedisShardCache` 是两种 `Cacher` 实现。其余模块是主链路的支撑组件。

```text
业务代码
   |
   v
CacheV2<K>                      读穿、归并、限流、TTL、删除同步
   |
   +-- Cacher<K> ---------------+
   |        |                   |
   |        v                   v
   |   LruCache<K>        RedisShardCache<K>
   |        |                   |
   |        v                   v
   |   Lru1 / LruK        RedisConnection
   |
   +-- SingleFlight            同一个 key 只回源一次
   +-- RateLimiter             回源令牌桶
   +-- TimeoutGuard            回源超时与慢回源回调
   +-- Stats                   双缓冲计数
   +-- EventQueue              定时刷新队列
   +-- GlobalSync              删除同步消息
```

Go 包与 Rust 模块的对应关系：

| Go | Rust | 职责 |
|---|---|---|
| `ycache.go`、`ycache_v2.go` | `cache_v2.rs` | 回源编排 |
| `cache.go` | `cacher.rs` | `Cacher` trait |
| `cacheable.go`、`byteview.go` | `cacheable.rs` | `Cacheable`、`CacheData`、`ByteView`、`InterfaceView` |
| `plugins/localcache.go` | `plugins/localcache.rs` | LRU 插件 |
| `plugins/redis_shard.go` | `plugins/redis_shard.rs` | Redis 分片插件 |
| `lru/` | `lru/` | LRU1、LRU-K、容量调整 |
| `mcache/` | `mcache.rs` | 类型化封装 |
| `singleflight/` | `singleflight.rs` | 请求归并 |
| `stat/` | `stats.rs` | 统计与上报 |
| `eventqueue/` | `eventqueue.rs` | 内存刷新队列 |
| `timeout_guard.go` | `timeout_guard.rs` | 回源超时 |
| `default_codec.go` | `codec.rs` | 编解码 |
| `global_sync.go` | `global_sync.rs` | 同步消息协议 |

## 3. 数据模型

### 3.1 CacheData

Go 用 `interface{}` 承载缓存值。Rust 用 `CacheData` 表达同样的四种形态。

```rust
pub enum CacheData {
    Nil,
    Bytes(Arc<[u8]>),
    Str(Arc<str>),
    Any(Arc<dyn Any + Send + Sync>),
}
```

`Bytes` 和 `Str` 对应 Go 的 `[]byte` 和 `string`。`Any` 对应进程内缓存的任意结构体。`Nil` 对应穿透占位。

选择枚举而不是裸 `dyn Any`，原因是 Redis 后端只能写字节。`Bytes` 和 `Str` 可以在不丢失类型信息的情况下直接写入 Redis。

### 3.2 Cacheable

```rust
pub trait Cacheable: Send + Sync + 'static {
    fn ttl(&self) -> i32;
    fn data(&self) -> CacheData;
    fn equal(&self, other: &dyn Cacheable) -> bool;
    fn as_any(&self) -> &dyn Any;
}
```

`CacheValue` 是 `Arc<dyn Cacheable>`。使用 `Arc` 的原因是同一个值会同时被缓存后端、归并回源的等待者和调用方持有。克隆 `Arc` 只增加引用计数。

`InterfaceView::new` 在构造时保存一个基于 `PartialEq` 的相等闭包。`InterfaceView::new_json` 额外保存一个序列化闭包，供 `JsonCodec` 使用。两个闭包都只在构造时确定，之后随视图一起移动。

### 3.3 ByteView

`ByteView` 保留 Go 的语义：内部要么是字节，要么是字符串，读取时返回字节切片。`ttl` 是缓存条目剩余时间，单位秒。

### 3.4 CacheKey

Go 的 key 是 `interface{}`，用 `==` 和 map 比较。Rust 要求 `Eq + Hash`，因此定义：

```rust
pub trait CacheKey: Clone + Eq + Hash + Send + Sync + 'static {
    fn as_key_string(&self) -> String;
    fn from_key_string(_value: &str) -> Option<Self> { None }
    fn is_empty_key(&self) -> bool { false }
}
```

三个方法各有用途。

- `as_key_string` 用于 Redis key、归并回源的 key 和同步消息。
- `from_key_string` 用于刷新队列，因为队列只传字符串。
- `is_empty_key` 复刻 Go 的 `key == ""`。空字符串是非法 key，空 `Vec<u8>` 和数字 0 不是。

已实现 `String`、`&'static str`、`Arc<str>`、`Vec<u8>` 和全部整数类型。自定义 key 只需实现这个 trait。

### 3.5 Cacher

```rust
pub trait Cacher<K: CacheKey>: Send + Sync {
    fn get(&self, key: &K) -> Result<Option<CacheValue>>;
    fn mget(&self, keys: &[K]) -> Result<(HashMap<K, CacheValue>, Vec<K>)>;
    fn set(&self, key: &K, value: CacheValue) -> Result<()>;
    fn delete(&self, key: &K) -> Result<()>;
    fn mdelete(&self, keys: &[K]) -> Result<()>;
    fn touch(&self, key: &K, ttl: i32) -> Result<()> { Ok(()) }
    fn stop(&self) -> Result<()> { Ok(()) }
    fn cache_id(&self) -> String;
    fn get_key(&self, keys: &[K]) -> String;
    fn set_stats(&self, stats: Arc<Stats>);
}
```

`get` 返回 `Ok(None)` 表示未命中。错误和未命中分开，原因是 `CacheV2` 在缓存故障时仍然回源。`get_key` 负责把多个 key 拼成归并回源使用的唯一字符串。

## 4. 读路径

`CacheV2::get` 是整个库的核心。它按固定顺序执行。

```text
get(key, getter)
  |
  +-- 校验 key
  |
  +-- source_only 或 refresh?
  |     是: 直接回源，refresh 时写缓存
  |
  +-- 查缓存
  |     命中且剩余 TTL >= extend_ttl: 返回缓存值
  |     命中但 TTL 不足: 记为老值，继续回源
  |     未命中: 继续
  |
  +-- singleflight.Do(cache_key)
         |
         +-- 再查一次缓存
         |     命中且 TTL 足够: 返回，计入 CacheHit
         |
         +-- 限流
         +-- 带超时回源
         +-- ErrSourceNotFound: 写入 Nil 占位
         +-- 成功: 写入缓存，TTL = 源 TTL + extend_ttl
         +-- 失败且存在老值且开启 extend_ttl: 返回老值
         |
         v
      返回缓存值或源值
```

### 4.1 为什么回源前要再查一次缓存

singleflight 只能合并同时进行的调用。两个请求可能先后错过第一次缓存查询，然后先后进入 `load`。第二个请求进入 singleflight 时，第一个请求可能已经写完缓存。再查一次可以避免重复回源和重复写入。

### 4.2 返回值与缓存值不是同一个 TTL

回源成功后，调用方拿到的是源值，TTL 是源函数设置的 TTL。写入缓存的值使用 `源 TTL + extend_ttl`。这是 Go 的行为，测试 `extend_ttl_serves_old_value_on_source_error` 明确验证了这一点。

### 4.3 穿透占位

回源返回 `ErrSourceNotFound` 时，`lookup_source` 做两件事。

1. 增加 `SourceNotFound` 统计。
2. 如果 `impenetrable_ttl` 不为 0，返回 `InterfaceView::nil(impenetrable_ttl)`。

这个空值会被写入缓存，后续请求直接命中空值，不再回源。默认值是 60 秒。把 `impenetrable_ttl` 设为 0 会关闭占位，源不存在时每次请求都会回源。

### 4.4 老值兜底

开启 `extend_ttl` 后，缓存里的 TTL 总是比源 TTL 多一段。当剩余 TTL 小于 `extend_ttl` 时，本次请求提前回源。如果回源失败，`load` 返回缓存中的老值，不把错误传给调用方。这是用一致性换可用性。

### 4.5 MGET

`CacheV2::mget` 与单 key 路径结构相同，区别有三点。

1. 缓存层按 key 批量查询，命中的 key 直接返回。
2. 剩余 TTL 不足的 key 会加入回源列表，但仍然保留在命中结果里。
3. 回源结果覆盖缓存结果。

批量回源的 singleflight key 是 `"sfmgets:" + cacher.get_key(keys)`。前缀避免和单 key 的归并键冲突。

如果缓存后端报错，`mget` 把全部 key 当作未命中继续回源。Go 在这个分支会带着空的未命中列表继续，结果为空。这里选择让缓存故障降级为回源，而不是返回空结果。

## 5. TTL 语义

| 场景 | 行为 |
|---|---|
| 值为 `ttl = 0` | LRU 使用构造时的默认过期时间。Redis 不设置过期时间。 |
| `extend_ttl > 0` | 写入 `ttl + extend_ttl`。剩余 TTL 小于 `extend_ttl` 时提前回源。 |
| 回源失败且有老值 | 返回老值，忽略错误。 |
| 回源返回 `ErrSourceNotFound` | 写入 `Nil` 占位，TTL 为 `impenetrable_ttl`。 |
| Redis 未开启 `ValueWithTTL` | 读到的 TTL 为 0。开启 `extend_ttl` 时会持续回源，因为无法判断剩余时间。 |

最后一行是 Go 的限制，不是 Rust 新增的行为。需要 Redis 上的 TTL 判断时，使用 `ValueWithTTL`。

## 6. 并发控制

### 6.1 SingleFlight

`SingleFlight` 用 `Mutex<HashMap<String, Arc<Call>>>` 保存进行中的调用。

1. 第一个调用者成为 leader，插入 `Call`，执行闭包。
2. 后来的调用者拿到同一个 `Arc<Call>`，在 `Condvar` 上等待。
3. leader 把结果放进 `Call`，设置 `done`，唤醒所有等待者，然后从 map 中删除这个 key。
4. 等待者克隆结果。结果类型必须实现 `Clone + Send + Sync + 'static`。

leader 的闭包用 `catch_unwind` 包裹。闭包 panic 时，leader 把 panic 转成 `CacheError`，等待者收到同一个错误。Go 用 `recover` 做同样的事。

删除 key 的时机在唤醒之后。这个顺序保证等待者不会在结果写入前被唤醒，也保证后续新请求会开启新一轮回源。

### 6.2 回源限流

`RateLimiter` 是令牌桶，速率和容量都等于 `SourceOptions.limit`。每次回源调用 `take_available(1)`。返回 0 时，`lookup_source` 返回 `TooManyRequests`，`load` 把它计入 `SourceErr`。

### 6.3 回源超时

`timeout_guard::do_with_timeout` 有两种模式，由 `ignore_source_timeout_err` 决定。

- **同步模式**，`ignore_source_timeout_err = true`。回源在调用线程执行。另一个线程等到截止时间，如果回源还没结束，调用 `slow_source_callback`。回源结束后发送取消信号，观察线程立即退出。调用方拿到真实结果。
- **异步模式**，`ignore_source_timeout_err = false`。回源在独立线程执行。调用方最多等待 `lookup_source_timeout`。超时返回 `SourceTimeout`，回源线程继续运行，结果被丢弃。

默认是同步模式，超时只报警，不改变返回结果。这与 Go 的默认值一致。

### 6.4 循环检查

开启 `enable_loop_check` 后，`load` 把 cache key 放入线程本地集合。同一个线程再次进入同一个 key 时 panic。Go 用 context 传递集合，Rust 没有 context，因此使用线程本地存储。跨线程的循环无法检测，这是实现差异。

## 7. LRU1

`Lru1` 是带 TTL 的 LRU，容量会随时间调整。

### 7.1 数据结构

Go 用 `container/list` 加 `map[interface{}]*list.Element`。Rust 不能安全地同时持有节点指针和 map，因此使用 arena 链表。

```text
nodes: Vec<Option<Node<K, CacheData>>>
free:  Vec<usize>
head:  Option<usize>   最近使用
tail:  Option<usize>   最久未使用
table: HashMap<K, usize>
```

`Node` 保存 `prev` 和 `next` 下标。删除节点时把槽位放回 `free`，下次插入复用。所有操作都是 O(1)，不使用 `unsafe`。

### 7.2 读取

1. 从 `table` 取下标。
2. 计算剩余 TTL。已过期就删除，计入 `Expires`，返回未命中。
3. 把节点移到表头。
4. 返回值和剩余 TTL。

### 7.3 写入

TTL 为 0 时使用构造时的 `expiration`。key 已存在时更新值、TTL 和 `added_at`，然后移到表头。key 不存在时插入表头，再执行 `check`。

`check` 从表尾开始删除，直到长度不超过 `cur_len`。过期节点计入 `Expires`，未过期节点计入 `Evicts`，并增加扩容计数器。

### 7.4 容量调整

`SizeChecker` 每 5 秒运行一次。

```text
evicts > 0:
    next = (evicts / step) * step + step + cur_len
    next = min(next, max_len)
    shrinks = 0
evicts == 0:
    shrinks += 1
    if shrinks >= 3 and cur_len > 2 * step:
        next = cur_len - reduce_step
    else:
        next = cur_len
```

`step` 是 5000，`reduce_step` 是 500。发生过淘汰就按 5000 的倍数扩容。连续三个周期没有淘汰才收缩，避免突发流量后容量抖动。收缩下限是 `2 * step`。

初始容量是 `min(5000, max_len)`。这样小缓存不会一上来就按 5000 扩容。

### 7.5 后台线程

- TTL 扫描线程每秒从 `clean_flag` 开始检查 100 个节点。`clean_flag` 保存 key，避免保存会失效的节点下标。
- 容量调整线程每 5 秒运行一次。

两个线程都持有 `Weak<Lru1>`。缓存被释放后线程自然退出。停止信号用 50 毫秒切片轮询，避免 `Drop` 等满一个完整周期。

## 8. LRU-K

`LruK` 用三层结构区分一次性访问和热点访问。默认配置是三层，每层最大长度 `min(5000, max_len)`，提升阈值 2，降级比例 10%。

### 8.1 层级

| 层 | 结构 | 作用 |
|---|---|---|
| 0 | 普通链表加 `base_table` | 新 key 进入这里。访问一次就提升。 |
| 1 | 链表加 `freq_tables[1]` | 访问次数超过阈值后提升到第 2 层。 |
| 2 | 链表加 `freq_tables[2]` | 超热点数据。 |

`freq_tables[level]` 保存 `key -> { index, freq }`。`base_table` 保存第 0 层的 `key -> index`。

### 8.2 读取与提升

`get_level(level, key)` 的行为：

1. 第 0 层直接命中就准备提升。
2. 第 1、2 层先增加 `freq`。`freq > promote_threshold` 时准备提升。
3. 检查过期。过期就删除并返回未命中。
4. 需要提升时调用 `promote_level`，否则移到表头。
5. 对当前层执行一次容量检查。

`promote_level` 先把节点移到上一层。如果上一层已满，先把上一层的表尾降回当前层，再把节点提升上去。降级和提升都更新对应的表。

### 8.3 降级

`retire_level` 按间隔运行。对第 1 层和第 2 层分别执行：

1. 计算 `count = len * retire_rate / 100`。
2. 遍历这一层的 map，取前 `count` 个条目。
3. 过期条目直接删除。
4. 未过期条目移到下一层。第 1 层移到第 0 层，第 2 层移到第 1 层。
5. 更新降级计数。

遍历顺序由 `HashMap` 决定，和 Go 的 map 一样不保证顺序。测试只断言层级数量，不断言具体 key。

### 8.4 容量调整

`LruK` 的每层容量由独立的 `SizeChecker` 调整。调整线程只在调用 `set_stats` 后启动，这与 Go 一致。`CacheV2` 构造时一定会调用 `set_stats`，所以正常使用会启动调整。

### 8.5 与 LRU1 的差异

`LruK::set` 更新已有 key 时修改值和 TTL，但不重置 `added_at`。`Lru1::set` 会重置 `added_at`。这是 Go 的原行为，测试按原行为断言。

## 9. Redis 分片

### 9.1 槽位

分片总数是 16384。配置里所有 `resp_slot` 都为 0 时，库按分片数量均分槽位。最后一个分片拿到剩余的槽位。之后按起始槽位稳定排序，并检查：

1. 第一个分片从 0 开始。
2. 最后一个分片到 16383 结束。
3. 相邻分片连续，没有空洞。

任何一条不满足就返回错误。

### 9.2 路由

```text
hash_with_tag(key):
    如果 key 中有 '{':
        找到第一个 '{' 之后的 '}'
        存在就只对花括号内的内容做哈希
    return crc32_ieee(content) % 16384
```

选择实例时线性扫描槽位区间。分片数量很少，线性扫描比维护区间树更简单。

### 9.3 批量读取

`mget` 先按实例分组，再对每个实例发一次 MGET。返回顺序与请求顺序一致。缺失的 key 放进 miss 列表。

### 9.4 写入 TTL

写入时按顺序选择 TTL：

1. 值的 TTL 大于 0，使用值的 TTL。
2. 否则插件 `TTL` 大于 0，使用插件 TTL。
3. 否则不设置过期时间。

### 9.5 ValueWithTTL 与 gob

开启 `ValueWithTTL` 后，Redis 里存的是 Go `encoding/gob` 编码的：

```go
type cacheValue struct {
    ExpireTs int64
    Value    []byte
}
```

Rust 侧必须写出完全相同的字节，否则 Go 服务读不了。`plugins/gob.rs` 做了两件事。

1. 写入固定的类型描述符。Go 每次新建 encoder 都会先写这个描述符。
2. 按 gob 规则编码字段号和值。整数使用 zigzag 变体，无符号整数小于等于 0x7F 时写单字节，否则写负的长度前缀加定长大端整数。

解码时先校验类型描述符，再按字段号读取。测试里的黄金向量由 Go 程序生成，逐字节比对。

### 9.6 Redis 客户端抽象

库不依赖具体 Redis crate。`RedisConnection` 定义 `get`、`mget`、`set`、`del`、`expire` 五个操作。`RedisPoolFactory` 根据分片配置创建连接。

这样做的原因有三点。

- 服务可能使用同步或异步客户端。
- 内部客户端可能带哨兵、读写分离或连接池策略。
- 测试可以注入内存实现，不需要启动 Redis。

`enable_slave` 和 `read_slave_only` 传给工厂，由工厂决定读主还是读从。分片层不强制读写分离。

## 10. mcache 类型化封装

`mcache::Cache<K, V>` 把 `CacheValue` 的 downcast 封装起来，调用方只看到 `V`。

`Source` trait 返回 `(Option<V>, ttl)`。`get` 把值包装成 `InterfaceView` 交给 `CacheV2`，再把返回的 `CacheValue` downcast 成 `V`。

### 10.1 JSON 路径

Redis 只能存字节，`CacheData::Any` 无法直接写入。`new_json_lru_cache` 和 `new_json_redis_cache` 做三件事。

1. 把 `options.codec` 设为 `JsonCodec`。
2. 用 `InterfaceView::new_json` 包装源值。视图保存一个 `serde_json::to_vec` 序列化闭包。
3. 读取时先尝试 downcast。失败就把 `CacheData::Bytes` 按 JSON 反序列化成 `V`。

这样同一套类型化 API 可以同时用于进程内 LRU 和 Redis。序列化只在跨后端时发生，纯 LRU 路径仍然共享 `Arc`，没有 JSON 开销。

### 10.2 未找到

源返回 `None` 时，包装成 `InterfaceView::nil(ttl)`。这个空值会进入缓存，后续读取 downcast 失败，调用方得到 `None`。这与 Go 的占位行为一致。

## 11. 统计

`Stats` 使用两块计数器缓冲区。上报时切换到另一块，报告并清零上一块。这样上报期间的新计数不会丢失。

| 指标 | 含义 |
|---|---|
| `CacheHits` | 缓存命中次数 |
| `CacheMisses` | 缓存未命中次数 |
| `CacheHitRate` | 命中率，整数表示，9999 表示 99.99% |
| `SourcesDeduped` | 实际回源次数 |
| `SourceHits` | 回源成功次数 |
| `SourceErrs` | 回源失败次数 |
| `SourceNotFound` | 回源不存在次数 |
| `SetErrs` | 写缓存失败次数 |
| `Evicts` | 容量淘汰次数 |
| `Expires` | TTL 过期次数 |
| `SourceCosts` | 回源总耗时，上报时取平均值 |
| `CacheSize` | 当前缓存容量 |

上报通过 `MetricsSink` 输出。默认实现是 `NoopMetrics`，服务可以接入自己的指标系统。

## 12. 事件队列与定时刷新

`MemoryEventQueue` 用最小堆保存 `(到期时间, 序号, 事件)`。

1. 分发线程每秒取出到期事件，放入容量 1024 的同步通道。
2. 100 个工作线程从通道取事件并调用处理器。
3. 处理器返回 `EventRetry` 时，事件在 5 秒后重新入队。
4. 通道满时丢弃事件，不阻塞分发线程。

`CacheV2::register_refresh_func` 按前缀注册队列。前缀之间不能互相包含，否则返回错误。处理器从事件字符串还原 key，调用 `get` 并带 `refresh = true`，回源成功后写缓存。

限制：

- `remove_event` 是空操作，与 Go 的内存队列一致。
- Redis 刷新队列未移植。需要跨进程刷新时，可以实现 `EventQueue` trait。

## 13. 删除同步

同步消息的 JSON 字段名与 Go 一致：

```json
{"Op":"Delete","Keys":["user:1"],"SeqID":1700000000000000000}
```

`GlobalSync` 负责三件事。

1. 编码和发送消息。消息 key 是 `CacheID + SeqID`。
2. 解码收到的消息。
3. 过滤自己发出的消息。key 以本实例 `CacheID` 开头时跳过。

实际发送通过 `SyncTransport` 注入。库不绑定 Kafka 客户端。`CacheV2::handle_sync_message` 处理 `Delete` 和 `MDelete`，直接调用底层 `Cacher` 删除。

限制：

- 非字符串 key 会被转换成字符串再发送。Go 在这种情况下返回 `ErrRequireString`。
- 收到消息后还原 key 依赖 `CacheKey::from_key_string`。自定义 key 不实现这个方法时，同步消息会被忽略。

## 14. 生命周期

### 14.1 CacheV2

`CacheV2::new` 做五件事。

1. 补全 `cache_id` 和 `report_name`。
2. 创建 `Stats` 并交给 `Cacher`。
3. 按 `source_options.limit` 创建限流器。
4. 按 `enable_sync` 创建 `GlobalSync`。
5. 启动统计上报线程。

上报线程用带超时的通道接收停止信号，不直接睡眠。`stop` 先丢弃发送端，再 join 线程。这样停止不会等到下一个上报周期。

### 14.2 LRU

`Lru1` 和 `LruK` 的后台线程持有 `Weak`。缓存释放后线程退出。停止信号用 50 毫秒切片轮询，`Drop` 最多等待一个切片。

`LruK` 的容量调整线程由 `LruKSettings` 持有。`stop` 会 join 这个线程。

### 14.3 事件队列

`MemoryEventQueue::stop` 设置停止标志，丢弃发送端，然后 join 分发线程和工作线程。工作线程用 500 毫秒超时接收，能及时看到停止标志。队列可以再次 `start`，启动时会清除停止标志。

## 15. 与 Go 的差异

| 差异 | 原因 |
|---|---|
| 不实现 Sink、`Getter`、`MGetter`、`GetByteView` | 这些接口已标记 deprecated。Rust 版直接返回 `CacheValue`。 |
| 不实现 `CacheV3` 和 `genericplugins` | 需求限定 v2 最新版本。 |
| Kafka 只实现协议和编排 | 不绑定内部 Kafka 客户端。发送通过 `SyncTransport` 注入。 |
| Redis 客户端通过 trait 注入 | 避免绑定同步或异步客户端，便于测试。 |
| 不实现 Redis 刷新队列 | 当前只有内存队列。需要时实现 `EventQueue`。 |
| `CacheV2::mget` 在缓存报错时把全部 key 当未命中 | 缓存故障时降级回源，避免返回空结果。 |
| `LruCache::mget` 用原始 key 返回命中项 | 回填目标容器需要原始 key。Go 用格式化后的 key，自定义 formatter 时行为不同。 |
| 缓存读取后 `InterfaceView` 的相等闭包丢失 | `Cacher` 只保存 `CacheData`，无法保存具体类型的比较函数。类型化调用走 downcast，不受影响。 |
| 循环检查使用线程本地存储 | Rust 没有 context。跨线程循环无法检测。 |
| 非字符串 key 的同步消息转成字符串 | 便于发送。Go 会返回 `ErrRequireString`。 |

## 16. 验证

验证分三层。

### 16.1 行为对齐测试

`tests/lru_parity.rs` 复刻 Go `Test_lruK_Get`。断言三层数量依次为：

```text
60/0/0 -> 30/30/0 -> 30/20/10 -> 32/19/9 -> 33/18/9
```

`tests/cache_v2_parity.rs` 覆盖读穿、删除回源、MGET、穿透占位、ExtendTTL 老值、并发归并和统计。

### 16.2 黄金向量

`plugins/gob.rs` 的测试包含 9 组 Go 生成的 gob 字节。编码结果逐字节比对，解码结果与原始值比对。

`tests/redis_shard_parity.rs` 的哈希测试包含 9 个 key，覆盖普通 key、hash tag、空 key 和中文 key。

### 16.3 并发与超时

`singleflight_dedupes_concurrent_gets` 用 8 个线程同时请求同一个 key，断言源只执行一次。

`tests/timeout_guard.rs` 覆盖快速回源不报警、慢回源报警但返回结果、异步超时返回错误三种情况。

运行全部检查：

```bash
cargo test
cargo clippy --all-targets
cargo fmt --check
```

## 17. 扩展点

| 需求 | 实现方式 |
|---|---|
| 新的缓存后端 | 实现 `Cacher<K>` |
| 接入 Redis 客户端 | 实现 `RedisConnection` 和 `RedisPoolFactory` |
| 自定义指标系统 | 实现 `MetricsSink` |
| 接入 Kafka | 实现 `SyncTransport` |
| 跨进程刷新 | 实现 `EventQueue` |
| 自定义序列化 | 实现 `Codec` |
| 自定义 key 类型 | 实现 `CacheKey` |
| 自定义缓存值 | 实现 `Cacheable` |
