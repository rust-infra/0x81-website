use std::any::Any;
use std::fmt;
use std::sync::Arc;

use crate::error::Result;

/// Data carried by a cache entry. Mirrors the `interface{}` returned by
/// `Cacheable.Data()` in the Go implementation.
#[derive(Clone)]
pub enum CacheData {
    Nil,
    Bytes(Arc<[u8]>),
    Str(Arc<str>),
    Any(Arc<dyn Any + Send + Sync>),
}

impl CacheData {
    pub fn from_bytes(bytes: impl Into<Arc<[u8]>>) -> Self {
        CacheData::Bytes(bytes.into())
    }

    #[allow(clippy::should_implement_trait)]
    pub fn from_str(value: impl Into<Arc<str>>) -> Self {
        CacheData::Str(value.into())
    }

    pub fn from_any<T: Any + Send + Sync>(value: T) -> Self {
        CacheData::Any(Arc::new(value))
    }

    pub fn is_nil(&self) -> bool {
        matches!(self, CacheData::Nil)
    }

    pub fn as_bytes(&self) -> Option<&[u8]> {
        match self {
            CacheData::Bytes(bytes) => Some(bytes),
            CacheData::Str(value) => Some(value.as_bytes()),
            _ => None,
        }
    }

    pub fn to_bytes(&self) -> Option<Vec<u8>> {
        self.as_bytes().map(|bytes| bytes.to_vec())
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            CacheData::Str(value) => Some(value),
            CacheData::Bytes(bytes) => std::str::from_utf8(bytes).ok(),
            _ => None,
        }
    }

    pub fn downcast_ref<T: Any>(&self) -> Option<&T> {
        match self {
            CacheData::Any(value) => value.downcast_ref::<T>(),
            _ => None,
        }
    }

    fn ptr_eq(&self, other: &CacheData) -> bool {
        match (self, other) {
            (CacheData::Nil, CacheData::Nil) => true,
            (CacheData::Bytes(a), CacheData::Bytes(b)) => Arc::ptr_eq(a, b),
            (CacheData::Str(a), CacheData::Str(b)) => Arc::ptr_eq(a, b),
            (CacheData::Any(a), CacheData::Any(b)) => {
                a.type_id() == b.type_id() && Arc::ptr_eq(a, b)
            }
            _ => false,
        }
    }
}

impl PartialEq for CacheData {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (CacheData::Nil, CacheData::Nil) => true,
            (CacheData::Bytes(a), CacheData::Bytes(b)) => a == b,
            (CacheData::Str(a), CacheData::Str(b)) => a == b,
            (CacheData::Bytes(a), CacheData::Str(b)) => a.as_ref() == b.as_bytes(),
            (CacheData::Str(a), CacheData::Bytes(b)) => a.as_bytes() == b.as_ref(),
            (CacheData::Any(a), CacheData::Any(b)) => {
                a.type_id() == b.type_id() && Arc::ptr_eq(a, b)
            }
            _ => false,
        }
    }
}

impl fmt::Debug for CacheData {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CacheData::Nil => f.write_str("Nil"),
            CacheData::Bytes(bytes) => write!(f, "Bytes({:?})", bytes),
            CacheData::Str(value) => write!(f, "Str({:?})", value),
            CacheData::Any(_) => f.write_str("Any(..)"),
        }
    }
}

/// A cacheable value. Mirrors `ycache.Cacheable`.
pub trait Cacheable: Send + Sync + 'static {
    fn ttl(&self) -> i32;
    fn data(&self) -> CacheData;
    fn equal(&self, other: &dyn Cacheable) -> bool;
    fn as_any(&self) -> &dyn Any;
}

pub type CacheValue = Arc<dyn Cacheable>;

#[derive(Clone, Default)]
enum ByteViewInner {
    #[default]
    Empty,
    Bytes(Arc<[u8]>),
    Str(Arc<str>),
}

/// `ycache.ByteView`: an immutable byte or string view with a TTL.
#[derive(Clone, Default)]
pub struct ByteView {
    inner: ByteViewInner,
    ttl: i32,
}

impl ByteView {
    pub fn new(bytes: impl Into<Arc<[u8]>>, ttl: i32) -> Self {
        Self {
            inner: ByteViewInner::Bytes(bytes.into()),
            ttl,
        }
    }

    pub fn from_string(value: impl Into<Arc<str>>, ttl: i32) -> Self {
        Self {
            inner: ByteViewInner::Str(value.into()),
            ttl,
        }
    }

    pub fn empty(ttl: i32) -> Self {
        Self {
            inner: ByteViewInner::Empty,
            ttl,
        }
    }

    pub fn len(&self) -> usize {
        match &self.inner {
            ByteViewInner::Empty => 0,
            ByteViewInner::Bytes(bytes) => bytes.len(),
            ByteViewInner::Str(value) => value.len(),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn byte_slice(&self) -> Vec<u8> {
        self.as_bytes().to_vec()
    }

    pub fn as_bytes(&self) -> &[u8] {
        match &self.inner {
            ByteViewInner::Empty => &[],
            ByteViewInner::Bytes(bytes) => bytes,
            ByteViewInner::Str(value) => value.as_bytes(),
        }
    }

    pub fn equal_string(&self, other: &str) -> bool {
        self.as_bytes() == other.as_bytes()
    }

    pub fn equal_bytes(&self, other: &[u8]) -> bool {
        self.as_bytes() == other
    }
}

impl Cacheable for ByteView {
    fn ttl(&self) -> i32 {
        self.ttl
    }

    fn data(&self) -> CacheData {
        match &self.inner {
            ByteViewInner::Empty => CacheData::Bytes(Arc::from(&[][..])),
            ByteViewInner::Bytes(bytes) => CacheData::Bytes(bytes.clone()),
            ByteViewInner::Str(value) => CacheData::Str(value.clone()),
        }
    }

    fn equal(&self, other: &dyn Cacheable) -> bool {
        if self.ttl != other.ttl() {
            return false;
        }
        if let Some(view) = other.as_any().downcast_ref::<ByteView>() {
            return self.as_bytes() == view.as_bytes();
        }
        if let Some(view) = other.as_any().downcast_ref::<InterfaceView>() {
            return view.data == self.data();
        }
        false
    }

    fn as_any(&self) -> &dyn Any {
        self
    }
}

type DataEq = Arc<dyn Fn(&CacheData, &CacheData) -> bool + Send + Sync>;
pub type Serializer = Arc<dyn Fn(&CacheData) -> Result<CacheData> + Send + Sync>;

/// `ycache.InterfaceView`: wraps arbitrary data and a TTL.
#[derive(Clone)]
pub struct InterfaceView {
    data: CacheData,
    ttl: i32,
    eq: Option<DataEq>,
    serializer: Option<Serializer>,
}

impl InterfaceView {
    pub fn new<T: Any + PartialEq + Send + Sync + 'static>(value: T, ttl: i32) -> Self {
        let eq: DataEq = Arc::new(|left, right| match (left, right) {
            (CacheData::Any(a), CacheData::Any(b)) => {
                match (a.downcast_ref::<T>(), b.downcast_ref::<T>()) {
                    (Some(a), Some(b)) => a == b,
                    _ => false,
                }
            }
            _ => left == right,
        });
        Self {
            data: CacheData::Any(Arc::new(value)),
            ttl,
            eq: Some(eq),
            serializer: None,
        }
    }

    /// Creates a view that a `JsonCodec` can serialize, so typed values can be
    /// stored by backends that only accept bytes (Redis).
    pub fn new_json<T: serde::Serialize + PartialEq + Send + Sync + 'static>(
        value: T,
        ttl: i32,
    ) -> Self {
        let mut view = Self::new(value, ttl);
        let serializer: Serializer = Arc::new(|data| match data {
            CacheData::Any(value) => {
                let value = value
                    .downcast_ref::<T>()
                    .ok_or(crate::error::CacheError::BadRetValue)?;
                let bytes = serde_json::to_vec(value)
                    .map_err(|error| crate::error::CacheError::Message(error.to_string()))?;
                Ok(CacheData::Bytes(bytes.into()))
            }
            other => Ok(other.clone()),
        });
        view.serializer = Some(serializer);
        view
    }

    pub fn new_uncomparable<T: Any + Send + Sync + 'static>(value: T, ttl: i32) -> Self {
        Self {
            data: CacheData::Any(Arc::new(value)),
            ttl,
            eq: None,
            serializer: None,
        }
    }

    pub fn from_data(data: CacheData, ttl: i32) -> Self {
        Self {
            data,
            ttl,
            eq: None,
            serializer: None,
        }
    }

    pub fn nil(ttl: i32) -> Self {
        Self {
            data: CacheData::Nil,
            ttl,
            eq: None,
            serializer: None,
        }
    }

    pub fn serialize(&self) -> Option<Result<CacheData>> {
        self.serializer
            .as_ref()
            .map(|serializer| serializer(&self.data))
    }

    pub fn with_ttl(mut self, ttl: i32) -> Self {
        self.ttl = ttl;
        self
    }

    pub fn data_ref(&self) -> &CacheData {
        &self.data
    }
}

impl Cacheable for InterfaceView {
    fn ttl(&self) -> i32 {
        self.ttl
    }

    fn data(&self) -> CacheData {
        self.data.clone()
    }

    fn equal(&self, other: &dyn Cacheable) -> bool {
        if self.ttl != other.ttl() {
            return false;
        }
        if let Some(view) = other.as_any().downcast_ref::<InterfaceView>() {
            if let Some(eq) = &self.eq {
                return eq(&self.data, &view.data);
            }
            if let Some(eq) = &view.eq {
                return eq(&self.data, &view.data);
            }
            return self.data.ptr_eq(&view.data);
        }
        if let Some(view) = other.as_any().downcast_ref::<ByteView>() {
            return match &self.data {
                CacheData::Bytes(bytes) => view.equal_bytes(bytes),
                CacheData::Str(value) => view.equal_string(value),
                _ => false,
            };
        }
        false
    }

    fn as_any(&self) -> &dyn Any {
        self
    }
}
