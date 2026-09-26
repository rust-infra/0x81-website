-- 打字练习「错题本」：记录打错过的词（card_id 指向原始卡片，不复制内容）。
-- 进入：某个词的一次完整练习中 wrong_chars > 0；移出：该词再练到 100% 准确率（wrong_chars = 0）。
-- last_entry_id 用于让客户端重试同一批次时不会把 wrong_count 重复累加（幂等）。
CREATE TABLE IF NOT EXISTS type_mistakes (
    owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    deck_id TEXT NOT NULL,
    wrong_count INTEGER NOT NULL DEFAULT 0,
    last_entry_id TEXT,
    created_at DATETIME NOT NULL,
    last_wrong_at DATETIME NOT NULL,
    PRIMARY KEY (owner_user_id, card_id)
);

CREATE INDEX IF NOT EXISTS idx_type_mistakes_user_last
    ON type_mistakes(owner_user_id, last_wrong_at DESC);
