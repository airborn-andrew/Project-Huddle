import { NextResponse } from "next/server";
import { agentActor } from "@/lib/agents";
import { bodyOf, forAgent, noJob } from "@/lib/agent-http";
import { importBudget, readImport } from "@/lib/ledger";
import { getProject } from "@/lib/projects";

type Params = { slug: string };

/** Proposes the approved estimate's components or bid items as the job's insurance budget, for OHI to approve. */
export const POST = forAgent<Params>(async (request, agent, { slug }) => {
  if (!(await getProject(slug))) return noJob();
  const data = readImport(await bodyOf(request));
  if ("error" in data) return NextResponse.json({ error: data.error }, { status: 422 });
  return NextResponse.json(await importBudget(slug, agentActor(agent), data), { status: 201 });
});
