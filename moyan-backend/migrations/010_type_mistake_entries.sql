-- 错题本去重表：记录"哪条打字记录已经让某个词进过错题本"。
--
-- 背景：原先只在 type_mistakes.last_entry_id 里存"最近一条"，于是同一批被重发（响应丢失、
-- 手工重放、将来改成非连续切片发送）时会重复累加 wrong_count。这里用
-- (owner_user_id, entry_id) 主键把"同一条记录只允许计数一次"落到数据库层，
-- 与 type_mistakes 同事务写入，重复提交变成 no-op。
CREATE TABLE IF NOT EXISTS type_mistake_entries (
    owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    entry_id TEXT NOT NULL,
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (owner_user_id, entry_id)
);

CREATE INDEX IF NOT EXISTS idx_type_mistake_entries_user_card
    ON type_mistake_entries(owner_user_id, card_id);
