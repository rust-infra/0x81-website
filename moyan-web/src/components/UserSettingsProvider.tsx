import { useEffect, type ReactNode } from "react";
import { toast } from "sonner";
import {
  getSettingsSyncEventName,
  subscribeToSettingsSync,
  type SettingsSyncState,
} from "@/services/userSettingsService";
import { t } from "@/i18n/translations";

export function UserSettingsProvider({
  children,
}: {
  children: ReactNode;
}) {
  useEffect(() => {
    const unsubscribe = subscribeToSettingsSync();

    const handleSyncState = (event: Event) => {
      const detail = (event as CustomEvent<SettingsSyncState>).detail;
      const id = "settings-sync";

      if (detail.status === "loading") {
        toast.loading(t("settings.sync.status.loading"), { id });
        return;
      }

      if (detail.status === "saving") {
        toast.loading(t("settings.sync.status.saving"), { id });
        return;
      }

      if (detail.status === "success") {
        toast.success(
          detail.phase === "fetch"
            ? t("settings.sync.status.loaded")
            : t("settings.sync.status.saved"),
          { id }
        );
        return;
      }

      if (detail.status === "error") {
        toast.error(t("settings.sync.status.error"), { id });
      }
    };

    window.addEventListener(getSettingsSyncEventName(), handleSyncState);

    return () => {
      unsubscribe();
      window.removeEventListener(getSettingsSyncEventName(), handleSyncState);
    };
  }, []);

  return <>{children}</>;
}
