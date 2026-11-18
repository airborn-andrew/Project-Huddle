import { NextResponse } from "next/server";
import { cookieOptions, homeCookie, homeToken, ohiCode, ohiCookie, ohiToken, safeEqual } from "@/lib/access";
import { clearFails, clientIp, lockedFor, recordFail } from "@/lib/locks";
import type { Role } from "@/lib/types";

/**
 * Checks a code from a passcode screen and sets the cookie it earns. The OHI
 * code works on every screen; a project's screen also takes its homeowner code.
 * `scope` names the screen for the wrong-code lock.
 */
export async function unlock(request: Request, scope: string, project?: { slug: string; homeCode: string }) {
  const { code } = (await request.json().catch(() => ({}))) as { code?: string };
  if (typeof code !== "string") return NextResponse.json({ ok: false }, { status: 401 });

  const ip = clientIp(request);
  const waiting = await lockedFor(scope, ip);
  if (waiting) return NextResponse.json({ ok: false, minutes: waiting }, { status: 429 });

  const ohi = ohiCode();
  const role: Role | null =
    ohi.length === 6 && safeEqual(code, ohi) ? "ohi" : project && safeEqual(code, project.homeCode) ? "home" : null;
  if (!role) {
    const minutes = await recordFail(scope, ip);
    return NextResponse.json({ ok: false, minutes }, { status: minutes ? 429 : 401 });
  }

  await clearFails(scope, ip);
  const response = NextResponse.json({ ok: true, role });
  if (role === "ohi") response.cookies.set(ohiCookie, await ohiToken(), cookieOptions);
  else if (project) response.cookies.set(homeCookie(project.slug), await homeToken(project.slug), cookieOptions);
  return response;
}
