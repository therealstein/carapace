import { CryptoHasher } from "bun";
import { logger } from "./logger";

const CARAPACE_TOKEN = process.env.CARAPACE_TOKEN || "";
const CARAPACE_HMAC_SECRET = process.env.CARAPACE_HMAC_SECRET || "";

type AuthMode = "token" | "hmac" | "both" | "none";

function getAuthMode(): AuthMode {
  const hasToken = CARAPACE_TOKEN.length > 0;
  const hasHmac = CARAPACE_HMAC_SECRET.length > 0;
  if (hasToken && hasHmac) return "both";
  if (hasToken) return "token";
  if (hasHmac) return "hmac";
  return "none";
}

function timingSafeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.byteLength !== bufB.byteLength) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function verifyHmac(body: ArrayBuffer, signature: string): boolean {
  const hasher = new CryptoHasher("sha256", CARAPACE_HMAC_SECRET);
  hasher.update(new Uint8Array(body));
  const expected = hasher.digest("hex");
  return timingSafeCompare(expected, signature);
}

export interface AuthResult {
  ok: boolean;
  status?: number;
  reason?: string;
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
    logger.warn("no auth configured — all requests allowed");
    return { ok: true };
  }

  const authHeader = request.headers.get("authorization") || "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const hmacHeader = request.headers.get("x-openclaw-hmac-sha256") || "";

  if (mode === "token" || mode === "both") {
    if (!bearerToken) {
      return { ok: false, status: 401, reason: "missing_bearer_token" };
    }
    if (!timingSafeCompare(bearerToken, CARAPACE_TOKEN)) {
      return { ok: false, status: 401, reason: "invalid_bearer_token" };
    }
  }

  if (mode === "hmac" || mode === "both") {
    if (!hmacHeader) {
      return { ok: false, status: 401, reason: "missing_hmac_signature" };
    }
    const valid = verifyHmac(bodyBuffer, hmacHeader);
    if (!valid) {
      return { ok: false, status: 401, reason: "invalid_hmac_signature" };
    }
  }

  return { ok: true };
}
