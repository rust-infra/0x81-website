package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"strings"
	"time"

	// 纯 Go 的 SQLite。**不能换成 mattn/go-sqlite3**——那个要 cgo，
	// 一旦 `CGO_ENABLED=1`，静态二进制 / `scratch` 镜像 / 「一条 docker build
	// 出成品」这三条收益全部消失（§7.2 的硬约束）。
	_ "modernc.org/sqlite"
)

// sqliteDriverName 是 modernc.org/sqlite 注册的驱动名。
const sqliteDriverName = "sqlite"

// sqliteMaxOpenConns 是文件库的连接数上限。
//
// SQLite 同一时刻**只允许一个写事务**，池子开大不会提高写吞吐，
// 只会把 `SQLITE_BUSY` 摊到更多连接上。4 是「读能并发、写靠 busy_timeout
// 排队」的一个折中；本服务的 DB 操作全是毫秒级单语句，不存在长事务占着
// 连接不放的情况（LLM 调用在 DB 之外）。
const sqliteMaxOpenConns = 4

// sqlitePragmas 是每条连接都要带的 PRAGMA。
//
// 与 `EnsurePoolerSafeDSN` 同一个思路：**这是代码约束，不是文档提醒**。
// 忘了 WAL 在单进程低并发下完全看不出问题，只有并发起来才暴露，
// 而那时症状是随机的 `database is locked`。
var sqlitePragmas = []string{
	// 抢不到写锁时先等 5 秒再报错，而不是立刻返回 SQLITE_BUSY。
	// 这是并发 `UsageTryConsume` 能串行成功的关键。
	"busy_timeout(5000)",
	// WAL 让读不阻塞写、写不阻塞读。缺省是 DELETE 模式，读会阻塞写。
	"journal_mode(WAL)",
	// WAL 下的推荐值：断电可能丢最后一个事务，但不会损坏库。
	// FULL 是给 DELETE 模式配的，在 WAL 下只是白白多一次 fsync。
	"synchronous(NORMAL)",
	// SQLite 默认**不**校验外键。今天这两张表没有外键，打开它只是为了
	// 将来加表时不会「写了 REFERENCES 却静默不生效」。
	"foreign_keys(1)",
}

// SQLite 是 Store 的 modernc.org/sqlite 实现（§7.3.5）。
//
// 适用场景：单机自托管、本地开发、以及测试。**不适用于多副本**——
// 多个进程写同一个文件要靠文件锁，跨容器/网络卷会静默失效（§7.3.1 已经
// 为「共享 SQLite 文件」记过这笔账，这里不重复踩）。多副本要用 Postgres。
type SQLite struct {
	db *sql.DB
	// inMemory 只影响连接池大小（内存库的每个连接是各自独立的库），
	// 以及 `/health` 与日志里怎么描述它。
	inMemory bool
}

// 编译期断言：SQLite 同时满足 Store 与 Migrator。
var (
	_ Store    = (*SQLite)(nil)
	_ Migrator = (*SQLite)(nil)
)

// connectSQLite 打开数据库文件（不存在则创建）。由 `Open` 按 DSN 分发调用。
func connectSQLite(ctx context.Context, databaseURL string) (*SQLite, error) {
	dsn, err := EnsureSQLiteDSN(databaseURL)
	if err != nil {
		return nil, err
	}

	db, err := sql.Open(sqliteDriverName, dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}

	inMemory := strings.Contains(dsn, ":memory:")
	if inMemory {
		// 内存库的每个连接是**各自独立的库**。DSN 里的 `cache=shared` 让它们
		// 共享同一个，但共享缓存下写事务是表级锁、行为与文件库不同——
		// 所以限制成一条连接，让它与文件库的语义最接近。
		// 测试默认走临时文件（更忠实），内存库是给「不想落盘」的场景留的。
		db.SetMaxOpenConns(1)
		db.SetMaxIdleConns(1)
	} else {
		db.SetMaxOpenConns(sqliteMaxOpenConns)
		db.SetMaxIdleConns(sqliteMaxOpenConns)
	}
	// 文件库的连接不需要回收，回收只会白白重放一遍 PRAGMA。
	db.SetConnMaxLifetime(0)
	db.SetConnMaxIdleTime(0)

	// `sql.Open` 不建连接，所以这里显式探一次。它同时是「文件可写」的检查：
	// 目录不存在、只读挂载、权限不对都会在这一步失败，而不是推迟到第一个请求。
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		// ⚠️ 不回显 DSN——连接串原则上可能含凭据，而 §13 的验收项要求
		// 任何日志与错误都不带它。SQLite 的路径本身不敏感，但保持同一条规则。
		return nil, fmt.Errorf(
			"connect sqlite: %w (确认数据库文件所在目录存在且可写；"+
				"容器里要挂卷，否则数据在容器重建后丢失)", err)
	}

	slog.Info("sqlite backend ready",
		"in_memory", inMemory,
		"max_open_conns", sqliteMaxOpenConns,
		"pragmas", sqlitePragmas)
	return &SQLite{db: db, inMemory: inMemory}, nil
}

// Ping 实现 Store。探活用，超时比 Postgres 侧短——本地文件不该慢。
func (s *SQLite) Ping(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	return s.db.PingContext(ctx)
}

// Close 实现 Store。
func (s *SQLite) Close() { _ = s.db.Close() }

// DB 暴露底层句柄，供需要原生 `*sql.DB` 的地方（目前只有测试）使用。
func (s *SQLite) DB() *sql.DB { return s.db }

// InMemory 报告这是不是一个内存库。
func (s *SQLite) InMemory() bool { return s.inMemory }

// EnsureSQLiteDSN 把 DSN 归一成 modernc.org/sqlite 认的 `file:` URI，
// 并补上 `sqlitePragmas`。
//
// 与 `EnsurePoolerSafeDSN` 一样是**纯函数**，所以能单测（`sqlite_test.go`
// 覆盖各种写法与「用户显式写了 pragma」的情况）。
//
// 接受的写法：
//
//	sqlite:./data/rehearse.db        相对路径
//	sqlite:///var/lib/rehearse.db    绝对路径（三个斜杠）
//	sqlite::memory:                  内存库（测试用）
//	file:rehearse.db?cache=shared    已经是 URI，原样保留、只补 PRAGMA
//
// 补的 PRAGMA 追加在用户已有的 query 之后，所以**冲突时本服务的值生效**
// （例：用户写了 `_pragma=journal_mode(DELETE)`，最终仍是 WAL）。
// 这是有意的：这几条不是可调项，是「这么写才不会在并发下坏掉」。
func EnsureSQLiteDSN(databaseURL string) (string, error) {
	rest := strings.TrimSpace(databaseURL)
	// 顺序不能反：先吃长的前缀，否则 `sqlite:///x.db` 会被削成 `/x.db` 之前
	// 多留一个 `/`。
	rest = strings.TrimPrefix(rest, "sqlite://")
	rest = strings.TrimPrefix(rest, "sqlite:")

	if rest == "" {
		return "", errors.New(
			"sqlite DSN has no database path; expected e.g. sqlite:./data/rehearse.db")
	}

	var uri string
	switch {
	case rest == ":memory:", rest == "file::memory:", rest == "file::memory:?cache=shared":
		// 内存库要显式共享缓存，否则每条连接各建一个库、互相看不见。
		uri = "file::memory:?cache=shared"
	case strings.HasPrefix(rest, "file:"):
		uri = rest
	default:
		// 普通路径转 URI。用 `EscapedPath` 而不是 `url.PathEscape`：
		// 后者会把路径分隔符也转义成 %2F，SQLite 就找不到文件了。
		uri = "file:" + (&url.URL{Path: rest}).EscapedPath()
	}

	return appendSQLitePragmas(uri), nil
}

// appendSQLitePragmas 给 URI 追加 `_pragma=` 参数。
//
// 用 `url.QueryEscape` 编码值：`busy_timeout(5000)` 里的括号是合法的 query
// 值字符，但编码后更稳妥，而驱动侧是 `url.ParseQuery` 解码的，能还原
// （modernc.org/sqlite `applyQueryParams`）。
func appendSQLitePragmas(uri string) string {
	var b strings.Builder
	b.WriteString(uri)
	separator := "?"
	if strings.Contains(uri, "?") {
		separator = "&"
	}
	for _, pragma := range sqlitePragmas {
		b.WriteString(separator)
		separator = "&"
		b.WriteString("_pragma=")
		b.WriteString(url.QueryEscape(pragma))
	}
	return b.String()
}

// ---- Migrator 实现 ----

// EnsureMigrationsTable 实现 Migrator。
func (s *SQLite) EnsureMigrationsTable(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version    TEXT PRIMARY KEY,
			applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`)
	if err != nil {
		return fmt.Errorf("ensure schema_migrations: %w", err)
	}
	return nil
}

// AppliedVersions 实现 Migrator。
func (s *SQLite) AppliedVersions(ctx context.Context) (map[string]bool, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT version FROM schema_migrations`)
	if err != nil {
		return nil, fmt.Errorf("read schema_migrations: %w", err)
	}
	defer func() { _ = rows.Close() }()

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
// 一个迁移一个事务：SQLite 的 DDL **是**事务性的（不像 MySQL），所以中途
// 失败会整体回滚，schema 不会停在半应用状态。
func (s *SQLite) ApplyMigration(ctx context.Context, version, body string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }() // 已提交时是 no-op

	// 一次 Exec 跑多条语句：modernc 的驱动会逐条执行。
	if _, err := tx.ExecContext(ctx, body); err != nil {
		return fmt.Errorf("exec migration body: %w", err)
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO schema_migrations (version) VALUES (?)`, version); err != nil {
		return fmt.Errorf("record version %s: %w", version, err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit: %w", err)
	}
	return nil
}
