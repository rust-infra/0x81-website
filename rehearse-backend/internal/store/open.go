package store

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

// Dialect 标识存储后端。
//
// 它是一个**显式类型**而不是裸 string：`cmd/migrate` 要按它挑迁移目录，
// 拼错一个字符串常量在编译期不会有任何反应，而后果是「跑了错的方言的迁移」
// ——那种错误在本地看不出来，只有换后端时才炸。
type Dialect string

const (
	DialectPostgres Dialect = "postgres"
	DialectSQLite   Dialect = "sqlite"
)

// String 实现 fmt.Stringer，让日志里出现的是 `postgres` / `sqlite`。
func (d Dialect) String() string { return string(d) }

// Backend 是一个已建连的存储后端。
//
// 把 Store 与 Migrator 一起返回，是因为「哪个 DSN 对应哪套实现」这个判断
// 只该做一次：`cmd/rehearse` 只要 Store，`cmd/migrate` 还要 Migrator，
// 如果两边各自 DetectDialect 一遍，将来加后端就会出现「两处判断不一致」
// 的可能。
type Backend struct {
	Store    Store
	Migrator Migrator
	Dialect  Dialect
}

// Close 释放连接。实现 `io.Closer`，方便 defer。
func (b *Backend) Close() {
	if b.Store != nil {
		b.Store.Close()
	}
}

// Open 按 DSN 选后端并建连接。
//
// 这是**唯一的**建连入口：Postgres 的 `EnsurePoolerSafeDSN` 与 SQLite 的
// `EnsureSQLiteDSN` 都是「代码约束」而不是文档提醒，所以必须只有一条路径
// 能绕过它们——就是没有别的路径。
func Open(ctx context.Context, databaseURL string) (*Backend, error) {
	dialect, err := DetectDialect(databaseURL)
	if err != nil {
		return nil, err
	}

	switch dialect {
	case DialectPostgres:
		pg, err := connectPostgres(ctx, databaseURL)
		if err != nil {
			return nil, err
		}
		return &Backend{Store: pg, Migrator: pg, Dialect: dialect}, nil

	case DialectSQLite:
		lite, err := connectSQLite(ctx, databaseURL)
		if err != nil {
			return nil, err
		}
		return &Backend{Store: lite, Migrator: lite, Dialect: dialect}, nil

	default:
		// 走到这里说明 DetectDialect 返回了一个它自己不会产生的值。
		return nil, fmt.Errorf("unsupported database dialect %q", dialect)
	}
}

// DetectDialect 按 DSN 判断该用哪个后端。
//
// **只认显式 scheme**，不接受裸路径。看起来啰嗦，但裸路径的代价是
// 「DSN 写错」会被静默解释成「在错误的位置新建一个空 SQLite 文件」——
// 而症状是「服务起来了、数据却查不到」，比启动失败难查得多（§7.7 的
// 同一条原则：宁可吵，不要静默给默认值）。
//
// 接受的写法：
//
//	postgres://...  postgresql://...   Postgres（生产，§7.3.2）
//	sqlite:...      sqlite://...       SQLite（§7.3.5）
//	file:...                           已经是 SQLite 的 URI 形式
//
// ⚠️ 错误信息里**不出现 DSN 本身**——连接串里有密码（§13 的验收项）。
func DetectDialect(databaseURL string) (Dialect, error) {
	dsn := strings.TrimSpace(databaseURL)

	switch {
	case dsn == "":
		return "", errors.New("DATABASE_URL is empty")
	case strings.HasPrefix(dsn, "postgres://"), strings.HasPrefix(dsn, "postgresql://"):
		return DialectPostgres, nil
	case strings.HasPrefix(dsn, "sqlite:"), strings.HasPrefix(dsn, "file:"):
		return DialectSQLite, nil
	default:
		return "", errors.New(
			"cannot tell the database backend from DATABASE_URL: " +
				"expected a postgres:// or postgresql:// DSN, or sqlite:<path> for a local SQLite file")
	}
}
