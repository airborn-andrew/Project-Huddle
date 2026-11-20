import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { roleOn } from "@/lib/access";
import { checkPieces } from "@/lib/design/layout";
import { readBack } from "@/lib/design/file";
import { openLayout } from "@/lib/design/open";
import { listVersions, readVersion, writeLayout, type Layout } from "@/lib/design/store";
import { getProject } from "@/lib/projects";
import type { Role } from "@/lib/types";

type Params = { params: Promise<{ slug: string; room: string }> };

/** What each side receives: the layout, and for OHI the saved versions it can go back to. */
async function payload(slug: string, layout: Layout, role: Role) {
  return { layout, versions: role === "ohi" ? await listVersions(slug, layout.room) : [] };
}

async function load(request: Request, { params }: Params) {
  const { slug, room } = await params;
  const role = await roleOn(slug, await cookies());
  if (!role) return { error: NextResponse.json({ error: "locked" }, { status: 401 }) };
  const project = await getProject(slug);
  const opened = project && (await openLayout(project, room, new URL(request.url).origin));
  if (!opened) return { error: NextResponse.json({ error: "not found" }, { status: 404 }) };
  return { slug, role, layout: opened.layout };
}

export async function GET(request: Request, ctx: Params) {
  const found = await load(request, ctx);
  if ("error" in found) return found.error;
  return NextResponse.json(await payload(found.slug, found.layout, found.role));
}

/**
 * save: new pieces, from the version the editor started at.
 * restore: OHI puts an earlier version back, as a new save.
 * upload: the layout file back from the homeowner's AI, as text.
 * A save that lands after someone else's gets 409 and the current layout.
 */
export async function POST(request: Request, ctx: Params) {
  const found = await load(request, ctx);
  if ("error" in found) return found.error;
  const { slug, role, layout } = found;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const version = Number(body.version);
  if (!Number.isInteger(version)) return NextResponse.json({ error: "version" }, { status: 400 });
  if (layout.status !== "open" && role !== "ohi") {
    return NextResponse.json({ error: "This layout is with OHI now.", ...(await payload(slug, layout, role)) }, { status: 423 });
  }

  let raw: unknown;
  if (body.action === "save") raw = body.pieces;
  else if (body.action === "restore" && role === "ohi") raw = await readVersion(slug, layout.room, Number(body.restore));
  else if (body.action === "upload" && typeof body.text === "string" && body.text.length < 400_000) {
    raw = readBack(body.text);
    if (!raw) return NextResponse.json({ error: "That isn't a layout file. Send back the whole file from your AI, or paste it in." }, { status: 422 });
  }
  else return NextResponse.json({ error: "action" }, { status: 400 });
  if (!raw) return NextResponse.json({ error: "That version is not there." }, { status: 404 });

  const { pieces, problems } = checkPieces(raw, layout.shell);
  if (problems.length) return NextResponse.json({ error: problems.join(" "), problems }, { status: 422 });

  const saved = await writeLayout(slug, layout.room, version, { pieces }, role);
  if (!saved) {
    const current = (await openLayout((await getProject(slug))!, layout.room, new URL(request.url).origin))!.layout;
    return NextResponse.json({ error: "conflict", ...(await payload(slug, current, role)) }, { status: 409 });
  }
  return NextResponse.json(await payload(slug, saved, role));
}
