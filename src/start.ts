import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

function newRequestId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  const requestId = newRequestId();
  // Server-only: lazily load the structured logger inside the handler so the
  // client bundle never includes node:async_hooks.
  const { runWithLogContext, log } = await import("@/lib/logger.server");
  return runWithLogContext({ request_id: requestId, source: "server" }, async () => {
    try {
      return await next();
    } catch (error) {
      if (error != null && typeof error === "object" && "statusCode" in error) {
        throw error;
      }
      log.error("server.unhandled", error, { request_id: requestId });
      return new Response(renderErrorPage(), {
        status: 500,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "x-request-id": requestId,
        },
      });
    }
  });
});

export const startInstance = createStart(() => ({
  requestMiddleware: [errorMiddleware],
  functionMiddleware: [attachSupabaseAuth],
}));
