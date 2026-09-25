/**
 * 「服务端为权威」模式的唯一判断来源。
 *
 * 历史坑（2026-09-18）：此前各个 service 直接把 `import.meta.env.VITE_API_URL` 非空
 * 当作「有后端」（`API_BASE.length > 0`）。但线上是**同源部署**：moyan-web 由 Caddy
 * 托管，Caddyfile 把 `/api/*` 反代到 moyan-backend，所以请求本来就该走相对路径、
 * VITE_API_URL 故意留空 —— 于是所有 `hasXxxBackend()` 恒为 false，前端一直退回
 * IndexedDB 本地模式（词库来自镜像里打包的 public/vocabulary.json），后台导入的
 * 词库在 /decks 永远看不见。
 *
 * 现在拆成两件事：
 *   - `API_BASE`：请求前缀，同源部署为空串（相对路径）；
 *   - `hasBackend()`：是否走服务端权威模式，与 API_BASE 是否为空解耦。
 *
 * 判断顺序（自上而下）：
 *   1. `VITE_SERVER_MODE=1/true` → 开；`=0/false` → 关（构建期注入，显式优先级最高）
 *   2. `VITE_API_URL` 非空 → 开（本地前端直连独立后端）
 *   3. 生产构建 → 默认开（线上就是同源 + Caddy 反代，默认开才不会再静默退回本地模式）
 *      开发（vite dev）→ 默认关，保留不带后端的离线调试体验
 */

const API_URL = import.meta.env.VITE_API_URL || "";
const SERVER_MODE_FLAG = String(import.meta.env.VITE_SERVER_MODE ?? "").toLowerCase();

/** API 前缀。同源部署时为空串，请求保持相对路径（如 `/api/decks`）。 */
export const API_BASE = API_URL;

/** 是否启用服务端权威模式（词库/进度/设置/同步/播客均以服务端为准）。 */
export function hasBackend(): boolean {
  if (SERVER_MODE_FLAG === "0" || SERVER_MODE_FLAG === "false") return false;
  if (SERVER_MODE_FLAG === "1" || SERVER_MODE_FLAG === "true") return true;
  if (API_URL.length > 0) return true;
  return import.meta.env.PROD;
}
