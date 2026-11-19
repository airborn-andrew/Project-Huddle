import { NextResponse } from "next/server";
import { forAgent, originOf, projectName } from "@/lib/agent-http";
import { claimNext, taskTypes } from "@/lib/tasks";

/** Claims the oldest queued task this bot takes. 204 when there is nothing to do. */
export const GET = forAgent<object>(async (request, agent) => {
  const task = await claimNext(agent, originOf(request), projectName);
  if (!task) return new NextResponse(null, { status: 204 });
  const kind = taskTypes[task.type];
  return NextResponse.json({ task, does: kind.does, result: kind.result });
});
