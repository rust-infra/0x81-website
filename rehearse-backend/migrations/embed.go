// Package migrations 把 SQL 迁移文件嵌进二进制。
//
// 为什么要单独一个包：`//go:embed` **不能跨目录往上引用**，而迁移文件按 §7.9
// 放在模块根的 `migrations/`。加一个只含 embed 的包，`cmd/migrate` 就能在
// `scratch` 镜像里（没有文件系统、没有 shell）照常跑迁移。
//
// 目录按后端分（2026-10-10）：`postgres/` 与 `sqlite/` 各一套，**版本号必须对齐**
// ——同一个版本号在两边描述同一件事。理由见 sqlite/0001_init.up.sql 顶部。
package migrations

import (
	"embed"
	"io/fs"
)

//go:embed postgres/*.sql
var postgresFS embed.FS

//go:embed sqlite/*.sql
var sqliteFS embed.FS

// Postgres 返回以 `postgres/` 为根的迁移文件系统。
func Postgres() fs.FS { return mustSub(postgresFS, "postgres") }

// SQLite 返回以 `sqlite/` 为根的迁移文件系统。
func SQLite() fs.FS { return mustSub(sqliteFS, "sqlite") }

// mustSub 只在 embed 指令写错时才会失败——那是构建期缺陷，
// 而且此时任何调用方都做不了补救，所以 panic 比返回 error 更诚实。
func mustSub(fsys fs.FS, dir string) fs.FS {
	sub, err := fs.Sub(fsys, dir)
	if err != nil {
		panic("migrations: embed directive and subdirectory name disagree: " + err.Error())
	}
	return sub
}
