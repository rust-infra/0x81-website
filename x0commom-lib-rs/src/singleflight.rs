use std::any::Any;
use std::collections::HashMap;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::Arc;

use parking_lot::{Condvar, Mutex};

use crate::error::{CacheError, Result};

struct CallState {
    done: bool,
    value: Option<Arc<dyn Any + Send + Sync>>,
    error: Option<CacheError>,
}

struct Call {
    state: Mutex<CallState>,
    ready: Condvar,
}

/// Duplicate call suppression, matching `ycache/singleflight`.
#[derive(Default)]
pub struct SingleFlight {
    calls: Mutex<HashMap<String, Arc<Call>>>,
}

impl SingleFlight {
    pub fn new() -> Self {
        Self::default()
    }

    /// Executes `f` once per in-flight key. Waiters receive a clone of the
    /// leader's result.
    pub fn do_call<T, F>(&self, key: &str, f: F) -> Result<T>
    where
        T: Clone + Send + Sync + 'static,
        F: FnOnce() -> Result<T>,
    {
        let (call, leader) = {
            let mut calls = self.calls.lock();
            if let Some(existing) = calls.get(key) {
                (existing.clone(), false)
            } else {
                let call = Arc::new(Call {
                    state: Mutex::new(CallState {
                        done: false,
                        value: None,
                        error: None,
                    }),
                    ready: Condvar::new(),
                });
                calls.insert(key.to_string(), call.clone());
                (call, true)
            }
        };

        if leader {
            let result = catch_unwind(AssertUnwindSafe(f)).unwrap_or_else(|panic| {
                let message = panic
                    .downcast_ref::<String>()
                    .cloned()
                    .or_else(|| panic.downcast_ref::<&str>().map(|s| (*s).to_string()))
                    .unwrap_or_else(|| "panic".to_string());
                Err(CacheError::Message(format!("panic: {message}")))
            });

            {
                let mut state = call.state.lock();
                match result {
                    Ok(value) => {
                        state.value = Some(Arc::new(value));
                    }
                    Err(error) => {
                        state.error = Some(error);
                    }
                }
                state.done = true;
                call.ready.notify_all();
            }

            self.calls.lock().remove(key);

            let state = call.state.lock();
            if let Some(error) = &state.error {
                return Err(error.clone());
            }
            let value = state
                .value
                .as_ref()
                .expect("singleflight leader stored a value")
                .clone();
            return value
                .downcast::<T>()
                .map(|value| (*value).clone())
                .map_err(|_| CacheError::Message("singleflight value type mismatch".to_string()));
        }

        let mut state = call.state.lock();
        while !state.done {
            call.ready.wait(&mut state);
        }
        if let Some(error) = &state.error {
            return Err(error.clone());
        }
        let value = state
            .value
            .as_ref()
            .expect("singleflight value present")
            .clone();
        value
            .downcast::<T>()
            .map(|value| (*value).clone())
            .map_err(|_| CacheError::Message("singleflight value type mismatch".to_string()))
    }
}
