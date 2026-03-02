export interface Route {
  name: string;
  token: string;
  upstream: string;
  hooksToken: string;
}

export function timingSafeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.byteLength !== bufB.byteLength) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

const ROUTE_TOKEN_PATTERN = /^ROUTE_([A-Z0-9]+)_TOKEN$/;

function parseMultiRoutes(): Route[] {
  const routes: Route[] = [];

  for (const [key, value] of Object.entries(process.env)) {
    const match = key.match(ROUTE_TOKEN_PATTERN);
    if (match && value) {
      const prefix = match[1];
      const name = prefix.toLowerCase();
      const upstream = process.env[`ROUTE_${prefix}_UPSTREAM`] || "";
      const hooksToken = process.env[`ROUTE_${prefix}_HOOKS_TOKEN`] || "";

      if (!upstream) {
        console.error(
          `FATAL: ROUTE_${prefix}_UPSTREAM is required when ROUTE_${prefix}_TOKEN is set.`
        );
        process.exit(1);
      }

      routes.push({ name, token: value, upstream, hooksToken });
    }
  }

  return routes;
}

function parseLegacyRoute(): Route | null {
  const token = process.env.CARAPACE_TOKEN || "";
  if (!token) return null;

  return {
    name: "default",
    token,
    upstream: process.env.OPENCLAW_UPSTREAM || "http://127.0.0.1:18789",
    hooksToken: process.env.OPENCLAW_HOOKS_TOKEN || "",
  };
}

function loadRoutes(): Route[] {
  const multi = parseMultiRoutes();
  if (multi.length > 0) return multi;

  const legacy = parseLegacyRoute();
  if (legacy) return [legacy];

  return [];
}

export const routes: Route[] = loadRoutes();

/** Find a route by bearer token using constant-time comparison. */
export function findRouteByToken(bearerToken: string): Route | null {
  for (const route of routes) {
    if (timingSafeCompare(bearerToken, route.token)) {
      return route;
    }
  }
  return null;
}
