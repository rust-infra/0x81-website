// Package store 是 Rehearse 自己的持久层。
//
// 与 moyan-backend 的 `repositories/`（3 文件 6,597 行）不同，这里**故意很薄**：
// Rehearse 只碰自己那两张表（`rehearse_usage` / `rehearse_settings`），
// 没有共享表要迁就，所以不需要那套多后端抽象（§7.9 的对照表里
// `repositories/` 标注为「不移植」）。
//
// 阶段 2 只实现连接与健康检查；`rehearse_usage` / `rehearse_settings` 的
// 读写随阶段 3（业务移植）补上。
package store

import "context"

// Store 是持久层的接口。
//
// 现在只有健康检查——因为阶段 2 的骨架还不碰业务表。这个接口会在阶段 3
// 长出 usage / settings 两组方法，届时 `Postgres` 是唯一实现
// （不会像 moyan-backend 那样有 sqlite / mongodb 两个实现：§7.3.4 已决定
// 不引入第二套存储后端）。
type Store interface {
	// Ping 用于 `/health`：能区分「进程活着」和「依赖可用」。
	Ping(ctx context.Context) error
	// Close 释放连接池。
	Close()
}
