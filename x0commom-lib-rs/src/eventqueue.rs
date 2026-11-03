use std::cmp::Reverse;
use std::collections::BinaryHeap;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::mpsc::{self, SyncSender, TrySendError};
use std::thread::{self, JoinHandle};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use parking_lot::Mutex;

use crate::error::{CacheError, Result};
use crate::util::sleep_interruptible;

pub trait EventHandler: Send + Sync {
    fn handle(&self, event: &str) -> Result<()>;
}

impl<F> EventHandler for F
where
    F: Fn(&str) -> Result<()> + Send + Sync,
{
    fn handle(&self, event: &str) -> Result<()> {
        self(event)
    }
}

/// `eventqueue.EventQueue`
pub trait EventQueue: Send + Sync {
    fn start(&self) -> Result<()>;
    fn stop(&self);
    fn add_event(&self, event: &str, interval: i64) -> Result<()>;
    fn remove_event(&self, event: &str) -> Result<()>;
    fn event_length(&self) -> Result<i64>;
}

struct QueueState {
    events: BinaryHeap<Reverse<(i64, u64, String)>>,
    sequence: u64,
}

fn enqueue(state: &Mutex<QueueState>, event: &str, interval: i64) {
    let expire_at = now_unix() + interval.max(0);
    let mut guard = state.lock();
    let sequence = guard.sequence;
    guard.sequence += 1;
    guard
        .events
        .push(Reverse((expire_at, sequence, event.to_string())));
}

/// `eventqueue.MemoryEventQueue`: an in-process delayed event queue.
pub struct MemoryEventQueue {
    handler: Arc<dyn EventHandler>,
    state: Arc<Mutex<QueueState>>,
    started: AtomicBool,
    stop: Arc<AtomicBool>,
    sender: Mutex<Option<SyncSender<String>>>,
    dispatcher: Mutex<Option<JoinHandle<()>>>,
    workers: Mutex<Vec<JoinHandle<()>>>,
    worker_count: usize,
    retry_interval: i64,
}

impl MemoryEventQueue {
    pub fn new(handler: Arc<dyn EventHandler>) -> Self {
        Self {
            handler,
            state: Arc::new(Mutex::new(QueueState {
                events: BinaryHeap::new(),
                sequence: 0,
            })),
            started: AtomicBool::new(false),
            stop: Arc::new(AtomicBool::new(false)),
            sender: Mutex::new(None),
            dispatcher: Mutex::new(None),
            workers: Mutex::new(Vec::new()),
            worker_count: 100,
            retry_interval: 5,
        }
    }

    pub fn with_worker_count(mut self, count: usize) -> Self {
        self.worker_count = count.max(1);
        self
    }

    pub fn with_retry_interval(mut self, seconds: i64) -> Self {
        self.retry_interval = seconds.max(1);
        self
    }
}

impl EventQueue for MemoryEventQueue {
    fn start(&self) -> Result<()> {
        if self.started.swap(true, Ordering::SeqCst) {
            return Err(CacheError::Message("already started".to_string()));
        }
        self.stop.store(false, Ordering::Relaxed);

        let (sender, receiver) = mpsc::sync_channel::<String>(1024);
        *self.sender.lock() = Some(sender.clone());

        let stop = self.stop.clone();
        let state = self.state.clone();
        *self.dispatcher.lock() = Some(thread::spawn(move || {
            while sleep_interruptible(&stop, Duration::from_secs(1)) {
                let now = now_unix();
                let mut due = Vec::new();
                {
                    let mut guard = state.lock();
                    while let Some(Reverse((expire_at, _, _))) = guard.events.peek() {
                        if *expire_at > now {
                            break;
                        }
                        if let Some(Reverse((_, _, event))) = guard.events.pop() {
                            due.push(event);
                        }
                    }
                }
                for event in due {
                    match sender.try_send(event) {
                        Ok(()) | Err(TrySendError::Disconnected(_)) => {}
                        Err(TrySendError::Full(_)) => {}
                    }
                }
            }
        }));

        let receiver = Arc::new(Mutex::new(receiver));
        let mut workers = Vec::with_capacity(self.worker_count);
        for _ in 0..self.worker_count {
            let receiver = receiver.clone();
            let handler = self.handler.clone();
            let stop = self.stop.clone();
            let state = self.state.clone();
            let retry_interval = self.retry_interval;
            workers.push(thread::spawn(move || {
                loop {
                    let message = {
                        let receiver = receiver.lock();
                        receiver.recv_timeout(Duration::from_millis(500))
                    };
                    match message {
                        Ok(event) => {
                            if handler.handle(&event) == Err(CacheError::EventRetry) {
                                enqueue(&state, &event, retry_interval);
                            }
                        }
                        Err(mpsc::RecvTimeoutError::Timeout) => {
                            if stop.load(Ordering::Relaxed) {
                                break;
                            }
                        }
                        Err(mpsc::RecvTimeoutError::Disconnected) => break,
                    }
                }
            }));
        }
        *self.workers.lock() = workers;
        Ok(())
    }

    fn stop(&self) {
        self.stop.store(true, Ordering::Relaxed);
        *self.sender.lock() = None;
        if let Some(handle) = self.dispatcher.lock().take() {
            let _ = handle.join();
        }
        let workers = std::mem::take(&mut *self.workers.lock());
        for handle in workers {
            let _ = handle.join();
        }
        self.started.store(false, Ordering::SeqCst);
    }

    fn add_event(&self, event: &str, interval: i64) -> Result<()> {
        enqueue(&self.state, event, interval);
        Ok(())
    }

    fn remove_event(&self, _event: &str) -> Result<()> {
        Ok(())
    }

    fn event_length(&self) -> Result<i64> {
        Ok(self.state.lock().events.len() as i64)
    }
}

impl Drop for MemoryEventQueue {
    fn drop(&mut self) {
        self.stop();
    }
}

fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

#[allow(dead_code)]
fn assert_send_sync() {
    fn check<T: Send + Sync>() {}
    check::<MemoryEventQueue>();
}

#[allow(dead_code)]
fn assert_atomic(_: AtomicI64) {}
