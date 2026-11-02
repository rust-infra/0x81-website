package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/0x81/rehearse-backend/internal/store"
)

// health 报告「进程活着」与「依赖可用」两件事。
//
// 刻意**不走错误信封**：这是给健康检查与运维看的端点，不是用户 API。
// 返回体保持极简，且**绝不回显连接串或任何凭据**（§13 的验收项）。
//
// 为什么要把 DB 可达性算进健康检查：§7.3 换成独立托管 PG 之后，
// Postgres 成了唯一的外部依赖，它挂了 Rehearse 整体不可用。如果 `/health`
// 只回 200，编排层会以为一切正常。
//
// `dialect` 与 `database_defaulted` 是为「默认 SQLite」配的（§7.3.5）：
// `DATABASE_URL` 不设时服务会落到本地 SQLite 文件上。这对本地开发是便利，
// 对生产是**事故**（单副本、没有托管备份与 PITR）。把这两项放进响应，
// 是为了让运维一条 curl 就能判出「现在跑在哪个库、是不是用的默认值」，
// 而不是只能去翻启动日志——日志会被轮转，`/health` 不会。
func health(st store.Store, dialect store.Dialect, databaseDefaulted bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		if err := st.Ping(c.Request.Context()); err != nil {
			// 细节只进日志（在 store 层记），响应里不出现。
			c.JSON(http.StatusServiceUnavailable,
				healthBody("degraded", "unreachable", dialect, databaseDefaulted))
			return
		}
		c.JSON(http.StatusOK, healthBody("ok", "ok", dialect, databaseDefaulted))
	}
}

// healthBody 手写而不是用 middleware.DataEnvelope：这个端点不属于用户 API
// 的信封体系（见上）。
//
// 用 `map[string]any` 而不是 struct：这里只有四个字段，而
// `database_defaulted` 是布尔、其余是字符串，拆成 struct 反而要多维护一组
// json tag 且没有任何类型安全上的收益（没有第二个使用方）。
func healthBody(overall, database string, dialect store.Dialect, databaseDefaulted bool) map[string]any {
	return map[string]any{
		"status":             overall,
		"database":           database,
		"dialect":            string(dialect),
		"database_defaulted": databaseDefaulted,
	}
}
