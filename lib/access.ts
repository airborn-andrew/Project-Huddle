import type { Role } from "@/lib/types";

/**
 * After the right code, a cookie holds the role and an HMAC of slug + role,
 * signed with HUDDLE_SECRET. Middleware and route handlers both check it.
 */
export const cookieName = (slug: string) => `huddle_${slug}`;

async function sign(value: string) {
  const secret = process.env.HUDDLE_SECRET ?? "";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function issueToken(slug: string, role: Role) {
  return `${role}.${await sign(`${slug}:${role}`)}`;
}

export async function readToken(slug: string, token: string | undefined): Promise<Role | null> {
  if (!token) return null;
  const [role] = token.split(".");
  if (role !== "home" && role !== "ohi") return null;
  return safeEqual(token, await issueToken(slug, role)) ? role : null;
}

/** Compares in constant time so response timing does not reveal the code. */
export function safeEqual(a: string, b: string) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}
