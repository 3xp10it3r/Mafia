import type { PlayerSession } from "@/lib/game-store";
import { getPlayerSession } from "@/lib/game-store";

export const SESSION_COOKIE = "mafia_session";
export const MAX_BODY_BYTES = 16 * 1024;

const buckets = new Map<string, { count: number; resetAt: number }>();

export function clientAddress(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

export function allowRate(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 10_000) {
      for (const [bucketKey, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(bucketKey);
      }
    }
    return true;
  }
  if (current.count >= limit) return false;
  current.count += 1;
  return true;
}

export function parseSessionCookie(cookieHeader: string | null | undefined): string | undefined {
  const value = cookieHeader?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  return value ? decodeURIComponent(value.slice(SESSION_COOKIE.length + 1)) : undefined;
}

export function sessionFromRequest(request: Request): PlayerSession | undefined {
  return getPlayerSession(parseSessionCookie(request.headers.get("cookie")));
}

export function validName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 1 && value.trim().length <= 32 && /^[\p{L}\p{N} _.'-]+$/u.test(value.trim());
}

export function validRoomCode(value: unknown): value is string {
  return typeof value === "string" && /^[A-HJ-NP-Z2-9]{6}$/i.test(value.trim());
}

export function validPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= 8 && value.length <= 128;
}

export function requestHasValidOrigin(request: Request): boolean {
  const origin = request.headers.get("origin")?.trim();
  if (!origin) return true;

  try {
    const requestOrigin = new URL(request.url).origin;
    const configured = process.env.ALLOWED_ORIGIN?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
    if (configured.length > 0) return configured.includes(origin);
    return origin === requestOrigin;
  } catch {
    return false;
  }
}
