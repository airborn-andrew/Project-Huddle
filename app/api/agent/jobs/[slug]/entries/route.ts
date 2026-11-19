import { NextResponse } from "next/server";
import { agentActor } from "@/lib/agents";
import { bodyOf, forAgent, noJob } from "@/lib/agent-http";
import { addEntry, readEntry } from "@/lib/ledger";
import { getProject } from "@/lib/projects";

type Params = { slug: string };

/**
 * Proposes a supplement, a commitment or an actual cost. It counts once OHI
 * approves it. A commitment or cost outside the approved estimate (scope
 * "review") waits for OHI's scope decision first.
 */
export const POST = forAgent<Params>(async (request, agent, { slug }) => {
  if (!(await getProject(slug))) return noJob();
  const entry = readEntry(await bodyOf(request));
  if ("error" in entry) return NextResponse.json({ error: entry.error }, { status: 422 });
  const added = await addEntry(slug, agentActor(agent), entry);
  if ("error" in added) return NextResponse.json({ error: added.error }, { status: 422 });
  return NextResponse.json(added, { status: 201 });
});
