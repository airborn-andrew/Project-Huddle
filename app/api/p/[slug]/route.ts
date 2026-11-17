import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { cookieName, readToken } from "@/lib/access";
import { readState, updateState } from "@/lib/state";
import type { Photo, ProjectState, Role } from "@/lib/types";

type Params = { params: Promise<{ slug: string }> };

async function roleFor(slug: string): Promise<Role | null> {
  return readToken(slug, (await cookies()).get(cookieName(slug))?.value);
}

export async function GET(_: Request, { params }: Params) {
  const { slug } = await params;
  return NextResponse.json(await readState(slug));
}

const id = () => crypto.randomUUID().slice(0, 8);
const now = () => new Date().toISOString();
const text = (v: unknown, max = 2000) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const photos = (v: unknown): Photo[] =>
  Array.isArray(v)
    ? v
        .filter((p): p is Photo => typeof p?.url === "string")
        .slice(0, 6)
        .map((p) => ({ url: p.url, width: Number(p.width) || 0, height: Number(p.height) || 0 }))
    : [];

type Body = Record<string, unknown> & { action?: string };

/** Changes anyone in the project can make. */
const shared: Record<string, (s: ProjectState, b: Body, role: Role) => void> = {
  message(s, b, role) {
    const body = text(b.body);
    const pics = photos(b.photos);
    if (!body && !pics.length) return;
    s.messages.push({ id: id(), from: role, body, photos: pics, room: text(b.room, 40) || undefined, at: now() });
  },
};

/** Changes only the homeowner makes. */
const home: Record<string, (s: ProjectState, b: Body) => void> = {
  answer(s, b) {
    const co = s.changeOrders.find((c) => c.id === b.id);
    const choice = b.choice;
    if (!co || co.answer || (choice !== "yes" && choice !== "no" && choice !== "other")) return;
    co.answer = { choice, note: text(b.note) || undefined, photos: photos(b.photos), at: now() };
  },
};

/** Changes only OHI makes. */
const ohi: Record<string, (s: ProjectState, b: Body) => void> = {
  start(s, b) {
    if (typeof b.startDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.startDate)) s.startDate = b.startDate;
  },
  task(s, b) {
    const key = text(b.id, 80);
    if (!key) return;
    const o = (s.overrides[key] ??= {});
    if (typeof b.day === "number" && b.day >= 0 && b.day < 120) o.day = Math.round(b.day);
    if (typeof b.done === "boolean") o.done = b.done;
  },
  resetTask(s, b) {
    delete s.overrides[text(b.id, 80)];
  },
  changeOrder(s, b) {
    const title = text(b.title, 120);
    if (!title) return;
    s.changeOrders.push({ id: id(), title, body: text(b.body), photos: photos(b.photos), createdAt: now() });
  },
  roomPhoto(s, b) {
    const room = text(b.room, 40);
    const pics = photos(b.photos);
    if (!room || !pics.length) return;
    (s.photos[room] ??= []).push(...pics);
  },
  closeout(s, b) {
    if (typeof b.walkthrough === "string") s.closeout.walkthrough = text(b.walkthrough, 40) || undefined;
    if (typeof b.warranty === "string") s.closeout.warranty = text(b.warranty, 4000);
  },
  punch(s, b) {
    const t = text(b.text, 300);
    if (t) s.closeout.punch.push({ id: id(), text: t, room: text(b.room, 40) || undefined, done: false });
  },
  punchDone(s, b) {
    const item = s.closeout.punch.find((p) => p.id === b.id);
    if (item) item.done = Boolean(b.done);
  },
  document(s, b) {
    const name = text(b.name, 120);
    const url = text(b.url, 1000);
    if (name && url.startsWith("http")) s.closeout.documents.push({ name, url });
  },
};

export async function POST(request: Request, { params }: Params) {
  const { slug } = await params;
  const role = await roleFor(slug);
  if (!role) return NextResponse.json({ error: "locked" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as Body;
  const action = String(body.action ?? "");
  const run = shared[action] ?? (role === "home" ? home[action] : ohi[action]);
  if (!run) return NextResponse.json({ error: "not allowed" }, { status: 403 });
  const state = await updateState(slug, (s) => run(s, body, role));
  return NextResponse.json(state);
}
