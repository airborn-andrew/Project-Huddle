import type { Project } from "@/lib/projects";
import { calendarOf, dayFormat, isoDate, lastDay, phaseTitle, scheduleOf, workdayDate } from "@/lib/sequence";
import type { ProjectState } from "@/lib/types";

/**
 * One line on where a project stands for OHI's project list, read from OHI's
 * working copy (the draft when there is one), and whether the homeowner has
 * posted anything OHI has not opened yet.
 */
export function summarize(project: Project, state: ProjectState, today = isoDate(new Date())) {
  const working = state.draft ?? state;
  const cal = calendarOf(working);
  const schedule = [...scheduleOf(working, project.phases)].sort((a, b) => a.start - b.start);
  const last = lastDay(schedule.map((p) => ({ day: p.start, days: p.days })));
  const date = (i: number) => isoDate(workdayDate(cal, i));
  const label = (i: number) => dayFormat.format(workdayDate(cal, i));

  let where: string;
  if (!schedule.length) where = "No production days";
  else if (today < date(0)) where = `Starts ${label(0)}`;
  else if (today > date(last)) where = `Finished ${label(last)}`;
  else {
    let day = 0;
    while (day < last && date(day) < today) day++;
    const phase = schedule.find((p) => day >= p.start && day < p.start + p.days) ?? schedule[0];
    where = `Day ${day + 1} of ${last + 1}: ${phaseTitle(phase, project.plan.rooms)}`;
  }

  const seen = state.ohiSeen ?? "";
  const fresh =
    state.messages.some((m) => m.from === "home" && m.at > seen) ||
    state.changeOrders.some((c) => c.answer && c.answer.at > seen);

  return { where, fresh };
}
