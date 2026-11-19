import { NextResponse } from "next/server";
import { agentActor } from "@/lib/agents";
import { bodyOf, forAgent } from "@/lib/agent-http";
import { assignLine } from "@/lib/ledger";

type Params = { slug: string; id: string };

/** Moves a budget line to another cost code, or to none with null. */
export const POST = forAgent<Params>(async (request, agent, { slug, id }) => {
  const body = await bodyOf(request);
  if (!("cost_code" in body)) return NextResponse.json({ error: "cost_code is required" }, { status: 400 });
  const ok = await assignLine(slug, id, body.cost_code, agentActor(agent));
  return ok ? NextResponse.json({ ok }) : NextResponse.json({ error: "no such line, or unknown cost_code" }, { status: 422 });
});
