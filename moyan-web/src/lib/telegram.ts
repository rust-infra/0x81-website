// Telegram Mini App 桥接（仅 Telegram 内生效，普通浏览器无副作用）。
// 依赖 index.html 中的 <script src="https://telegram.org/js/telegram-web-app.js"></script>，
// 加载后可用 window.Telegram.WebApp。

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        ready: () => void;
        expand: () => void;
        colorScheme: 'light' | 'dark';
        initData: string;
        setHeaderColor?: (color: string) => void;
        setBackgroundColor?: (color: string) => void;
      };
    };
  }
}

/** 在 Telegram Mini App 中初始化：全屏展开 + 预留登录凭据 */
export function initTelegramWebApp(): void {
  if (typeof window === 'undefined') return;
  const tg = window.Telegram?.WebApp;
  if (!tg) return; // 非 Telegram 环境，直接跳过

  try {
    tg.ready();
    tg.expand();
    tg.setHeaderColor?.('#F5F0E8');
    tg.setBackgroundColor?.('#F5F0E8');
    if (tg.initData) {
      // 供后续接入 Telegram 登录：后端可用 bot token 校验 initData（HMAC-SHA256）
      sessionStorage.setItem('tg_init_data', tg.initData);
    }
  } catch (err) {
    console.warn('Telegram WebApp init failed', err);
  }
}
