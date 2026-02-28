const OPENCLAW_UPSTREAM = process.env.OPENCLAW_UPSTREAM || "http://127.0.0.1:18789";
const OPENCLAW_HOOKS_TOKEN = process.env.OPENCLAW_HOOKS_TOKEN || "";
const PROXY_TIMEOUT_MS = parseInt(process.env.PROXY_TIMEOUT_MS || "30000", 10);

export interface ProxyResult {
  status: number;
  body: string;
  headers: Record<string, string>;
}

export async function forwardRequest(
  path: string,
  body: Record<string, unknown>,
  clientIp: string
): Promise<ProxyResult> {
  const url = `${OPENCLAW_UPSTREAM}${path}`;
  const payload = JSON.stringify(body);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Forwarded-For": clientIp,
  };

  if (OPENCLAW_HOOKS_TOKEN) {
    headers["Authorization"] = `Bearer ${OPENCLAW_HOOKS_TOKEN}`;
    headers["x-openclaw-token"] = OPENCLAW_HOOKS_TOKEN;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: payload,
      signal: controller.signal,
    });

    const responseBody = await response.text();
    return {
      status: response.status,
      body: responseBody,
      headers: {
        "Content-Type": response.headers.get("content-type") || "application/json",
      },
    };
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return { status: 504, body: '{"error":"upstream_timeout"}', headers: { "Content-Type": "application/json" } };
    }
    return { status: 502, body: '{"error":"upstream_unreachable"}', headers: { "Content-Type": "application/json" } };
  } finally {
    clearTimeout(timeout);
  }
}
