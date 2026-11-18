"use client";

import { Check } from "lucide-react";
import { Sheet } from "@/components/sheet";
import { longDayFormat, parseDate } from "@/lib/sequence";
import type { ProjectState, Room } from "@/lib/types";

export function CloseoutSheet({
  rooms,
  state,
  walkthrough,
  onClose,
}: {
  rooms: Room[];
  state: ProjectState;
  /** The final walkthrough day on the schedule. */
  walkthrough: Date | null;
  onClose: () => void;
}) {
  const { closeout } = state;
  const roomName = (id?: string) => rooms.find((r) => r.id === id)?.name;

  return (
    <Sheet title="Closeout" onClose={onClose}>
      <p className="label">Final walkthrough</p>
      <div className="group">
        <h3>
          {closeout.walkthrough
            ? longDayFormat.format(parseDate(closeout.walkthrough))
            : walkthrough
              ? longDayFormat.format(walkthrough)
              : "Not scheduled yet"}
        </h3>
      </div>

      <p className="label">Punch list</p>
      <div className="group">
        {closeout.punch.length === 0 && <p>Nothing open</p>}
        {closeout.punch.map((p) => (
          <div key={p.id} className="check" data-done={p.done}>
            <span className="check-mark">{p.done && <Check />}</span>
            <span>
              {p.room && <span className="bubble-room">{roomName(p.room)}</span>}
              {p.text}
            </span>
          </div>
        ))}
      </div>

      {closeout.warranty && (
        <>
          <p className="label">Warranty</p>
          <div className="group">
            <p>{closeout.warranty}</p>
          </div>
        </>
      )}

      {closeout.documents.length > 0 && (
        <>
          <p className="label">Documents</p>
          <div className="group">
            {closeout.documents.map((d) => (
              <a key={d.url} className="check" href={d.url} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>
                {d.name}
              </a>
            ))}
          </div>
        </>
      )}
    </Sheet>
  );
}
