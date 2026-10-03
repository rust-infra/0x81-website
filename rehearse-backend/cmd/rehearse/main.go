// Command rehearse 是 Rehearse（职演）的 API 服务。
//
// 职责边界（§7.4）：**只验签，不签发。** 不实现 OAuth、不建号、不读 `users` 表。
// 登录入口是 `auth.0x81.uk`（由认证服务提供），Rehearse 只消费它签出的 JWT。
//
// 存储（§7.3）：自己的托管 Postgres（Supabase，只当 PG 用），
// 与墨言不共享任何表。
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/0x81/rehearse-backend/internal/coach"
	"github.com/0x81/rehearse-backend/internal/config"
	"github.com/0x81/rehearse-backend/internal/httpapi"
	"github.com/0x81/rehearse-backend/internal/llm"
	"github.com/0x81/rehearse-backend/internal/material"
	"github.com/0x81/rehearse-backend/internal/scenarios"
	"github.com/0x81/rehearse-backend/internal/store"
)

func main() {
	// `-healthcheck` 是给容器 healthcheck 用的自探模式。
	//
	// 为什么需要它：最终镜像是 `scratch`，**里面没有 shell、没有 wget、没有 curl**
	// （moyan-backend 用 `wget --spider` 是因为它的镜像是 debian-slim）。
	// 所以健康检查只能由二进制自己发起——这也顺带避免了为健康检查往镜像里
	// 塞一个 HTTP 客户端。
	if len(os.Args) > 1 && os.Args[1] == "-healthcheck" {
		os.Exit(healthcheck())
	}

	if err := run(); err != nil {
		// 配置错误要吵：这是「服务器上漏改 .env」的第一道可见反馈（§7.7）。
		slog.Error("fatal", "err", err)
		os.Exit(1)
	}
}

// healthcheck 打本进程的 /health，返回进程退出码。
//
// 刻意不读 DATABASE_URL、也不复用 store：healthcheck 只该问「服务活着吗」，
// 由服务自己去问「依赖活着吗」。这样探针不需要任何配置。
func healthcheck() int {
	port := os.Getenv("PORT")
	if port == "" {
		port = strconv.Itoa(config.DefaultPort)
	}
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get("http://127.0.0.1:" + port + "/health")
	if err != nil {
		fmt.Fprintln(os.Stderr, "healthcheck: request failed:", err)
		return 1
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		fmt.Fprintln(os.Stderr, "healthcheck: unexpected status", resp.StatusCode)
		return 1
	}
	return 0
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}

	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: parseLevel(cfg.LogLevel),
	})))

	// gin 默认是 debug 模式：启动时把整张路由表打到 stdout，且每个请求都做
	// 额外检查。生产要 release——路由表属于内部结构，没必要出现在容器日志里。
	// 排查路由问题时用 `GIN_MODE=debug` 覆盖。
	if os.Getenv("GIN_MODE") == "" {
		gin.SetMode(gin.ReleaseMode)
	}

	// 连库：**惰性**的，`pgxpool` 不会在创建时真连（见下面的启动探测）。
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	st, err := store.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		// 走到这里说明 DSN 本身有问题（格式、pooler 模式），不是「库没起来」——
		// 那是配置错误，必须吵。
		return fmt.Errorf("connect database: %w", err)
	}
	defer st.Close()

	// 启动探测：连不上**不退出**，只记一条 error。
	//
	// 为什么不像配置错误那样直接退：
	//   · `pgxpool` 是惰性连接，创建成功不代表库可用；不探的话问题会推迟到
	//     第一个请求才暴露
	//   · 但也不该退——配了 `restart: unless-stopped` 的话，库短暂不可用会变成
	//     崩溃循环，而 §13 要的是**降级运行**：`/health` 明确报错、业务接口
	//     返回可判定的错误码，而不是超时挂住
	// 所以：日志里吵一次，`/health` 与容器 healthcheck 持续反映真实状态。
	probeCtx, probeCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer probeCancel()
	if err := st.Ping(probeCtx); err != nil {
		slog.Error("database unreachable at startup; serving in degraded mode",
			"err", err, "note", "/health will report database=unreachable")
	}

	// 场景目录：数据是 go:embed 进来的，加载失败说明内嵌的 JSON 有问题——
	// 那是构建期缺陷（CI 的 `go test ./...` 会先拦住），所以这里直接退出。
	catalog, err := scenarios.Load()
	if err != nil {
		return fmt.Errorf("load scenario catalog: %w", err)
	}
	slog.Info("scenario catalog loaded", "count", catalog.Count())

	// 装配业务服务。
	//
	// 依赖方向是一条线，没有环：store ← quota/settings ← coach/material ← httpapi。
	// LLM 客户端只建一个、三处共用——它内部是一个带 300 秒超时的 http.Client，
	// 每次请求新建一个客户端会让连接池形同虚设（而 LLM 调用是本服务最贵的一跳）。
	llmClient := llm.New()
	quota := coach.NewQuotaService(st)
	llmSettings := coach.NewLLMSettingsService(st, cfg.LLMFallback)
	coachService := coach.NewService(quota, llmSettings, catalog, llmClient)

	addr := fmt.Sprintf(":%d", cfg.Port)
	server := &http.Server{
		Addr: addr,
		Handler: httpapi.NewRouter(httpapi.Deps{
			Config:      cfg,
			Store:       st,
			Catalog:     catalog,
			Coach:       coachService,
			Quota:       quota,
			LLMSettings: llmSettings,
			OCR:         material.NewOCRService(quota, llmSettings, llmClient),
			Profile:     material.NewProfileService(quota, llmSettings, llmClient),
		}),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		// 写超时要留够：材料解析与 LLM 调用都在这条链路上（阶段 3）。
		WriteTimeout: 120 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// 优雅退出：容器收到 SIGTERM 时把在飞的请求放完。
	shutdownDone := make(chan struct{})
	go func() {
		defer close(shutdownDone)
		sig := make(chan os.Signal, 1)
		signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
		<-sig
		slog.Info("shutting down")
		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer shutdownCancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			slog.Error("graceful shutdown failed", "err", err)
		}
	}()

	slog.Info("listening", "addr", addr)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("serve: %w", err)
	}
	<-shutdownDone
	return nil
}

func parseLevel(raw string) slog.Level {
	switch raw {
	case "debug":
		return slog.LevelDebug
	case "warn":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}
