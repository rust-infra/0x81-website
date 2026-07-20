import { useEffect } from "react";
import { Toaster, toast } from "sonner";
import { syncUpload, syncDownload, getSyncMode } from "@/services/syncService";
import { t } from "@/i18n/translations";

export function SyncProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const handleUpload = async () => {
      const mode = getSyncMode();
      toast.loading(
        mode === "backend" ? t("sync.upload.backend") : t("sync.upload.local"),
        { id: "sync-upload" }
      );

      const result = await syncUpload();

      if (result.success) {
        toast.success(result.message, {
          id: "sync-upload",
          description: result.details
            ? `${result.details.cardsCount} ${t("sync.cards")} · ${result.details.decksCount} ${t("sync.decks")} · ${result.details.logsCount} ${t("sync.logs")}`
            : undefined,
        });
      } else {
        toast.error(result.message, { id: "sync-upload" });
      }
    };

    const handleDownload = async () => {
      const mode = getSyncMode();
      toast.loading(
        mode === "backend" ? t("sync.download.backend") : t("sync.download.local"),
        { id: "sync-download" }
      );

      const result = await syncDownload();

      if (result.success) {
        toast.success(result.message, {
          id: "sync-download",
          description: result.details
            ? `${result.details.cardsCount} ${t("sync.cards")} · ${result.details.decksCount} ${t("sync.decks")} · ${result.details.logsCount} ${t("sync.logs")}`
            : undefined,
        });
      } else {
        toast.error(result.message, { id: "sync-download" });
      }
    };

    window.addEventListener("moyan:sync-upload", handleUpload as EventListener);
    window.addEventListener(
      "moyan:sync-download",
      handleDownload as EventListener
    );

    return () => {
      window.removeEventListener(
        "moyan:sync-upload",
        handleUpload as EventListener
      );
      window.removeEventListener(
        "moyan:sync-download",
        handleDownload as EventListener
      );
    };
  }, []);

  return (
    <>
      {children}
      <Toaster
        position="top-center"
        toastOptions={{
          style: {
            background: "var(--card)",
            color: "var(--ink)",
            border: "1px solid var(--border)",
          },
        }}
      />
    </>
  );
}
