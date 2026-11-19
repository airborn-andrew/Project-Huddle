import { NextResponse } from "next/server";
import { bodyOf, forAgent, originOf, projectName } from "@/lib/agent-http";
import { finishTask } from "@/lib/tasks";

type Params = { id: string };

/** Finishes a claimed task with { result } in the shape its type asks for, or reports { error }. */
export const POST = forAgent<Params>(async (request, agent, { id }) => {
  const done = await finishTask(agent, id, await bodyOf(request), originOf(request), projectName);
  if ("error" in done) return NextResponse.json({ error: done.error }, { status: done.status });
  return NextResponse.json(done);
});
