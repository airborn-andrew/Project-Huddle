import { NextResponse } from "next/server";
import { agentFrom, type Agent } from "@/lib/agents";
import { getProject } from "@/lib/projects";

/** Runs a /api/agent handler for a bot with a valid token; anyone else gets a 401. */
export function forAgent<P>(handler: (request: Request, agent: Agent, params: P) => Promise<Response>) {
  return async (request: Request, context: { params: Promise<P> }) => {
    const agent = await agentFrom(request);
    if (!agent) return NextResponse.json({ error: "a valid bot token is required" }, { status: 401 });
    return handler(request, agent, await context.params);
  };
}

/** A JSON request body as an object; anything else reads as empty. */
export async function bodyOf(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? body : {};
}

export const projectName = async (slug: string) => (await getProject(slug))?.name ?? slug;

export const originOf = (request: Request) => new URL(request.url).origin;

export const noJob = () => NextResponse.json({ error: "no job by that slug" }, { status: 404 });
