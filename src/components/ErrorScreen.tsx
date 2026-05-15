import { useMemo } from "react";
import { useRouter } from "@tanstack/react-router";
import { AlertTriangle, RefreshCw, Home, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

function makeReferenceId(seed?: string): string {
  // Short, copyable, time-anchored reference for support.
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  const tag = seed ? seed.slice(0, 4).toLowerCase().replace(/[^a-z0-9]/g, "") : "err";
  return `${tag}-${ts}-${rand}`.toUpperCase();
}

export interface ErrorScreenProps {
  title?: string;
  description?: string;
  error?: Error | null;
  reset?: () => void;
  showHome?: boolean;
  referenceId?: string;
}

export function ErrorScreen({
  title = "Something went wrong",
  description = "An unexpected error occurred. You can try again, refresh the page, or head back home.",
  error,
  reset,
  showHome = true,
  referenceId,
}: ErrorScreenProps) {
  const router = useRouter();
  const refId = useMemo(() => referenceId ?? makeReferenceId(error?.name), [referenceId, error]);

  const onRetry = () => {
    try {
      router.invalidate();
    } catch {
      /* noop */
    }
    reset?.();
  };

  const onRefresh = () => {
    if (typeof window !== "undefined") window.location.reload();
  };

  const onHome = () => {
    if (typeof window !== "undefined") window.location.assign("/");
  };

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(refId);
      toast.success("Reference ID copied");
    } catch {
      toast.error("Could not copy reference ID");
    }
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-background px-4 py-12">
      <div className="bg-mesh absolute inset-0 -z-10 opacity-60" aria-hidden />
      <div className="bg-grid absolute inset-0 -z-10 opacity-30" aria-hidden />
      <div className="w-full max-w-md rounded-2xl border bg-card/80 backdrop-blur p-8 shadow-[var(--shadow-elegant)]">
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-destructive/15 to-destructive/5 ring-1 ring-destructive/20">
          <AlertTriangle className="h-6 w-6 text-destructive" />
        </div>
        <h1 className="text-center text-2xl font-display tracking-tight text-foreground">
          {title}
        </h1>
        <p className="mt-2 text-center text-sm text-muted-foreground">{description}</p>

        {error?.message ? (
          <pre className="mt-4 max-h-32 overflow-auto rounded-md border bg-muted/50 p-3 text-xs text-muted-foreground whitespace-pre-wrap break-words">
            {error.message}
          </pre>
        ) : null}

        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button onClick={onRetry} className="gap-2">
            <RefreshCw className="h-4 w-4" /> Try again
          </Button>
          <Button onClick={onRefresh} variant="secondary" className="gap-2">
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
          {showHome ? (
            <Button onClick={onHome} variant="outline" className="gap-2">
              <Home className="h-4 w-4" /> Go home
            </Button>
          ) : null}
        </div>

        <div className="mt-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <span>Reference ID:</span>
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
            {refId}
          </code>
          <button
            type="button"
            onClick={onCopy}
            className="inline-flex items-center gap-1 rounded p-1 text-muted-foreground hover:text-foreground"
            aria-label="Copy reference ID"
          >
            <Copy className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}