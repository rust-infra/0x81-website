import { useNavigate } from "react-router";
import { Home, ArrowLeft } from "lucide-react";
import { t } from "../i18n/translations";

export default function NotFound() {
  const navigate = useNavigate();

  return (
    <div className="min-h-[100dvh] paper-texture flex flex-col items-center justify-center px-6">
      <div className="text-center">
        {/* Ink-style 404 */}
        <div className="mb-6 relative">
          <div
            className="font-serif-cn text-8xl font-bold opacity-10"
            style={{ color: "var(--ink)" }}
          >
            404
          </div>
          <div className="absolute inset-0 flex items-center justify-center">
            <span
              className="font-serif-cn text-lg"
              style={{ color: "var(--ink-light)" }}
            >
              {t('404.title')}
            </span>
          </div>
        </div>

        <p
          className="text-sm mb-8"
          style={{ color: "var(--ink-muted)" }}
        >
          {t('404.desc')}
        </p>

        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm transition-all duration-300 hover:shadow-md"
            style={{
              background: "var(--card)",
              color: "var(--ink)",
              border: "1px solid var(--border)",
            }}
          >
            <ArrowLeft size={16} />
            {t('back')}
          </button>
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-300 hover:shadow-md"
            style={{
              background: "var(--btn-bg)",
              color: "var(--btn-text)",
            }}
          >
            <Home size={16} />
            {t('404.home')}
          </button>
        </div>
      </div>
    </div>
  );
}
