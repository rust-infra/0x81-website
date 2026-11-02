// Package migrate 是 Rehearse 的迁移 runner。
//
// 单独一个包而不是写在 `cmd/migrate` 里，是为了让**测试也能用**：
// 集成测试要先建表，而「怎么按版本号找迁移、按什么顺序跑、失败怎么办」
// 这套逻辑只该有一份。`cmd/migrate` 因此只剩参数解析与打印。
//
// 与 moyan-backend 的区别（§7.9）：这里**不在 server 启动路径上**。
// `cmd/rehearse` 不 import 本包，所以运行时既没有 DDL 能力、也不会出现
// 「多副本同时抢着迁移」。
package migrate

import (
	"context"
	"fmt"
	"io/fs"
	"sort"
	"strings"

	"github.com/0x81/rehearse-backend/internal/store"
	"github.com/0x81/rehearse-backend/migrations"
)

// Runner 把一个后端与一套迁移文件绑在一起。
type Runner struct {
	backend *store.Backend
	fsys    fs.FS
}

// New 按后端的方言选迁移目录。
//
// 选目录这件事**由方言决定，不由调用方决定**——否则就会出现「用 SQLite 跑
// PG 的迁移」，而那种错误在只有一个后端时永远不会暴露。
func New(backend *store.Backend) (*Runner, error) {
	var fsys fs.FS
	switch backend.Dialect {
	case store.DialectPostgres:
		fsys = migrations.Postgres()
	case store.DialectSQLite:
		fsys = migrations.SQLite()
	default:
		return nil, fmt.Errorf("no migration set for dialect %q", backend.Dialect)
	}
	return &Runner{backend: backend, fsys: fsys}, nil
}

// Up 按版本号顺序应用所有未应用的迁移，**每个迁移一个事务**。
//
// 返回本次真正应用的版本号（已应用的不重复返回）。一个迁移失败就整体停下
// 并返回错误——不做「跳过失败的继续往下跑」，那会让 schema 停在半应用状态。
func (r *Runner) Up(ctx context.Context) ([]string, error) {
	if err := r.backend.Migrator.EnsureMigrationsTable(ctx); err != nil {
		return nil, err
	}

	applied, err := r.backend.Migrator.AppliedVersions(ctx)
	if err != nil {
		return nil, err
	}

	available, err := r.available()
	if err != nil {
		return nil, err
	}

	var ran []string
	for _, m := range available {
		if applied[m.Version] {
			continue
		}
		body, err := fs.ReadFile(r.fsys, m.Filename)
		if err != nil {
			return ran, fmt.Errorf("read %s: %w", m.Filename, err)
		}
		if err := r.backend.Migrator.ApplyMigration(ctx, m.Version, string(body)); err != nil {
			return ran, fmt.Errorf("apply %s: %w", m.Version, err)
		}
		ran = append(ran, m.Version)
	}
	return ran, nil
}

// Version 返回已应用的版本号，升序。
//
// 它会先确保 `schema_migrations` 存在——空库上「报错」不如「回一个空列表」
// 有用，而这个副作用只是建一张记账表。
func (r *Runner) Version(ctx context.Context) ([]string, error) {
	if err := r.backend.Migrator.EnsureMigrationsTable(ctx); err != nil {
		return nil, err
	}
	applied, err := r.backend.Migrator.AppliedVersions(ctx)
	if err != nil {
		return nil, err
	}
	versions := make([]string, 0, len(applied))
	for version := range applied {
		versions = append(versions, version)
	}
	sort.Strings(versions)
	return versions, nil
}

// Pending 返回尚未应用的版本号，升序。`cmd/migrate` 用它做 dry-run 打印。
func (r *Runner) Pending(ctx context.Context) ([]string, error) {
	if err := r.backend.Migrator.EnsureMigrationsTable(ctx); err != nil {
		return nil, err
	}
	applied, err := r.backend.Migrator.AppliedVersions(ctx)
	if err != nil {
		return nil, err
	}
	available, err := r.available()
	if err != nil {
		return nil, err
	}
	var pending []string
	for _, m := range available {
		if !applied[m.Version] {
			pending = append(pending, m.Version)
		}
	}
	return pending, nil
}

// migration 是一个待应用的迁移：版本号与它在嵌入文件系统里的文件名。
//
// 两者一起算出来而不是事后拼字符串——文件名是 `<version>_<描述>.up.sql`，
// 描述部分属于文件名但不属于版本号，分开存就不用在读的时候反解。
type migration struct {
	Version  string
	Filename string
}

// available 列出嵌入的全部 up 迁移，按版本号排序。
//
// 零填充的数字前缀让字典序等于时间序，所以不需要解析成整数。
func (r *Runner) available() ([]migration, error) {
	entries, err := fs.Glob(r.fsys, "*.up.sql")
	if err != nil {
		return nil, fmt.Errorf("glob migrations: %w", err)
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
