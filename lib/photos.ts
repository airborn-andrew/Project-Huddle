import type { Editable, Photo } from "@/lib/types";

/** Every photo tied to a room: room photos and photos on notes posted to it. */
export function roomPhotos(s: Pick<Editable, "photos" | "notes">, room: string): Photo[] {
  return [...(s.photos[room] ?? []), ...s.notes.filter((n) => n.room === room).flatMap((n) => n.photos)];
}
