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
func health(st store.Store) gin.HandlerFunc {
	return func(c *gin.Context) {
		if err := st.Ping(c.Request.Context()); err != nil {
			// 细节只进日志（在 store 层记），响应里不出现。
			c.JSON(http.StatusServiceUnavailable, healthBody("degraded", "unreachable"))
			return
		}
		c.JSON(http.StatusOK, healthBody("ok", "ok"))
	}
}

// healthBody 手写而不是用 middleware.DataEnvelope：这个端点不属于用户 API
// 的信封体系（见上）。
func healthBody(overall, database string) map[string]string {
	return map[string]string{"status": overall, "database": database}
}
