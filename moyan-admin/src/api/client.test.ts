import { afterEach, describe, expect, it } from "vitest";
import {
  clearAdminToken,
  getAdminToken,
  setAdminToken,
} from "./client";

describe("admin token storage", () => {
  afterEach(() => {
    sessionStorage.clear();
  });

  it("returns null when no token is stored", () => {
    expect(getAdminToken()).toBeNull();
  });

  it("stores and retrieves the admin token", () => {
    setAdminToken("secret-token");
    expect(getAdminToken()).toBe("secret-token");
  });

  it("clears the stored admin token", () => {
    setAdminToken("secret-token");
    clearAdminToken();
    expect(getAdminToken()).toBeNull();
  });
});
