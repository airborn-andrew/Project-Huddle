import { NextResponse } from "next/server";
import { cookieName, issueToken, safeEqual } from "@/lib/access";
import { clearFails, clientIp, lockedFor, recordFail } from "@/lib/locks";
import { projectConfig } from "@/lib/projects";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const project = projectConfig(slug);
  const { code } = (await request.json().catch(() => ({}))) as { code?: string };
  if (!project || typeof code !== "string") return NextResponse.json({ ok: false }, { status: 401 });

  const ip = clientIp(request);
  const waiting = await lockedFor(slug, ip);
  if (waiting) return NextResponse.json({ ok: false, minutes: waiting }, { status: 429 });

  const role = safeEqual(code, project.ohi) ? "ohi" : safeEqual(code, project.home) ? "home" : null;
  if (!role) {
    const minutes = await recordFail(slug, ip);
    return NextResponse.json({ ok: false, minutes }, { status: minutes ? 429 : 401 });
  }

  await clearFails(slug, ip);
  const response = NextResponse.json({ ok: true, role });
  response.cookies.set(cookieName(slug), await issueToken(slug, role), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
