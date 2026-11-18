"use client";

import { Sheet } from "@/components/sheet";
import { dayFormat, phaseTitle, workdayDate, type Calendar } from "@/lib/sequence";
import type { PhaseEdit, People, Room } from "@/lib/types";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter((w) => /^[A-Za-z0-9]/.test(w))
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");

/** A placeholder portrait: initials in a gray circle. */
export function Avatar({ name }: { name: string }) {
  return (
    <span className="avatar" aria-hidden="true">
      {initials(name)}
    </span>
  );
}

const when = (cal: Calendar, p: PhaseEdit) => {
  const first = dayFormat.format(workdayDate(cal, p.start));
  if (p.days === 1) return first;
  return `${first} – ${dayFormat.format(workdayDate(cal, p.start + p.days - 1)).split(", ")[1]}`;
};

/** The project manager, and under them each sub with the days they are on site. */
export function PeopleSheet({
  people,
  schedule,
  rooms,
  cal,
  onClose,
}: {
  people: People;
  schedule: PhaseEdit[];
  rooms: Room[];
  cal: Calendar;
  onClose: () => void;
}) {
  return (
    <Sheet title="Your team" onClose={onClose}>
      <div className="group person">
        <Avatar name={people.pm.name} />
        <div>
          <h3>{people.pm.name}</h3>
          <p>Project manager</p>
        </div>
      </div>

      {people.subs.length > 0 && <p className="label">On site</p>}
      {people.subs.map((sub) => {
        const days = schedule.filter((p) => sub.phases.includes(p.id)).sort((a, b) => a.start - b.start);
        return (
          <div key={sub.id} className="group person">
            <Avatar name={sub.name} />
            <div>
              <h3>{sub.name}</h3>
              {sub.trade && <p>{sub.trade}</p>}
              {days.length > 0 && (
                <ul className="person-days">
                  {days.map((p) => (
                    <li key={p.id}>
                      <span>{phaseTitle(p, rooms)}</span>
                      <span>{when(cal, p)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        );
      })}
    </Sheet>
  );
}
