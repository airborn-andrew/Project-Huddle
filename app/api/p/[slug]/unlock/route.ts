import { NextResponse } from "next/server";
import { cookieName, issueToken, safeEqual } from "@/lib/access";
import { projectConfig } from "@/lib/projects";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const project = projectConfig(slug);
  const { code } = (await request.json().catch(() => ({}))) as { code?: string };
  if (!project || typeof code !== "string") return NextResponse.json({ ok: false }, { status: 401 });

  const role = safeEqual(code, project.ohi) ? "ohi" : safeEqual(code, project.home) ? "home" : null;
  if (!role) return NextResponse.json({ ok: false }, { status: 401 });

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
