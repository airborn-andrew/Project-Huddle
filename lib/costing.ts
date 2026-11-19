import { costCodeName, costCodes, templateCostCode } from "@/lib/cost-codes";
import type { PhaseEdit } from "@/lib/types";

/** Rows of the job costing tables, as stored. Money is in dollars with cents. */
export type BudgetLine = {
  id: string;
  slug: string;
  batch: string;
  source: "components" | "bid_item" | "manual";
  kind: "material" | "labor" | "equipment" | "other";
  xact_code: string | null;
  description: string;
  quantity: number | null;
  unit: string | null;
  unit_price: number | null;
  amount: number;
  cost_code: string | null;
  flagged: boolean;
  status: "proposed" | "approved" | "superseded" | "rejected";
  created_by: string;
  created_at: string;
};

export type EntryType = "budget_change" | "commitment" | "actual";

export type CostEntry = {
  id: string;
  slug: string;
  type: EntryType;
  cost_code: string | null;
  amount: number;
  vendor: string | null;
  description: string;
  source: string | null;
  reason: string | null;
  status: "proposed" | "approved" | "rejected";
  created_by: string;
  created_at: string;
  decided_by: string | null;
  decided_at: string | null;
};

export type TradeMethod = "crew" | "sub" | "supplier_crew";

export type Trade = {
  slug: string;
  cost_code: string;
  method: TradeMethod | null;
  cost_to_complete: number | null;
  note: string | null;
};

export const noteFlags = ["opportunity", "rebid", "check_supplier", "quote_requested", "risk"] as const;
export type NoteFlag = (typeof noteFlags)[number];

export type JobSettings = { slug: string; manual: boolean; margin_floor: number; overhead_profit: number };

export const defaultSettings = (slug: string): JobSettings => ({ slug, manual: false, margin_floor: 0.3, overhead_profit: 0 });

/** One section of the job: the insurance money on it, what OHI has spent and will spend, and the margin left. */
export type TradeSummary = {
  cost_code: string | null;
  name: string;
  method: TradeMethod | null;
  /** The approved estimate's components and bid items in this section. */
  insurance: number;
  /** Approved supplements and changes. */
  changes: number;
  revised: number;
  committed: number;
  actual: number;
  cost_to_complete: number;
  /** True when OHI set the cost to complete instead of it following the commitments. */
  cost_to_complete_set: boolean;
  projected: number;
  margin: number;
  margin_pct: number | null;
  /** Share of the section's production days marked done; null when no day covers it. */
  percent_complete: number | null;
  below_floor: boolean;
};

export type JobSummary = {
  trades: TradeSummary[];
  totals: {
    insurance: number;
    changes: number;
    revised: number;
    overhead_profit: number;
    /** Revised insurance money plus overhead and profit. */
    revenue: number;
    committed: number;
    actual: number;
    projected: number;
    margin: number;
    margin_pct: number | null;
    below_floor: boolean;
  };
};

const cents = (dollars: number) => Math.round(dollars * 100);
const dollars = (c: number) => c / 100;

/**
 * Every number on the job cost report, from approved rows only. Sums run in
 * whole cents so totals never drift.
 *
 * Per section: revised = insurance + changes. Cost to complete is OHI's figure
 * when set; otherwise the commitments not yet paid, or, with nothing
 * committed, the revised insurance money not yet spent. Projected = actual +
 * cost to complete, and margin = revised - projected.
 */
export function summarize({
  lines,
  entries,
  trades,
  settings,
  schedule,
}: {
  lines: BudgetLine[];
  entries: CostEntry[];
  trades: Trade[];
  settings: JobSettings;
  schedule: PhaseEdit[];
}): JobSummary {
  const approvedLines = lines.filter((l) => l.status === "approved");
  const approvedEntries = entries.filter((e) => e.status === "approved");
  const sections = new Set<string | null>([
    ...approvedLines.map((l) => l.cost_code),
    ...approvedEntries.map((e) => e.cost_code),
    ...trades.map((t) => t.cost_code),
  ]);
  const order = (code: string | null) => (code === null ? Infinity : costCodes.findIndex((c) => c.code === code));
  const sum = (rows: { amount: number }[]) => rows.reduce((s, r) => s + cents(r.amount), 0);

  const rows = [...sections]
    .sort((a, b) => order(a) - order(b))
    .map((code) => {
      const trade = trades.find((t) => t.cost_code === code);
      const of = (type: EntryType) => approvedEntries.filter((e) => e.type === type && e.cost_code === code);
      const insurance = sum(approvedLines.filter((l) => l.cost_code === code));
      const changes = sum(of("budget_change"));
      const revised = insurance + changes;
      const committed = sum(of("commitment"));
      const actual = sum(of("actual"));
      const set = trade?.cost_to_complete != null;
      const toComplete = set
        ? cents(trade!.cost_to_complete!)
        : committed > 0
          ? Math.max(committed - actual, 0)
          : Math.max(revised - actual, 0);
      const projected = actual + toComplete;
      const margin = revised - projected;
      const marginPct = revised ? margin / revised : null;
      return {
        cost_code: code,
        name: costCodeName(code),
        method: trade?.method ?? null,
        insurance: dollars(insurance),
        changes: dollars(changes),
        revised: dollars(revised),
        committed: dollars(committed),
        actual: dollars(actual),
        cost_to_complete: dollars(toComplete),
        cost_to_complete_set: set,
        projected: dollars(projected),
        margin: dollars(margin),
        margin_pct: marginPct,
        percent_complete: percentComplete(code, schedule),
        // Only a section with real costs behind it can fall below the floor; costs with no insurance money behind them always do.
        below_floor: (committed > 0 || actual > 0 || set) && (marginPct === null ? margin < 0 : marginPct < settings.margin_floor),
      };
    });

  const total = (key: "insurance" | "changes" | "revised" | "committed" | "actual" | "projected") =>
    rows.reduce((s, r) => s + cents(r[key]), 0);
  const revised = total("revised");
  const overheadProfit = cents(settings.overhead_profit);
  const revenue = revised + overheadProfit;
  const projected = total("projected");
  const margin = revenue - projected;
  const marginPct = revenue ? margin / revenue : null;

  return {
    trades: rows,
    totals: {
      insurance: dollars(total("insurance")),
      changes: dollars(total("changes")),
      revised: dollars(revised),
      overhead_profit: dollars(overheadProfit),
      revenue: dollars(revenue),
      committed: dollars(total("committed")),
      actual: dollars(total("actual")),
      projected: dollars(projected),
      margin: dollars(margin),
      margin_pct: marginPct,
      below_floor: rows.some((r) => r.committed > 0 || r.actual > 0) && marginPct !== null && marginPct < settings.margin_floor,
    },
  };
}

/** Done days over all days of the production phases that work in a section. */
function percentComplete(code: string | null, schedule: PhaseEdit[]) {
  const phases = schedule.filter((p) => code !== null && templateCostCode[p.template] === code);
  const days = phases.reduce((s, p) => s + p.days, 0);
  if (!days) return null;
  return phases.filter((p) => p.done).reduce((s, p) => s + p.days, 0) / days;
}
