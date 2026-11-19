import { put } from "@vercel/blob";
import { db } from "@/lib/db";
import type { Editable, ProjectState, Role } from "@/lib/types";

/**
 * Each project's state is one row in the project_states table. Every save
 * checks the row's version, so when two saves land at once (a homeowner's
 * message while OHI pushes) the later one reruns on fresh state instead of
 * overwriting the other. Without a database (local development) state stays
 * in memory. Photos stay in Vercel Blob.
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
  selections: [],
  photos: {},
  closeout: { warranty: "", punch: [], documents: [] },
  people: { pm: { name: "Andrew Pearson" }, subs: [] },
  messages: [],
  draft: null,
  undo: [],
  log: [],
  ohiSeen: null,
});

const editableKeys = [
  "startDate",
  "schedule",
  "offDays",
  "notes",
  "expect",
  "changeOrders",
  "selections",
  "photos",
  "closeout",
  "people",
] as const satisfies readonly (keyof Editable)[];

/** The published parts of the state that OHI edits. */
export function editable(s: Editable): Editable {
  return structuredClone(Object.fromEntries(editableKeys.map((k) => [k, s[k]])) as Editable);
}

/** What the homeowner receives: the published project, never OHI's draft, log or read marker. */
export function forRole(s: ProjectState, role: Role): ProjectState {
  return role === "ohi" ? s : { ...s, draft: null, undo: [], log: [], ohiSeen: null };
}

/** Fills fields added after a project was saved, in the published state, OHI's draft and its undo steps. */
const withDefaults = (state: Partial<ProjectState>): ProjectState => {
  const filled = { ...defaultState(), ...state };
  const fill = (e: Editable) => ({ ...editable(defaultState()), ...e });
  return { ...filled, draft: filled.draft && fill(filled.draft), undo: filled.undo.map(fill) };
};

async function readRow(slug: string): Promise<{ state: ProjectState; version: number | null }> {
  const client = db();
  if (!client) return { state: structuredClone(memory.get(slug) ?? defaultState()), version: null };
  const { data, error } = await client
    .from("project_states")
    .select("state, version")
    .eq("slug", slug)
    .maybeSingle<{ state: ProjectState; version: number }>();
  if (error) throw error;
  return data ? { state: withDefaults(data.state), version: data.version } : { state: defaultState(), version: null };
}

/** Saves when the row is still at `version` (null: no row yet). Returns false when another save got there first. */
async function writeRow(slug: string, state: ProjectState, version: number | null) {
  const client = db();
  if (!client) {
    memory.set(slug, state);
    return true;
  }
  const updated_at = new Date().toISOString();
  if (version === null) {
    const { error } = await client.from("project_states").insert({ slug, state, version: 1, updated_at });
    if (error?.code === "23505") return false;
    if (error) throw error;
    return true;
  }
  const { data, error } = await client
    .from("project_states")
    .update({ state, version: version + 1, updated_at })
    .eq("slug", slug)
    .eq("version", version)
    .select("version");
  if (error) throw error;
  return data.length === 1;
}

export async function readState(slug: string) {
  return (await readRow(slug)).state;
}

/** Several projects' states at once, for the project list. */
export async function readStates(slugs: string[]): Promise<Map<string, ProjectState>> {
  const client = db();
  if (!client) return new Map(slugs.map((slug) => [slug, structuredClone(memory.get(slug) ?? defaultState())]));
  const { data, error } = await client
    .from("project_states")
    .select("slug, state")
    .in("slug", slugs)
    .returns<{ slug: string; state: ProjectState }[]>();
  if (error) throw error;
  const found = new Map(data.map((r) => [r.slug, withDefaults(r.state)]));
  return new Map(slugs.map((slug) => [slug, found.get(slug) ?? defaultState()]));
}

/** Read, change and save in one step. `change` reruns on fresh state if another save lands first. */
export async function updateState(slug: string, change: (s: ProjectState) => void) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { state, version } = await readRow(slug);
    change(state);
    if (await writeRow(slug, state, version)) return state;
  }
  throw new Error(`Project ${slug} is busy; try again`);
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
