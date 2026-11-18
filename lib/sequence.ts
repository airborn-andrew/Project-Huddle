import { templateById, templates } from "@/lib/templates";
import type { Phase, ProjectState, Room, ScheduledTask, Task } from "@/lib/types";

/** Trade order and default length in workdays, from the day templates. */
export const steps = templates.map((t) => ({ id: t.id, days: t.days }));

/** Days the crew is off besides weekends. */
export const holidays = new Set(["2026-11-26", "2026-11-27", "2026-12-24", "2026-12-25", "2027-01-01"]);

/** One task per room per production phase, titled by the phase's template. */
export function buildTasks(phases: Phase[], rooms: Room[]): Task[] {
  const tasks: Task[] = [];
  for (const phase of phases) {
    const template = templateById(phase.template);
    if (!template) continue;
    const covered = rooms.filter((r) => r.id in phase.rooms);
    const title = template.title(covered);
    for (const room of covered) {
      tasks.push({
        id: `${template.id}-${room.id}`,
        room: room.id,
        step: template.id,
        title,
        categories: phase.rooms[room.id],
      });
    }
  }
  return tasks;
}

export function parseDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function isWorkday(date: Date) {
  const dow = date.getUTCDay();
  return dow !== 0 && dow !== 6 && !holidays.has(isoDate(date));
}

/** Calendar date of a workday index counted from the start date. */
export function workdayDate(startDate: string, index: number) {
  const date = parseDate(startDate);
  while (!isWorkday(date)) date.setUTCDate(date.getUTCDate() + 1);
  for (let i = 0; i < index; ) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (isWorkday(date)) i++;
  }
  return date;
}

/** Workday index for a calendar date, clamped to the schedule. */
export function workdayIndex(startDate: string, date: Date, last: number) {
  for (let i = 0; i <= last; i++) {
    if (workdayDate(startDate, i).getTime() >= date.getTime()) return i;
  }
  return last;
}

/** Places every task on a workday: trade order first, then OHI's changes. */
export function schedule(tasks: Task[], state: ProjectState): ScheduledTask[] {
  const startOf: Record<string, number> = {};
  const lengthOf: Record<string, number> = {};
  let day = 0;
  for (const step of steps) {
    if (!tasks.some((t) => t.step === step.id)) continue;
    startOf[step.id] = day;
    lengthOf[step.id] = step.days;
    day += step.days;
  }
  return tasks.map((t) => {
    const o = state.overrides[t.id] ?? {};
    return {
      ...t,
      day: o.day ?? startOf[t.step] ?? 0,
      days: lengthOf[t.step] ?? 1,
      done: o.done ?? false,
    };
  });
}

export function lastDay(tasks: ScheduledTask[]) {
  return tasks.reduce((max, t) => Math.max(max, t.day + t.days - 1), 0);
}

export const dayFormat = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

export const longDayFormat = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});
