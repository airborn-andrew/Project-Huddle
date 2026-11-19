import { NextResponse } from "next/server";
import { forAgent, noJob } from "@/lib/agent-http";
import { listEvents } from "@/lib/ledger";
import { getProject } from "@/lib/projects";

type Params = { slug: string };

/** Everything that changed on the job after `since` (an ISO time), oldest first, up to 200 at a time. */
export const GET = forAgent<Params>(async (request, _agent, { slug }) => {
  if (!(await getProject(slug))) return noJob();
  const since = new URL(request.url).searchParams.get("since") ?? undefined;
  if (since && Number.isNaN(Date.parse(since))) return NextResponse.json({ error: "since must be an ISO time" }, { status: 400 });
  const events = await listEvents(slug, since && new Date(since).toISOString());
  return NextResponse.json({ events, next: events.at(-1)?.at ?? since ?? null });
});
