import { del, list, put } from "@vercel/blob";
import type { Editable, ProjectState, Role } from "@/lib/types";

/**
 * Each project's state is one JSON file in Vercel Blob. Every save writes a
 * new file with a random name and removes the old one, so the address is never
 * guessable. Without a Blob token (local development) state stays in memory.
 */
const memory = new Map<string, ProjectState>();
const hasBlob = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);

export const defaultState = (): ProjectState => ({
  startDate: "2026-11-18",
  schedule: null,
  offDays: [],
  notes: [],
  expect: {},
  changeOrders: [],
  photos: {},
  closeout: { warranty: "", punch: [], documents: [] },
  people: { pm: { name: "Andrew Pearson" }, subs: [] },
  messages: [],
  draft: null,
  undo: [],
  log: [],
});

const editableKeys = [
  "startDate",
  "schedule",
  "offDays",
  "notes",
  "expect",
  "changeOrders",
  "photos",
  "closeout",
  "people",
] as const satisfies readonly (keyof Editable)[];

/** The published parts of the state that OHI edits. */
export function editable(s: Editable): Editable {
  return structuredClone(Object.fromEntries(editableKeys.map((k) => [k, s[k]])) as Editable);
}

/** What the homeowner receives: the published project, never OHI's draft or log. */
export function forRole(s: ProjectState, role: Role): ProjectState {
  return role === "ohi" ? s : { ...s, draft: null, undo: [], log: [] };
}

const prefix = (slug: string) => `projects/${slug}/state`;

export async function readState(slug: string): Promise<ProjectState> {
  if (!hasBlob()) return memory.get(slug) ?? defaultState();
  const { blobs } = await list({ prefix: prefix(slug) });
  const latest = blobs.sort((a, b) => +new Date(b.uploadedAt) - +new Date(a.uploadedAt))[0];
  if (!latest) return defaultState();
  const res = await fetch(`${latest.url}?v=${+new Date(latest.uploadedAt)}`, { cache: "no-store" });
  return { ...defaultState(), ...((await res.json()) as ProjectState) };
}

export async function writeState(slug: string, state: ProjectState) {
  if (!hasBlob()) {
    memory.set(slug, state);
    return;
  }
  const { blobs } = await list({ prefix: prefix(slug) });
  await put(`${prefix(slug)}.json`, JSON.stringify(state), {
    access: "public",
    addRandomSuffix: true,
    contentType: "application/json",
    cacheControlMaxAge: 60,
  });
  if (blobs.length) await del(blobs.map((b) => b.url));
}

/** Read, change and save in one step. */
export async function updateState(slug: string, change: (s: ProjectState) => void) {
  const state = await readState(slug);
  change(state);
  await writeState(slug, state);
  return state;
}

export async function savePhoto(slug: string, file: File) {
  if (!hasBlob()) {
    const bytes = Buffer.from(await file.arrayBuffer()).toString("base64");
    return `data:${file.type};base64,${bytes}`;
  }
  const blob = await put(`projects/${slug}/photos/${file.name || "photo.jpg"}`, file, {
    access: "public",
    addRandomSuffix: true,
    contentType: file.type || "image/jpeg",
  });
  return blob.url;
}
