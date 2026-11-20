import { after, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { roleOn } from "@/lib/access";
import { checkPieces, type LayoutStatus } from "@/lib/design/layout";
import { openLayout } from "@/lib/design/open";
import { listVersions, readVersion, writeLayout, type Layout } from "@/lib/design/store";
import { notifyOhi } from "@/lib/notify";
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
  // A prototype: OHI only for now.
  if (role !== "ohi") return { error: NextResponse.json({ error: "not found" }, { status: 404 }) };
  const project = await getProject(slug);
  const opened = project && (await openLayout(project, room, new URL(request.url).origin));
  if (!opened) return { error: NextResponse.json({ error: "not found" }, { status: 404 }) };
  return { slug, role, layout: opened.layout, project: project!, roomName: opened.room.name };
}

export async function GET(request: Request, ctx: Params) {
  const found = await load(request, ctx);
  if ("error" in found) return found.error;
  return NextResponse.json(await payload(found.slug, found.layout, found.role));
}

/**
 * save: new pieces, from the version the editor started at.
 * restore: OHI puts an earlier version back, as a new save.
 * status: the homeowner marks the layout ready for OHI or takes it back;
 * OHI locks it for ordering or opens it again.
 * A save that lands after someone else's gets 409 and the current layout.
 */
export async function POST(request: Request, ctx: Params) {
  const found = await load(request, ctx);
  if ("error" in found) return found.error;
  const { slug, role, layout } = found;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const version = Number(body.version);
  if (!Number.isInteger(version)) return NextResponse.json({ error: "version" }, { status: 400 });

  if (body.action === "status") {
    const status = body.status as LayoutStatus;
    const allowed =
      role === "ohi"
        ? status === "locked" || status === "open"
        : (status === "ready" && layout.status === "open") || (status === "open" && layout.status === "ready");
    if (!allowed) return NextResponse.json({ error: "status" }, { status: 400 });
    const saved = await writeLayout(slug, layout.room, version, { status }, role);
    if (!saved) return NextResponse.json({ error: "conflict", ...(await payload(slug, layout, role)) }, { status: 409 });
    if (status === "ready") {
      const link = new URL(`/p/${slug}/design/${layout.room}`, request.url).toString();
      after(() => notifyOhi({ project: found.project.name, what: `The ${found.roomName.toLowerCase()} layout is ready for you to look at.`, link }));
    }
    return NextResponse.json(await payload(slug, saved, role));
  }
  if (layout.status !== "open" && role !== "ohi") {
    return NextResponse.json({ error: "This layout is with OHI now.", ...(await payload(slug, layout, role)) }, { status: 423 });
  }

  let raw: unknown;
  if (body.action === "save") raw = body.pieces;
  else if (body.action === "restore" && role === "ohi") raw = await readVersion(slug, layout.room, Number(body.restore));
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
