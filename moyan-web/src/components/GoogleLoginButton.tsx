import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Chrome } from "lucide-react";
import { loginWithGoogle } from "@/services/authService";
import { t } from "@/i18n/translations";

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";

export function GoogleLoginButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check if Google Client ID is configured
  const isConfigured = GOOGLE_CLIENT_ID.length > 0 && GOOGLE_CLIENT_ID.includes(".apps.googleusercontent.com");

  const handleLogin = async () => {
    if (!isConfigured) return;
    setLoading(true);
    setError(null);
    try {
      await loginWithGoogle();
      window.location.reload();
    } catch (err) {
      const message = err instanceof Error ? err.message : "登录失败";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  // Not configured: hide completely
  if (!isConfigured) {
    return null;
  }

  return (
    <div className="space-y-2 w-full">
      <Button
        className="w-full border shadow-md hover:shadow-lg transition-all duration-300"
        size="lg"
        variant="outline"
        onClick={handleLogin}
        disabled={loading}
        style={{ background: "white", color: "#333" }}
      >
        {loading ? (
          <div className="w-5 h-5 mr-2 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
        ) : (
          <Chrome className="w-5 h-5 mr-2" />
        )}
        {loading ? t("loading") : t("login.google")}
      </Button>
      {error && (
        <p className="text-xs text-center" style={{ color: "#b91c1c" }}>
          {error}
        </p>
      )}
    </div>
  );
}
