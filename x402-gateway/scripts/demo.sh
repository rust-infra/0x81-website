#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

PORT="${X402_PORT:-4330}"
FAC_PORT="${MOCK_FACILITATOR_PORT:-4402}"
PAY_TO="0x1111111111111111111111111111111111111111"
ADMIN_TOKEN="dev-admin-token"
DEMO_DIR="$(mktemp -d)"
DB_URL="sqlite:${DEMO_DIR}/ledger.db"

export X402_PORT="$PORT"
export X402_DATABASE_URL="$DB_URL"
export X402_FACILITATOR_URL="http://127.0.0.1:${FAC_PORT}"
export X402_PAY_TO="$PAY_TO"
export X402_NETWORK="eip155:84532"
export X402_PUBLIC_BASE_URL="http://127.0.0.1:${PORT}"
export X402_ADMIN_TOKEN="$ADMIN_TOKEN"
export X402_FACILITATOR_TIMEOUT_SECONDS="5"
export X402_LOG_LEVEL="warn"
export MOCK_FACILITATOR_PORT="$FAC_PORT"

cleanup() {
  if [[ -n "${GW_PID:-}" ]]; then
    kill "$GW_PID" 2>/dev/null || true
    wait "$GW_PID" 2>/dev/null || true
  fi
  if [[ -n "${FAC_PID:-}" ]]; then
    kill "$FAC_PID" 2>/dev/null || true
    wait "$FAC_PID" 2>/dev/null || true
  fi
  rm -rf "$DEMO_DIR"
}
trap cleanup EXIT

echo "==> building"
cargo build --offline --bins >/dev/null

BIN=target/debug

echo "==> starting mock facilitator on :${FAC_PORT}"
"$BIN/mock_facilitator" &
FAC_PID=$!
for _ in $(seq 1 50); do
  if curl -fsS "http://127.0.0.1:${FAC_PORT}/supported" >/dev/null 2>&1; then break; fi
  sleep 0.2
done

echo "==> migrating ${DB_URL}"
"$BIN/migrate"

echo "==> starting x402-gateway on :${PORT}"
"$BIN/x402-gateway" &
GW_PID=$!
for _ in $(seq 1 50); do
  if curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then break; fi
  sleep 0.2
done

echo "==> unpaid request (expect 402)"
curl -sS -i -X POST "http://127.0.0.1:${PORT}/v1/echo" \
  -H 'Content-Type: application/json' \
  -d '{"message":"hello"}' | sed -n '1,12p'
echo

PAYMENT_HEADER="$(python3 - <<'PY'
import base64, json, time
asset = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
pay_to = "0x1111111111111111111111111111111111111111"
accepted = {
    "scheme": "exact",
    "network": "eip155:84532",
    "asset": asset,
    "amount": "1000",
    "payTo": pay_to,
    "maxTimeoutSeconds": 60,
    "extra": {"name": "USDC", "version": "2"},
}
payload = {
    "x402Version": 2,
    "accepted": accepted,
    "payload": {
        "signature": "0xdead",
        "authorization": {
            "from": "0x3333333333333333333333333333333333333333",
            "to": pay_to,
            "value": "1000",
            "validAfter": "0",
            "validBefore": str(int(time.time()) + 600),
            "nonce": "0x" + "ab" * 16,
        },
    },
}
print(base64.b64encode(json.dumps(payload).encode()).decode())
PY
)"

echo "==> paid request (expect 200)"
RESPONSE="$(curl -sS -X POST "http://127.0.0.1:${PORT}/v1/echo" \
  -H 'Content-Type: application/json' \
  -H "PAYMENT-SIGNATURE: ${PAYMENT_HEADER}" \
  -d '{"message":"hello"}')"
echo "$RESPONSE"

REQUEST_ID="$(printf '%s' "$RESPONSE" | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["request_id"])')"

echo "==> ledger row"
curl -sS "http://127.0.0.1:${PORT}/admin/payments/${REQUEST_ID}" \
  -H "X-Admin-Token: ${ADMIN_TOKEN}"
echo

echo "==> replay (expect 409)"
curl -sS -o /dev/null -w '%{http_code}\n' -X POST "http://127.0.0.1:${PORT}/v1/echo" \
  -H 'Content-Type: application/json' \
  -H "PAYMENT-SIGNATURE: ${PAYMENT_HEADER}" \
  -d '{"message":"hello"}'
