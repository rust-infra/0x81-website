package httpapi

import (
	"net/http"

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
func health(st store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := st.Ping(r.Context()); err != nil {
			// 细节只进日志（在 store 层记），响应里不出现。
			writeHealth(w, http.StatusServiceUnavailable, "degraded", "unreachable")
			return
		}
		writeHealth(w, http.StatusOK, "ok", "ok")
	}
}

func writeHealth(w http.ResponseWriter, status int, overall, database string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	// 手写而不是用 middleware.WriteData：这个端点不属于用户 API 的信封体系。
	_, _ = w.Write([]byte(`{"status":"` + overall + `","database":"` + database + `"}` + "\n"))
}
