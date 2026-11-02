CREATE TABLE price_rules (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  model             TEXT NOT NULL UNIQUE,
  price_atomic   INTEGER NOT NULL CHECK (price_atomic > 0),
  max_output_tokens INTEGER NOT NULL,
  active            INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL
);

CREATE TABLE payment_attempts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id       TEXT NOT NULL UNIQUE,
  payer            TEXT NOT NULL,
  network          TEXT NOT NULL,
  asset            TEXT NOT NULL,
  nonce            TEXT NOT NULL,
  amount_atomic INTEGER NOT NULL,
  pay_to           TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN (
                     'verified', 'settling', 'settled', 'served',
                     'settle_failed', 'rejected', 'expired', 'orphaned')),
  payload_hash     TEXT NOT NULL,
  valid_before     TEXT NOT NULL,
  tx_hash          TEXT,
  invalid_reason   TEXT,
  created_at       TEXT NOT NULL,
  verified_at      TEXT,
  settled_at       TEXT,
  served_at        TEXT,
  UNIQUE (network, asset, payer, nonce)
);

CREATE UNIQUE INDEX payment_attempts_one_inflight
  ON payment_attempts (payer)
  WHERE status IN ('verified', 'settling', 'settled');

CREATE TABLE usage_events (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id       TEXT NOT NULL UNIQUE REFERENCES payment_attempts(request_id),
  model            TEXT NOT NULL,
  price_atomic  INTEGER NOT NULL,
  status           TEXT NOT NULL,
  latency_ms       INTEGER,
  created_at       TEXT NOT NULL
);

INSERT INTO price_rules (model, price_atomic, max_output_tokens, active, created_at)
VALUES ('echo', 1000, 0, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
