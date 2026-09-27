import { afterEach, describe, expect, it, vi } from "vitest";
import { getCoachSettings, updateCoachSettings } from "./admin";
import { setAdminToken } from "./client";

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("coach settings api", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it("GETs /api/admin/settings/coach and unwraps the envelope", async () => {
    setAdminToken("t");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ daily_turn_limit: 100, enabled: true }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getCoachSettings();

    expect(result).toEqual({ daily_turn_limit: 100, enabled: true });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/admin/settings/coach");
  });

  it("PUTs the new limit and sends the admin token", async () => {
    setAdminToken("t");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ daily_turn_limit: 250, enabled: true }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await updateCoachSettings({ daily_turn_limit: 250, enabled: true });

    expect(result.daily_turn_limit).toBe(250);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/admin/settings/coach");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({
      daily_turn_limit: 250,
      enabled: true,
    });
    expect(new Headers(init.headers).get("X-Admin-Token")).toBe("t");
  });
});
