import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { log, runWithLogContext, newRequestId } from "@/lib/logger.server";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  const requestId = newRequestId();
  return runWithLogContext({ request_id: requestId, source: "server" }, async () => {
    try {
      const result = await next();
      // Best-effort: tag the response with the request id for client correlation.
      if (result && typeof result === "object" && "response" in result) {
        const r = (result as { response?: Response }).response;
        if (r && r.headers && typeof r.headers.set === "function") {
          r.headers.set("x-request-id", requestId);
        }
      }
      return result;
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
