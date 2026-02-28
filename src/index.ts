import { authenticate } from "./auth";
import { checkRateLimit, recordAuthFailure, resetAuthFailures } from "./rate-limit";
import { validateBody } from "./validate";
import { forwardRequest } from "./proxy";
import { logger } from "./logger";

const PORT = parseInt(process.env.PORT || "3000", 10);
const HOOKS_PATTERN = /^\/hooks\/[\w-]+$/;

function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const server = Bun.serve({
  port: PORT,
  async fetch(request: Request): Promise<Response> {
    const start = performance.now();
    const url = new URL(request.url);
    const path = url.pathname;
    const clientIp = getClientIp(request);

    // Health check
    if (request.method === "GET" && path === "/health") {
      return json(200, { status: "ok" });
    }

    // Only POST /hooks/* allowed
    if (request.method !== "POST" || !HOOKS_PATTERN.test(path)) {
      const latencyMs = Math.round(performance.now() - start);
      logger.request({ method: request.method, path, clientIp, status: 404, latencyMs });
      return json(404, { error: "not_found" });
    }

    // 1. Rate limit
    const rateResult = checkRateLimit(clientIp);
    if (!rateResult.ok) {
      const latencyMs = Math.round(performance.now() - start);
      logger.request({ method: "POST", path, clientIp, status: rateResult.status!, latencyMs });
      return new Response(JSON.stringify({ error: rateResult.reason }), {
        status: rateResult.status!,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(rateResult.retryAfterSec || 60),
        },
      });
    }

    // Read body once for auth (HMAC) and validation
    const bodyBuffer = await request.arrayBuffer();

    // 2. Authenticate
    const authResult = authenticate(request, bodyBuffer);
    if (!authResult.ok) {
      recordAuthFailure(clientIp);
      logger.authFailure(clientIp, authResult.reason!);
      const latencyMs = Math.round(performance.now() - start);
      logger.request({ method: "POST", path, clientIp, status: authResult.status!, latencyMs });
      return json(authResult.status!, { error: authResult.reason });
    }
    resetAuthFailures(clientIp);

    // 3. Validate
    const validation = validateBody(bodyBuffer, path);
    if (!validation.ok) {
      const latencyMs = Math.round(performance.now() - start);
      logger.request({ method: "POST", path, clientIp, status: validation.status!, latencyMs });
      return json(validation.status!, { error: validation.reason });
    }

    // 4. Proxy
    const proxyResult = await forwardRequest(path, validation.body!, clientIp);
    const latencyMs = Math.round(performance.now() - start);
    logger.request({ method: "POST", path, clientIp, status: proxyResult.status, latencyMs });

    return new Response(proxyResult.body, {
      status: proxyResult.status,
      headers: proxyResult.headers,
    });
  },
});

logger.info("carapace started", { port: PORT });

// Graceful shutdown
function shutdown(): void {
  logger.info("shutting down");
  server.stop();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
