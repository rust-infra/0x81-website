const TOKEN_KEY = "moyan_admin_token";

export function getAdminToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setAdminToken(token: string): void {
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearAdminToken(): void {
  sessionStorage.removeItem(TOKEN_KEY);
}

export async function adminFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = getAdminToken();
  const headers = new Headers(init.headers);
  if (token) {
    headers.set("X-Admin-Token", token);
  }

  const base = import.meta.env.VITE_API_URL ?? "";
  const res = await fetch(`${base}${path}`, { ...init, headers });

  if (res.status === 401) {
    clearAdminToken();
    window.location.href = "/login";
    throw new Error("unauthorized");
  }

  return res;
}
