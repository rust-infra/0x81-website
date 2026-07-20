import { useState, useRef, useEffect } from "react";
import { LogOut, Cloud, CloudDownload, User } from "lucide-react";
import { getCurrentUser, logout, onAuthChange, type User as AuthUser } from "@/services/authService";
import { t } from "@/i18n/translations";

export function UserMenu() {
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setUser(getCurrentUser());
    const unsub = onAuthChange((u) => setUser(u));
    return unsub;
  }, []);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  if (!user) return null;

  const handleLogout = () => {
    logout();
    setOpen(false);
    window.location.href = "/";
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="w-9 h-9 rounded-full overflow-hidden border-2 border-white/80 shadow-md"
      >
        {user.avatar ? (
          <img src={user.avatar} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-ink-200 to-ink-300 flex items-center justify-center text-[var(--paper)]">
            <User size={16} />
          </div>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 mt-2 w-56 rounded-2xl shadow-xl py-2 z-50"
          style={{ backgroundColor: "var(--card)", border: "1px solid var(--divider)" }}
        >
          <div className="px-4 py-3 border-b" style={{ borderColor: "var(--divider)" }}>
            <p className="text-sm font-medium truncate" style={{ color: "var(--ink)" }}>
              {user.name}
            </p>
            <p className="text-xs truncate" style={{ color: "var(--ink-light)" }}>
              {user.email}
            </p>
          </div>

          <button
            onClick={() => {
              window.dispatchEvent(new CustomEvent("moyan:sync-upload"));
              setOpen(false);
            }}
            className="w-full text-left flex items-center gap-2.5 px-4 py-2.5 text-sm transition hover:opacity-80"
            style={{ color: "var(--ink)" }}
          >
            <Cloud size={16} style={{ color: "var(--ink-light)" }} />
            {t("settings.sync.upload")}
          </button>

          <button
            onClick={() => {
              window.dispatchEvent(new CustomEvent("moyan:sync-download"));
              setOpen(false);
            }}
            className="w-full text-left flex items-center gap-2.5 px-4 py-2.5 text-sm transition hover:opacity-80"
            style={{ color: "var(--ink)" }}
          >
            <CloudDownload size={16} style={{ color: "var(--ink-light)" }} />
            {t("settings.sync.download")}
          </button>

          <div className="border-t mx-2 my-1" style={{ borderColor: "var(--divider)" }} />

          <button
            onClick={handleLogout}
            className="w-full text-left flex items-center gap-2.5 px-4 py-2.5 text-sm transition hover:opacity-80"
            style={{ color: "var(--accent)" }}
          >
            <LogOut size={16} />
            {t("settings.account.logout")}
          </button>
        </div>
      )}
    </div>
  );
}
