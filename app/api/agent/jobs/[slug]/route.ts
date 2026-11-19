import { NextResponse } from "next/server";
import { forAgent, noJob } from "@/lib/agent-http";
import { jobContext } from "@/lib/job-view";

type Params = { slug: string };

/** The job in one compact read: schedule, costing by section, the approval queue, open notes and open tasks. */
export const GET = forAgent<Params>(async (_request, _agent, { slug }) => {
  const context = await jobContext(slug);
  return context ? NextResponse.json(context) : noJob();
});
