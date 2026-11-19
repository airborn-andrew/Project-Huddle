import { insert, remove, select, update, upsert } from "@/lib/tables";
import type { Actor } from "@/lib/ledger";

/**
 * The bots that work on jobs through /api/agent. Each has its own token; only
 * the token's SHA-256 is stored, so a token is shown once, when it is made.
 * A bot sends it as `Authorization: Bearer <token>`.
 */
export type Agent = {
  id: string;
  name: string;
  token_hash: string;
  /** Task types the bot takes; empty takes every type. */
  task_types: string[];
  /** Where to ping when a task it takes is queued; without one the bot polls. */
  webhook_url: string | null;
  paused: boolean;
  created_at: string;
  last_seen_at: string | null;
};

/** What OHI sees of a bot: everything but the token hash. */
export const publicAgent = (a: Agent) => ({
  id: a.id,
  name: a.name,
  task_types: a.task_types,
  webhook_url: a.webhook_url,
  paused: a.paused,
  created_at: a.created_at,
  last_seen_at: a.last_seen_at,
});

export type PublicAgent = ReturnType<typeof publicAgent>;

export async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createAgent(name: string, taskTypes: string[], webhookUrl: string | null) {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = `hb_${Buffer.from(bytes).toString("base64url")}`;
  const [agent] = await insert<Agent>("agents", [
    {
      id: crypto.randomUUID(),
      name,
      token_hash: await sha256(token),
      task_types: taskTypes,
      webhook_url: webhookUrl,
      paused: false,
      created_at: new Date().toISOString(),
      last_seen_at: null,
    },
  ]);
  return { agent, token };
}

export const listAgents = () => select<Agent>("agents", {}, { order: "created_at" });

export async function setAgent(id: string, patch: Partial<Pick<Agent, "paused" | "task_types" | "webhook_url">>) {
  const [agent] = await update<Agent>("agents", { id }, patch);
  return agent ?? null;
}

export const removeAgent = (id: string) => remove("agents", { id });

/** The bot a request comes from, or null without a valid token. */
export async function agentFrom(request: Request): Promise<Agent | null> {
  const match = request.headers.get("authorization")?.match(/^Bearer (hb_[A-Za-z0-9_-]+)$/);
  if (!match) return null;
  const [agent] = await select<Agent>("agents", { token_hash: await sha256(match[1]) });
  if (!agent) return null;
  await update("agents", { id: agent.id }, { last_seen_at: new Date().toISOString() });
  return agent;
}

export const agentActor = (agent: Agent): Actor => ({ kind: "agent", id: agent.id, name: agent.name });

/** The switch that stops every task going out to every bot. */
export async function dispatchPaused() {
  const [row] = await select<{ key: string; value: boolean }>("control", { key: "dispatch_paused" });
  return row?.value === true;
}

export const setDispatchPaused = (paused: boolean) => upsert("control", { key: "dispatch_paused", value: paused }, ["key"]);
