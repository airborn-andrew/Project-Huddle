"use client";

import { Sheet } from "@/components/sheet";
import { selectionCategories, type ProjectState, type Room } from "@/lib/types";

/** What the homeowner picked at the showroom, by kind of finish, with OHI's screenshots. */
export function SelectionsSheet({ rooms, state, onClose }: { rooms: Room[]; state: ProjectState; onClose: () => void }) {
  const roomName = (id?: string) => rooms.find((r) => r.id === id)?.name;

  return (
    <Sheet title="Selections" onClose={onClose}>
      {selectionCategories.map((category) => {
        const picked = state.selections.filter((s) => s.category === category);
        if (!picked.length) return null;
        return (
          <section key={category}>
            <p className="label">{category}</p>
            {picked.map((s) => (
              <article key={s.id} className="group">
                {s.room && <span className="bubble-room">{roomName(s.room)}</span>}
                <h3>{s.name}</h3>
                {s.style && <p>{s.style}</p>}
                {s.photos.length > 0 && (
                  <div className="photos photos-large">
                    {s.photos.map((p) => (
                      <a key={p.url} href={p.url} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.url} alt="" loading="lazy" />
                      </a>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </section>
        );
      })}
    </Sheet>
  );
}
