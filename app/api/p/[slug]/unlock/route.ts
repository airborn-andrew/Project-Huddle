import { NextResponse } from "next/server";
import { getProject } from "@/lib/projects";
import { unlock } from "@/lib/unlock";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const project = await getProject(slug);
  if (!project) return NextResponse.json({ ok: false }, { status: 401 });
  return unlock(request, slug, project);
}
