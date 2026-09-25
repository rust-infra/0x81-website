import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  getTelegramInitData,
  isTelegramWebApp,
  loginWithTelegram,
} from "@/services/authService";
import { Loader2, Send } from "lucide-react";
import { t } from "@/i18n/translations";

/**
 * Telegram Mini App 登录按钮。
 * 仅在 Telegram 内置浏览器（window.Telegram.WebApp 存在）内渲染；
 * 其他环境（普通浏览器/微信）不显示，避免误导。
 */
export function TelegramLoginButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isTelegramWebApp()) return null;

  const handleLogin = async () => {
    setLoading(true);
    setError(null);

    const initData = getTelegramInitData();
    if (!initData) {
      setLoading(false);
      setError("未检测到 Telegram 会话，请直接在 Telegram 内打开本应用");
      return;
    }

    try {
      await loginWithTelegram(initData);
      window.location.reload();
    } catch (err: any) {
      setError(err?.message || t("error"));
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      <Button
        className="w-full border shadow-md hover:shadow-lg transition-all duration-300"
        size="lg"
        variant="outline"
        onClick={handleLogin}
        disabled={loading}
        style={{
          background: "linear-gradient(135deg, #2AABEE 0%, #229ED9 100%)",
          color: "#fff",
          borderColor: "#1e8ec4",
        }}
      >
        {loading ? (
          <Loader2 className="w-5 h-5 mr-2 animate-spin" />
        ) : (
          <Send className="w-5 h-5 mr-2" />
        )}
        {loading ? t("loading") : "Telegram 登录"}
      </Button>
      {error && (
        <p className="text-xs text-center" style={{ color: "var(--accent)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
