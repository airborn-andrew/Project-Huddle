import type { Role } from "@/lib/types";

/**
 * Two kinds of signed cookie. A homeowner's cookie opens one project; OHI's
 * cookie opens the project list and every project. Each holds an HMAC signed
 * with HUDDLE_SECRET, and middleware and route handlers both check it.
 */
export const homeCookie = (slug: string) => `huddle_${slug}`;
export const ohiCookie = "huddle_ohi";

export const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 30,
};

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

export const homeToken = (slug: string) => sign(`${slug}:home`);
export const ohiToken = () => sign("ohi");

type CookieJar = { get(name: string): { value: string } | undefined };

export async function isOhi(cookies: CookieJar) {
  const token = cookies.get(ohiCookie)?.value;
  return Boolean(token && safeEqual(token, await ohiToken()));
}

/** The role these cookies have on a project: OHI anywhere, or the homeowner on their own project. */
export async function roleOn(slug: string, cookies: CookieJar): Promise<Role | null> {
  if (await isOhi(cookies)) return "ohi";
  const token = cookies.get(homeCookie(slug))?.value;
  return token && safeEqual(token, await homeToken(slug)) ? "home" : null;
}

/** The OHI code, the same on every project. */
export const ohiCode = () => process.env.HUDDLE_OHI_CODE ?? "";

/** Compares in constant time so response timing does not reveal the code. */
export function safeEqual(a: string, b: string) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}
