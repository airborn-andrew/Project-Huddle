import { after, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { cookieName, readToken } from "@/lib/access";
import { notifyOhi } from "@/lib/notify";
import { projectConfig, projectData } from "@/lib/projects";
import { calendarOf, dayFormat, defaultSchedule, phaseTitle, workdayDate } from "@/lib/sequence";
import { editable, forRole, readState, updateState } from "@/lib/state";
import { templateById } from "@/lib/templates";
import type { Category, Editable, Phase, Photo, Plan, ProjectState, Role } from "@/lib/types";

type Params = { params: Promise<{ slug: string }> };

async function roleFor(slug: string): Promise<Role | null> {
  return readToken(slug, (await cookies()).get(cookieName(slug))?.value);
}

export async function GET(_: Request, { params }: Params) {
  const { slug } = await params;
  const role = await roleFor(slug);
  if (!role) return NextResponse.json({ error: "locked" }, { status: 401 });
  return NextResponse.json(forRole(await readState(slug), role));
}

const id = () => crypto.randomUUID().slice(0, 8);
const now = () => new Date().toISOString();
const text = (v: unknown, max = 2000) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const count = (v: unknown, min: number, max: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : null;
const photos = (v: unknown): Photo[] =>
  Array.isArray(v)
    ? v
        .filter((p): p is Photo => typeof p?.url === "string")
        .slice(0, 6)
        .map((p) => ({ url: p.url, width: Number(p.width) || 0, height: Number(p.height) || 0 }))
    : [];

type Body = Record<string, unknown> & { action?: string };
type Ctx = { plan: Plan; phases: Phase[]; log: (text: string) => void };

/** Changes anyone in the project can make. They go live at once. */
const shared: Record<string, (s: ProjectState, b: Body, role: Role) => void> = {
  message(s, b, role) {
    const body = text(b.body);
    const pics = photos(b.photos);
    if (!body && !pics.length) return;
    s.messages.push({ id: id(), from: role, body, photos: pics, room: text(b.room, 40) || undefined, at: now() });
  },
};

/** Changes only the homeowner makes. They go live at once. */
const home: Record<string, (s: ProjectState, b: Body) => void> = {
  answer(s, b) {
    const choice = b.choice;
    if (choice !== "yes" && choice !== "no" && choice !== "other") return;
    const answer = { choice, note: text(b.note) || undefined, photos: photos(b.photos), at: now() } as const;
    const co = s.changeOrders.find((c) => c.id === b.id);
    if (!co || co.answer) return;
    co.answer = answer;
    // Keep OHI's draft in step so pushing it never drops the answer.
    const drafted = s.draft?.changeOrders.find((c) => c.id === b.id);
    if (drafted) drafted.answer = answer;
  },
};

/**
 * Changes only OHI makes. Each one edits OHI's draft and adds a line to the
 * change log; Push publishes the draft to the homeowner.
 */
const ohi: Record<string, (d: Editable, b: Body, c: Ctx) => void> = {
  start(d, b, c) {
    if (!isDate(b.startDate)) return;
    d.startDate = b.startDate;
    c.log(`Start date set to ${dayFormat.format(workdayDate(calendarOf(d), 0))}`);
  },
  phase(d, b, c) {
    const schedule = (d.schedule ??= defaultSchedule(c.phases));
    const phase = schedule.find((p) => p.id === b.id);
    if (!phase) return;
    const title = phaseTitle(phase, c.plan.rooms);
    const start = count(b.start, 0, 400);
    if (start !== null && start !== phase.start) {
      phase.start = start;
      c.log(`Moved ${title} to ${dayFormat.format(workdayDate(calendarOf(d), start))}`);
    }
    const days = count(b.days, 1, 60);
    if (days !== null && days !== phase.days) {
      // Days that came after this one move with it, so nothing overlaps.
      const end = phase.start + phase.days;
      for (const later of schedule) if (later !== phase && later.start >= end) later.start += days - phase.days;
      phase.days = days;
      c.log(`${title} is now ${days} ${days === 1 ? "day" : "days"}; later days moved to match`);
    }
    if (typeof b.done === "boolean" && b.done !== phase.done) {
      phase.done = b.done;
      c.log(`${title} marked ${b.done ? "done" : "not done"}`);
    }
    if (Array.isArray(b.rooms)) {
      const known = new Set(c.plan.rooms.map((r) => r.id));
      const rooms: Record<string, Category[]> = {};
      for (const r of b.rooms) if (typeof r === "string" && known.has(r)) rooms[r] = phase.rooms[r] ?? [];
      if (Object.keys(rooms).length) {
        phase.rooms = rooms;
        c.log(`${phaseTitle(phase, c.plan.rooms)} now covers ${Object.keys(rooms).length} rooms`);
      }
    }
  },
  addPhase(d, b, c) {
    const template = templateById(text(b.template, 40));
    if (!template || !Array.isArray(b.rooms)) return;
    const schedule = (d.schedule ??= defaultSchedule(c.phases));
    const rooms: Record<string, Category[]> = {};
    for (const r of c.plan.rooms) if (b.rooms.includes(r.id)) rooms[r.id] = categoriesFor(template.id, r.id, c.phases);
    if (!Object.keys(rooms).length) return;
    const end = schedule.reduce((max, p) => Math.max(max, p.start + p.days), 0);
    const start = count(b.start, 0, 400) ?? end;
    const phase = { id: `${template.id}-${id()}`, template: template.id, rooms, start, days: template.days, done: false };
    schedule.push(phase);
    schedule.sort((x, y) => x.start - y.start);
    c.log(`Added ${phaseTitle(phase, c.plan.rooms)}`);
  },
  removePhase(d, b, c) {
    const schedule = (d.schedule ??= defaultSchedule(c.phases));
    const phase = schedule.find((p) => p.id === b.id);
    if (!phase) return;
    d.schedule = schedule.filter((p) => p !== phase);
    for (const sub of d.people.subs) sub.phases = sub.phases.filter((p) => p !== phase.id);
    c.log(`Removed ${phaseTitle(phase, c.plan.rooms)}`);
  },
  offDay(d, b, c) {
    if (!isDate(b.date)) return;
    const on = d.offDays.includes(b.date);
    if (b.off === true && !on) d.offDays = [...d.offDays, b.date].sort();
    else if (b.off === false && on) d.offDays = d.offDays.filter((x) => x !== b.date);
    else return;
    c.log(`${dayFormat.format(new Date(`${b.date}T12:00:00Z`))} ${b.off ? "is now an off day" : "is a workday again"}`);
  },
  expect(d, b, c) {
    const template = templateById(text(b.template, 40));
    if (!template) return;
    const line = text(b.text, 300);
    if (line && line !== template.expect) d.expect[template.id] = line;
    else delete d.expect[template.id];
    c.log(`Rewrote what to expect for ${template.title(c.plan.rooms)}`);
  },
  note(d, b, c) {
    const body = text(b.body);
    const pics = photos(b.photos);
    if (!body && !pics.length) return;
    const room = c.plan.rooms.find((r) => r.id === b.room);
    d.notes.push({ id: id(), body, photos: pics, room: room?.id, date: isDate(b.date) ? b.date : undefined, at: now() });
    c.log(`Posted a note${room ? ` to ${room.name}` : ""}${pics.length ? ` with ${pics.length} photo${pics.length > 1 ? "s" : ""}` : ""}`);
  },
  removeNote(d, b, c) {
    const before = d.notes.length;
    d.notes = d.notes.filter((n) => n.id !== b.id);
    if (d.notes.length !== before) c.log("Removed a note");
  },
  changeOrder(d, b, c) {
    const title = text(b.title, 120);
    if (!title) return;
    d.changeOrders.push({ id: id(), title, body: text(b.body), photos: photos(b.photos), createdAt: now() });
    c.log(`Created change order “${title}”`);
  },
  editChangeOrder(d, b, c) {
    const co = d.changeOrders.find((x) => x.id === b.id);
    const title = text(b.title, 120);
    if (!co || co.answer || !title) return;
    co.title = title;
    co.body = text(b.body);
    c.log(`Edited change order “${title}”`);
  },
  withdrawChangeOrder(d, b, c) {
    const co = d.changeOrders.find((x) => x.id === b.id);
    if (!co || co.answer) return;
    d.changeOrders = d.changeOrders.filter((x) => x !== co);
    c.log(`Withdrew change order “${co.title}”`);
  },
  warranty(d, b, c) {
    d.closeout.warranty = text(b.warranty, 4000);
    c.log("Updated the warranty");
  },
  punch(d, b, c) {
    const t = text(b.text, 300);
    if (!t) return;
    d.closeout.punch.push({ id: id(), text: t, room: text(b.room, 40) || undefined, done: false });
    c.log(`Added punch item “${t}”`);
  },
  punchDone(d, b, c) {
    const item = d.closeout.punch.find((p) => p.id === b.id);
    if (!item) return;
    item.done = Boolean(b.done);
    c.log(`Punch item “${item.text}” ${item.done ? "done" : "reopened"}`);
  },
  removePunch(d, b, c) {
    const item = d.closeout.punch.find((p) => p.id === b.id);
    if (!item) return;
    d.closeout.punch = d.closeout.punch.filter((p) => p !== item);
    c.log(`Removed punch item “${item.text}”`);
  },
  document(d, b, c) {
    const name = text(b.name, 120);
    const url = text(b.url, 1000);
    if (!name || !url.startsWith("http")) return;
    d.closeout.documents.push({ name, url });
    c.log(`Added document “${name}”`);
  },
  removeDocument(d, b, c) {
    const doc = d.closeout.documents.find((x) => x.url === b.url);
    if (!doc) return;
    d.closeout.documents = d.closeout.documents.filter((x) => x !== doc);
    c.log(`Removed document “${doc.name}”`);
  },
  pm(d, b, c) {
    const name = text(b.name, 80);
    if (!name) return;
    d.people.pm.name = name;
    c.log(`Project manager set to ${name}`);
  },
  sub(d, b, c) {
    const name = text(b.name, 80);
    if (!name) return;
    const trade = text(b.trade, 80);
    const known = new Set((d.schedule ?? defaultSchedule(c.phases)).map((p) => p.id));
    const phases = Array.isArray(b.phases) ? b.phases.filter((p): p is string => typeof p === "string" && known.has(p)) : [];
    const existing = d.people.subs.find((x) => x.id === b.id);
    if (existing) Object.assign(existing, { name, trade, phases });
    else d.people.subs.push({ id: id(), name, trade, phases });
    c.log(`${existing ? "Updated" : "Added"} ${name}`);
  },
  removeSub(d, b, c) {
    const sub = d.people.subs.find((x) => x.id === b.id);
    if (!sub) return;
    d.people.subs = d.people.subs.filter((x) => x !== sub);
    c.log(`Removed ${sub.name}`);
  },
};

/** The parts of the model a template works on in a room, from the job's own days. */
function categoriesFor(template: string, room: string, phases: Phase[]): Category[] {
  const same = phases.find((p) => p.template === template)?.rooms[room];
  if (same) return same;
  const fallback: Record<string, Category[]> = {
    "insulate-crawlspace": ["Insulation"],
    "build-cabinets": ["Cabinets"],
    "paint-walls": ["Paint"],
    "install-flooring": ["Flooring"],
    "hang-doors": ["Doors"],
    "install-baseboard": ["Baseboard"],
    "paint-trim": ["Paint"],
    "final-clean": ["Clean"],
  };
  return fallback[template] ?? [];
}

/** What a homeowner just posted, worded for OHI's email, with a link straight to it. */
function homeownerUpdate(action: string, before: ProjectState, after: ProjectState, origin: string, slug: string) {
  const base = `${origin}/p/${slug}`;
  if (action === "message" && after.messages.length > before.messages.length) {
    const m = after.messages[after.messages.length - 1];
    const what = m.photos.length && !m.body ? "The homeowner sent a photo." : "The homeowner sent a message.";
    return { what, link: `${base}?sheet=messages${m.room ? `&about=${m.room}` : ""}` };
  }
  if (action === "answer") {
    const co = after.changeOrders.find((c) => c.answer && !before.changeOrders.find((b) => b.id === c.id)?.answer);
    if (!co?.answer) return null;
    const answer = { yes: "said yes to", no: "said no to", other: "sent something else for" }[co.answer.choice];
    return { what: `The homeowner ${answer} the change order “${co.title}”.`, link: `${base}?sheet=changes` };
  }
  return null;
}

const UNDO_LIMIT = 20;
const LOG_LIMIT = 200;

export async function POST(request: Request, { params }: Params) {
  const { slug } = await params;
  const role = await roleFor(slug);
  if (!role) return NextResponse.json({ error: "locked" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as Body;
  const action = String(body.action ?? "");

  if (shared[action] || (role === "home" && home[action])) {
    const run = shared[action] ?? home[action];
    const before = await readState(slug);
    const state = await updateState(slug, (s) => run(s, body, role));
    if (role === "home") {
      const update = homeownerUpdate(action, before, state, new URL(request.url).origin, slug);
      const project = projectConfig(slug)?.name ?? "Project Huddle";
      if (update) after(() => notifyOhi({ project, ...update }).catch((e) => console.error(e)));
    }
    return NextResponse.json(forRole(state, role));
  }
  if (role !== "ohi") return NextResponse.json({ error: "not allowed" }, { status: 403 });

  const data = await projectData(slug);
  if (!data) return NextResponse.json({ error: "no project" }, { status: 404 });

  const state = await updateState(slug, (s) => {
    const stamp = (line: string) => s.log.unshift({ at: now(), text: line });

    if (action === "push") {
      if (!s.draft) return;
      // Answers the homeowner gave since the draft was copied stay answered.
      for (const co of s.draft.changeOrders) {
        const live = s.changeOrders.find((x) => x.id === co.id);
        if (live?.answer) co.answer = live.answer;
      }
      Object.assign(s, s.draft);
      s.draft = null;
      s.undo = [];
      stamp("Pushed to homeowner");
    } else if (action === "undo") {
      const previous = s.undo.shift();
      if (!previous) return;
      s.draft = JSON.stringify(previous) === JSON.stringify(editable(s)) ? null : previous;
      stamp("Undid the last change");
    } else if (ohi[action]) {
      const draft = s.draft ?? editable(s);
      const before = structuredClone(draft);
      const lines: string[] = [];
      ohi[action](draft, body, { plan: data.plan, phases: data.phases, log: (l) => lines.push(l) });
      if (!lines.length) return;
      s.undo = [before, ...s.undo].slice(0, UNDO_LIMIT);
      s.draft = draft;
      for (const l of lines) stamp(l);
    }
    s.log = s.log.slice(0, LOG_LIMIT);
  });

  return NextResponse.json(forRole(state, role));
}
