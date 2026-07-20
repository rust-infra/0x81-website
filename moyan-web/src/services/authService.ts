// Google OAuth + Auth State Management

const API_BASE = import.meta.env.VITE_API_URL || "";

export interface User {
  id: string;
  name: string;
  email: string;
  avatar: string;
  provider: "google" | "kimi" | "local";
}

let currentUser: User | null = null;
let authListeners: ((user: User | null) => void)[] = [];

function notifyListeners() {
  authListeners.forEach((cb) => cb(currentUser));
}

export function onAuthChange(callback: (user: User | null) => void) {
  authListeners.push(callback);
  callback(currentUser);
  return () => {
    authListeners = authListeners.filter((cb) => cb !== callback);
  };
}

export function getCurrentUser(): User | null {
  // Check localStorage first
  if (!currentUser) {
    const stored = localStorage.getItem("moyan_user");
    if (stored) {
      try {
        currentUser = JSON.parse(stored);
      } catch {
        localStorage.removeItem("moyan_user");
      }
    }
  }
  return currentUser;
}

export function setUser(user: User | null) {
  currentUser = user;
  if (user) {
    localStorage.setItem("moyan_user", JSON.stringify(user));
  } else {
    localStorage.removeItem("moyan_user");
    localStorage.removeItem("moyan_token");
  }
  notifyListeners();
}

export function logout() {
  currentUser = null;
  localStorage.removeItem("moyan_user");
  localStorage.removeItem("moyan_token");
  notifyListeners();
}

// ========== Google OAuth ==========

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";

/**
 * Initialize Google Identity Services
 */
export function initGoogleAuth(): Promise<void> {
  return new Promise((resolve, reject) => {
    if ((window as any).google?.accounts?.oauth2) {
      resolve();
      return;
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google Identity Services"));
    document.head.appendChild(script);
  });
}

/**
 * Start Google OAuth flow
 */
export async function loginWithGoogle(): Promise<User> {
  await initGoogleAuth();

  const google = (window as any).google;

  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: "openid email profile https://www.googleapis.com/auth/drive.file",
      callback: async (tokenResponse: any) => {
        try {
          if (tokenResponse.error) {
            reject(new Error(tokenResponse.error));
            return;
          }

          // Fetch user info from Google
          const userInfo = await fetch(
            "https://www.googleapis.com/oauth2/v3/userinfo",
            {
              headers: {
                Authorization: `Bearer ${tokenResponse.access_token}`,
              },
            }
          ).then((r) => r.json());

          const user: User = {
            id: `google_${userInfo.sub}`,
            name: userInfo.name,
            email: userInfo.email,
            avatar: userInfo.picture,
            provider: "google",
          };

          // Store token
          localStorage.setItem("moyan_token", tokenResponse.access_token);
          setUser(user);
          resolve(user);
        } catch (err) {
          reject(err);
        }
      },
    });

    client.requestAccessToken();
  });
}

// ========== Kimi OAuth (Device Flow - PKCE-free, no redirect needed) ==========

const KIMI_CLIENT_ID = "17e5f671-d194-4dfb-9706-5516cb48c098";
const KIMI_AUTH_BASE = "https://auth.kimi.com";

// Persistent device ID for Kimi auth
function getKimiDeviceId(): string {
  let id = localStorage.getItem("moyan_kimi_device_id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("moyan_kimi_device_id", id);
  }
  return id;
}

/** Kimi-required platform headers */
function kimiHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/x-www-form-urlencoded",
    "Accept": "application/json",
    "X-Msh-Platform": "web",
    "X-Msh-Version": "1.0.0",
    "X-Msh-Device-Name": "MoyanWeb",
    "X-Msh-Device-Model": "browser",
    "X-Msh-Os-Version": "web",
    "X-Msh-Device-Id": getKimiDeviceId(),
  };
}

export interface KimiDeviceAuth {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

/**
 * Step 1: Request device authorization
 * Note: Kimi device_authorization does NOT accept a scope parameter;
 *       the server automatically assigns scope "kimi-code".
 */
export async function requestKimiDeviceAuth(): Promise<KimiDeviceAuth> {
  const res = await fetch(`${KIMI_AUTH_BASE}/api/oauth/device_authorization`, {
    method: "POST",
    headers: kimiHeaders(),
    body: new URLSearchParams({
      client_id: KIMI_CLIENT_ID,
    }).toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Kimi device auth failed: ${err}`);
  }

  return res.json();
}

/**
 * Step 2: Poll for access token
 * Returns token when user authorizes, null if still pending, throws on error/expired
 */
export async function pollKimiToken(deviceCode: string): Promise<string | null> {
  const res = await fetch(`${KIMI_AUTH_BASE}/api/oauth/token`, {
    method: "POST",
    headers: kimiHeaders(),
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: deviceCode,
      client_id: KIMI_CLIENT_ID,
    }).toString(),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    // Standard OAuth device flow error codes
    if (data.error === "authorization_pending") {
      return null; // Still waiting for user
    }
    if (data.error === "slow_down") {
      return null; // Need to poll slower
    }
    if (data.error === "expired_token") {
      throw new Error("授权已过期，请重试");
    }
    if (data.error === "access_denied") {
      throw new Error("用户拒绝了授权");
    }
    throw new Error(data.error_description || data.error || "Token request failed");
  }

  const data = await res.json();
  return data.access_token;
}

/**
 * Step 3: Get user info from Kimi access token
 */
export async function getKimiUserInfo(accessToken: string): Promise<User> {
  // Try to get user info from Kimi's userinfo endpoint
  try {
    const res = await fetch(`${KIMI_AUTH_BASE}/api/oauth/userinfo`, {
      headers: {
        ...kimiHeaders(),
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (res.ok) {
      const data = await res.json();
      return {
        id: `kimi_${data.sub || data.id}`,
        name: data.name || data.nickname || "Kimi User",
        email: data.email || `${data.sub}@kimi.user`,
        avatar: data.picture || data.avatar || "",
        provider: "kimi",
      };
    }
  } catch {
    // Fallback: try to decode JWT token
  }

  // Try decoding JWT token to extract claims
  try {
    const parts = accessToken.split(".");
    if (parts.length === 3) {
      const payload = JSON.parse(atob(parts[1]));
      return {
        id: `kimi_${payload.sub || payload.user_id || Date.now()}`,
        name: payload.name || payload.nickname || "Kimi User",
        email: payload.email || `${payload.sub}@kimi.user`,
        avatar: payload.picture || payload.avatar || "",
        provider: "kimi",
      };
    }
  } catch {
    // Final fallback: generate a user from token hash
  }

  // Ultimate fallback
  return {
    id: `kimi_${Date.now()}`,
    name: "Kimi User",
    email: `user_${Date.now()}@kimi.user`,
    avatar: "",
    provider: "kimi",
  };
}

/**
 * Complete Kimi login flow (device flow)
 * If VITE_API_URL is set, uses backend for token exchange and user creation.
 */
export async function loginWithKimi(
  onWaiting: () => void,
  onPolling: (attempt: number) => void
): Promise<User> {
  // Step 1: Request device auth
  const deviceAuth = await requestKimiDeviceAuth();

  // Open verification page
  window.open(deviceAuth.verification_uri_complete, "_blank", "noopener,noreferrer");

  onWaiting();

  // Step 2: Poll for token
  const maxAttempts = Math.floor(deviceAuth.expires_in / deviceAuth.interval);
  const pollInterval = (deviceAuth.interval || 5) * 1000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((r) => setTimeout(r, pollInterval));
    onPolling(attempt + 1);

    try {
      const kimiToken = await pollKimiToken(deviceAuth.device_code);
      if (kimiToken) {
        // If backend is configured, exchange Kimi token for backend JWT
        if (API_BASE) {
          const res = await fetch(`${API_BASE}/api/auth/kimi`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ access_token: kimiToken }),
          });
          if (!res.ok) {
            const err = await res.text();
            throw new Error(`Backend login failed: ${err}`);
          }
          const data = await res.json();
          const { token, user } = data.data;
          localStorage.setItem("moyan_token", token);
          const u: User = {
            id: user.id,
            name: user.name,
            email: user.email,
            avatar: user.avatar || "",
            provider: "kimi",
          };
          setUser(u);
          return u;
        }

        // Pure frontend mode: decode JWT locally
        const user = await getKimiUserInfo(kimiToken);
        localStorage.setItem("moyan_token", kimiToken);
        setUser(user);
        return user;
      }
      // null = still pending, continue polling
    } catch (err) {
      // Real error, stop polling
      throw err;
    }
  }

  throw new Error("授权等待超时，请重试");
}

// ========== Rust Backend API (可选) ==========

export async function loginWithRustBackend(code: string): Promise<User> {
  const res = await fetch(`${API_BASE}/api/auth/google/callback?code=${code}`);
  if (!res.ok) throw new Error("Backend authentication failed");

  const data = await res.json();
  localStorage.setItem("moyan_token", data.token);
  const user: User = {
    id: `google_${data.user.id}`,
    name: data.user.name,
    email: data.user.email,
    avatar: data.user.avatar,
    provider: "google",
  };
  setUser(user);
  return user;
}

export async function getUserFromRustBackend(): Promise<User | null> {
  const token = localStorage.getItem("moyan_token");
  if (!token) return null;

  try {
    const res = await fetch(`${API_BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;

    const data = await res.json();
    const user: User = {
      id: `google_${data.id}`,
      name: data.name,
      email: data.email,
      avatar: data.avatar,
      provider: "google",
    };
    setUser(user);
    return user;
  } catch {
    return null;
  }
}
