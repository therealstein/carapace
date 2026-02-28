const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || "30", 10);
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000", 10);
const AUTH_FAIL_LOCKOUT_THRESHOLD = 3;
const AUTH_FAIL_LOCKOUT_MS = 5 * 60 * 1000; // 5 minutes

interface WindowEntry {
  timestamps: number[];
}

interface LockoutEntry {
  failures: number;
  lockedUntil: number;
}

const windows = new Map<string, WindowEntry>();
const lockouts = new Map<string, LockoutEntry>();

// Cleanup stale entries every 60s
setInterval(() => {
  const now = Date.now();
  const windowCutoff = now - RATE_LIMIT_WINDOW_MS;

  for (const [ip, entry] of windows) {
    entry.timestamps = entry.timestamps.filter((t) => t > windowCutoff);
    if (entry.timestamps.length === 0) windows.delete(ip);
  }

  for (const [ip, entry] of lockouts) {
    if (entry.lockedUntil < now && entry.failures === 0) {
      lockouts.delete(ip);
    }
  }
}, 60_000).unref();

export interface RateLimitResult {
  ok: boolean;
  status?: number;
  retryAfterSec?: number;
  reason?: string;
}

export function checkRateLimit(clientIp: string): RateLimitResult {
  const now = Date.now();

  // Check lockout first
  const lockout = lockouts.get(clientIp);
  if (lockout && lockout.lockedUntil > now) {
    const retryAfterSec = Math.ceil((lockout.lockedUntil - now) / 1000);
    return { ok: false, status: 429, retryAfterSec, reason: "ip_locked_out" };
  }

  // Sliding window check
  let entry = windows.get(clientIp);
  if (!entry) {
    entry = { timestamps: [] };
    windows.set(clientIp, entry);
  }

  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  entry.timestamps = entry.timestamps.filter((t) => t > windowStart);

  if (entry.timestamps.length >= RATE_LIMIT_MAX) {
    const oldestInWindow = entry.timestamps[0];
    const retryAfterSec = Math.ceil((oldestInWindow + RATE_LIMIT_WINDOW_MS - now) / 1000);
    return { ok: false, status: 429, retryAfterSec, reason: "rate_limit_exceeded" };
  }

  entry.timestamps.push(now);
  return { ok: true };
}

export function recordAuthFailure(clientIp: string): void {
  const now = Date.now();
  let lockout = lockouts.get(clientIp);

  if (!lockout) {
    lockout = { failures: 0, lockedUntil: 0 };
    lockouts.set(clientIp, lockout);
  }

  // Reset if previous lockout expired
  if (lockout.lockedUntil > 0 && lockout.lockedUntil < now) {
    lockout.failures = 0;
    lockout.lockedUntil = 0;
  }

  lockout.failures++;

  if (lockout.failures >= AUTH_FAIL_LOCKOUT_THRESHOLD) {
    lockout.lockedUntil = now + AUTH_FAIL_LOCKOUT_MS;
    lockout.failures = 0;
  }
}

export function resetAuthFailures(clientIp: string): void {
  const lockout = lockouts.get(clientIp);
  if (lockout) {
    lockout.failures = 0;
  }
}
