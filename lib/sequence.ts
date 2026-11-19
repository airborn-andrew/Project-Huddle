import { templateById } from "@/lib/templates";
import type { Editable, Phase, PhaseEdit, Room, ScheduledTask } from "@/lib/types";

/** Days the crew is off besides weekends. OHI adds more per project. */
export const holidays = new Set(["2026-11-26", "2026-11-27", "2026-12-24", "2026-12-25", "2027-01-01"]);

/** A project's working calendar: the start date and its extra off days. */
export type Calendar = { start: string; off: string[] };

export const calendarOf = (s: Pick<Editable, "startDate" | "offDays">): Calendar => ({ start: s.startDate, off: s.offDays });

/** The project's production days laid end to end in trade order, from day 0. */
export function defaultSchedule(phases: Phase[]): PhaseEdit[] {
  let start = 0;
  return phases.filter((p) => templateById(p.template)).map((p) => {
    const days = templateById(p.template)?.days ?? 1;
    const phase = { id: p.template, template: p.template, rooms: p.rooms, start, days, done: false };
    start += days;
    return phase;
  });
}

/**
 * The schedule in force: OHI's edits, or the project's production days laid end
 * to end. A day whose template has been retired is left out.
 */
export const scheduleOf = (s: Pick<Editable, "schedule">, phases: Phase[]) =>
  s.schedule ? s.schedule.filter((p) => templateById(p.template)) : defaultSchedule(phases);

/** One task per room per production phase, placed on its workdays. */
export function expand(schedule: PhaseEdit[], rooms: Room[]): ScheduledTask[] {
  const tasks: ScheduledTask[] = [];
  for (const phase of schedule) {
    const template = templateById(phase.template);
    if (!template) continue;
    const covered = rooms.filter((r) => r.id in phase.rooms);
    const title = template.title(covered);
    for (const room of covered) {
      tasks.push({
        id: `${phase.id}-${room.id}`,
        phase: phase.id,
        room: room.id,
        step: template.id,
        title,
        categories: phase.rooms[room.id],
        day: phase.start,
        days: phase.days,
        done: phase.done,
      });
    }
  }
  return tasks;
}

export const phaseTitle = (phase: PhaseEdit, rooms: Room[]) =>
  templateById(phase.template)?.title(rooms.filter((r) => r.id in phase.rooms)) ?? phase.template;

export function parseDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function isWorkday(date: Date, off: string[]) {
  const dow = date.getUTCDay();
  const iso = isoDate(date);
  return dow !== 0 && dow !== 6 && !holidays.has(iso) && !off.includes(iso);
}

/** Calendar date of a workday index counted from the start date. */
export function workdayDate(cal: Calendar, index: number) {
  const date = parseDate(cal.start);
  while (!isWorkday(date, cal.off)) date.setUTCDate(date.getUTCDate() + 1);
  for (let i = 0; i < index; ) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (isWorkday(date, cal.off)) i++;
  }
  return date;
}

/** Workday index for a calendar date, clamped to the schedule. */
export function workdayIndex(cal: Calendar, date: Date, last: number) {
  for (let i = 0; i <= last; i++) {
    if (workdayDate(cal, i).getTime() >= date.getTime()) return i;
  }
  return last;
}

export function lastDay(tasks: { day: number; days: number }[]) {
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
