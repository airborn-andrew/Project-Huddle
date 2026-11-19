import { notifyOhi } from "@/lib/notify";
import { costCodeFor, costCodeName, isCostCode } from "@/lib/cost-codes";
import {
  defaultSettings,
  noteFlags,
  type NoteFlag,
  type BudgetLine,
  type CostEntry,
  type EntryType,
  type JobSettings,
  type Trade,
  type TradeMethod,
} from "@/lib/costing";
import { insert, select, update, upsert } from "@/lib/tables";

/**
 * The job costing ledger: reading a job's rows and every change to them. Who
 * makes a change decides how it lands: OHI's changes are approved as they are
 * made, a bot's changes to money wait in the approval queue. Every change is
 * recorded as an event.
 */
export type Actor = { kind: "ohi" } | { kind: "homeowner" } | { kind: "agent"; id: string; name: string };

export const actorName = (a: Actor) => (a.kind === "agent" ? a.name : a.kind === "ohi" ? "OHI" : "Homeowner");

export type Note = {
  id: string;
  slug: string;
  record_type: string | null;
  record_id: string | null;
  body: string;
  flag: NoteFlag | null;
  notify: boolean;
  created_by: string;
  created_at: string;
  resolved_at: string | null;
};


export type JobEvent = { id: number; slug: string | null; type: string; ref: string | null; data: Record<string, unknown>; actor: string; at: string };

const now = () => new Date().toISOString();

/** Input checks shared by the routes and task results. Each returns null when the value is unusable. */
export const text = (v: unknown, max = 2000) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
/** A checked input, or why it was refused. */
export type Checked<T> = T | { error: string };

export const money = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 1e9 ? Math.round(v * 100) / 100 : null);
const quantity = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export async function recordEvents(slug: string | null, actor: Actor, events: { type: string; ref?: string; data?: Record<string, unknown> }[]) {
  if (!events.length) return;
  await insert(
    "events",
    events.map((e) => ({ slug, type: e.type, ref: e.ref ?? null, data: e.data ?? {}, actor: actorName(actor), at: now() })),
  );
}

export function listEvents(slug: string, since?: string, limit = 200) {
  return select<JobEvent>("events", { slug }, { order: "at", after: since ? ["at", since] : undefined, limit });
}

export async function loadJob(slug: string) {
  const [lines, entries, trades, settings, notes] = await Promise.all([
    select<BudgetLine>("budget_lines", { slug }, { order: "created_at" }),
    select<CostEntry>("cost_entries", { slug }, { order: "created_at" }),
    select<Trade>("trades", { slug }),
    select<JobSettings>("job_settings", { slug }),
    select<Note>("notes", { slug }, { order: "created_at" }),
  ]);
  return {
    lines: lines.filter((l) => l.status === "approved" || l.status === "proposed"),
    entries: entries.filter((e) => e.status !== "rejected"),
    trades,
    settings: settings[0] ?? defaultSettings(slug),
    notes,
  };
}

export async function jobSettings(slug: string) {
  return (await select<JobSettings>("job_settings", { slug }))[0] ?? defaultSettings(slug);
}

/**
 * Checks an estimate import: the Components report from pipeline/components.py,
 * or the estimate's bid items. Each kind of line must add up to its total, so
 * a misread line cannot slip into the budget.
 */
type ImportLine = Omit<BudgetLine, "id" | "slug" | "batch" | "source" | "status" | "created_by" | "created_at">;

export type Import = { source: "components" | "bid_item"; estimate: string | null; priceList: string | null; lines: ImportLine[] };

export function readImport(body: Record<string, unknown>): Checked<Import> {
  const source = body.source === "components" || body.source === "bid_item" ? body.source : null;
  if (!source) return { error: "source must be components or bid_item" };
  if (!Array.isArray(body.lines) || !body.lines.length) return { error: "lines must be a non-empty list" };
  const kinds = ["material", "labor", "equipment", "other"] as const;
  const lines: ImportLine[] = [];
  for (const [i, raw] of body.lines.entries()) {
    const l = (raw ?? {}) as Record<string, unknown>;
    const kind = kinds.find((k) => k === l.kind);
    const description = text(l.description, 300);
    const total = money(l.total);
    if (!kind || !description || total === null) return { error: `line ${i + 1} needs kind, description and total` };
    const code = text(l.code, 40);
    lines.push({
      kind,
      xact_code: code,
      description,
      quantity: quantity(l.quantity),
      unit: text(l.unit, 8),
      unit_price: quantity(l.unit_price),
      amount: total,
      cost_code: isCostCode(l.cost_code) ? l.cost_code : costCodeFor(kind, code, description),
      flagged: l.flagged === true,
    });
  }
  const totals = (body.totals ?? {}) as Record<string, unknown>;
  for (const kind of new Set(lines.map((l) => l.kind))) {
    const stated = money(totals[kind]);
    if (stated === null) return { error: `totals.${kind} is missing` };
    const found = lines.filter((l) => l.kind === kind).reduce((s, l) => s + Math.round(l.amount * 100), 0) / 100;
    if (Math.abs(found - stated) > 0.005) return { error: `${kind} lines add up to ${found.toFixed(2)}, not ${stated.toFixed(2)}` };
  }
  return { source, estimate: text(body.estimate, 120), priceList: text(body.price_list, 40), lines };
}

/** Adds an import as one batch. OHI's batch is approved at once; a bot's waits for approval. */
export async function importBudget(slug: string, actor: Actor, data: Import) {
  const batch = crypto.randomUUID();
  const at = now();
  await insert(
    "budget_lines",
    data.lines.map((l) => ({
      id: crypto.randomUUID(),
      slug,
      batch,
      source: data.source,
      ...l,
      status: "proposed",
      created_by: actorName(actor),
      created_at: at,
    })),
  );
  const total = data.lines.reduce((s, l) => s + Math.round(l.amount * 100), 0) / 100;
  await recordEvents(slug, actor, [
    { type: "budget_import", ref: batch, data: { source: data.source, estimate: data.estimate, price_list: data.priceList, lines: data.lines.length, total } },
  ]);
  if (actor.kind === "ohi") await decideBatch(slug, batch, true, actor);
  return { batch, lines: data.lines.length, total };
}

/** Approving a batch replaces the approved lines from the same source; rejecting drops it. */
export async function decideBatch(slug: string, batch: string, approve: boolean, actor: Actor) {
  const lines = await select<BudgetLine>("budget_lines", { slug, batch, status: "proposed" });
  if (!lines.length) return false;
  if (approve) await update("budget_lines", { slug, source: lines[0].source, status: "approved" }, { status: "superseded" });
  await update("budget_lines", { slug, batch, status: "proposed" }, { status: approve ? "approved" : "rejected" });
  await recordEvents(slug, actor, [{ type: approve ? "budget_approved" : "budget_rejected", ref: batch }]);
  return true;
}

export async function assignLine(slug: string, id: string, costCode: unknown, actor: Actor) {
  const code = costCode === null ? null : isCostCode(costCode) ? costCode : undefined;
  if (code === undefined) return false;
  const [line] = await update<BudgetLine>("budget_lines", { slug, id }, { cost_code: code });
  if (!line) return false;
  await recordEvents(slug, actor, [{ type: "line_assigned", ref: id, data: { cost_code: code, description: line.description } }]);
  return true;
}

const entryTypes: EntryType[] = ["budget_change", "commitment", "actual"];

export type EntryInput = Pick<CostEntry, "type" | "amount" | "description" | "cost_code" | "vendor" | "source" | "reason" | "covers">;

export function readEntry(body: Record<string, unknown>): Checked<EntryInput> {
  const type = entryTypes.find((t) => t === body.type);
  const amount = money(body.amount);
  const description = text(body.description, 300);
  if (!type || amount === null || !description) return { error: "type, amount and description are required" };
  if (body.cost_code != null && !isCostCode(body.cost_code)) return { error: `unknown cost_code ${String(body.cost_code)}` };
  if (body.covers != null && !(Array.isArray(body.covers) && body.covers.every((c) => typeof c === "string"))) {
    return { error: "covers must be a list of budget line ids" };
  }
  return {
    type,
    amount,
    description,
    cost_code: (body.cost_code as string | undefined) ?? null,
    vendor: text(body.vendor, 120),
    source: text(body.source, 1000),
    reason: text(body.reason, 1000),
    covers: ((body.covers as string[] | undefined) ?? []).slice(0, 50),
  };
}

/**
 * The scope gate. A supplement or change to the insurance money is in scope by
 * its nature. A commitment or cost is in scope when the approved lines it names
 * exist, or when its section has approved estimate lines; otherwise it waits
 * for OHI to decide what happens to it. Naming a line that is not approved on
 * this job is refused.
 */
async function scopeOf(slug: string, input: EntryInput): Promise<Checked<{ scope: CostEntry["scope"] }>> {
  if (input.type === "budget_change") return { scope: "in_scope" };
  const approved = await select<BudgetLine>("budget_lines", { slug, status: "approved" });
  if (input.covers.length) {
    const known = new Set(approved.map((l) => l.id));
    const unknown = input.covers.filter((id) => !known.has(id));
    if (unknown.length) return { error: `covers names lines not in the approved estimate: ${unknown.join(", ")}` };
    return { scope: "in_scope" };
  }
  return { scope: approved.some((l) => l.cost_code === input.cost_code) ? "in_scope" : "review" };
}

/** Adds an entry. OHI's entries in scope count at once; a bot's wait for approval, and anything out of scope waits for OHI's decision. */
export async function addEntry(slug: string, actor: Actor, input: EntryInput): Promise<Checked<CostEntry>> {
  const checked = await scopeOf(slug, input);
  if ("error" in checked) return checked;
  const at = now();
  const approved = actor.kind === "ohi" && checked.scope === "in_scope";
  const [entry] = await insert<CostEntry>("cost_entries", [
    {
      id: crypto.randomUUID(),
      slug,
      ...input,
      status: approved ? "approved" : "proposed",
      scope: checked.scope,
      change_order: null,
      created_by: actorName(actor),
      created_at: at,
      decided_by: approved ? "OHI" : null,
      decided_at: approved ? at : null,
      scope_decided_by: null,
      scope_decided_at: null,
    },
  ]);
  const type = checked.scope === "review" ? "scope_review" : approved ? "entry_added" : "entry_proposed";
  await recordEvents(slug, actor, [{ type, ref: entry.id, data: { type: input.type, cost_code: input.cost_code, amount: input.amount } }]);
  return entry;
}

/** Approves or rejects a proposed entry. An entry outside the approved scope cannot be approved until OHI releases it. */
export async function decideEntry(slug: string, id: string, approve: boolean, actor: Actor): Promise<Checked<{ ok: true }>> {
  const [current] = await select<CostEntry>("cost_entries", { slug, id, status: "proposed" });
  if (!current) return { error: "nothing waiting by that id" };
  if (approve && current.scope !== "in_scope") return { error: "this is not in the approved estimate; decide its scope first" };
  const [entry] = await update<CostEntry>(
    "cost_entries",
    { slug, id, status: "proposed" },
    { status: approve ? "approved" : "rejected", decided_by: actorName(actor), decided_at: now() },
  );
  if (!entry) return { error: "nothing waiting by that id" };
  await recordEvents(slug, actor, [{ type: approve ? "entry_approved" : "entry_rejected", ref: id }]);
  return { ok: true };
}

const methods: TradeMethod[] = ["crew", "sub", "supplier_crew"];

/** How a section is bought, OHI's cost to complete, and a note. Only fields present in `body` change. */
export async function setTrade(slug: string, costCode: string, body: Record<string, unknown>, actor: Actor) {
  if (!isCostCode(costCode)) return null;
  const current = (await select<Trade>("trades", { slug, cost_code: costCode }))[0] ?? {
    slug,
    cost_code: costCode,
    method: null,
    cost_to_complete: null,
    note: null,
  };
  const next = { ...current };
  if ("method" in body) next.method = methods.find((m) => m === body.method) ?? null;
  if ("cost_to_complete" in body) next.cost_to_complete = body.cost_to_complete === null ? null : money(body.cost_to_complete);
  if ("note" in body) next.note = text(body.note, 1000);
  const trade = await upsert("trades", next, ["slug", "cost_code"]);
  await recordEvents(slug, actor, [{ type: "trade_set", ref: costCode, data: { method: trade.method, cost_to_complete: trade.cost_to_complete } }]);
  return trade;
}

export async function setSettings(slug: string, body: Record<string, unknown>, actor: Actor) {
  const next = { ...(await jobSettings(slug)) };
  if (typeof body.manual === "boolean") next.manual = body.manual;
  const floor = quantity(body.margin_floor);
  if (floor !== null && floor >= 0 && floor < 1) next.margin_floor = floor;
  const op = money(body.overhead_profit);
  if (op !== null && op >= 0) next.overhead_profit = op;
  const settings = await upsert("job_settings", next, ["slug"]);
  await recordEvents(slug, actor, [{ type: "settings_set", data: { ...settings } }]);
  return settings;
}

export type NoteInput = Pick<Note, "body" | "flag" | "record_type" | "record_id" | "notify">;

export function readNote(body: Record<string, unknown>): Checked<NoteInput> {
  const noteBody = text(body.body, 2000);
  if (!noteBody) return { error: "body is required" };
  if (body.flag != null && !noteFlags.includes(body.flag as NoteFlag)) return { error: `flag must be one of ${noteFlags.join(", ")}` };
  return {
    body: noteBody,
    flag: (body.flag as NoteFlag | undefined) ?? null,
    record_type: text(body.record_type, 40),
    record_id: text(body.record_id, 80),
    notify: body.notify === true,
  };
}

/** Adds a note; a note marked notify is emailed to OHI with a link to the job's costing. */
export async function addNote(slug: string, actor: Actor, input: NoteInput, origin: string, project: string) {
  const [note] = await insert<Note>("notes", [
    { id: crypto.randomUUID(), slug, ...input, created_by: actorName(actor), created_at: now(), resolved_at: null },
  ]);
  await recordEvents(slug, actor, [{ type: "note", ref: note.id, data: { flag: note.flag, record_type: note.record_type, record_id: note.record_id } }]);
  if (note.notify) {
    const about = note.record_type === "trade" && note.record_id ? ` on ${costCodeName(note.record_id)}` : "";
    await notifyOhi({ project, what: `${actorName(actor)}${about}: ${note.body}`, link: `${origin}/p/${slug}/edit#costing` }).catch((e) =>
      console.error(e),
    );
  }
  return note;
}

export async function resolveNote(slug: string, id: string, actor: Actor) {
  const [note] = await update<Note>("notes", { slug, id, resolved_at: null }, { resolved_at: now() });
  if (!note) return false;
  await recordEvents(slug, actor, [{ type: "note_resolved", ref: id }]);
  return true;
}
