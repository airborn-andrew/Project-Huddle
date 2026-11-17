import type { Category, ProjectState, ScheduledTask, Task } from "@/lib/types";

/** Trade order and default length in workdays. The schedule is drafted from this. */
export const steps: { id: string; name: string; days: number }[] = [
  { id: "insulation", name: "Crawlspace insulation", days: 1 },
  { id: "tearout", name: "Tear-out", days: 1 },
  { id: "cabinets", name: "Cabinet rebuild", days: 2 },
  { id: "paint", name: "Wall paint", days: 2 },
  { id: "flooring", name: "Flooring", days: 3 },
  { id: "reset", name: "Cabinets, fixtures and appliances reset", days: 1 },
  { id: "doors", name: "Doors", days: 1 },
  { id: "baseboard", name: "Baseboard", days: 1 },
  { id: "trim", name: "Trim and door paint", days: 1 },
  { id: "clean", name: "Final clean", days: 1 },
];

/** Days the crew is off besides weekends. */
export const holidays = new Set(["2026-11-26", "2026-11-27", "2026-12-24", "2026-12-25", "2027-01-01"]);

/** What the homeowner reads in a room card for each kind of work. */
export const categoryCopy: Record<Category, { what: string; expect: string }> = {
  Insulation: {
    what: "New insulation goes up under the floor, with a vapor barrier over the ground.",
    expect: "The crew works from the crawlspace hatch. Nothing inside the house needs to move.",
  },
  Cabinets: {
    what: "Cabinet work in the kitchen.",
    expect: "Counters and cabinets need to be empty.",
  },
  Appliances: {
    what: "Appliances are moved so the floor and cabinets can be worked on.",
    expect: "Plan meals around a kitchen without a range or refrigerator for these days.",
  },
  Fixtures: {
    what: "Plumbing fixtures are taken out or put back.",
    expect: "The temporary toilet outside stays available the whole time.",
  },
  Paint: {
    what: "Painting in this room.",
    expect: "Keep the room clear and ventilated. Paint is dry to the touch the same day.",
  },
  Flooring: {
    what: "New plank flooring goes down.",
    expect: "The room needs to be empty, including closets and anything under beds.",
  },
  Doors: {
    what: "Doors are hung and adjusted.",
    expect: "The doorway is open for part of the day.",
  },
  Baseboard: {
    what: "Baseboard and trim are installed along the floor.",
    expect: "Keep furniture a couple of feet off the walls.",
  },
  Clean: {
    what: "A final clean of the house.",
    expect: "Your walkthrough with OHI follows.",
  },
};

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
