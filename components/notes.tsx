"use client";

import type { Note } from "@/lib/types";

const stamp = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

/** OHI's notes as the homeowner reads them: the words, then any photos. */
export function NoteList({ notes }: { notes: Note[] }) {
  return (
    <ul className="notes">
      {notes.map((n) => (
        <li key={n.id} className="note">
          {n.body && <p>{n.body}</p>}
          {n.photos.length > 0 && (
            <div className="photos">
              {n.photos.map((p) => (
                <a key={p.url} href={p.url} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt="" loading="lazy" />
                </a>
              ))}
            </div>
          )}
          <span className="note-meta">OHI · {stamp.format(new Date(n.at))}</span>
        </li>
      ))}
    </ul>
  );
}
