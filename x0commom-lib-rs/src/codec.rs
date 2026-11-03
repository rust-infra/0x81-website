use std::sync::Arc;

use crate::cacheable::{CacheData, Cacheable, InterfaceView};
use crate::error::{CacheError, Result};

/// Serialization hook used when writing source values into the cache and when
/// reading them back. Mirrors `ycache.Codec`, adapted to `CacheData` so the
/// Rust API stays typed at the boundaries.
pub trait Codec: Send + Sync {
    fn marshal(&self, value: &dyn Cacheable) -> Result<CacheData>;
    fn unmarshal(&self, data: CacheData) -> Result<CacheData>;
}

/// `ycache.NewStringCodec`: bytes and strings pass through unchanged.
#[derive(Debug, Default, Clone, Copy)]
pub struct StringCodec;

impl Codec for StringCodec {
    fn marshal(&self, value: &dyn Cacheable) -> Result<CacheData> {
        Ok(value.data())
    }

    fn unmarshal(&self, data: CacheData) -> Result<CacheData> {
        Ok(data)
    }
}

/// `ycache.NewBytesCodec`: bytes pass through unchanged.
#[derive(Debug, Default, Clone, Copy)]
pub struct BytesCodec;

impl Codec for BytesCodec {
    fn marshal(&self, value: &dyn Cacheable) -> Result<CacheData> {
        Ok(value.data())
    }

    fn unmarshal(&self, data: CacheData) -> Result<CacheData> {
        Ok(data)
    }
}

pub type SharedCodec = Arc<dyn Codec>;

/// `ycache.NewJSONCodec` for values created with `InterfaceView::new_json`.
/// Reads pass bytes through; the typed layer deserializes them.
#[derive(Debug, Default, Clone, Copy)]
pub struct JsonCodec;

impl Codec for JsonCodec {
    fn marshal(&self, value: &dyn Cacheable) -> Result<CacheData> {
        if let Some(view) = value.as_any().downcast_ref::<InterfaceView>()
            && let Some(result) = view.serialize()
        {
            return result;
        }
        let data = value.data();
        match &data {
            CacheData::Bytes(_) | CacheData::Str(_) | CacheData::Nil => Ok(data),
            CacheData::Any(_) => Err(CacheError::Message(
                "json codec requires InterfaceView::new_json".to_string(),
            )),
        }
    }

    fn unmarshal(&self, data: CacheData) -> Result<CacheData> {
        Ok(data)
    }
}
