"use client";

import { X } from "lucide-react";
import { useState } from "react";
import { NoteList } from "@/components/notes";
import { dayFormat, workdayDate, type Calendar } from "@/lib/sequence";
import { templateById } from "@/lib/templates";
import type { Note, Photo, Room, ScheduledTask } from "@/lib/types";

/** The detail card for the picked room: each production day that works in it. */
export function RoomCard({
  room,
  tasks,
  cal,
  day,
  expect,
  notes,
  photos,
  onClose,
}: {
  room: Room;
  tasks: ScheduledTask[];
  cal: Calendar;
  day: number;
  expect: Record<string, string>;
  notes: Note[];
  photos: Photo[];
  onClose: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const sorted = [...tasks].sort((a, b) => a.day - b.day);

  const when = (t: ScheduledTask) => {
    const first = dayFormat.format(workdayDate(cal, t.day));
    if (t.days === 1) return first;
    return `${first} – ${dayFormat.format(workdayDate(cal, t.day + t.days - 1)).split(", ")[1]}`;
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
                <p>{templateById(t.step)?.what}</p>
                <p>{expect[t.step] ?? templateById(t.step)?.expect}</p>
              </div>
            )}
          </li>
        ))}
      </ul>
      {notes.length > 0 && <NoteList notes={notes} />}
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
