# x402-gateway 的常用命令。CI 跑的是同一组检查。

CARGO ?= cargo
PAY_TO ?= 0x1111111111111111111111111111111111111111
ADMIN_TOKEN ?= dev-admin-token

.PHONY: help build test lint fmt fmt-check check run run-mock migrate-up demo docker

help:
	@echo "build        编译 release 二进制"
	@echo "test         跑测试（离线）"
	@echo "lint         cargo clippy -D warnings"
	@echo "check        fmt-check + clippy + test + build（提交前跑这个）"
	@echo "run          本地起服务（需要 mock facilitator 已在跑）"
	@echo "run-mock     起本地 mock facilitator"
	@echo "migrate-up   建 data/ 并跑迁移"
	@echo "demo         一条命令跑完 402 -> 200 -> 账本 -> 重放 409"
	@echo "docker       本地构建镜像"

build:
	$(CARGO) build --release

test:
	$(CARGO) test --offline

lint:
	$(CARGO) clippy --all-targets -- -D warnings

fmt:
	$(CARGO) fmt

fmt-check:
	$(CARGO) fmt --all -- --check

check: fmt-check lint test build

run:
	mkdir -p data
	X402_FACILITATOR_URL=$${X402_FACILITATOR_URL:-http://127.0.0.1:4402} \
	X402_PAY_TO=$${X402_PAY_TO:-$(PAY_TO)} \
	X402_ADMIN_TOKEN=$${X402_ADMIN_TOKEN:-$(ADMIN_TOKEN)} \
	$(CARGO) run --bin x402-gateway

run-mock:
	$(CARGO) run --bin mock_facilitator

migrate-up:
	mkdir -p data
	X402_DATABASE_URL="$${X402_DATABASE_URL:-sqlite:./data/ledger.db}" \
	$(CARGO) run --bin migrate

demo:
	./scripts/demo.sh

docker:
	docker build -t x402-gateway .
