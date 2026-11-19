import { agentActor, dispatchPaused, listAgents, type Agent } from "@/lib/agents";
import { costCodeName, isCostCode } from "@/lib/cost-codes";
import type { BudgetLine } from "@/lib/costing";
import {
  actorName,
  addEntry,
  addNote,
  importBudget,
  jobSettings,
  money,
  readEntry,
  readImport,
  recordEvents,
  text,
  type Actor,
  type Checked,
  type Note,
} from "@/lib/ledger";
import { insert, select, update } from "@/lib/tables";

/**
 * The task queue. A task is one short, specific job for a bot: its input
 * carries everything the bot needs, and its result must match the shape its
 * type defines or it is refused and retried. The queue wakes bots by webhook
 * when they have one; otherwise they poll /api/agent/tasks/next.
 *
 * A task waits (held) instead of going out while dispatch is paused for every
 * job or its job is in manual mode. A claimed task that runs past its timeout
 * goes back in the queue, up to its attempt limit; then it fails and OHI gets
 * a note.
 */
export type Task = {
  id: string;
  slug: string | null;
  type: string;
  input: Record<string, unknown>;
  status: "queued" | "held" | "claimed" | "done" | "failed";
  agent_id: string | null;
  attempts: number;
  max_attempts: number;
  timeout_seconds: number;
  claimed_at: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
  created_by: string;
  created_at: string;
  finished_at: string | null;
};

type Done = { slug: string; actor: Actor; origin: string; project: string };

type TaskType = {
  /** What the bot does, shown to bots in the API description. */
  does: string;
  input: string;
  result: string;
  /** Checks the input when the task is made; returns an error or the input to store. */
  checkInput(input: Record<string, unknown>): string | Record<string, unknown>;
  /** Checks the bot's result and applies it; returns an error when the result is refused. */
  finish(task: Task, result: Record<string, unknown>, done: Done): Promise<string | null>;
};

export const taskTypes: Record<string, TaskType> = {
  "read-components": {
    does: "Read the Components report of the carrier-approved estimate, as pipeline/components.py prints it.",
    input: "{ source: where the report is, such as a Restoration Manager attachment }",
    result: "{ source: 'components', estimate, price_list, lines: [{ kind, code, description, quantity, unit, unit_price, total, flagged }], totals: { material, equipment, labor } }",
    checkInput: (input) => (text(input.source) ? { source: text(input.source) } : "input.source is required"),
    async finish(_task, result, done) {
      const data = readImport({ ...result, source: "components" });
      if ("error" in data) return data.error;
      await importBudget(done.slug, done.actor, data);
      return null;
    },
  },
  "read-bid": {
    does:
      "Read a sub or supplier bid into its items. Each item becomes a proposed commitment for OHI to accept or reject. An item in a section with no approved estimate lines waits for OHI's scope decision. Name the approved budget line ids an item covers in covers when you can match them.",
    input: "{ source: where the bid is }",
    result: "{ vendor, date?, expires?, total?, items: [{ description, amount, cost_code?, covers?: [budget line id] }] }",
    checkInput: (input) => (text(input.source) ? { source: text(input.source) } : "input.source is required"),
    async finish(task, result, done) {
      const vendor = text(result.vendor, 120);
      const items = Array.isArray(result.items) ? (result.items as Record<string, unknown>[]) : [];
      if (!vendor || !items.length) return "vendor and at least one item are required";
      const entries = [];
      for (const [i, item] of items.entries()) {
        const entry = readEntry({ ...item, type: "commitment" });
        if ("error" in entry) return `item ${i + 1}: ${entry.error}`;
        entries.push(entry);
      }
      const total = money(result.total);
      const sum = entries.reduce((s, e) => s + Math.round(e.amount * 100), 0) / 100;
      if (total !== null && Math.abs(total - sum) > 0.005) return `items add up to ${sum.toFixed(2)}, not the bid total ${total.toFixed(2)}`;
      // Every named line must be approved before any item is written, so a refused result leaves nothing behind.
      const approved = new Set((await select<BudgetLine>("budget_lines", { slug: done.slug, status: "approved" })).map((l) => l.id));
      const unknown = entries.flatMap((e) => e.covers).filter((id) => !approved.has(id));
      if (unknown.length) return `covers names lines not in the approved estimate: ${unknown.join(", ")}`;
      const terms = [text(result.date, 40) && `dated ${text(result.date, 40)}`, text(result.expires, 40) && `expires ${text(result.expires, 40)}`]
        .filter(Boolean)
        .join(", ");
      for (const entry of entries) {
        const added = await addEntry(done.slug, done.actor, {
          ...entry,
          vendor,
          source: text(task.input.source, 1000),
          reason: terms ? `Bid ${terms}` : entry.reason,
        });
        if ("error" in added) return added.error;
      }
      return null;
    },
  },
  "request-quote": {
    does: "Ask a supplier or sub for a quote on one section's scope, then report who was asked.",
    input: "{ cost_code, name, scope: [{ description, quantity, unit }], instructions }",
    result: "{ vendor, sent_to, sent_at? }",
    checkInput(input) {
      if (!isCostCode(input.cost_code)) return "input.cost_code must be a cost code";
      return { ...input, name: costCodeName(input.cost_code) };
    },
    async finish(task, result, done) {
      const vendor = text(result.vendor, 120);
      const sentTo = text(result.sent_to, 200);
      if (!vendor || !sentTo) return "vendor and sent_to are required";
      await addNote(
        done.slug,
        done.actor,
        {
          body: `Quote requested from ${vendor} (${sentTo})`,
          flag: "quote_requested",
          record_type: "trade",
          record_id: String(task.input.cost_code),
          notify: false,
        },
        done.origin,
        done.project,
      );
      return null;
    },
  },
};

const now = () => new Date().toISOString();

export function listTasks(slug: string) {
  return select<Task>("tasks", { slug }, { order: "created_at", descending: true, limit: 50 });
}

export async function createTask(
  slug: string,
  type: string,
  rawInput: Record<string, unknown>,
  actor: Actor,
): Promise<Checked<{ task: Task }>> {
  const kind = taskTypes[type];
  if (!kind) return { error: `unknown task type ${type}; known: ${Object.keys(taskTypes).join(", ")}` };
  const input = kind.checkInput(rawInput);
  if (typeof input === "string") return { error: input };
  const held = (await dispatchPaused()) || (await jobSettings(slug)).manual;
  const [task] = await insert<Task>("tasks", [
    {
      id: crypto.randomUUID(),
      slug,
      type,
      input,
      status: held ? "held" : "queued",
      agent_id: null,
      attempts: 0,
      max_attempts: 3,
      timeout_seconds: 900,
      claimed_at: null,
      result: null,
      error: null,
      created_by: actorName(actor),
      created_at: now(),
      finished_at: null,
    },
  ]);
  await recordEvents(slug, actor, [{ type: "task_created", ref: task.id, data: { type, status: task.status } }]);
  if (!held) await wake(task);
  return { task };
}

/** A flag asking for a new price on a section queues a quote request with that section's scope. */
export async function onNote(note: Note, actor: Actor) {
  if (note.record_type !== "trade" || !isCostCode(note.record_id)) return;
  if (note.flag !== "rebid" && note.flag !== "check_supplier") return;
  const lines = await select<BudgetLine>("budget_lines", { slug: note.slug, cost_code: note.record_id, status: "approved" });
  const scope = lines
    .filter((l) => l.kind === "material" || l.kind === "other")
    .map((l) => ({ description: l.description, quantity: l.quantity, unit: l.unit }));
  await createTask(note.slug, "request-quote", { cost_code: note.record_id, scope, instructions: note.body }, actor);
}

/** Pings every bot that takes this task and has a webhook. The ping carries no job data. */
async function wake(task: Task) {
  const agents = (await listAgents()).filter(
    (a) => !a.paused && a.webhook_url && (!a.task_types.length || a.task_types.includes(task.type)),
  );
  await Promise.all(
    agents.map(async (agent) => {
      const body = JSON.stringify({ event: "task", task_id: task.id, type: task.type });
      try {
        await fetch(agent.webhook_url!, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Huddle-Signature": `sha256=${await sign(agent.token_hash, body)}` },
          body,
          signal: AbortSignal.timeout(5000),
        });
      } catch (e) {
        console.error(`Waking ${agent.name} failed`, e);
      }
    }),
  );
}

/** HMAC-SHA256 of the body, keyed with the SHA-256 of the bot's token, so the bot can check it came from Huddle. */
async function sign(key: string, body: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Puts claimed tasks that ran past their timeout back in the queue, or fails them at their attempt limit. */
async function sweep(origin: string, project: (slug: string) => Promise<string>) {
  const claimed = await select<Task>("tasks", { status: "claimed" });
  const late = claimed.filter((t) => t.claimed_at && Date.parse(t.claimed_at) + t.timeout_seconds * 1000 < Date.now());
  for (const task of late) await retryOrFail(task, "timed out", origin, project);
}

async function retryOrFail(task: Task, error: string, origin: string, project: (slug: string) => Promise<string>) {
  const failed = task.attempts >= task.max_attempts;
  const [changed] = await update<Task>(
    "tasks",
    { id: task.id, status: "claimed" },
    failed ? { status: "failed", error, finished_at: now() } : { status: "queued", error, agent_id: null, claimed_at: null },
  );
  if (!changed || !task.slug) return;
  const system: Actor = { kind: "ohi" };
  await recordEvents(task.slug, system, [{ type: failed ? "task_failed" : "task_retry", ref: task.id, data: { error } }]);
  if (failed) {
    await addNote(
      task.slug,
      system,
      { body: `Task ${task.type} failed after ${task.attempts} tries: ${error}`, flag: "risk", record_type: "task", record_id: task.id, notify: true },
      origin,
      await project(task.slug),
    );
  } else {
    await wake(changed);
  }
}

/** Gives a bot the oldest queued task it takes, on a job not in manual mode. */
export async function claimNext(agent: Agent, origin: string, project: (slug: string) => Promise<string>) {
  if (agent.paused || (await dispatchPaused())) return null;
  await sweep(origin, project);
  const queued = await select<Task>("tasks", { status: "queued" }, { order: "created_at", limit: 100 });
  for (const task of queued) {
    if (agent.task_types.length && !agent.task_types.includes(task.type)) continue;
    if (task.slug && (await jobSettings(task.slug)).manual) continue;
    const [claimed] = await update<Task>(
      "tasks",
      { id: task.id, status: "queued" },
      { status: "claimed", agent_id: agent.id, attempts: task.attempts + 1, claimed_at: now() },
    );
    if (claimed) {
      if (claimed.slug) await recordEvents(claimed.slug, agentActor(agent), [{ type: "task_claimed", ref: claimed.id }]);
      return claimed;
    }
  }
  return null;
}

/** A bot's answer to its claimed task: a result to check and apply, or an error. */
export async function finishTask(
  agent: Agent,
  id: string,
  body: Record<string, unknown>,
  origin: string,
  project: (slug: string) => Promise<string>,
) {
  const [task] = await select<Task>("tasks", { id, status: "claimed", agent_id: agent.id });
  if (!task) return { error: "no task by that id is claimed by this bot", status: 404 };
  const reported = text(body.error, 1000);
  const result = body.result && typeof body.result === "object" ? (body.result as Record<string, unknown>) : null;
  if (reported || !result || !task.slug) {
    await retryOrFail(task, reported ?? "no result", origin, project);
    return { error: reported ? "error recorded" : "result is required", status: reported ? 200 : 400 };
  }
  const refused = await taskTypes[task.type].finish(task, result, {
    slug: task.slug,
    actor: agentActor(agent),
    origin,
    project: await project(task.slug),
  });
  if (refused) {
    await retryOrFail(task, `result refused: ${refused}`, origin, project);
    return { error: refused, status: 422 };
  }
  await update("tasks", { id }, { status: "done", result, error: null, finished_at: now() });
  await recordEvents(task.slug, agentActor(agent), [{ type: "task_done", ref: id, data: { type: task.type } }]);
  return { ok: true };
}

/** Sends a held task out, or every held task on a job. */
export async function release(slug: string, id?: string) {
  if (await dispatchPaused()) return 0;
  const held = await select<Task>("tasks", id ? { slug, id, status: "held" } : { slug, status: "held" });
  for (const task of held) {
    const [queued] = await update<Task>("tasks", { id: task.id, status: "held" }, { status: "queued" });
    if (queued) await wake(queued);
  }
  return held.length;
}

/** Sends out every held task on jobs not in manual mode, after dispatch is switched back on. */
export async function releaseAll() {
  const held = await select<Task>("tasks", { status: "held" });
  for (const slug of new Set(held.map((t) => t.slug).filter((s): s is string => Boolean(s)))) {
    if (!(await jobSettings(slug)).manual) await release(slug);
  }
}
