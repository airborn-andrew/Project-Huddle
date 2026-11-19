import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { roleOn } from "@/lib/access";
import { bodyOf, originOf } from "@/lib/agent-http";
import { costingView } from "@/lib/job-view";
import {
  addEntry,
  addNote,
  assignLine,
  decideBatch,
  decideEntry,
  readEntry,
  readNote,
  resolveNote,
  setSettings,
  setTrade,
  text,
  type Actor,
} from "@/lib/ledger";
import { getProject } from "@/lib/projects";
import { createTask, onNote, release } from "@/lib/tasks";

type Params = { params: Promise<{ slug: string }> };

const ohi: Actor = { kind: "ohi" };

/** OHI's job costing for one project. Never sent to the homeowner. */
export async function GET(_request: Request, { params }: Params) {
  const { slug } = await params;
  if ((await roleOn(slug, await cookies())) !== "ohi") return NextResponse.json({ error: "not allowed" }, { status: 403 });
  const view = await costingView(slug);
  return view ? NextResponse.json(view) : NextResponse.json({ error: "no project" }, { status: 404 });
}

/** OHI's changes to the job's costing. They count at once; the response is the updated costing. */
export async function POST(request: Request, { params }: Params) {
  const { slug } = await params;
  if ((await roleOn(slug, await cookies())) !== "ohi") return NextResponse.json({ error: "not allowed" }, { status: 403 });
  const project = await getProject(slug);
  if (!project) return NextResponse.json({ error: "no project" }, { status: 404 });
  const body = await bodyOf(request);
  const id = text(body.id, 80) ?? "";
  const fail = (error: string) => NextResponse.json({ error }, { status: 422 });

  switch (body.action) {
    case "decideBudget":
      if (!(await decideBatch(slug, text(body.batch, 80) ?? "", body.approve === true, ohi))) return fail("nothing waiting in that batch");
      break;
    case "decideEntry":
      if (!(await decideEntry(slug, id, body.approve === true, ohi))) return fail("nothing waiting by that id");
      break;
    case "entry": {
      const entry = readEntry(body);
      if ("error" in entry) return fail(entry.error);
      await addEntry(slug, ohi, entry);
      break;
    }
    case "assign":
      if (!(await assignLine(slug, id, body.cost_code, ohi))) return fail("no such line, or unknown cost code");
      break;
    case "trade":
      if (!(await setTrade(slug, text(body.cost_code, 20) ?? "", body, ohi))) return fail("unknown cost code");
      break;
    case "settings": {
      const settings = await setSettings(slug, body, ohi);
      if (!settings.manual) await release(slug);
      break;
    }
    case "note": {
      const input = readNote(body);
      if ("error" in input) return fail(input.error);
      await onNote(await addNote(slug, ohi, { ...input, notify: false }, originOf(request), project.name), ohi);
      break;
    }
    case "resolveNote":
      await resolveNote(slug, id, ohi);
      break;
    case "release":
      await release(slug, id || undefined);
      break;
    case "task": {
      const input = body.input && typeof body.input === "object" ? (body.input as Record<string, unknown>) : {};
      const made = await createTask(slug, String(body.type ?? ""), input, ohi);
      if ("error" in made) return fail(made.error);
      break;
    }
    default:
      return fail("unknown action");
  }
  return NextResponse.json(await costingView(slug));
}
