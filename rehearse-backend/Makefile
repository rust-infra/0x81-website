# rehearse-backend 的常用命令。
#
# CI 跑的是同一组命令（`.github/workflows/go-checks.yml`），所以本地能过的
# 提交在 CI 上也能过——不用去猜 CI 用了什么参数。

GO ?= go

.PHONY: help build test test-race lint fmt vet check docker run migrate-up migrate-version

help:
	@echo "build           编译全部包（CGO_ENABLED=0）"
	@echo "test            跑测试（快，不带 race）"
	@echo "test-race       跑测试（带 race detector，与 CI 一致）"
	@echo "fmt             格式化（会改写文件）"
	@echo "vet             go vet"
	@echo "lint            golangci-lint"
	@echo "check           fmt-check + vet + lint + test-race + build（提交前跑这个）"
	@echo "docker          docker compose build rehearse-backend"
	@echo "run             本地起服务（需要 DATABASE_URL / JWT_SECRET）"
	@echo "migrate-up      跑迁移（需要 DATABASE_URL）"

build:
	CGO_ENABLED=0 $(GO) build ./...

# 不带 race，本地迭代快一点。
test:
	$(GO) test ./...

# 与 CI 一致。race detector 需要 cgo，所以这里**不**设 CGO_ENABLED=0。
test-race:
	$(GO) test -race ./...

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
	$(GO) run ./cmd/rehearse

migrate-up:
	$(GO) run ./cmd/migrate up

migrate-version:
	$(GO) run ./cmd/migrate version
