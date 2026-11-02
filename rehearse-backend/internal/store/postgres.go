package store

import (
	"context"
	"fmt"
	"log/slog"
	"net/url"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// PoolerSafeExecMode 是对 Supabase transaction 模式 pooler 唯一稳妥的执行模式（§7.3.2）。
//
// 背景：Supavisor 的 transaction 模式**不支持 prepared statement**
// （官方文档原话："although the direct connections and Supavisor in session mode
// support prepared statements, Supavisor in transaction mode does not"）。
//
// pgx v5 的默认模式是 `cache_statement`，会在服务端建 prepared statement，
// 对着 transaction pooler 会报 `prepared statement does not exist`。
// `exec` 用扩展协议但**不建服务端 prepared statement**、只走 1 次 round trip，
// 同时保留参数类型安全。
const PoolerSafeExecMode = "exec"

// poolerUnsafeExecModes 是明确不能用在 transaction pooler 上的模式。
//
// `describe_exec` 特别值得一提：它要 **2 次 round trip**，而 pooler 会在两次
// 之间切换底层连接（pgx 文档原文："May cause problems with connection poolers
// that switch the underlying connection between round trips"）。网上大量
// 「用 statement_cache_mode=describe」的建议是 **pgx v4 的写法**，照抄不仅
// 静默不生效，它对应的 v5 模式还正好是不能用的那个。
var poolerUnsafeExecModes = map[string]string{
	"cache_statement": "在服务端建 prepared statement，transaction pooler 不保留（pgx v5 默认值，必须显式改掉）",
	"describe_exec":   "需要 2 次 round trip，pooler 会在两次之间切换连接",
}

// Postgres 是 Store 的 pgx 实现。
type Postgres struct {
	pool *pgxpool.Pool
}

// 编译期断言：Postgres 同时满足 Store 与 Migrator。
var (
	_ Store    = (*Postgres)(nil)
	_ Migrator = (*Postgres)(nil)
)

// connectPostgres 建连接池。由 `Open` 按 DSN 分发调用。
//
// DSN 会先过 EnsurePoolerSafeDSN——**这是代码约束，不是文档提醒**：
// 本地 PG 上没有 pooler，写错模式照样跑得好好的，只有连到 Supabase 才炸，
// 所以不能靠「实施的人记得」。
func connectPostgres(ctx context.Context, databaseURL string) (*Postgres, error) {
	dsn, err := EnsurePoolerSafeDSN(databaseURL)
	if err != nil {
		return nil, err
	}

	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("parse DATABASE_URL: %w", err)
	}
	// Supabase 的 pooler 有自己的连接数上限，池子别开太大。
	cfg.MaxConns = 8
	cfg.MaxConnLifetime = 30 * time.Minute
	cfg.MaxConnIdleTime = 5 * time.Minute
	cfg.HealthCheckPeriod = time.Minute

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("create pgx pool: %w", err)
	}
	return &Postgres{pool: pool}, nil
}

// Ping 检查连接可用。
func (p *Postgres) Ping(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	return p.pool.Ping(ctx)
}

// Close 释放连接池。
func (p *Postgres) Close() { p.pool.Close() }

// Pool 暴露底层连接池，供阶段 3 的 usage / settings 使用。
func (p *Postgres) Pool() *pgxpool.Pool { return p.pool }

// EnsurePoolerSafeDSN 校验并补全连接串里的 `default_query_exec_mode`。
//
// 行为：
//   - 没设 → 补成 `exec`，记一条 info（这是最常见的路径：人不会记得写）
//   - 设成 pooler 不安全的模式 → **报错退出**（显式写错要吵，不能静默改）
//   - 设成安全模式 → 原样放行
//
// 这个函数是纯函数，所以能单测——`postgres_test.go` 覆盖三种情况。
func EnsurePoolerSafeDSN(databaseURL string) (string, error) {
	parsed, err := url.Parse(databaseURL)
	if err != nil {
		return "", fmt.Errorf("parse DATABASE_URL: %w", err)
	}

	query := parsed.Query()
	current := query.Get("default_query_exec_mode")

	switch {
	case current == "":
		query.Set("default_query_exec_mode", PoolerSafeExecMode)
		parsed.RawQuery = query.Encode()
		slog.Info("DATABASE_URL 未设 default_query_exec_mode，已补为 exec",
			"mode", PoolerSafeExecMode,
			"why", "Supabase transaction pooler 不支持 prepared statement（§7.3.2）")
		return parsed.String(), nil

	case current == PoolerSafeExecMode || current == "simple_protocol":
		return databaseURL, nil

	case current == "cache_describe":
		// 只缓存描述，风险比 cache_statement 低，但仍非为 pooler 设计。
		slog.Warn("DATABASE_URL 用了 cache_describe；对 transaction pooler 建议改成 exec",
			"mode", current)
		return databaseURL, nil

	default:
		reason, known := poolerUnsafeExecModes[current]
		if !known {
			return "", fmt.Errorf(
				"unknown default_query_exec_mode %q; expected one of: exec, simple_protocol, cache_describe, cache_statement, describe_exec",
				current)
		}
		return "", fmt.Errorf(
			"default_query_exec_mode=%q is not safe for the Supabase transaction pooler: %s; use %q instead (§7.3.2)",
			current, reason, PoolerSafeExecMode)
	}
}

// ---- Migrator 实现 ----
//
// 这三段原先是 `cmd/migrate` 里的函数，2026-10-10 搬进 store 包：加了 SQLite
// 之后，`cmd/migrate` 不该知道「PG 的事务怎么开、版本表怎么建」——那是方言。
// 搬进来之后 `cmd/migrate` 只负责「读哪个目录的 SQL、按什么顺序跑」。

// EnsureMigrationsTable 实现 Migrator。
func (p *Postgres) EnsureMigrationsTable(ctx context.Context) error {
	_, err := p.pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version    TEXT        PRIMARY KEY,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)`)
	if err != nil {
		return fmt.Errorf("ensure schema_migrations: %w", err)
	}
	return nil
}

// AppliedVersions 实现 Migrator。
func (p *Postgres) AppliedVersions(ctx context.Context) (map[string]bool, error) {
	rows, err := p.pool.Query(ctx, `SELECT version FROM schema_migrations`)
	if err != nil {
		return nil, fmt.Errorf("read schema_migrations: %w", err)
	}
	defer rows.Close()

	applied := map[string]bool{}
	for rows.Next() {
		var version string
		if err := rows.Scan(&version); err != nil {
			return nil, fmt.Errorf("scan schema_migrations: %w", err)
		}
		applied[version] = true
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read schema_migrations: %w", err)
	}
	return applied, nil
}

// ApplyMigration 实现 Migrator。
//
// body 里通常有**多条**语句（建表 + 建索引），这依赖 pgx 在「无参数 Exec」时
// 走 simple protocol —— 扩展协议不允许一次 Parse 多条语句。带参数的
// `UsageTryConsume` 那条才是单语句。
func (p *Postgres) ApplyMigration(ctx context.Context, version, body string) error {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }() // 已提交时是 no-op

	if _, err := tx.Exec(ctx, body); err != nil {
		return fmt.Errorf("exec migration body: %w", err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO schema_migrations (version) VALUES ($1)`, version); err != nil {
		return fmt.Errorf("record version %s: %w", version, err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit: %w", err)
	}
	return nil
}
