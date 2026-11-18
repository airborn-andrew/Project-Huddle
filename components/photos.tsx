"use client";

import { Sheet } from "@/components/sheet";
import type { ProjectState, Room } from "@/lib/types";

/** Every photo on the job, room by room. */
export function PhotosSheet({ rooms, state, onClose }: { rooms: Room[]; state: ProjectState; onClose: () => void }) {
  const withPhotos = rooms.filter((r) => (state.photos[r.id] ?? []).length > 0);

  return (
    <Sheet title="Photos" onClose={onClose}>
      {withPhotos.map((room) => (
        <section key={room.id}>
          <p className="label">{room.name}</p>
          <div className="photos photos-large">
            {state.photos[room.id].map((p) => (
              <a key={p.url} href={p.url} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt="" loading="lazy" />
              </a>
            ))}
          </div>
        </section>
      ))}
    </Sheet>
  );
}
