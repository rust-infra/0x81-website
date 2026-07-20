import { useEffect, useState } from "react";
import { BookOpen } from "lucide-react";
import { GoogleLoginButton } from "@/components/GoogleLoginButton";
import { KimiLoginButton } from "@/components/KimiLoginButton";
import {
  getCurrentUser,
  onAuthChange,
} from "@/services/authService";
import { t } from "@/i18n/translations";

export default function Login() {
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (getCurrentUser()) {
      window.location.replace("/");
      return;
    }

    const unsub = onAuthChange((user) => {
      if (user) {
        window.location.replace("/");
      }
    });

    setChecking(false);
    return unsub;
  }, []);

  if (checking) {
    return (
      <div
        className="min-h-[100dvh] flex items-center justify-center"
        style={{ backgroundColor: "var(--paper)" }}
      >
        <div
          className="w-8 h-8 border-2 rounded-full animate-spin"
          style={{
            borderColor: "var(--ink-muted)",
            borderTopColor: "var(--accent)",
          }}
        />
      </div>
    );
  }

  return (
    <div
      className="min-h-[100dvh] flex flex-col relative"
      style={{ backgroundColor: "var(--paper)" }}
    >
      {/* Top bar with back link */}
      <div
        className="shrink-0 px-5 pt-5 pb-2 flex items-center"
        style={{ position: "relative", zIndex: 10 }}
      >
        <a
          href="/"
          className="inline-flex items-center gap-1.5 text-sm py-2 px-1 transition-colors"
          style={{ color: "var(--ink-light)" }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.color = "var(--ink)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.color = "var(--ink-light)")
          }
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M19 12H5" />
            <path d="M12 19l-7-7 7-7" />
          </svg>
          {t('back')}
        </a>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6">
        <div className="w-full max-w-sm">
          {/* Logo */}
          <div className="text-center mb-10">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5 shadow-lg"
              style={{
                backgroundColor: "var(--btn-bg)",
              }}
            >
              <BookOpen
                size={28}
                style={{ color: "var(--btn-text)" }}
              />
            </div>
            <h1
              className="font-serif-cn text-2xl font-bold mb-2"
              style={{ color: "var(--ink)" }}
            >
              {t('app.name')}
            </h1>
            <p
              className="text-sm"
              style={{ color: "var(--ink-light)" }}
            >
              {t('login.title')}
            </p>
          </div>

          {/* Login buttons */}
          <div className="space-y-3">
            <KimiLoginButton />
            <GoogleLoginButton />

            {/* Divider */}
            <div className="flex items-center gap-3 my-4">
              <div
                className="flex-1 h-px"
                style={{ backgroundColor: "var(--divider)" }}
              />
              <span
                className="text-xs"
                style={{ color: "var(--ink-muted)" }}
              >
                or
              </span>
              <div
                className="flex-1 h-px"
                style={{ backgroundColor: "var(--divider)" }}
              />
            </div>

            {/* Skip login */}
            <a
              href="/"
              className="block w-full text-center py-2.5 rounded-xl text-sm font-medium transition-all duration-300 hover:shadow-md"
              style={{
                backgroundColor: "var(--card)",
                color: "var(--ink-light)",
                border: "1px solid var(--border)",
              }}
            >
              {t('login.skip')}
            </a>
          </div>

          {/* Info */}
          <p
            className="text-xs text-center mt-8 leading-relaxed"
            style={{ color: "var(--ink-muted)" }}
          >
            {t('login.skip.desc')}
          </p>
        </div>
      </div>
    </div>
  );
}
