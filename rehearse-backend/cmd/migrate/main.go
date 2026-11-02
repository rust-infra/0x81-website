// Command migrate 是 Rehearse 的迁移 runner。
//
// 为什么与 server 分成两个二进制（§7.9）：
//   - **运行时不带 DDL 权限**。server 只读写自己的两张表；建表能力留在
//     这个只跑一次的命令里
//   - 避免「启动时无条件跑迁移」——moyan-backend 现在是那么做的
//     （`sqlx::migrate!("./migrations")` 在启动路径上），多副本部署时几个实例
//     会同时抢着迁移。Rehearse 从一开始就分开
//
// 用法：
//
//	migrate up        应用所有未应用的迁移
//	migrate version   打印已应用的版本
//	migrate pending   只打印待应用的版本，不改库（dry-run）
//
// 迁移文件通过 go:embed 打进二进制（见 `migrations/embed.go`），所以
// `scratch` 镜像里也能跑。
//
// 具体逻辑在 `internal/migrate`——这里只做参数解析与打印，因为测试也要
// 用同一套逻辑建表（2026-10-10）。
package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/0x81/rehearse-backend/internal/config"
	"github.com/0x81/rehearse-backend/internal/migrate"
	"github.com/0x81/rehearse-backend/internal/store"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "migrate:", err)
		os.Exit(1)
	}
}

func run() error {
	if len(os.Args) < 2 {
		return fmt.Errorf("usage: migrate <up|version|pending>")
	}
	command := os.Args[1]

	// 只用 `LoadDatabaseURL` 而不是 `config.Load`：迁移不需要 JWT_SECRET，
	// 强迫它去编一个只会让人在本地随手 export 一个假密钥（§7.7 的反面）。
	//
	// 第二个返回值说明用的是默认 SQLite——**必须说出来**。否则在本目录的
	// ./data/rehearse.db 上跑完迁移，很可能被误以为改的是生产库
	// （症状是「迁移成功但线上 schema 没变」，很难查）。
	dsn, dsnDefaulted := config.LoadDatabaseURL()
	if dsnDefaulted {
		fmt.Printf("note: DATABASE_URL not set, using default %s\n", dsn)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	// 复用 store.Open —— 迁移同样要按 DSN 选后端，所以
	// `EnsurePoolerSafeDSN`（PG）与 `EnsureSQLiteDSN`（SQLite）那两套校验
	// 必须一起生效。走别的路径建连就绕过了它们。
	backend, err := store.Open(ctx, dsn)
	if err != nil {
		return err
	}
	defer backend.Close()

	runner, err := migrate.New(backend)
	if err != nil {
		return err
	}

	fmt.Printf("dialect: %s\n", backend.Dialect)

	switch command {
	case "up":
		return up(ctx, runner)
	case "version":
		return version(ctx, runner)
	case "pending":
		return pending(ctx, runner)
	default:
		return fmt.Errorf("unknown command %q; expected up, version or pending", command)
	}
}

func up(ctx context.Context, runner *migrate.Runner) error {
	ran, err := runner.Up(ctx)
	if err != nil {
		return err
	}
	if len(ran) == 0 {
		fmt.Println("no pending migrations")
		return nil
	}
	for _, version := range ran {
		fmt.Printf("applied %s\n", version)
	}
	return nil
}

func version(ctx context.Context, runner *migrate.Runner) error {
	versions, err := runner.Version(ctx)
	if err != nil {
		return err
	}
	if len(versions) == 0 {
		fmt.Println("no migrations applied")
		return nil
	}
	for _, version := range versions {
		fmt.Println(version)
	}
	return nil
}

func pending(ctx context.Context, runner *migrate.Runner) error {
	versions, err := runner.Pending(ctx)
	if err != nil {
		return err
	}
	if len(versions) == 0 {
		fmt.Println("no pending migrations")
		return nil
	}
	for _, version := range versions {
		fmt.Println(version)
	}
	return nil
}
