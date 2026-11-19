import { NextResponse } from "next/server";
import { agentActor } from "@/lib/agents";
import { bodyOf, forAgent, noJob, originOf } from "@/lib/agent-http";
import { addNote, readNote } from "@/lib/ledger";
import { getProject } from "@/lib/projects";
import { onNote } from "@/lib/tasks";

type Params = { slug: string };

/** Leaves a note or a flag on the job or one of its records; notify emails OHI. */
export const POST = forAgent<Params>(async (request, agent, { slug }) => {
  const project = await getProject(slug);
  if (!project) return noJob();
  const input = readNote(await bodyOf(request));
  if ("error" in input) return NextResponse.json({ error: input.error }, { status: 422 });
  const note = await addNote(slug, agentActor(agent), input, originOf(request), project.name);
  await onNote(note, agentActor(agent));
  return NextResponse.json(note, { status: 201 });
});
