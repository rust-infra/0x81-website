import { afterEach, describe, expect, it, vi } from "vitest";
import { getRehearseSettings, updateRehearseSettings } from "./admin";
import { setAdminToken } from "./client";

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const SAMPLE = {
  daily_turn_limit: 100,
  enabled: true,
  base_url: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  temperature: 0.3,
  api_key_set: false,
  api_key_masked: null,
};

describe("rehearse settings api", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it("GETs /api/admin/settings/rehearse and unwraps the envelope", async () => {
    setAdminToken("t");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(SAMPLE));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getRehearseSettings();

    expect(result).toEqual(SAMPLE);
    // Caddy 在同一个 origin 上按路径分流到 4324，前端不该出现端口号。
    expect(fetchMock.mock.calls[0][0]).toBe("/api/admin/settings/rehearse");
  });

  it("PUTs only the provided fields (partial update) with the admin token", async () => {
    setAdminToken("t");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(SAMPLE));
    vi.stubGlobal("fetch", fetchMock);

    await updateRehearseSettings({ api_key: "sk-test" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/admin/settings/rehearse");
    expect(init.method).toBe("PUT");
    // 只带 api_key：整对象回传会把没传的 daily_turn_limit 重置掉。
    expect(JSON.parse(init.body as string)).toEqual({ api_key: "sk-test" });
    expect(new Headers(init.headers).get("X-Admin-Token")).toBe("t");
  });
});
