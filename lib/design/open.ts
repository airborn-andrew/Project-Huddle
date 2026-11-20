import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { designRooms } from "@/lib/design/layout";
import { buildShell, glbParts, seedPieces } from "@/lib/design/shell";
import { createLayout, readLayout } from "@/lib/design/store";
import type { Project } from "@/lib/projects";

/**
 * A room's layout, made from the sketch the first time the room opens. The
 * first layout starts from the cabinets and appliances already in the sketch.
 * Returns null when the room has no Design Room.
 */
export async function openLayout(project: Project, roomId: string, origin: string) {
  const room = designRooms(project.plan).find((r) => r.id === roomId);
  if (!room) return null;
  const existing = await readLayout(project.slug, room.id);
  if (existing) return { room, layout: existing };
  const parts = glbParts(await modelBytes(project.model, origin));
  const shell = buildShell(project.plan, room, parts);
  const layout = await createLayout(project.slug, room.id, shell, seedPieces(project.plan, room, shell, parts));
  return { room, layout };
}

/** The model is a static file: read from the app's public folder when it is there, or fetched from the site. */
async function modelBytes(model: string, origin: string): Promise<ArrayBuffer> {
  if (model.startsWith("/") && !model.startsWith("//")) {
    try {
      const file = await readFile(join(process.cwd(), "public", model));
      return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
    } catch {
      // Not on this server's disk; fetch it below.
    }
  }
  const res = await fetch(new URL(model, origin));
  if (!res.ok) throw new Error(`Could not load the model at ${model}`);
  return res.arrayBuffer();
}
