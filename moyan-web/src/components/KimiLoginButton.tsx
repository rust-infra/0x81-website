import { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { loginWithKimi } from "@/services/authService";
import { Loader2, ExternalLink, CheckCircle2, XCircle, Sparkles } from "lucide-react";
import { t } from "@/i18n/translations";

type AuthStep = "idle" | "requesting" | "waiting" | "polling" | "success" | "error";

export function KimiLoginButton() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<AuthStep>("idle");
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef(false);

  const reset = useCallback(() => {
    abortRef.current = true;
    setStep("idle");
    setAttempt(0);
    setError(null);
    setOpen(false);
  }, []);

  const handleLogin = async () => {
    setStep("requesting");
    setError(null);
    abortRef.current = false;
    setOpen(true);

    try {
      await loginWithKimi(
        () => {
          if (!abortRef.current) setStep("waiting");
        },
        (n) => {
          if (!abortRef.current) {
            setStep("polling");
            setAttempt(n);
          }
        }
      );

      if (!abortRef.current) {
        setStep("success");
        setTimeout(() => {
          window.location.reload();
        }, 1200);
      }
    } catch (err: any) {
      if (!abortRef.current) {
        setStep("error");
        setError(err?.message || t("error"));
      }
    }
  };

  const getDialogContent = () => {
    switch (step) {
      case "requesting":
        return (
          <div className="flex flex-col items-center gap-4 py-6">
            <Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--accent)" }} />
            <p className="text-sm" style={{ color: "var(--ink-light)" }}>
              {t("loading")}
            </p>
          </div>
        );

      case "waiting":
      case "polling":
        return (
          <div className="flex flex-col items-center gap-4 py-4">
            <Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--accent)" }} />
            <div className="text-center space-y-2">
              <p className="text-sm font-medium" style={{ color: "var(--ink)" }}>
                {t("login.title")}
              </p>
              <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
                {t("loading")}
              </p>
              <p className="text-xs mt-2" style={{ color: "var(--ink-muted)" }}>
                {attempt}s...
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                window.open("https://auth.kimi.com/device", "_blank", "noopener,noreferrer")
              }
              className="mt-2 text-xs"
            >
              <ExternalLink className="w-3 h-3 mr-1" />
              Kimi
            </Button>
          </div>
        );

      case "success":
        return (
          <div className="flex flex-col items-center gap-4 py-6">
            <CheckCircle2 className="w-10 h-10" style={{ color: "#16a34a" }} />
            <p className="text-sm font-medium" style={{ color: "var(--ink)" }}>
              OK!
            </p>
          </div>
        );

      case "error":
        return (
          <div className="flex flex-col items-center gap-4 py-6">
            <XCircle className="w-10 h-10" style={{ color: "var(--accent)" }} />
            <p className="text-sm text-center" style={{ color: "var(--accent)" }}>
              {error}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setStep("idle");
                setError(null);
                setOpen(false);
              }}
            >
              {t("close")}
            </Button>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <>
      <Button
        className="w-full border shadow-md hover:shadow-lg transition-all duration-300"
        size="lg"
        variant="outline"
        onClick={handleLogin}
        disabled={step === "requesting" || step === "waiting" || step === "polling"}
        style={{
          background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
          color: "#fff",
          borderColor: "#2d3561",
        }}
      >
        {step === "requesting" || step === "waiting" || step === "polling" ? (
          <Loader2 className="w-5 h-5 mr-2 animate-spin" />
        ) : (
          <Sparkles className="w-5 h-5 mr-2" />
        )}
        {step === "requesting"
          ? t("loading")
          : step === "waiting" || step === "polling"
          ? t("loading")
          : "Kimi Login"}
      </Button>

      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!v) reset();
        }}
      >
        <DialogContent
          className="sm:max-w-sm"
          style={{ background: "var(--card)", borderColor: "var(--border)" }}
        >
          <DialogHeader>
            <DialogTitle
              className="font-serif-cn text-lg"
              style={{ color: "var(--ink)" }}
            >
              Kimi
            </DialogTitle>
            <DialogDescription style={{ color: "var(--ink-muted)" }}>
              {step === "waiting" || step === "polling"
                ? t("login.title")
                : step === "success"
                ? "OK"
                : step === "error"
                ? t("error")
                : t("loading")}
            </DialogDescription>
          </DialogHeader>
          {getDialogContent()}
        </DialogContent>
      </Dialog>
    </>
  );
}
