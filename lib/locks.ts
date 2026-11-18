import { db } from "@/lib/db";

/**
 * Wrong codes are counted per sign-in screen (a project, or OHI's) and per
 * device. After MAX_FAILS wrong codes in a row, that device waits LOCK_MINUTES
 * before it can try again. Devices are keyed by a hash of their IP address, so
 * no address is stored.
 */
export const MAX_FAILS = 5;
export const LOCK_MINUTES = 15;

type Lock = { fails: number; until: number | null };

const memory = new Map<string, Lock>();

async function deviceKey(scope: string, ip: string) {
  const data = new TextEncoder().encode(`${process.env.HUDDLE_SECRET ?? ""}:${scope}:${ip}`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash).slice(0, 12), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function read(key: string): Promise<Lock> {
  const client = db();
  if (!client) return memory.get(key) ?? { fails: 0, until: null };
  const { data, error } = await client
    .from("code_locks")
    .select("fails, locked_until")
    .eq("key", key)
    .maybeSingle<{ fails: number; locked_until: string | null }>();
  if (error) throw error;
  return { fails: data?.fails ?? 0, until: data?.locked_until ? Date.parse(data.locked_until) : null };
}

async function write(key: string, lock: Lock) {
  const client = db();
  if (!client) {
    memory.set(key, lock);
    return;
  }
  const locked_until = lock.until ? new Date(lock.until).toISOString() : null;
  const { error } = await client.from("code_locks").upsert({ key, fails: lock.fails, locked_until });
  if (error) throw error;
}

/** Minutes left on this device's lock, or 0 when it may try a code. */
export async function lockedFor(scope: string, ip: string) {
  const lock = await read(await deviceKey(scope, ip));
  if (!lock.until || lock.until <= Date.now()) return 0;
  return Math.ceil((lock.until - Date.now()) / 60_000);
}

/** Records a wrong code and returns the minutes the device is now locked for. */
export async function recordFail(scope: string, ip: string) {
  const key = await deviceKey(scope, ip);
  const lock = await read(key);
  const fails = (lock.until && lock.until <= Date.now() ? 0 : lock.fails) + 1;
  const next: Lock = fails >= MAX_FAILS ? { fails: 0, until: Date.now() + LOCK_MINUTES * 60_000 } : { fails, until: null };
  await write(key, next);
  return next.until ? LOCK_MINUTES : 0;
}

export async function clearFails(scope: string, ip: string) {
  const key = await deviceKey(scope, ip);
  const lock = await read(key);
  if (lock.fails || lock.until) await write(key, { fails: 0, until: null });
}

export function clientIp(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}
