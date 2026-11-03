/**
 * Telegram Mini App 的最小桥接。
 *
 * 只在 Web 上生效；原生 App 里 `window` 不存在，`Platform.OS !== 'web'`
 * 的调用方会直接跳过。SDK 由 `src/app/+html.tsx` 从 telegram.org 引入；
 * 加载失败或不在 Telegram 里时，这里全部返回空值，App 退回普通登录页。
 */
export interface TelegramWebAppLike {
  initData?: string;
  platform?: string;
  version?: string;
  ready?: () => void;
  expand?: () => void;
}

interface TelegramScope {
  Telegram?: { WebApp?: TelegramWebAppLike };
}

function scopeOf(candidate?: unknown): TelegramScope | null {
  if (candidate !== undefined) {
    return candidate && typeof candidate === 'object'
      ? (candidate as TelegramScope)
      : null;
  }
  if (typeof window !== 'undefined') {
    return window as unknown as TelegramScope;
  }
  return null;
}

export function getTelegramWebApp(candidate?: unknown): TelegramWebAppLike | null {
  return scopeOf(candidate)?.Telegram?.WebApp ?? null;
}

/**
 * 读取 initData，并顺手完成 SDK 握手。
 *
 * `ready()` 告诉 Telegram 首屏已经渲染完，不调用会一直显示加载态；
 * `expand()` 让 Mini App 占满可用高度，不调用默认是半屏。两者都幂等。
 */
export function getTelegramInitData(candidate?: unknown): string {
  const app = getTelegramWebApp(candidate);
  if (!app) return '';
  try {
    app.ready?.();
    app.expand?.();
  } catch {
    // SDK 版本差异或非 Telegram 环境：握手失败不影响登录流程。
  }
  return typeof app.initData === 'string' ? app.initData : '';
}
