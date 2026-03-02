import { logger } from "./logger";
import { Route, findRouteByToken, routes, timingSafeCompare } from "./routes";

const CARAPACE_HMAC_SECRET = process.env.CARAPACE_HMAC_SECRET || "";

type AuthMode = "token" | "hmac" | "both" | "none";

function getAuthMode(): AuthMode {
  const hasToken = routes.length > 0;
  const hasHmac = CARAPACE_HMAC_SECRET.length > 0;
  if (hasToken && hasHmac) return "both";
  if (hasToken) return "token";
  if (hasHmac) return "hmac";
  return "none";
}

function verifyHmac(body: ArrayBuffer, signature: string): boolean {
  const hasher = new Bun.CryptoHasher("sha256", CARAPACE_HMAC_SECRET);
  hasher.update(new Uint8Array(body));
  const expected = hasher.digest("hex");
  return timingSafeCompare(expected, signature);
}

export interface AuthResult {
  ok: boolean;
  status?: number;
  reason?: string;
  route?: Route;
}

/** Call at startup to fail fast if auth is misconfigured. */
export function assertAuthConfigured(): void {
  if (getAuthMode() === "none") {
    console.error(
      "FATAL: No auth configured. Set CARAPACE_TOKEN (or ROUTE_*_TOKEN) and/or CARAPACE_HMAC_SECRET."
    );
    process.exit(1);
  }
}

export function authenticate(
  request: Request,
  bodyBuffer: ArrayBuffer
): AuthResult {
  const url = new URL(request.url);

  // Reject token in query string
  if (url.searchParams.has("token")) {
    return { ok: false, status: 400, reason: "token_in_query" };
  }

  const mode = getAuthMode();

  if (mode === "none") {
    return { ok: false, status: 500, reason: "no_auth_configured" };
  }

  const authHeader = request.headers.get("authorization") || "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const hmacHeader = request.headers.get("x-openclaw-hmac-sha256") || "";

  let matchedRoute: Route | undefined;

  if (mode === "token" || mode === "both") {
    if (!bearerToken) {
      return { ok: false, status: 401, reason: "missing_bearer_token" };
    }
    const route = findRouteByToken(bearerToken);
    if (!route) {
      return { ok: false, status: 401, reason: "invalid_bearer_token" };
    }
    matchedRoute = route;
  }

  if (mode === "hmac" || mode === "both") {
    if (!hmacHeader) {
      return { ok: false, status: 401, reason: "missing_hmac_signature" };
    }
    if (!verifyHmac(bodyBuffer, hmacHeader)) {
      return { ok: false, status: 401, reason: "invalid_hmac_signature" };
    }
  }

  // HMAC-only mode: no route matched via token, use first route
  if (!matchedRoute && routes.length > 0) {
    matchedRoute = routes[0];
  }

  return { ok: true, route: matchedRoute };
}
