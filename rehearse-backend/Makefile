# rehearse-backend 的常用命令。
#
# CI 跑的是同一组命令（`.github/workflows/go-checks.yml`），所以本地能过的
# 提交在 CI 上也能过——不用去猜 CI 用了什么参数。

GO ?= go

# 本地 SQLite 后端的库文件位置（§7.3.5）。
#
# 用 `sqlite:` 前缀而不是裸路径：`store.DetectDialect` 只认显式 scheme，
# 免得 DSN 打错一个字母就被静默解释成「在别处新建一个空库」。
SQLITE_DSN ?= sqlite:./data/rehearse.db

.PHONY: help build test test-race test-postgres lint fmt vet check docker run run-sqlite \
        migrate-up migrate-version migrate-pending migrate-up-sqlite

help:
	@echo "build              编译全部包（CGO_ENABLED=0）"
	@echo "test               跑测试（快，不带 race；SQLite 后端默认跑）"
	@echo "test-race          跑测试（带 race detector，与 CI 一致）"
	@echo "test-postgres      额外在真 Postgres 上跑一致性测试（需要 REHEARSE_TEST_DATABASE_URL）"
	@echo "fmt                格式化（会改写文件）"
	@echo "vet                go vet"
	@echo "lint               golangci-lint"
	@echo "check              fmt-check + vet + lint + test-race + build（提交前跑这个）"
	@echo "docker             docker compose build rehearse-backend"
	@echo "run                本地起服务（DATABASE_URL 未设时用 sqlite:./data/rehearse.db）"
	@echo "run-sqlite         从零跑起来：建 data/ → 迁移 → 起服务（强制用 \$$SQLITE_DSN）"
	@echo "migrate-up         跑迁移（DATABASE_URL 未设时用默认 SQLite，目录需已存在）"
	@echo "migrate-version    打印已应用的迁移版本"
	@echo "migrate-pending    只打印待应用的版本（dry-run）"
	@echo "migrate-up-sqlite  对 \$$SQLITE_DSN（默认 $(SQLITE_DSN)）跑迁移"

build:
	CGO_ENABLED=0 $(GO) build ./...

# 不带 race，本地迭代快一点。
test:
	$(GO) test ./...

# 与 CI 一致。race detector 需要 cgo，所以这里**不**设 CGO_ENABLED=0。
test-race:
	$(GO) test -race ./...

# 一致性测试默认只跑 SQLite；这一条把 Postgres 那一半也打开。
#
# 需要先有一个能连的库（`make migrate-up` 会建表）。不设变量时那半边会跳过，
# 所以 CI 上不跑它也不会红——这是有意的：CI 没有 Postgres 服务。
test-postgres:
	@test -n "$$REHEARSE_TEST_DATABASE_URL" || \
		{ echo "需要 REHEARSE_TEST_DATABASE_URL（例：postgres://...）"; exit 1; }
	$(GO) test ./internal/store/ -run 'TestUsage|TestSetting' -v

fmt:
	$(GO) fmt ./...

vet:
	$(GO) vet ./...

lint:
	golangci-lint run ./...

# 提交前跑这个。fmt 用 -l 做检查（不改文件），有输出即失败。
check:
	@out=$$(gofmt -l .); if [ -n "$$out" ]; then echo "以下文件未格式化："; echo "$$out"; exit 1; fi
	$(GO) vet ./...
	golangci-lint run ./...
	$(GO) test -race ./...
	CGO_ENABLED=0 $(GO) build ./...

# 与 §7.1 定的一致：一条命令出成品镜像，不走 release 资产那一套。
docker:
	cd .. && docker compose build rehearse-backend

run:
	# 默认 DSN 是 sqlite:./data/rehearse.db（config.DefaultDatabaseURL），
	# 而 SQLite 不会替我们建父目录——缺了会直接 `unable to open database file`。
	# 这里建一次是安全的：配了 Postgres 的人只是多一个空目录（已 gitignore）。
	mkdir -p data
	$(GO) run ./cmd/rehearse

# 一条命令从零跑起来：建目录 → 迁移 → 起服务。
#
# 建目录这一步不能省：SQLite 不会替你建父目录，缺了会直接
# `unable to open database file`（store/sqlite.go 里没有自动 mkdir——
# 容器里自动建目录会把「卷没挂上」变成静默的数据丢失）。
run-sqlite:
	mkdir -p $(dir $(patsubst sqlite:%,%,$(SQLITE_DSN)))
	DATABASE_URL="$(SQLITE_DSN)" $(GO) run ./cmd/migrate up
	DATABASE_URL="$(SQLITE_DSN)" $(GO) run ./cmd/rehearse

migrate-up:
	# 同 run：默认 DSN 落在 ./data/ 下，SQLite 不会替我们建父目录。
	mkdir -p data
	$(GO) run ./cmd/migrate up

migrate-version:
	$(GO) run ./cmd/migrate version

migrate-pending:
	$(GO) run ./cmd/migrate pending

migrate-up-sqlite:
	mkdir -p $(dir $(patsubst sqlite:%,%,$(SQLITE_DSN)))
	DATABASE_URL="$(SQLITE_DSN)" $(GO) run ./cmd/migrate up
