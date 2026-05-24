// Client-side error reporter. Batches window.onerror + unhandledrejection +
// manual reports, ships them to /api/public/errors. No external SDK.
import { supabase } from "@/integrations/supabase/client";

type ErrorEvent = {
  request_id?: string;
  organization_id?: string | null;
  user_id?: string | null;
  route?: string;
  level?: "error" | "warn" | "fatal";
  message: string;
  error_stack?: string;
  context?: Record<string, unknown>;
};

const ENDPOINT = "/api/public/errors";
const FLUSH_INTERVAL_MS = 5_000;
const MAX_BATCH = 20;
const queue: ErrorEvent[] = [];
let installed = false;
let timer: ReturnType<typeof setInterval> | null = null;
let cachedUserId: string | null = null;

function genRequestId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

function serializeError(err: unknown): { message: string; stack?: string } {
  if (err instanceof Error) return { message: err.message, stack: err.stack };
  if (typeof err === "string") return { message: err };
  try {
    return { message: JSON.stringify(err).slice(0, 2000) };
  } catch {
    return { message: String(err).slice(0, 2000) };
  }
}

export function reportClientError(
  err: unknown,
  extra: Partial<ErrorEvent> = {},
): void {
  const { message, stack } = serializeError(err);
  const evt: ErrorEvent = {
    request_id: extra.request_id ?? genRequestId(),
    user_id: cachedUserId,
    route: typeof location !== "undefined" ? location.pathname + location.search : undefined,
    level: extra.level ?? "error",
    message: (extra.message ?? message).slice(0, 2000),
    error_stack: (extra.error_stack ?? stack)?.slice(0, 8000),
    context: extra.context,
    organization_id: extra.organization_id ?? null,
  };
  queue.push(evt);
  if (queue.length >= MAX_BATCH) flush();
}

async function flush() {
  if (queue.length === 0) return;
  const batch = queue.splice(0, MAX_BATCH);
  try {
    const body = JSON.stringify({ events: batch });
    // Use sendBeacon on unload paths if available, else fetch keepalive.
    if (typeof navigator !== "undefined" && "sendBeacon" in navigator) {
      const blob = new Blob([body], { type: "application/json" });
      const ok = navigator.sendBeacon(ENDPOINT, blob);
      if (ok) return;
    }
    await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    });
  } catch {
    // re-queue best-effort; drop if still too large
    if (queue.length + batch.length <= 100) queue.unshift(...batch);
  }
}

export function installClientErrorReporter(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  // Hydrate user id from current session, refresh on auth state change.
  supabase.auth.getUser().then(({ data }) => {
    cachedUserId = data.user?.id ?? null;
  });
  supabase.auth.onAuthStateChange((_evt, session) => {
    cachedUserId = session?.user?.id ?? null;
  });

  window.addEventListener("error", (e: globalThis.ErrorEvent) => {
    reportClientError(e.error ?? e.message, { level: "error" });
  });
  window.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
    reportClientError(e.reason, { level: "error", context: { kind: "unhandledrejection" } });
  });

  timer = setInterval(flush, FLUSH_INTERVAL_MS);
  window.addEventListener("pagehide", flush);
  window.addEventListener("beforeunload", flush);
}

export function teardownClientErrorReporter(): void {
  if (timer) clearInterval(timer);
  timer = null;
  installed = false;
}