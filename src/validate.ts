export const MAX_BODY_SIZE = parseInt(process.env.MAX_BODY_SIZE || "65536", 10);

export interface ReadBodyResult {
  ok: boolean;
  status?: number;
  reason?: string;
  buffer?: ArrayBuffer;
}

/** Read request body with early size enforcement to prevent memory DoS. */
export async function readBody(request: Request): Promise<ReadBodyResult> {
  // Fast reject via Content-Length header (before any allocation)
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_BODY_SIZE) {
    return { ok: false, status: 413, reason: "body_too_large" };
  }

  // Stream-read with cap (Content-Length can be spoofed or absent)
  const stream = request.body;
  if (!stream) {
    return { ok: true, buffer: new ArrayBuffer(0) };
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const reader = stream.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_BODY_SIZE) {
        reader.cancel();
        return { ok: false, status: 413, reason: "body_too_large" };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  // Concatenate chunks
  const buffer = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { ok: true, buffer: buffer.buffer };
}

export interface ValidationResult {
  ok: boolean;
  status?: number;
  reason?: string;
  body?: Record<string, unknown>;
}

const WAKE_MODES = new Set(["now", "next-heartbeat"]);

function validateWakePayload(body: Record<string, unknown>): ValidationResult {
  if (typeof body.text !== "string") {
    return { ok: false, status: 400, reason: "missing_or_invalid_field: text" };
  }
  if (body.text.length > 2000) {
    return { ok: false, status: 400, reason: "text_too_long" };
  }
  if (body.mode !== undefined) {
    if (typeof body.mode !== "string" || !WAKE_MODES.has(body.mode)) {
      return { ok: false, status: 400, reason: "invalid_mode" };
    }
  }

  const allowed: Record<string, unknown> = { text: body.text };
  if (body.mode !== undefined) allowed.mode = body.mode;
  return { ok: true, body: allowed };
}

function validateAgentPayload(body: Record<string, unknown>): ValidationResult {
  if (typeof body.message !== "string") {
    return { ok: false, status: 400, reason: "missing_or_invalid_field: message" };
  }
  if (body.message.length > 10000) {
    return { ok: false, status: 400, reason: "message_too_long" };
  }

  // Allowlist top-level fields
  const allowedKeys = ["message", "mode", "type", "metadata"];
  const cleaned: Record<string, unknown> = {};
  for (const key of allowedKeys) {
    if (body[key] !== undefined) {
      cleaned[key] = body[key];
    }
  }

  return { ok: true, body: cleaned };
}

function validateMappedPayload(body: Record<string, unknown>): ValidationResult {
  // Mapped hooks: pass through with size limit only (OpenClaw handles validation)
  return { ok: true, body };
}

export function validateBody(
  rawBody: ArrayBuffer,
  path: string
): ValidationResult {
  let parsed: unknown;
  try {
    const text = new TextDecoder().decode(rawBody);
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, status: 400, reason: "invalid_json" };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, status: 400, reason: "body_must_be_object" };
  }

  const body = parsed as Record<string, unknown>;

  if (path === "/hooks/wake") {
    return validateWakePayload(body);
  }
  if (path === "/hooks/agent") {
    return validateAgentPayload(body);
  }
  // /hooks/:name — mapped hooks
  return validateMappedPayload(body);
}
