import type { Route } from "./routes";

const PROXY_TIMEOUT_MS = parseInt(process.env.PROXY_TIMEOUT_MS || "30000", 10);

export interface ProxyResult {
  status: number;
  body: string;
  headers: Record<string, string>;
}

export async function forwardRequest(
  path: string,
  body: Record<string, unknown>,
  clientIp: string,
  route: Route
): Promise<ProxyResult> {
  const url = `${route.upstream}${path}`;
  const payload = JSON.stringify(body);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Forwarded-For": clientIp,
  };

  if (route.hooksToken) {
    headers["Authorization"] = `Bearer ${route.hooksToken}`;
    headers["x-openclaw-token"] = route.hooksToken;
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
