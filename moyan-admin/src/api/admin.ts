import { adminFetch } from "./client";

export async function pingAdmin(token?: string): Promise<void> {
  const base = import.meta.env.VITE_API_URL ?? "";
  const headers = new Headers();

  if (token) {
    headers.set("X-Admin-Token", token);
  }

  const res = token
    ? await fetch(`${base}/api/admin/ping`, { headers })
    : await adminFetch("/api/admin/ping");

  if (!res.ok) {
    throw new Error(
      res.status === 401 ? "无效的管理员令牌" : "管理员验证失败",
    );
  }
}
