// Package migrations 把 SQL 迁移文件嵌进二进制。
//
// 为什么要单独一个包：`//go:embed` **不能跨目录往上引用**，而迁移文件按 §7.9
// 放在模块根的 `migrations/`。加一个只含 embed 的包，`cmd/migrate` 就能在
// `scratch` 镜像里（没有文件系统、没有 shell）照常跑迁移。
package migrations

import "embed"

// FS 是 `migrations/*.sql` 的内容。
//
//go:embed *.sql
var FS embed.FS
