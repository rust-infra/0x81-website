/// Mirrors `lru.sizeChecker.calcNextLen`.
pub(crate) struct SizeChecker {
    shrinks: usize,
    reduce_threshold: usize,
}

impl Default for SizeChecker {
    fn default() -> Self {
        Self {
            shrinks: 0,
            reduce_threshold: 3,
        }
    }
}

impl SizeChecker {
    pub fn calc_next_len(
        &mut self,
        cur_len: usize,
        max_len: usize,
        evicts: usize,
        step: usize,
        reduce_step: usize,
    ) -> usize {
        if evicts > 0 {
            let mut next = (evicts / step) * step + step + cur_len;
            if next >= max_len {
                next = max_len;
            }
            self.shrinks = 0;
            return next;
        }

        self.shrinks += 1;
        if self.shrinks >= self.reduce_threshold {
            if cur_len <= 2 * step {
                return cur_len;
            }
            return cur_len.saturating_sub(reduce_step);
        }
        cur_len
    }
}
