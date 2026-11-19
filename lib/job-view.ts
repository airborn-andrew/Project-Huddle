import { costCodeName } from "@/lib/cost-codes";
import { summarize, type BudgetLine } from "@/lib/costing";
import { loadJob } from "@/lib/ledger";
import { getProject } from "@/lib/projects";
import { calendarOf, isoDate, phaseTitle, scheduleOf, workdayDate } from "@/lib/sequence";
import { readState } from "@/lib/state";
import { listTasks } from "@/lib/tasks";

/** A proposed budget import, as one item in the approval queue. */
export type PendingBatch = { batch: string; source: BudgetLine["source"]; lines: number; total: number; created_by: string; created_at: string };

/**
 * Everything about a job's costing in one read: the numbers by section, the
 * approval queue, open notes and flags, and the job's tasks. OHI's costing view
 * and the bots' job context both read it.
 */
export async function costingView(slug: string) {
  const project = await getProject(slug);
  if (!project) return null;
  const state = await readState(slug);
  const working = state.draft ?? state;
  const schedule = scheduleOf(working, project.phases);
  const [{ lines, entries, trades, settings, notes }, tasks] = await Promise.all([loadJob(slug), listTasks(slug)]);

  const pending = new Map<string, PendingBatch>();
  for (const l of lines.filter((x) => x.status === "proposed")) {
    const b = pending.get(l.batch) ?? { batch: l.batch, source: l.source, lines: 0, total: 0, created_by: l.created_by, created_at: l.created_at };
    b.lines += 1;
    b.total = Math.round((b.total + l.amount) * 100) / 100;
    pending.set(l.batch, b);
  }

  return {
    project: { slug, name: project.name, status: project.status },
    settings,
    summary: summarize({ lines, entries, trades, settings, schedule }),
    lines: lines.filter((l) => l.status === "approved"),
    approvals: {
      budgets: [...pending.values()],
      entries: entries.filter((e) => e.status === "proposed" && e.scope === "in_scope"),
    },
    /** Entries outside the approved estimate, by where they wait: OHI's decision, the homeowner's answer, or the carrier. */
    scope: {
      review: entries.filter((e) => e.scope === "review"),
      homeowner: entries.filter((e) => e.scope === "homeowner"),
      supplement: entries.filter((e) => e.scope === "supplement"),
    },
    entries: entries.filter((e) => e.status === "approved"),
    trades,
    notes: notes.filter((n) => !n.resolved_at),
    tasks,
    schedule: [...schedule]
      .sort((a, b) => a.start - b.start)
      .map((p) => ({
        id: p.id,
        title: phaseTitle(p, project.plan.rooms),
        template: p.template,
        start: isoDate(workdayDate(calendarOf(working), p.start)),
        days: p.days,
        done: p.done,
      })),
  };
}

export type CostingView = NonNullable<Awaited<ReturnType<typeof costingView>>>;

/**
 * The job as a bot needs it to decide its next step, kept small: no budget
 * line detail and no finished tasks. A bot reads the rest through the changes feed.
 */
export async function jobContext(slug: string) {
  const view = await costingView(slug);
  if (!view) return null;
  return {
    project: view.project,
    settings: view.settings,
    schedule: view.schedule,
    trades: view.summary.trades,
    totals: view.summary.totals,
    approvals: {
      budgets: view.approvals.budgets,
      entries: view.approvals.entries.map((e) => ({
        id: e.id,
        type: e.type,
        cost_code: e.cost_code,
        trade: costCodeName(e.cost_code),
        amount: e.amount,
        vendor: e.vendor,
        description: e.description,
        created_by: e.created_by,
      })),
    },
    scope: {
      review: view.scope.review.map((e) => ({ id: e.id, cost_code: e.cost_code, amount: e.amount, vendor: e.vendor, description: e.description })),
      homeowner: view.scope.homeowner.map((e) => ({ id: e.id, change_order: e.change_order, description: e.description })),
      supplement: view.scope.supplement.map((e) => ({ id: e.id, cost_code: e.cost_code, amount: e.amount, description: e.description })),
    },
    notes: view.notes,
    tasks: view.tasks.filter((t) => t.status !== "done" && t.status !== "failed"),
  };
}
