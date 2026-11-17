"use client";

import { X } from "lucide-react";
import { useState } from "react";
import { categoryCopy, dayFormat, workdayDate } from "@/lib/sequence";
import type { Photo, Room, ScheduledTask } from "@/lib/types";

/** The detail card for the picked room: every piece of work in it and its day. */
export function RoomCard({
  room,
  tasks,
  startDate,
  day,
  photos,
  onClose,
}: {
  room: Room;
  tasks: ScheduledTask[];
  startDate: string;
  day: number;
  photos: Photo[];
  onClose: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const sorted = [...tasks].sort((a, b) => a.day - b.day);

  const when = (t: ScheduledTask) => {
    const first = dayFormat.format(workdayDate(startDate, t.day));
    if (t.days === 1) return first;
    return `${first} – ${dayFormat.format(workdayDate(startDate, t.day + t.days - 1)).split(", ")[1]}`;
  };

  const stateOf = (t: ScheduledTask) =>
    day >= t.day && day < t.day + t.days ? "today" : t.done || t.day + t.days - 1 < day ? "done" : "next";

  return (
    <aside className="room-panel glass" aria-label={room.name}>
      <div className="card-head">
        <h2 className="card-title">{room.name}</h2>
        <button type="button" className="close" aria-label="Close" onClick={onClose}>
          <X />
        </button>
      </div>
      <ul className="rows">
        {sorted.map((t) => (
          <li key={t.id} className="row" data-state={stateOf(t)}>
            <button
              type="button"
              className="row-button"
              aria-expanded={open === t.id}
              onClick={() => setOpen(open === t.id ? null : t.id)}
            >
              <span className="row-title">{t.title}</span>
              <span className="row-when">{when(t)}</span>
            </button>
            {open === t.id && (
              <div className="row-detail">
                <p>{categoryCopy[t.category].what}</p>
                <p>{categoryCopy[t.category].expect}</p>
              </div>
            )}
          </li>
        ))}
      </ul>
      {photos.length > 0 && (
        <div className="photos">
          {photos.map((p) => (
            <a key={p.url} href={p.url} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt="" loading="lazy" />
            </a>
          ))}
        </div>
      )}
    </aside>
  );
}
