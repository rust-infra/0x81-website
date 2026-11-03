use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use parking_lot::RwLock;

use crate::cacheable::{CacheData, CacheValue, InterfaceView};
use crate::cacher::Cacher;
use crate::error::{CacheError, Result};
use crate::key::CacheKey;
use crate::options::PluginOptions;
use crate::plugins::gob;
use crate::stats::Stats;

pub const TOTAL_SLOT_SIZE: u32 = 16384;

type InnerGetValues = Vec<Option<(Vec<u8>, i32)>>;
const DEFAULT_MAX_IDLE: usize = 64;
const DEFAULT_MAX_ACTIVE: usize = 256;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Slot {
    pub begin: u32,
    pub end: u32,
}

#[derive(Clone, Debug, Default)]
pub struct RedisShardOption {
    pub resp_slot: Slot,
    pub master_name: String,
    pub addrs: Vec<String>,
    pub enable_slave: bool,
    pub read_slave_only: bool,
    pub max_idle: usize,
    pub max_active: usize,
}

/// Minimal Redis command surface used by the shard plugin. Implement it with
/// your Redis client of choice (sync `redis`, `fred`, a test double, ...).
pub trait RedisConnection: Send + Sync {
    /// Returns `None` for a missing key.
    fn get(&self, key: &str) -> Result<Option<Vec<u8>>>;
    fn mget(&self, keys: &[String]) -> Result<Vec<Option<Vec<u8>>>>;
    fn set(&self, key: &str, value: &[u8], ttl_seconds: Option<i64>) -> Result<()>;
    fn del(&self, keys: &[String]) -> Result<i64>;
    fn expire(&self, key: &str, ttl_seconds: i32) -> Result<()>;
}

pub trait RedisPoolFactory: Send + Sync {
    fn connect(&self, option: &RedisShardOption) -> Result<Arc<dyn RedisConnection>>;
}

struct Instance {
    option: RedisShardOption,
    connection: Arc<dyn RedisConnection>,
}

/// `plugins.RedisShardCache`: CRC32 slot-based Redis sharding.
pub struct RedisShardCache<K: CacheKey> {
    instances: Vec<Instance>,
    options: PluginOptions<K>,
    stats: RwLock<Option<Arc<Stats>>>,
}

impl<K: CacheKey> RedisShardCache<K> {
    pub fn new(
        mut shards: Vec<RedisShardOption>,
        factory: &dyn RedisPoolFactory,
        options: PluginOptions<K>,
    ) -> Result<Self> {
        if shards.is_empty() {
            return Err(CacheError::Message("no cache instance".to_string()));
        }
        if shards.len() > TOTAL_SLOT_SIZE as usize {
            return Err(CacheError::Message(
                "too many shards for 16384 slots".to_string(),
            ));
        }

        let mut is_slot_zero = true;
        let mut instances = Vec::with_capacity(shards.len());
        for shard in shards.drain(..) {
            let mut shard = shard;
            if shard.max_idle == 0 {
                shard.max_idle = DEFAULT_MAX_IDLE;
            }
            if shard.max_active == 0 {
                shard.max_active = DEFAULT_MAX_ACTIVE;
            }
            if shard.resp_slot.begin != 0 || shard.resp_slot.end != 0 {
                is_slot_zero = false;
            }
            let connection = factory.connect(&shard)?;
            instances.push(Instance {
                option: shard,
                connection,
            });
        }

        let size = instances.len();
        if is_slot_zero {
            let step = TOTAL_SLOT_SIZE / size as u32;
            for (index, instance) in instances.iter_mut().enumerate() {
                let begin = index as u32 * step;
                let mut end = (index as u32 + 1) * step - 1;
                if index == size - 1 {
                    end = TOTAL_SLOT_SIZE - 1;
                }
                instance.option.resp_slot = Slot { begin, end };
            }
        }

        instances.sort_by_key(|instance| instance.option.resp_slot.begin);

        let first = instances.first().expect("non-empty");
        let last = instances.last().expect("non-empty");
        if first.option.resp_slot.begin != 0 || last.option.resp_slot.end != TOTAL_SLOT_SIZE - 1 {
            return Err(CacheError::Message("range must cover 0-16383".to_string()));
        }
        for window in instances.windows(2) {
            if window[0].option.resp_slot.end + 1 != window[1].option.resp_slot.begin {
                return Err(CacheError::Message(format!(
                    "range lost between:{} to {}",
                    window[0].option.resp_slot.end, window[1].option.resp_slot.begin
                )));
            }
        }

        Ok(Self {
            instances,
            options,
            stats: RwLock::new(None),
        })
    }

    pub fn new_with_pool(connection: Arc<dyn RedisConnection>, options: PluginOptions<K>) -> Self {
        let instance = Instance {
            option: RedisShardOption {
                resp_slot: Slot {
                    begin: 0,
                    end: TOTAL_SLOT_SIZE - 1,
                },
                enable_slave: true,
                ..RedisShardOption::default()
            },
            connection,
        };
        Self {
            instances: vec![instance],
            options,
            stats: RwLock::new(None),
        }
    }

    fn select_instance(&self, key: &str) -> Option<&Instance> {
        let slot = hash_with_tag(key.as_bytes());
        self.instances.iter().find(|instance| {
            instance.option.resp_slot.end >= slot && instance.option.resp_slot.begin <= slot
        })
    }

    fn translate_key(&self, key: &K) -> String {
        match &self.options.key_formatter {
            Some(formatter) => formatter.format(key),
            None => key.as_key_string(),
        }
    }

    fn inner_get(&self, key: &str) -> Result<Option<(Vec<u8>, i32)>> {
        let instance = self
            .select_instance(key)
            .ok_or_else(|| CacheError::Message(format!("no instance find for {key}")))?;
        let Some(raw) = instance.connection.get(key)? else {
            return Ok(None);
        };

        if self.options.value_with_ttl
            && let Ok((expire_ts, value)) = gob::decode(&raw)
        {
            let ttl = (expire_ts - now_unix()) as i32;
            return Ok(Some((value, ttl)));
        }
        Ok(Some((raw, 0)))
    }

    fn inner_mget(&self, instance: &Instance, keys: &[String]) -> Result<InnerGetValues> {
        let raw_values = instance.connection.mget(keys)?;
        let now = now_unix();
        Ok(raw_values
            .into_iter()
            .map(|raw| {
                raw.map(|raw| {
                    if self.options.value_with_ttl
                        && let Ok((expire_ts, value)) = gob::decode(&raw)
                    {
                        return (value, (expire_ts - now) as i32);
                    }
                    (raw, 0)
                })
            })
            .collect())
    }

    fn translate_value(&self, value: &CacheValue) -> Result<(Vec<u8>, i32)> {
        let ttl = value.ttl();
        let data = value.data();
        let raw = match &data {
            CacheData::Bytes(bytes) => bytes.to_vec(),
            CacheData::Str(value) => value.as_bytes().to_vec(),
            _ => {
                return Err(CacheError::Message(
                    "bad value format for redis".to_string(),
                ));
            }
        };
        if self.options.value_with_ttl {
            Ok((gob::encode(now_unix() + i64::from(ttl), &raw), ttl))
        } else {
            Ok((raw, ttl))
        }
    }
}

impl<K: CacheKey> Cacher<K> for RedisShardCache<K> {
    fn get(&self, key: &K) -> Result<Option<CacheValue>> {
        let key = self.translate_key(key);
        match self.inner_get(&key)? {
            Some((data, ttl)) => Ok(Some(Arc::new(InterfaceView::from_data(
                CacheData::Bytes(data.into()),
                ttl,
            )))),
            None => Err(CacheError::NotExists),
        }
    }

    fn mget(&self, keys: &[K]) -> Result<(HashMap<K, CacheValue>, Vec<K>)> {
        let mut hits = HashMap::with_capacity(keys.len());
        let mut misses = Vec::new();
        let mut groups: HashMap<usize, Vec<usize>> = HashMap::new();

        let translated: Vec<String> = keys.iter().map(|key| self.translate_key(key)).collect();
        for (index, key) in translated.iter().enumerate() {
            let instance_index = self
                .instances
                .iter()
                .position(|instance| {
                    let slot = hash_with_tag(key.as_bytes());
                    instance.option.resp_slot.end >= slot && instance.option.resp_slot.begin <= slot
                })
                .ok_or_else(|| CacheError::Message(format!("no instance find for {key}")))?;
            groups.entry(instance_index).or_default().push(index);
        }

        for (instance_index, indexes) in groups {
            let instance = &self.instances[instance_index];
            let group_keys: Vec<String> = indexes
                .iter()
                .map(|index| translated[*index].clone())
                .collect();
            let values = self.inner_mget(instance, &group_keys)?;
            for (position, index) in indexes.into_iter().enumerate() {
                match values.get(position).cloned().flatten() {
                    Some((data, ttl)) => {
                        hits.insert(
                            keys[index].clone(),
                            Arc::new(InterfaceView::from_data(CacheData::Bytes(data.into()), ttl))
                                as CacheValue,
                        );
                    }
                    None => misses.push(keys[index].clone()),
                }
            }
        }

        Ok((hits, misses))
    }

    fn set(&self, key: &K, value: CacheValue) -> Result<()> {
        let key = self.translate_key(key);
        let instance = self
            .select_instance(&key)
            .ok_or_else(|| CacheError::Message(format!("no instance find for {key}")))?;
        let (data, ttl) = self.translate_value(&value)?;
        let effective_ttl = if ttl > 0 {
            Some(i64::from(ttl))
        } else if self.options.ttl > 0 {
            Some(i64::from(self.options.ttl))
        } else {
            None
        };
        instance.connection.set(&key, &data, effective_ttl)
    }

    fn delete(&self, key: &K) -> Result<()> {
        let key = self.translate_key(key);
        let instance = self
            .select_instance(&key)
            .ok_or_else(|| CacheError::Message(format!("no instance find for {key}")))?;
        instance.connection.del(std::slice::from_ref(&key))?;
        Ok(())
    }

    fn mdelete(&self, keys: &[K]) -> Result<()> {
        let mut groups: HashMap<usize, Vec<String>> = HashMap::new();
        for key in keys {
            let key = self.translate_key(key);
            let instance_index = self
                .instances
                .iter()
                .position(|instance| {
                    let slot = hash_with_tag(key.as_bytes());
                    instance.option.resp_slot.end >= slot && instance.option.resp_slot.begin <= slot
                })
                .ok_or_else(|| CacheError::Message(format!("no instance find for {key}")))?;
            groups.entry(instance_index).or_default().push(key);
        }
        for (instance_index, group) in groups {
            self.instances[instance_index].connection.del(&group)?;
        }
        Ok(())
    }

    fn touch(&self, key: &K, ttl: i32) -> Result<()> {
        let key = self.translate_key(key);
        let instance = self
            .select_instance(&key)
            .ok_or_else(|| CacheError::Message(format!("no instance find for {key}")))?;
        instance.connection.expire(&key, ttl)
    }

    fn stop(&self) -> Result<()> {
        Ok(())
    }

    fn cache_id(&self) -> String {
        self.instances
            .first()
            .and_then(|instance| instance.option.addrs.first())
            .cloned()
            .unwrap_or_default()
    }

    fn get_key(&self, keys: &[K]) -> String {
        keys.iter()
            .map(|key| self.translate_key(key))
            .collect::<Vec<_>>()
            .join(":")
    }

    fn set_stats(&self, stats: Arc<Stats>) {
        *self.stats.write() = Some(stats);
    }
}

/// CRC32 with Redis Cluster hash-tag support, modulo 16384.
pub fn hash_with_tag(key: &[u8]) -> u32 {
    let tagged = match key.iter().position(|byte| *byte == b'{') {
        Some(begin) => match key[begin + 1..].iter().position(|byte| *byte == b'}') {
            Some(end) => &key[begin + 1..begin + 1 + end],
            None => key,
        },
        None => key,
    };
    crc32fast::hash(tagged) % TOTAL_SLOT_SIZE
}

fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}
