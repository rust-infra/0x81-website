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
//
// 迁移文件通过 go:embed 打进二进制（见 `migrations/embed.go`），所以
// `scratch` 镜像里也能跑。
package main

import (
	"context"
	"fmt"
	"io/fs"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/0x81/rehearse-backend/internal/config"
	"github.com/0x81/rehearse-backend/internal/store"
	"github.com/0x81/rehearse-backend/migrations"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "migrate:", err)
		os.Exit(1)
	}
}

func run() error {
	if len(os.Args) < 2 {
		return fmt.Errorf("usage: migrate <up|version>")
	}
	command := os.Args[1]

	cfg, err := config.Load()
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	// 复用 store.Connect —— 迁移同样要连 Supabase 的 pooler，
	// 所以 `default_query_exec_mode=exec` 那套校验必须一起生效（§7.3.2）。
	st, err := store.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer st.Close()

	if err := ensureMigrationsTable(ctx, st); err != nil {
		return err
	}

	switch command {
	case "up":
		return up(ctx, st)
	case "version":
		return version(ctx, st)
	default:
		return fmt.Errorf("unknown command %q; expected up or version", command)
	}
}

// migration 是一个待应用的迁移：版本号与它在 embed.FS 里的文件名。
//
// 两者一起算出来而不是事后拼字符串——文件名是 `<version>_<描述>.up.sql`，
// 描述部分属于文件名但不属于版本号，分开存就不用在读的时候反解。
type migration struct {
	Version  string
	Filename string
}

func ensureMigrationsTable(ctx context.Context, st *store.Postgres) error {
	_, err := st.Pool().Exec(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version    TEXT        PRIMARY KEY,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)`)
	return err
}

// up 按版本号顺序应用所有未应用的迁移，**每个迁移一个事务**。
//
// 一个迁移失败就整体停下并返回错误——不做「跳过失败的继续往下跑」，
// 那会让 schema 停在半应用状态。
func up(ctx context.Context, st *store.Postgres) error {
	applied, err := appliedVersions(ctx, st)
	if err != nil {
		return err
	}

	pending, err := availableMigrations()
	if err != nil {
		return err
	}

	count := 0
	for _, m := range pending {
		if applied[m.Version] {
			continue
		}
		body, err := migrations.FS.ReadFile(m.Filename)
		if err != nil {
			return fmt.Errorf("read %s: %w", m.Filename, err)
		}
		if err := applyOne(ctx, st, m.Version, string(body)); err != nil {
			return fmt.Errorf("apply %s: %w", m.Version, err)
		}
		fmt.Printf("applied %s (%s)\n", m.Version, m.Filename)
		count++
	}

	if count == 0 {
		fmt.Println("no pending migrations")
	}
	return nil
}

func applyOne(ctx context.Context, st *store.Postgres, version, body string) error {
	tx, err := st.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }() // 已提交时是 no-op

	if _, err := tx.Exec(ctx, body); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO schema_migrations (version) VALUES ($1)`, version); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func version(ctx context.Context, st *store.Postgres) error {
	applied, err := appliedVersions(ctx, st)
	if err != nil {
		return err
	}
	if len(applied) == 0 {
		fmt.Println("no migrations applied")
		return nil
	}
	versions := make([]string, 0, len(applied))
	for v := range applied {
		versions = append(versions, v)
	}
	sort.Strings(versions)
	for _, v := range versions {
		fmt.Println(v)
	}
	return nil
}

func appliedVersions(ctx context.Context, st *store.Postgres) (map[string]bool, error) {
	rows, err := st.Pool().Query(ctx, `SELECT version FROM schema_migrations`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	applied := map[string]bool{}
	for rows.Next() {
		var v string
		if err := rows.Scan(&v); err != nil {
			return nil, err
		}
		applied[v] = true
	}
	return applied, rows.Err()
}

// availableMigrations 列出内嵌的全部 up 迁移，按版本号排序。
//
// 零填充的数字前缀让字典序等于时间序，所以不需要解析成整数。
func availableMigrations() ([]migration, error) {
	entries, err := fs.Glob(migrations.FS, "*.up.sql")
	if err != nil {
		return nil, err
	}

	out := make([]migration, 0, len(entries))
	for _, name := range entries {
		version, _, ok := strings.Cut(name, "_")
		if !ok || version == "" {
			return nil, fmt.Errorf("migration filename %q must look like <version>_<desc>.up.sql", name)
		}
		out = append(out, migration{Version: version, Filename: name})
	}

	sort.Slice(out, func(i, j int) bool { return out[i].Version < out[j].Version })
	return out, nil
}
