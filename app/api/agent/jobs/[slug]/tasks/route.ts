import { NextResponse } from "next/server";
import { agentActor } from "@/lib/agents";
import { bodyOf, forAgent, noJob } from "@/lib/agent-http";
import { getProject } from "@/lib/projects";
import { createTask } from "@/lib/tasks";

type Params = { slug: string };

/** Queues a task on the job: { type, input }. */
export const POST = forAgent<Params>(async (request, agent, { slug }) => {
  if (!(await getProject(slug))) return noJob();
  const body = await bodyOf(request);
  const input = body.input && typeof body.input === "object" ? (body.input as Record<string, unknown>) : {};
  const made = await createTask(slug, String(body.type ?? ""), input, agentActor(agent));
  if ("error" in made) return NextResponse.json({ error: made.error }, { status: 422 });
  return NextResponse.json(made.task, { status: 201 });
});
