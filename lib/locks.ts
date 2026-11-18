import { list, put } from "@vercel/blob";

/**
 * Wrong codes are counted per project and per device. After MAX_FAILS wrong
 * codes in a row, that device waits LOCK_MINUTES before it can try again.
 * Devices are keyed by a hash of their IP address, so no address is stored.
 */
export const MAX_FAILS = 5;
export const LOCK_MINUTES = 15;

type Lock = { fails: number; until?: number };

const memory = new Map<string, Lock>();
const hasBlob = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);

async function deviceKey(slug: string, ip: string) {
  const data = new TextEncoder().encode(`${process.env.HUDDLE_SECRET ?? ""}:${slug}:${ip}`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash).slice(0, 12), (b) => b.toString(16).padStart(2, "0")).join("");
}

const path = (slug: string, key: string) => `projects/${slug}/locks/${key}.json`;

async function read(slug: string, key: string): Promise<Lock> {
  if (!hasBlob()) return memory.get(key) ?? { fails: 0 };
  const { blobs } = await list({ prefix: path(slug, key) });
  if (!blobs[0]) return { fails: 0 };
  const res = await fetch(`${blobs[0].url}?v=${+new Date(blobs[0].uploadedAt)}`, { cache: "no-store" });
  return res.ok ? ((await res.json()) as Lock) : { fails: 0 };
}

async function write(slug: string, key: string, lock: Lock) {
  if (!hasBlob()) {
    memory.set(key, lock);
    return;
  }
  await put(path(slug, key), JSON.stringify(lock), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    cacheControlMaxAge: 60,
  });
}

/** Minutes left on this device's lock, or 0 when it may try a code. */
export async function lockedFor(slug: string, ip: string) {
  const lock = await read(slug, await deviceKey(slug, ip));
  if (!lock.until || lock.until <= Date.now()) return 0;
  return Math.ceil((lock.until - Date.now()) / 60_000);
}

/** Records a wrong code and returns the minutes the device is now locked for. */
export async function recordFail(slug: string, ip: string) {
  const key = await deviceKey(slug, ip);
  const lock = await read(slug, key);
  const fails = (lock.until && lock.until <= Date.now() ? 0 : lock.fails) + 1;
  const next: Lock = fails >= MAX_FAILS ? { fails: 0, until: Date.now() + LOCK_MINUTES * 60_000 } : { fails };
  await write(slug, key, next);
  return next.until ? LOCK_MINUTES : 0;
}

export async function clearFails(slug: string, ip: string) {
  const key = await deviceKey(slug, ip);
  const lock = await read(slug, key);
  if (lock.fails || lock.until) await write(slug, key, { fails: 0 });
}

export function clientIp(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}
