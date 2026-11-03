use std::fmt;
use std::hash::Hash;
use std::sync::Arc;

/// Keys accepted by the cache. Go's `interface{}` keys are restricted here to
/// hashable Rust values.
pub trait CacheKey: Clone + Eq + Hash + Send + Sync + 'static {
    fn as_key_string(&self) -> String;

    /// Used by the refresh event queue, which only carries strings.
    fn from_key_string(_value: &str) -> Option<Self> {
        None
    }

    /// Go's `key == ""` check only matches an empty string, not an empty
    /// byte slice or a numeric zero.
    fn is_empty_key(&self) -> bool {
        false
    }
}

impl CacheKey for String {
    fn as_key_string(&self) -> String {
        self.clone()
    }

    fn from_key_string(value: &str) -> Option<Self> {
        Some(value.to_string())
    }

    fn is_empty_key(&self) -> bool {
        self.is_empty()
    }
}

impl CacheKey for &'static str {
    fn as_key_string(&self) -> String {
        (*self).to_string()
    }

    fn is_empty_key(&self) -> bool {
        self.is_empty()
    }
}

impl CacheKey for Arc<str> {
    fn as_key_string(&self) -> String {
        self.to_string()
    }

    fn from_key_string(value: &str) -> Option<Self> {
        Some(Arc::from(value))
    }

    fn is_empty_key(&self) -> bool {
        self.is_empty()
    }
}

impl CacheKey for Vec<u8> {
    fn as_key_string(&self) -> String {
        String::from_utf8_lossy(self).into_owned()
    }

    fn from_key_string(value: &str) -> Option<Self> {
        Some(value.as_bytes().to_vec())
    }
}

macro_rules! impl_numeric_key {
    ($($ty:ty),* $(,)?) => {
        $(
            impl CacheKey for $ty {
                fn as_key_string(&self) -> String {
                    self.to_string()
                }

                fn from_key_string(value: &str) -> Option<Self> {
                    value.parse().ok()
                }
            }
        )*
    };
}

impl_numeric_key!(
    i8, i16, i32, i64, i128, isize, u8, u16, u32, u64, u128, usize
);

/// Converts a key into the string used by the cache backend. Mirrors
/// `ycache.CacheKeyFormatter`.
pub trait KeyFormatter<K: CacheKey>: Send + Sync {
    fn format(&self, key: &K) -> String;
}

#[derive(Debug, Default, Clone, Copy)]
pub struct DefaultKeyFormatter;

impl<K: CacheKey> KeyFormatter<K> for DefaultKeyFormatter {
    fn format(&self, key: &K) -> String {
        key.as_key_string()
    }
}

/// Formats a key with `Display`, matching Go's default `fmt.Sprintf("%v")`.
#[derive(Debug, Default, Clone, Copy)]
pub struct DisplayKeyFormatter;

impl<K: CacheKey + fmt::Display> KeyFormatter<K> for DisplayKeyFormatter {
    fn format(&self, key: &K) -> String {
        key.to_string()
    }
}
