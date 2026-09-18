import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * 「服务端为权威」开关的回归测试。
 *
 * 背景：线上曾经把 `VITE_API_URL` 非空当作「有后端」，但线上是同源部署、该变量故意为空，
 * 导致前端静默退回 IndexedDB 本地模式 —— 管理后台导入的词库在 /decks 永远看不见。
 * 这里锁住 backendMode.hasBackend() 的语义，避免再次退化。
 */

async function loadModule(env: Record<string, string | undefined>) {
  vi.resetModules();
  const meta = import.meta.env as Record<string, string | undefined>;
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete meta[key];
    else meta[key] = value;
  }
  return import("./backendMode");
}

afterEach(() => {
  const meta = import.meta.env as Record<string, string | undefined>;
  delete meta.VITE_API_URL;
  delete meta.VITE_SERVER_MODE;
});

describe("hasBackend", () => {
  it("VITE_SERVER_MODE=1（构建期显式开启）→ 服务端模式，且 API_BASE 保持相对路径", async () => {
    const { API_BASE, hasBackend } = await loadModule({
      VITE_SERVER_MODE: "1",
      VITE_API_URL: undefined,
    });
    expect(hasBackend()).toBe(true);
    // 同源部署必须是相对路径，否则会跨域/把域名写死
    expect(API_BASE).toBe("");
  });

  it("VITE_SERVER_MODE=0 优先于 VITE_API_URL（可显式构建离线版）", async () => {
    const { hasBackend } = await loadModule({
      VITE_SERVER_MODE: "0",
      VITE_API_URL: "http://127.0.0.1:4323",
    });
    expect(hasBackend()).toBe(false);
  });

  it("只配 VITE_API_URL（前端直连独立后端）→ 服务端模式", async () => {
    const { API_BASE, hasBackend } = await loadModule({
      VITE_SERVER_MODE: undefined,
      VITE_API_URL: "http://127.0.0.1:4323",
    });
    expect(hasBackend()).toBe(true);
    expect(API_BASE).toBe("http://127.0.0.1:4323");
  });

  it("两者都没有（vite dev / 测试环境）→ 本地模式，API_BASE 为空", async () => {
    expect(import.meta.env.PROD).toBe(false);
    const { API_BASE, hasBackend } = await loadModule({
      VITE_SERVER_MODE: undefined,
      VITE_API_URL: undefined,
    });
    expect(hasBackend()).toBe(false);
    expect(API_BASE).toBe("");
  });
});
