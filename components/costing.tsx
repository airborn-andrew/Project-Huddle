"use client";

import { useCallback, useEffect, useState } from "react";
import { costCodeName, costCodes } from "@/lib/cost-codes";
import { noteFlags, type TradeMethod, type TradeSummary } from "@/lib/costing";
import type { CostingView } from "@/lib/job-view";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const pct = (v: number | null) => (v === null ? "–" : `${Math.round(v * 1000) / 10}%`);
const when = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const methodLabel: Record<TradeMethod, string> = { crew: "Own crew", sub: "Sub", supplier_crew: "Supplier + own crew" };
const entryLabel = { budget_change: "Supplement or change", commitment: "Commitment", actual: "Actual cost" } as const;
const flagLabel: Record<(typeof noteFlags)[number], string> = {
  opportunity: "Opportunity",
  rebid: "Re-bid",
  check_supplier: "Check supplier",
  quote_requested: "Quote requested",
  risk: "Risk",
};

type Post = (action: string, body?: Record<string, unknown>) => Promise<boolean>;

/**
 * OHI's job costing for the project: the margin by section against the
 * insurance money, the approval queue for what bots propose, notes and flags,
 * and the job's tasks. Nothing here reaches the homeowner.
 */
export function Costing({ slug }: { slug: string }) {
  const [view, setView] = useState<CostingView | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/p/${slug}/costing`, { cache: "no-store" });
    if (res.ok) setView(await res.json());
    else setError("Job costing could not load.");
  }, [slug]);

  useEffect(() => {
    load();
  }, [load]);

  const post: Post = async (action, body = {}) => {
    const res = await fetch(`/api/p/${slug}/costing`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...body }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "That change did not go through.");
      return false;
    }
    setError("");
    setView(data);
    return true;
  };

  if (!view) {
    return (
      <>
        <p className="label" id="costing">
          Job costing
        </p>
        <div className="group">
          <p>{error || "Loading"}</p>
        </div>
      </>
    );
  }

  const { summary, settings } = view;
  const t = summary.totals;

  return (
    <>
      <p className="label" id="costing">
        Job costing
      </p>
      {error && <p className="cost-error">{error}</p>}
      <div className="group">
        <Figure label="Insurance and O&P" value={t.revenue} />
        <Figure label="Projected cost" value={t.projected} />
        <Figure label="Margin" value={t.margin} note={pct(t.margin_pct)} warn={t.below_floor} />
        <Figure label="Committed" value={t.committed} />
        <Figure label="Spent" value={t.actual} />
      </div>

      <ScopeGate view={view} post={post} />
      <Approvals view={view} post={post} />

      <p className="label">By section</p>
      <div className="group group-list">
        {summary.trades.length === 0 && <p className="edit-item-meta">No budget yet. Import the approved estimate&apos;s components.</p>}
        {summary.trades.map((trade) => (
          <TradeRow
            key={trade.cost_code ?? "none"}
            trade={trade}
            view={view}
            open={open === (trade.cost_code ?? "none")}
            onToggle={() => setOpen(open === (trade.cost_code ?? "none") ? null : (trade.cost_code ?? "none"))}
            post={post}
          />
        ))}
      </div>

      <AddEntry post={post} />
      <Notes view={view} post={post} />
      <Tasks view={view} post={post} />

      <p className="label">Job settings</p>
      <Settings key={`${settings.margin_floor}-${settings.overhead_profit}`} settings={settings} post={post} />
    </>
  );
}

function Figure({ label, value, note, warn }: { label: string; value: number; note?: string; warn?: boolean }) {
  return (
    <div className="row-field" data-warn={warn || undefined}>
      <span>{label}</span>
      <span className="cost-figure">
        {usd.format(value)}
        {note && <span className="edit-item-meta"> · {note}</span>}
      </span>
    </div>
  );
}

function Approvals({ view, post }: { view: CostingView; post: Post }) {
  const { budgets, entries } = view.approvals;
  if (!budgets.length && !entries.length) return null;
  return (
    <>
      <p className="label">Waiting for approval</p>
      <div className="group group-list">
        {budgets.map((b) => (
          <div key={b.batch} className="edit-item">
            <div>
              <p className="edit-item-title">
                {b.source === "components" ? "Estimate components" : "Estimate bid items"} · {usd.format(b.total)}
              </p>
              <p className="edit-item-meta">
                {b.lines} lines · {b.created_by} · {when.format(new Date(b.created_at))}
              </p>
            </div>
            <Decide onDecide={(approve) => post("decideBudget", { batch: b.batch, approve })} />
          </div>
        ))}
        {entries.map((e) => (
          <div key={e.id} className="edit-item">
            <div>
              <p className="edit-item-title">
                {entryLabel[e.type]} · {costCodeName(e.cost_code)} · {usd.format(e.amount)}
              </p>
              <p className="edit-item-meta">{[e.vendor, e.description, e.reason, e.created_by].filter(Boolean).join(" · ")}</p>
            </div>
            <Decide onDecide={(approve) => post("decideEntry", { id: e.id, approve })} />
          </div>
        ))}
      </div>
    </>
  );
}

/** Entries outside the carrier-approved estimate, and where each one waits. */
function ScopeGate({ view, post }: { view: CostingView; post: Post }) {
  const { review, homeowner, supplement } = view.scope;
  if (!review.length && !homeowner.length && !supplement.length) return null;
  return (
    <>
      <p className="label">Not in the approved estimate</p>
      <div className="group group-list">
        {review.map((e) => (
          <Held key={e.id} entry={e} post={post} />
        ))}
        {supplement.map((e) => (
          <Supplement key={e.id} entry={e} post={post} />
        ))}
        {homeowner.map((e) => (
          <div key={e.id} className="edit-item">
            <div>
              <p className="edit-item-title">
                {e.description} · {usd.format(e.amount)}
              </p>
              <p className="edit-item-meta">Waiting on the homeowner&apos;s answer to the change order</p>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

type Entry = CostingView["entries"][number];

function Held({ entry, post }: { entry: Entry; post: Post }) {
  const [pricing, setPricing] = useState(false);
  const [price, setPrice] = useState(String(entry.amount));
  return (
    <div className="phase-body">
      <p className="edit-item-title">
        {entry.description} · {usd.format(entry.amount)}
      </p>
      <p className="edit-item-meta">{[entry.vendor, costCodeName(entry.cost_code), entry.created_by].filter(Boolean).join(" · ")}</p>
      {pricing ? (
        <div className="edit-inline">
          <input className="field" inputMode="decimal" aria-label="Homeowner's price" value={price} onChange={(e) => setPrice(e.target.value)} />
          <button type="button" className="button" disabled={!(Number(price) > 0)} onClick={() => post("scope", { id: entry.id, choice: "homeowner", price: Number(price) })}>
            Draft change order
          </button>
        </div>
      ) : (
        <div className="edit-actions scope-choices">
          <button type="button" className="button button-quiet" onClick={() => post("scope", { id: entry.id, choice: "discard" })}>
            Discard
          </button>
          <button type="button" className="button button-quiet" onClick={() => setPricing(true)}>
            Homeowner pays
          </button>
          <button type="button" className="button button-quiet" onClick={() => post("scope", { id: entry.id, choice: "supplement" })}>
            Supplement
          </button>
        </div>
      )}
    </div>
  );
}

function Supplement({ entry, post }: { entry: Entry; post: Post }) {
  const [amount, setAmount] = useState("");
  return (
    <div className="phase-body">
      <p className="edit-item-title">
        {entry.description} · {usd.format(entry.amount)}
      </p>
      <p className="edit-item-meta">Supplement sent; waiting on the carrier</p>
      <div className="edit-inline">
        <input className="field" inputMode="decimal" placeholder="Approved amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <button type="button" className="button" disabled={!(Number(amount) > 0)} onClick={() => post("supplement", { id: entry.id, approved: true, amount: Number(amount) })}>
          Carrier approved
        </button>
      </div>
      <div className="edit-actions">
        <button type="button" className="button button-quiet" onClick={() => post("supplement", { id: entry.id, approved: false })}>
          Denied
        </button>
      </div>
    </div>
  );
}

function Decide({ onDecide }: { onDecide: (approve: boolean) => void }) {
  return (
    <span className="edit-item-actions">
      <button type="button" className="link" onClick={() => onDecide(true)}>
        Approve
      </button>
      <button type="button" className="link" onClick={() => onDecide(false)}>
        Reject
      </button>
    </span>
  );
}

function TradeRow({
  trade,
  view,
  open,
  onToggle,
  post,
}: {
  trade: TradeSummary;
  view: CostingView;
  open: boolean;
  onToggle: () => void;
  post: Post;
}) {
  const code = trade.cost_code;
  const lines = view.lines.filter((l) => l.cost_code === code);
  const entries = view.entries.filter((e) => e.cost_code === code);
  const [toComplete, setToComplete] = useState(trade.cost_to_complete_set ? String(trade.cost_to_complete) : "");

  return (
    <div className="phase">
      <button type="button" className="phase-head" aria-expanded={open} onClick={onToggle}>
        <span className="edit-item-title">
          {trade.name}
          {code && <span className="edit-item-meta cost-code"> {code}</span>}
        </span>
        <span className="edit-item-meta" data-warn={trade.below_floor || undefined}>
          {usd.format(trade.revised)} insurance · {usd.format(trade.margin)} margin ({pct(trade.margin_pct)})
        </span>
      </button>
      {open && (
        <div className="phase-body">
          <Figure label="Insurance" value={trade.insurance} />
          {trade.changes !== 0 && <Figure label="Supplements and changes" value={trade.changes} />}
          <Figure label="Committed" value={trade.committed} />
          <Figure label="Spent" value={trade.actual} />
          <Figure label="Cost to complete" value={trade.cost_to_complete} note={trade.cost_to_complete_set ? "set by OHI" : undefined} />
          <Figure label="Projected cost" value={trade.projected} />
          <Figure label="Margin" value={trade.margin} note={pct(trade.margin_pct)} warn={trade.below_floor} />
          {trade.percent_complete !== null && (
            <div className="row-field">
              <span>Production days done</span>
              <span>{pct(trade.percent_complete)}</span>
            </div>
          )}

          {code && (
            <>
              <label className="row-field">
                <span>Bought as</span>
                <select
                  className="cost-method"
                  value={trade.method ?? ""}
                  onChange={(e) => post("trade", { cost_code: code, method: e.target.value || null })}
                >
                  <option value="">Not decided</option>
                  {(Object.keys(methodLabel) as TradeMethod[]).map((m) => (
                    <option key={m} value={m}>
                      {methodLabel[m]}
                    </option>
                  ))}
                </select>
              </label>
              <div className="edit-inline">
                <input
                  className="field"
                  inputMode="decimal"
                  placeholder="Cost to complete (blank follows commitments)"
                  value={toComplete}
                  onChange={(e) => setToComplete(e.target.value)}
                />
                <button
                  type="button"
                  className="button"
                  onClick={() => post("trade", { cost_code: code, cost_to_complete: toComplete.trim() ? Number(toComplete) : null })}
                >
                  Save
                </button>
              </div>
              <div className="edit-actions">
                <button
                  type="button"
                  className="button button-quiet"
                  onClick={() => post("note", { body: `Re-bid ${trade.name}`, flag: "rebid", record_type: "trade", record_id: code })}
                >
                  Ask a bot for quotes
                </button>
              </div>
            </>
          )}

          {entries.length > 0 && <p className="edit-sub">Supplements, commitments and costs</p>}
          {entries.map((e) => (
            <div key={e.id} className="edit-item">
              <div>
                <p className="edit-item-title">
                  {entryLabel[e.type]} · {usd.format(e.amount)}
                </p>
                <p className="edit-item-meta">{[e.vendor, e.description].filter(Boolean).join(" · ")}</p>
              </div>
            </div>
          ))}

          {lines.length > 0 && <p className="edit-sub">Estimate lines</p>}
          {lines.map((l) => (
            <div key={l.id} className="edit-item">
              <div>
                <p className="edit-item-title">
                  {l.description}
                  {l.flagged && " *"}
                </p>
                <p className="edit-item-meta">
                  {[l.xact_code, l.kind, l.quantity !== null && `${l.quantity} ${l.unit ?? ""}`.trim(), usd.format(l.amount)].filter(Boolean).join(" · ")}
                </p>
              </div>
              <select
                className="cost-move"
                aria-label="Move to section"
                value={l.cost_code ?? ""}
                onChange={(e) => post("assign", { id: l.id, cost_code: e.target.value || null })}
              >
                <option value="">Unassigned</option>
                {costCodes.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} {c.name}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AddEntry({ post }: { post: Post }) {
  const blank = { type: "commitment", cost_code: "", amount: "", vendor: "", description: "" };
  const [form, setForm] = useState(blank);
  const set = (key: keyof typeof blank) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });

  return (
    <>
      <p className="label">Add a cost</p>
      <div className="group">
        <div className="edit-inline">
          <select className="field" aria-label="Kind" value={form.type} onChange={set("type")}>
            {Object.entries(entryLabel).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select className="field" aria-label="Section" value={form.cost_code} onChange={set("cost_code")}>
            <option value="">Section</option>
            {costCodes.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="edit-inline">
          <input className="field" inputMode="decimal" placeholder="Amount" value={form.amount} onChange={set("amount")} />
          <input className="field" placeholder="Vendor" value={form.vendor} onChange={set("vendor")} />
        </div>
        <input className="field" placeholder="What it is" value={form.description} onChange={set("description")} />
        <button
          type="button"
          className="button"
          disabled={!form.cost_code || !form.description.trim() || !Number.isFinite(Number(form.amount)) || !form.amount.trim()}
          onClick={async () => {
            if (await post("entry", { ...form, amount: Number(form.amount), vendor: form.vendor || undefined })) setForm(blank);
          }}
        >
          Add
        </button>
      </div>
    </>
  );
}

function Notes({ view, post }: { view: CostingView; post: Post }) {
  const [body, setBody] = useState("");
  const [flag, setFlag] = useState("");
  const [code, setCode] = useState("");

  return (
    <>
      <p className="label">Notes and flags</p>
      <div className="group group-list">
        {view.notes.map((n) => (
          <div key={n.id} className="edit-item">
            <div>
              <p className="edit-item-title">{n.body}</p>
              <p className="edit-item-meta">
                {[
                  n.flag && flagLabel[n.flag],
                  n.record_type === "trade" && costCodeName(n.record_id),
                  n.created_by,
                  when.format(new Date(n.created_at)),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <button type="button" className="link" onClick={() => post("resolveNote", { id: n.id })}>
              Resolve
            </button>
          </div>
        ))}
        <div className="phase-body">
          <textarea className="field" placeholder="Note" value={body} onChange={(e) => setBody(e.target.value)} />
          <div className="edit-inline">
            <select className="field" aria-label="Flag" value={flag} onChange={(e) => setFlag(e.target.value)}>
              <option value="">No flag</option>
              {noteFlags.map((f) => (
                <option key={f} value={f}>
                  {flagLabel[f]}
                </option>
              ))}
            </select>
            <select className="field" aria-label="Section" value={code} onChange={(e) => setCode(e.target.value)}>
              <option value="">Whole job</option>
              {costCodes.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="button"
            disabled={!body.trim()}
            onClick={async () => {
              const about = code ? { record_type: "trade", record_id: code } : {};
              if (await post("note", { body, flag: flag || undefined, ...about })) setBody("");
            }}
          >
            Add note
          </button>
        </div>
      </div>
    </>
  );
}

const taskLabel: Record<string, string> = {
  "read-components": "Read the components report",
  "read-bid": "Read a bid",
  "request-quote": "Ask for a quote",
};

function Tasks({ view, post }: { view: CostingView; post: Post }) {
  const [type, setType] = useState("read-bid");
  const [source, setSource] = useState("");
  const held = view.tasks.filter((t) => t.status === "held");

  return (
    <>
      <p className="label">Bot tasks</p>
      <div className="group group-list">
        {view.tasks.slice(0, 12).map((t) => (
          <div key={t.id} className="edit-item">
            <div>
              <p className="edit-item-title">{taskLabel[t.type] ?? t.type}</p>
              <p className="edit-item-meta">
                {[t.status === "held" ? "Waiting for release" : t.status, t.error, t.created_by, when.format(new Date(t.created_at))]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            {t.status === "held" && (
              <button type="button" className="link" onClick={() => post("release", { id: t.id })}>
                Release
              </button>
            )}
          </div>
        ))}
        {held.length > 1 && (
          <div className="phase-body">
            <button type="button" className="button button-quiet" onClick={() => post("release")}>
              Release all {held.length}
            </button>
          </div>
        )}
        <div className="phase-body">
          <div className="edit-inline">
            <select className="field" aria-label="Task" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="read-bid">{taskLabel["read-bid"]}</option>
              <option value="read-components">{taskLabel["read-components"]}</option>
            </select>
          </div>
          <input
            className="field"
            placeholder="Where it is (Restoration Manager attachment, email, link)"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          />
          <button
            type="button"
            className="button"
            disabled={!source.trim()}
            onClick={async () => {
              if (await post("task", { type, input: { source } })) setSource("");
            }}
          >
            Give to a bot
          </button>
        </div>
      </div>
    </>
  );
}

function Settings({ settings, post }: { settings: CostingView["settings"]; post: Post }) {
  const [floor, setFloor] = useState(String(Math.round(settings.margin_floor * 100)));
  const [op, setOp] = useState(String(settings.overhead_profit));

  return (
    <div className="group">
      <label className="row-field">
        <span>Manual mode (bots wait for release)</span>
        <input type="checkbox" checked={settings.manual} onChange={(e) => post("settings", { manual: e.target.checked })} />
      </label>
      <label className="row-field">
        <span>Margin floor %</span>
        <input className="cost-input" inputMode="decimal" value={floor} onChange={(e) => setFloor(e.target.value)} />
      </label>
      <label className="row-field">
        <span>Overhead and profit $</span>
        <input className="cost-input" inputMode="decimal" value={op} onChange={(e) => setOp(e.target.value)} />
      </label>
      <button
        type="button"
        className="button"
        disabled={!Number.isFinite(Number(floor)) || !Number.isFinite(Number(op))}
        onClick={() => post("settings", { margin_floor: Number(floor) / 100, overhead_profit: Number(op) })}
      >
        Save
      </button>
    </div>
  );
}
