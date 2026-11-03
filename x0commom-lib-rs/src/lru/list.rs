use std::time::{Duration, Instant};

pub(crate) struct Node<K, V> {
    pub key: K,
    pub value: V,
    pub added_at: Instant,
    pub ttl: Duration,
    prev: Option<usize>,
    next: Option<usize>,
}

impl<K, V> Node<K, V> {
    pub fn remaining_ttl(&self, now: Instant) -> Duration {
        if self.ttl.is_zero() {
            return Duration::ZERO;
        }
        self.added_at
            .checked_add(self.ttl)
            .and_then(|deadline| deadline.checked_duration_since(now))
            .unwrap_or(Duration::ZERO)
    }

    pub fn expired(&self, now: Instant) -> bool {
        !self.ttl.is_zero()
            && now
                .checked_duration_since(self.added_at)
                .is_some_and(|elapsed| elapsed > self.ttl)
    }
}

/// Intrusive doubly linked list backed by an arena, giving O(1) push, move and
/// remove without unsafe pointers.
pub(crate) struct ArenaList<K, V> {
    nodes: Vec<Option<Node<K, V>>>,
    free: Vec<usize>,
    head: Option<usize>,
    tail: Option<usize>,
    len: usize,
}

impl<K, V> Default for ArenaList<K, V> {
    fn default() -> Self {
        Self::new()
    }
}

impl<K, V> ArenaList<K, V> {
    pub fn new() -> Self {
        Self {
            nodes: Vec::new(),
            free: Vec::new(),
            head: None,
            tail: None,
            len: 0,
        }
    }

    pub fn len(&self) -> usize {
        self.len
    }

    #[allow(dead_code)]
    pub fn is_empty(&self) -> bool {
        self.len == 0
    }

    #[allow(dead_code)]
    pub fn head(&self) -> Option<usize> {
        self.head
    }

    pub fn tail(&self) -> Option<usize> {
        self.tail
    }

    pub fn prev(&self, index: usize) -> Option<usize> {
        self.nodes
            .get(index)
            .and_then(|node| node.as_ref())
            .and_then(|node| node.prev)
    }

    #[allow(dead_code)]
    pub fn next(&self, index: usize) -> Option<usize> {
        self.nodes
            .get(index)
            .and_then(|node| node.as_ref())
            .and_then(|node| node.next)
    }

    pub fn get(&self, index: usize) -> Option<&Node<K, V>> {
        self.nodes.get(index).and_then(|node| node.as_ref())
    }

    pub fn get_mut(&mut self, index: usize) -> Option<&mut Node<K, V>> {
        self.nodes.get_mut(index).and_then(|node| node.as_mut())
    }

    pub fn push_front(&mut self, key: K, value: V, added_at: Instant, ttl: Duration) -> usize {
        let index = self.allocate(Node {
            key,
            value,
            added_at,
            ttl,
            prev: None,
            next: None,
        });
        self.link_front(index);
        index
    }

    fn allocate(&mut self, node: Node<K, V>) -> usize {
        if let Some(index) = self.free.pop() {
            self.nodes[index] = Some(node);
            index
        } else {
            self.nodes.push(Some(node));
            self.nodes.len() - 1
        }
    }

    fn link_front(&mut self, index: usize) {
        let old_head = self.head;
        {
            let node = self.nodes[index].as_mut().expect("node allocated");
            node.prev = None;
            node.next = old_head;
        }
        if let Some(head) = old_head {
            if let Some(node) = self.nodes[head].as_mut() {
                node.prev = Some(index);
            }
        } else {
            self.tail = Some(index);
        }
        self.head = Some(index);
        self.len += 1;
    }

    fn unlink(&mut self, index: usize) {
        let (prev, next) = {
            let Some(node) = self.nodes[index].as_ref() else {
                return;
            };
            (node.prev, node.next)
        };

        match prev {
            Some(prev) => {
                if let Some(node) = self.nodes[prev].as_mut() {
                    node.next = next;
                }
            }
            None => self.head = next,
        }

        match next {
            Some(next) => {
                if let Some(node) = self.nodes[next].as_mut() {
                    node.prev = prev;
                }
            }
            None => self.tail = prev,
        }

        if let Some(node) = self.nodes[index].as_mut() {
            node.prev = None;
            node.next = None;
        }
        self.len = self.len.saturating_sub(1);
    }

    pub fn move_to_front(&mut self, index: usize) {
        if self.head == Some(index) || self.nodes.get(index).is_none_or(Option::is_none) {
            return;
        }
        self.unlink(index);
        self.link_front(index);
    }

    pub fn remove(&mut self, index: usize) -> Option<Node<K, V>> {
        if self.nodes.get(index).is_none_or(Option::is_none) {
            return None;
        }
        self.unlink(index);
        let node = self.nodes[index].take();
        self.free.push(index);
        node
    }

    pub fn pop_back(&mut self) -> Option<Node<K, V>> {
        let tail = self.tail?;
        self.remove(tail)
    }

    pub fn clear(&mut self) {
        self.nodes.clear();
        self.free.clear();
        self.head = None;
        self.tail = None;
        self.len = 0;
    }
}
