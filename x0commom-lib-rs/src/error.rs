use std::fmt;

/// Errors mirrored from `git.ihago.top/ihago/ycache/v2/errors.go`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CacheError {
    NilSink,
    TooManyRequests,
    NilGetter,
    ZeroKeys,
    DeleteFail,
    GetFail,
    LoadFail,
    DeleteSyncFail,
    BadSink,
    NotCacher,
    SourceNotFound,
    UnsupportedCacheValue,
    BadRetValue,
    DismatchRetValue,
    NotExists,
    RequireString,
    RequireSlice,
    SourceTimeout,
    RequireKeyFormatter,
    RequireValueCodec,
    EventRetry,
    Message(String),
}

impl CacheError {
    /// Metric code from the Go implementation. Non-metric errors map to 699.
    pub fn code(&self) -> i32 {
        match self {
            CacheError::NilSink => 601,
            CacheError::TooManyRequests => 602,
            CacheError::NilGetter => 603,
            CacheError::ZeroKeys => 604,
            CacheError::DeleteFail => 606,
            CacheError::GetFail => 607,
            CacheError::LoadFail => 608,
            CacheError::DeleteSyncFail => 609,
            CacheError::BadSink => 610,
            CacheError::NotCacher => 611,
            _ => 699,
        }
    }
}

impl fmt::Display for CacheError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CacheError::NilSink => f.write_str("nil dest Sink"),
            CacheError::TooManyRequests => f.write_str("too many request"),
            CacheError::NilGetter => f.write_str("nil getter"),
            CacheError::ZeroKeys => f.write_str("zero keys"),
            CacheError::DeleteFail => f.write_str("delete fail"),
            CacheError::GetFail => f.write_str("get fail"),
            CacheError::LoadFail => f.write_str("load fail"),
            CacheError::DeleteSyncFail => f.write_str("delete sync fail"),
            CacheError::BadSink => f.write_str("bad Sink args"),
            CacheError::NotCacher => f.write_str("not cacher object"),
            CacheError::SourceNotFound => f.write_str("source not found"),
            CacheError::UnsupportedCacheValue => f.write_str("unsupported cache value type"),
            CacheError::BadRetValue => f.write_str("bad retval type"),
            CacheError::DismatchRetValue => f.write_str("dismatch retval type"),
            CacheError::NotExists => f.write_str("not exist"),
            CacheError::RequireString => f.write_str("require string"),
            CacheError::RequireSlice => f.write_str("require slice"),
            CacheError::SourceTimeout => f.write_str("source time out"),
            CacheError::RequireKeyFormatter => f.write_str("require key formatter"),
            CacheError::RequireValueCodec => f.write_str("require value codec"),
            CacheError::EventRetry => f.write_str("event retry"),
            CacheError::Message(msg) => f.write_str(msg),
        }
    }
}

impl std::error::Error for CacheError {}

pub type Result<T> = std::result::Result<T, CacheError>;
