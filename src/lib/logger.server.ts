// Structured logger for server fns, routes, and workers.
// - AsyncLocalStorage-based context (request_id, org_id, user_id, job_id)
// - Console output as single-line JSON for log aggregators
// - Optional DB sinks: error_events for errors/fatals, job_logs when in a job
import { AsyncLocalStorage } from "node:async_hooks";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

export type LogContext = {
  request_id?: string;
  organization_id?: string | null;
  user_id?: string | null;
  job_id?: string | null;
  job_type?: string | null;
  route?: string | null;
  source?: "server" | "client" | "worker" | "cron";
};

const storage = new AsyncLocalStorage<LogContext>();

export function runWithLogContext<T>(ctx: LogContext, fn: () => Promise<T> | T): Promise<T> | T {
  return storage.run(ctx, fn);
}

export function getLogContext(): LogContext {
  return storage.getStore() ?? {};
}

export function newRequestId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50,
};

const minLevel: LogLevel =
  (process.env.LOG_LEVEL as LogLevel | undefined) &&
  LEVEL_RANK[(process.env.LOG_LEVEL as LogLevel) ?? "info"]
    ? (process.env.LOG_LEVEL as LogLevel)
    : "info";

function serializeError(err: unknown): { message: string; stack?: string; name?: string } {
  if (err instanceof Error) return { message: err.message, stack: err.stack, name: err.name };
  if (typeof err === "string") return { message: err };
  try {
    return { message: JSON.stringify(err) };
  } catch {
    return { message: String(err) };
  }
}

function emit(level: LogLevel, message: string, fields: Record<string, unknown>) {
  if (LEVEL_RANK[level] < LEVEL_RANK[minLevel]) return;
  const ctx = getLogContext();
  const record = {
    ts: new Date().toISOString(),
    level,
    message,
    ...ctx,
    ...fields,
  };
  const line = JSON.stringify(record);
  if (level === "error" || level === "fatal") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (msg: string, fields: Record<string, unknown> = {}) => emit("debug", msg, fields),
  info: (msg: string, fields: Record<string, unknown> = {}) => emit("info", msg, fields),
  warn: (msg: string, fields: Record<string, unknown> = {}) => emit("warn", msg, fields),
  error: (msg: string, err?: unknown, fields: Record<string, unknown> = {}) =>
    emit("error", msg, { ...fields, error: err === undefined ? undefined : serializeError(err) }),
  fatal: (msg: string, err?: unknown, fields: Record<string, unknown> = {}) =>
    emit("fatal", msg, { ...fields, error: err === undefined ? undefined : serializeError(err) }),
};

// Persist a structured error to error_events. Best-effort; never throws.
export async function captureError(
  admin: SupabaseClient<Database> | null,
  err: unknown,
  extra: Partial<LogContext> & { message?: string; level?: "error" | "warn" | "fatal" } = {},
): Promise<void> {
  const ctx = { ...getLogContext(), ...extra };
  const { message, stack } = serializeError(err);
  log.error(extra.message ?? message, err, { route: ctx.route });
  if (!admin) return;
  try {
    await admin.from("error_events").insert({
      request_id: ctx.request_id ?? null,
      organization_id: ctx.organization_id ?? null,
      user_id: ctx.user_id ?? null,
      route: ctx.route ?? null,
      source: (ctx.source ?? "server") as never,
      level: extra.level ?? "error",
      message: extra.message ?? message,
      error_stack: stack ?? null,
      context: {
        job_id: ctx.job_id ?? null,
        job_type: ctx.job_type ?? null,
      } as never,
    });
  } catch {
    // swallow — never let logging crash the request
  }
}

// Timed span helper: logs start/end with duration.
export async function withSpan<T>(
  name: string,
  fn: () => Promise<T>,
  fields: Record<string, unknown> = {},
): Promise<T> {
  const t0 = Date.now();
  log.debug(`${name} start`, fields);
  try {
    const out = await fn();
    log.info(`${name} ok`, { ...fields, duration_ms: Date.now() - t0 });
    return out;
  } catch (e) {
    log.error(`${name} fail`, e, { ...fields, duration_ms: Date.now() - t0 });
    throw e;
  }
}