import { actorName, addNote, money, recordEvents, text, type Actor, type Checked } from "@/lib/ledger";
import type { CostEntry } from "@/lib/costing";
import { editable, updateState } from "@/lib/state";
import { insert, select, update } from "@/lib/tables";

/**
 * OHI's decisions on entries that are not in the carrier-approved estimate.
 * Nothing outside the approved scope counts toward the job, or reaches the
 * homeowner, until OHI decides here: discard it, ask the homeowner to pay for
 * it with a priced change order, or send it to the carrier as a supplement.
 */
export type ScopeChoice = "discard" | "homeowner" | "supplement";

const now = () => new Date().toISOString();
const UNDO_LIMIT = 20;
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

async function held(slug: string, id: string, scope: CostEntry["scope"]) {
  const [entry] = await select<CostEntry>("cost_entries", { slug, id, scope, status: "proposed" });
  return entry ?? null;
}

const decided = (actor: Actor) => ({ scope_decided_by: actorName(actor), scope_decided_at: now() });

/** The money a released entry brings in: the homeowner's price or the carrier's approved supplement. */
async function addRevenue(entry: CostEntry, amount: number, reason: string, actor: Actor) {
  const at = now();
  await insert<CostEntry>("cost_entries", [
    {
      id: crypto.randomUUID(),
      slug: entry.slug,
      type: "budget_change",
      cost_code: entry.cost_code,
      amount,
      vendor: null,
      description: entry.description,
      source: entry.source,
      reason,
      covers: [],
      status: "approved",
      scope: "in_scope",
      change_order: entry.change_order,
      created_by: actorName(actor),
      created_at: at,
      decided_by: actorName(actor),
      decided_at: at,
      scope_decided_by: actorName(actor),
      scope_decided_at: at,
    },
  ]);
}

export async function decideScope(
  slug: string,
  id: string,
  choice: unknown,
  body: Record<string, unknown>,
  actor: Actor,
): Promise<Checked<{ ok: true }>> {
  const entry = await held(slug, id, "review");
  if (!entry) return { error: "nothing waiting for a scope decision by that id" };

  if (choice === "discard") {
    await update("cost_entries", { slug, id, scope: "review" }, { scope: "discarded", status: "rejected", ...decided(actor) });
  } else if (choice === "supplement") {
    await update("cost_entries", { slug, id, scope: "review" }, { scope: "supplement", ...decided(actor) });
  } else if (choice === "homeowner") {
    const price = money(body.price);
    if (price === null || price <= 0) return { error: "the homeowner's price is required" };
    const title = text(body.title, 120) ?? entry.description.slice(0, 120);
    const co = { id: crypto.randomUUID().slice(0, 8), title, body: text(body.body) ?? "", photos: [], createdAt: now(), price };
    // The change order lands in OHI's draft like any other edit; the homeowner sees it once OHI pushes.
    await updateState(slug, (s) => {
      const draft = s.draft ?? editable(s);
      s.undo = [structuredClone(draft), ...s.undo].slice(0, UNDO_LIMIT);
      draft.changeOrders.push(co);
      s.draft = draft;
      s.log.unshift({ at: now(), text: `Created change order “${title}” for the homeowner to pay ${usd.format(price)}` });
    });
    await update("cost_entries", { slug, id, scope: "review" }, { scope: "homeowner", change_order: co.id, ...decided(actor) });
  } else {
    return { error: "choice must be discard, homeowner or supplement" };
  }
  await recordEvents(slug, actor, [{ type: "scope_decided", ref: id, data: { choice } }]);
  return { ok: true };
}

/** The carrier's answer on a supplement: approved for an amount, which joins the insurance money, or denied. */
export async function resolveSupplement(slug: string, id: string, body: Record<string, unknown>, actor: Actor): Promise<Checked<{ ok: true }>> {
  const entry = await held(slug, id, "supplement");
  if (!entry) return { error: "no supplement waiting by that id" };
  if (body.approved === true) {
    const amount = money(body.amount);
    if (amount === null || amount <= 0) return { error: "the carrier's approved amount is required" };
    await update("cost_entries", { slug, id, scope: "supplement" }, { scope: "in_scope", ...decided(actor) });
    await addRevenue(entry, amount, "Supplement approved by the carrier", actor);
  } else {
    await update("cost_entries", { slug, id, scope: "supplement" }, { scope: "discarded", status: "rejected", ...decided(actor) });
  }
  await recordEvents(slug, actor, [{ type: body.approved === true ? "supplement_approved" : "supplement_denied", ref: id }]);
  return { ok: true };
}

/**
 * The homeowner's answer on a priced change order. Yes releases the entry into
 * scope and adds the price to the job's money; no discards it; something else
 * leaves it waiting with a note for OHI.
 */
export async function onChangeOrderAnswer(slug: string, coId: string, choice: "yes" | "no" | "other", price: number | undefined, origin: string, project: string) {
  const entries = await select<CostEntry>("cost_entries", { slug, change_order: coId, scope: "homeowner" });
  const homeowner: Actor = { kind: "homeowner" };
  for (const entry of entries) {
    if (choice === "yes") {
      await update("cost_entries", { slug, id: entry.id, scope: "homeowner" }, { scope: "in_scope", ...decided(homeowner) });
      if (price) await addRevenue(entry, price, "Homeowner-paid change order", homeowner);
    } else if (choice === "no") {
      await update(
        "cost_entries",
        { slug, id: entry.id, scope: "homeowner" },
        { scope: "discarded", status: "rejected", ...decided(homeowner) },
      );
    } else {
      await addNote(
        slug,
        homeowner,
        { body: `The homeowner answered something else on “${entry.description}”`, flag: "risk", record_type: "entry", record_id: entry.id, notify: false },
        origin,
        project,
      );
    }
    await recordEvents(slug, homeowner, [{ type: "homeowner_scope", ref: entry.id, data: { choice } }]);
  }
}

/** A withdrawn change order puts its entries back in front of OHI. */
export async function onChangeOrderWithdrawn(slug: string, coId: string) {
  const entries = await update<CostEntry>("cost_entries", { slug, change_order: coId, scope: "homeowner" }, { scope: "review", change_order: null });
  if (entries.length) await recordEvents(slug, { kind: "ohi" }, entries.map((e) => ({ type: "scope_review", ref: e.id })));
}
