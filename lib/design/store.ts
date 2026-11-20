import { db } from "@/lib/db";
import type { LayoutStatus, Piece, Shell } from "@/lib/design/layout";
import type { Role } from "@/lib/types";

/**
 * Design Room layouts, one row per room, and every saved version. Each save
 * checks the version it started from, so two people moving pieces at once
 * never overwrite each other unseen. Without a database (local development)
 * layouts stay in memory.
 */

export type Layout = {
  room: string;
  shell: Shell;
  pieces: Piece[];
  status: LayoutStatus;
  version: number;
  updatedAt: string;
  updatedBy: Role;
};

export type SavedVersion = { version: number; savedAt: string; savedBy: Role; count: number };

type Row = {
  room: string;
  shell: Shell;
  pieces: Piece[];
  status: LayoutStatus;
  version: number;
  updated_at: string;
  updated_by: Role;
};

const fromRow = (r: Row): Layout => ({
  room: r.room,
  shell: r.shell,
  pieces: r.pieces,
  status: r.status,
  version: r.version,
  updatedAt: r.updated_at,
  updatedBy: r.updated_by,
});

const memory = new Map<string, { layout: Layout; versions: (SavedVersion & { pieces: Piece[] })[] }>();
const key = (slug: string, room: string) => `${slug}/${room}`;

export async function readLayout(slug: string, room: string): Promise<Layout | null> {
  const client = db();
  if (!client) return structuredClone(memory.get(key(slug, room))?.layout ?? null);
  const { data, error } = await client.from("layouts").select("*").eq("slug", slug).eq("room", room).maybeSingle<Row>();
  if (error) throw error;
  return data ? fromRow(data) : null;
}

/** Creates the room's layout the first time it opens. Returns the layout that is there, which may be another visitor's. */
export async function createLayout(slug: string, room: string, shell: Shell, pieces: Piece[]): Promise<Layout> {
  const now = new Date().toISOString();
  const layout: Layout = { room, shell, pieces, status: "open", version: 1, updatedAt: now, updatedBy: "ohi" };
  const client = db();
  if (!client) {
    const k = key(slug, room);
    if (!memory.has(k)) memory.set(k, { layout, versions: [{ version: 1, savedAt: now, savedBy: "ohi", count: pieces.length, pieces }] });
    return structuredClone(memory.get(k)!.layout);
  }
  const { error } = await client.from("layouts").insert({ slug, room, shell, pieces, version: 1, updated_by: "ohi" });
  if (error && error.code !== "23505") throw error;
  if (!error) await recordVersion(slug, room, 1, pieces, "ohi");
  return (await readLayout(slug, room))!;
}

/**
 * Saves new pieces or a new status when the layout is still at `version`.
 * Returns the saved layout, or null when someone else saved first.
 */
export async function writeLayout(
  slug: string,
  room: string,
  version: number,
  change: { pieces?: Piece[]; status?: LayoutStatus },
  by: Role,
): Promise<Layout | null> {
  const next = version + 1;
  const updated_at = new Date().toISOString();
  const client = db();
  if (!client) {
    const entry = memory.get(key(slug, room));
    if (!entry || entry.layout.version !== version) return null;
    entry.layout = { ...entry.layout, ...change, version: next, updatedAt: updated_at, updatedBy: by };
    if (change.pieces) entry.versions.push({ version: next, savedAt: updated_at, savedBy: by, count: change.pieces.length, pieces: change.pieces });
    return structuredClone(entry.layout);
  }
  const { data, error } = await client
    .from("layouts")
    .update({ ...change, version: next, updated_at, updated_by: by })
    .eq("slug", slug)
    .eq("room", room)
    .eq("version", version)
    .select("*")
    .returns<Row[]>();
  if (error) throw error;
  if (data.length !== 1) return null;
  if (change.pieces) await recordVersion(slug, room, next, change.pieces, by);
  return fromRow(data[0]);
}

async function recordVersion(slug: string, room: string, version: number, pieces: Piece[], by: Role) {
  const { error } = await db()!.from("layout_versions").insert({ slug, room, version, pieces, saved_by: by });
  if (error) throw error;
}

/** The latest saved versions, newest first. */
export async function listVersions(slug: string, room: string, limit = 40): Promise<SavedVersion[]> {
  const client = db();
  if (!client) {
    return (memory.get(key(slug, room))?.versions ?? [])
      .slice(-limit)
      .reverse()
      .map(({ version, savedAt, savedBy, count }) => ({ version, savedAt, savedBy, count }));
  }
  const { data, error } = await client
    .from("layout_versions")
    .select("version, saved_at, saved_by, pieces")
    .eq("slug", slug)
    .eq("room", room)
    .order("version", { ascending: false })
    .limit(limit)
    .returns<{ version: number; saved_at: string; saved_by: Role; pieces: Piece[] }[]>();
  if (error) throw error;
  return data.map((v) => ({ version: v.version, savedAt: v.saved_at, savedBy: v.saved_by, count: v.pieces.length }));
}

export async function readVersion(slug: string, room: string, version: number): Promise<Piece[] | null> {
  const client = db();
  if (!client) return structuredClone(memory.get(key(slug, room))?.versions.find((v) => v.version === version)?.pieces ?? null);
  const { data, error } = await client
    .from("layout_versions")
    .select("pieces")
    .eq("slug", slug)
    .eq("room", room)
    .eq("version", version)
    .maybeSingle<{ pieces: Piece[] }>();
  if (error) throw error;
  return data?.pieces ?? null;
}
