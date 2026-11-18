"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowUp, ClipboardCheck, FileSignature, MessageCircle, RotateCcw, SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DayScrubber } from "@/components/day-scrubber";
import { RoomCard } from "@/components/room-card";
import { Messages } from "@/components/messages";
import { ChangeOrders } from "@/components/change-orders";
import { CloseoutSheet } from "@/components/closeout";
import { Connector } from "@/components/connector";
import type { LayerState, RoomLook } from "@/components/plan/scene";
import { useProject } from "@/lib/client";
import { lastDay, schedule, workdayDate, workdayIndex } from "@/lib/sequence";
import type { Plan, ProjectState, Role, Room, ScheduledTask, Task } from "@/lib/types";

const Scene = dynamic(() => import("@/components/plan/scene").then((m) => m.Scene), { ssr: false });

type SheetName = "messages" | "changes" | "closeout" | null;

export function Huddle({
  slug,
  name,
  role,
  plan,
  tasks,
  initialState,
}: {
  slug: string;
  name: string;
  role: Role;
  plan: Plan;
  tasks: Task[];
  initialState: ProjectState;
}) {
  const { state, act } = useProject(slug, initialState);
  const scheduled = useMemo(() => schedule(tasks, state), [tasks, state]);
  const last = lastDay(scheduled);
  const today = useToday(state.startDate, last);
  const [day, setDay] = useState(today);
  const [selected, setSelected] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetName>(null);
  const [resetKey, setResetKey] = useState(0);
  const [compact, setCompact] = useState(false);
  const reducedMotion = useReducedMotion();
  const compass = useRef<SVGSVGElement>(null);

  useEffect(() => setDay(today), [today]);

  // Once the last workday has passed, the project opens on its closeout.
  useEffect(() => {
    const end = workdayDate(state.startDate, last);
    if (Date.now() > end.getTime() + 36 * 60 * 60 * 1000) setSheet("closeout");
  }, [state.startDate, last]);

  const looks = useMemo(() => roomLooks(plan.rooms, scheduled, day), [plan.rooms, scheduled, day]);

  const pick = useCallback((room: string | null) => {
    setSelected(room);
    setCompact(true);
  }, []);

  /** Work that covers most of the house gets one bubble instead of one per room. */
  const houseWork = useMemo(() => {
    const today = scheduled.filter((t) => isOn(t, day));
    const counts = new Map<string, number>();
    for (const t of today) counts.set(t.title, (counts.get(t.title) ?? 0) + 1);
    return [...counts].filter(([, n]) => n >= HOUSE_WIDE).map(([title]) => title);
  }, [scheduled, day]);

  const overlay = useCallback(
    (room: Room) => {
      if (room.id === selected) {
        return (
          <span className="bubble glass" data-picked="true">
            <span className="bubble-work">{room.name}</span>
          </span>
        );
      }
      const active = scheduled.filter((t) => t.room === room.id && isOn(t, day) && !houseWork.includes(t.title));
      if (active.length && !selected) {
        return (
          <button type="button" className="bubble glass" onClick={() => pick(room.id)}>
            <span className="bubble-room">{room.name}</span>
            {[...new Set(active.map((t) => t.title))].map((title) => (
              <span key={title} className="bubble-work">
                {title}
              </span>
            ))}
          </button>
        );
      }
      return (
        <span
          className="room-label"
          data-dim={selected !== null}
          style={{ display: "block", transform: "translate(-50%, -50%)" }}
          onClick={() => pick(room.id)}
        >
          {room.name}
        </span>
      );
    },
    [selected, scheduled, day, pick, houseWork],
  );

  const houseOverlay =
    houseWork.length > 0 && !selected ? (
      <div className="bubble glass" data-house="true">
        <span className="bubble-room">Whole house</span>
        {houseWork.map((title) => (
          <span key={title} className="bubble-work">
            {title}
          </span>
        ))}
      </div>
    ) : null;

  const selectedRoom = plan.rooms.find((r) => r.id === selected);
  const openChanges = state.changeOrders.filter((c) => !c.answer).length;

  return (
    <main className="huddle">
      <Scene
        model={`/models/${slug}.glb`}
        levels={plan.levels}
        rooms={plan.rooms}
        looks={looks}
        selected={selected}
        onSelect={pick}
        resetKey={resetKey}
        reducedMotion={reducedMotion}
        onInteract={() => setCompact(true)}
        onHeading={(h) => {
          if (compass.current) compass.current.style.transform = `rotate(${h}rad)`;
        }}
      />

      <div className="anchors">
        {plan.rooms.map((r) => (
          <div key={r.id} id={`anchor-${r.id}`} className="anchor">
            {overlay(r)}
          </div>
        ))}
        <div id="anchor-house" className="anchor">
          {houseOverlay}
        </div>
      </div>

      <header className="topbar" data-compact={compact}>
        <div>
          <h1 className="title">{name}</h1>
          {!compact && <p className="title-sub">OHI Construction</p>}
        </div>
        <nav className="tools glass" aria-label="Project">
          <button type="button" className="tool" aria-label="Messages" onClick={() => setSheet("messages")}>
            <MessageCircle />
          </button>
          <button
            type="button"
            className="tool"
            aria-label={openChanges ? `Change orders, ${openChanges} waiting` : "Change orders"}
            onClick={() => setSheet("changes")}
          >
            <FileSignature />
          </button>
          <button type="button" className="tool" aria-label="Closeout" onClick={() => setSheet("closeout")}>
            <ClipboardCheck />
          </button>
          <button
            type="button"
            className="tool"
            aria-label="Reset view"
            onClick={() => {
              setSelected(null);
              setResetKey((k) => k + 1);
            }}
          >
            <RotateCcw />
          </button>
          {role === "ohi" && (
            <Link className="tool" aria-label="Edit schedule" href={`/p/${slug}/edit`}>
              <SlidersHorizontal />
            </Link>
          )}
        </nav>
      </header>

      <div className="compass" aria-hidden="true" data-hidden={selected !== null}>
        <span className="compass-n">
          N
          <ArrowUp ref={compass} />
        </span>
        <span className="compass-level">Main Level</span>
      </div>

      {selectedRoom && <Connector key={`line-${selectedRoom.id}`} />}
      {selectedRoom && (
        <RoomCard
          key={selectedRoom.id}
          room={selectedRoom}
          tasks={scheduled.filter((t) => t.room === selectedRoom.id)}
          startDate={state.startDate}
          day={day}
          photos={state.photos[selectedRoom.id] ?? []}
          onClose={() => setSelected(null)}
        />
      )}

      <DayScrubber
        startDate={state.startDate}
        day={day}
        last={last}
        today={today}
        onChange={(d) => {
          setDay(d);
          setSelected(null);
        }}
      />

      {sheet === "messages" && (
        <Messages slug={slug} role={role} rooms={plan.rooms} state={state} act={act} onClose={() => setSheet(null)} />
      )}
      {sheet === "changes" && (
        <ChangeOrders slug={slug} role={role} state={state} act={act} onClose={() => setSheet(null)} />
      )}
      {sheet === "closeout" && (
        <CloseoutSheet rooms={plan.rooms} state={state} onClose={() => setSheet(null)} />
      )}
    </main>
  );
}

const isOn = (t: ScheduledTask, day: number) => day >= t.day && day < t.day + t.days;

/** Rooms sharing the same work on a day before it reads as whole-house work. */
const HOUSE_WIDE = 5;

/** What each room shows on a given day: whether work is happening, and each layer's state. */
function roomLooks(rooms: Room[], tasks: ScheduledTask[], day: number) {
  const looks: Record<string, RoomLook> = {};
  for (const room of rooms) {
    const mine = tasks.filter((t) => t.room === room.id);
    const layers: RoomLook["layers"] = {};
    for (const category of new Set(mine.flatMap((t) => t.categories))) {
      const group = mine.filter((t) => t.categories.includes(category));
      let state: LayerState = "pending";
      if (group.some((t) => isOn(t, day))) state = "active";
      else if (group.every((t) => t.done || t.day + t.days - 1 < day)) state = "done";
      layers[category] = state;
    }
    looks[room.id] = { active: mine.some((t) => isOn(t, day)), layers };
  }
  return looks;
}

function useToday(startDate: string, last: number) {
  const [today, setToday] = useState(0);
  useEffect(() => {
    const now = new Date();
    const local = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    setToday(workdayIndex(startDate, local, last));
  }, [startDate, last]);
  return today;
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(q.matches);
    const on = () => setReduced(q.matches);
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  return reduced;
}
