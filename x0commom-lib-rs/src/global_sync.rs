use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::error::{CacheError, Result};
use crate::options::{KafkaConfig, Region};

/// Wire format of `ycache.SyncValue` (v2). Field names intentionally match the
/// Go struct without JSON tags.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SyncValue {
    #[serde(rename = "Op")]
    pub op: String,
    #[serde(rename = "Keys")]
    pub keys: Vec<String>,
    #[serde(rename = "SeqID")]
    pub seq_id: i64,
}

/// Transport used to publish cache-sync messages. Implement it with the Kafka
/// client used by the service.
pub trait SyncTransport: Send + Sync {
    fn send_sync_msg(
        &self,
        topic: &str,
        key: Vec<u8>,
        value: Vec<u8>,
        dest: &[Region],
    ) -> Result<()>;
}

/// `ycache.globalSync`: message encoding/decoding and self-message filtering.
pub struct GlobalSync {
    config: KafkaConfig,
    id: String,
    transport: Option<Arc<dyn SyncTransport>>,
    enable: bool,
}

impl GlobalSync {
    pub fn new(
        config: KafkaConfig,
        id: impl Into<String>,
        transport: Option<Arc<dyn SyncTransport>>,
    ) -> Self {
        Self {
            config,
            id: id.into(),
            transport,
            enable: true,
        }
    }

    pub fn enable(&self) -> bool {
        self.enable
    }

    /// Returns `Ok(None)` for messages produced by this instance.
    pub fn decode(&self, message_key: &[u8], message_value: &[u8]) -> Result<Option<SyncValue>> {
        let key = String::from_utf8_lossy(message_key);
        if !key.is_empty() && key.starts_with(&self.id) {
            return Ok(None);
        }
        let value: SyncValue = serde_json::from_slice(message_value)
            .map_err(|error| CacheError::Message(format!("sync value unmarshal: {error}")))?;
        Ok(Some(value))
    }

    pub fn notify(&self, keys: &[String], op: &str, dest: &[Region]) -> Result<()> {
        if !self.enable {
            return Ok(());
        }
        let Some(transport) = &self.transport else {
            return Ok(());
        };
        let seq_id = now_nanos();
        let value = SyncValue {
            op: op.to_string(),
            keys: keys.to_vec(),
            seq_id,
        };
        let value = serde_json::to_vec(&value)
            .map_err(|error| CacheError::Message(format!("sync value marshal: {error}")))?;
        let key = format!("{}{}", self.id, seq_id).into_bytes();
        transport.send_sync_msg(&self.config.topic, key, value, dest)
    }

    pub fn mnotify(&self, keys: &[String], dest: &[Region]) -> Result<()> {
        self.notify(keys, "MDelete", dest)
    }

    pub fn notify_delete(&self, key: &str, dest: &[Region]) -> Result<()> {
        self.notify(&[key.to_string()], "Delete", dest)
    }
}

fn now_nanos() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos() as i64)
        .unwrap_or(0)
}
