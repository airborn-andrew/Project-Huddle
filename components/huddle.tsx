"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import {
  ArrowUp,
  Camera,
  ClipboardCheck,
  FileSignature,
  Images,
  Layers,
  MessageCircle,
  Moon,
  Palette,
  RotateCcw,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DayScrubber, type DayWork, type Speed } from "@/components/day-scrubber";
import { RoomCard } from "@/components/room-card";
import { Messages } from "@/components/messages";
import { ChangeOrders } from "@/components/change-orders";
import { CloseoutSheet } from "@/components/closeout";
import { Connector } from "@/components/connector";
import { PeopleSheet } from "@/components/people";
import { PhotosSheet } from "@/components/photos";
import { SelectionsSheet } from "@/components/selections";
import type { LayerState, RoomLook } from "@/components/plan/scene";
import { useProject } from "@/lib/client";
import { roomPhotos } from "@/lib/photos";
import { calendarOf, expand, isoDate, lastDay, scheduleOf, workdayDate, workdayIndex, type Calendar } from "@/lib/sequence";
import { templateById } from "@/lib/templates";
import { useTheme } from "@/lib/theme";
import { useView } from "@/lib/view";
import type { Phase, Plan, ProjectState, Role, Room, ScheduledTask } from "@/lib/types";

const Scene = dynamic(() => import("@/components/plan/scene").then((m) => m.Scene), { ssr: false });

export function Huddle({
  slug,
  name,
  role,
  plan,
  phases,
  model,
  initialState,
}: {
  slug: string;
  name: string;
  role: Role;
  plan: Plan;
  phases: Phase[];
  /** Address of the 3D model. */
  model: string;
  initialState: ProjectState;
}) {
  // The homeowner view always shows the published project, for OHI too.
  const { state, act } = useProject(slug, initialState);
  const cal = useMemo(() => calendarOf(state), [state]);
  const schedule = useMemo(() => scheduleOf(state, phases), [state, phases]);
  const scheduled = useMemo(() => expand(schedule, plan.rooms), [schedule, plan.rooms]);
  const last = lastDay(scheduled);
  const today = useToday(cal, last);
  const [day, setDay] = useState(today);
  const { view, open, back, home } = useView();
  const { room: selected, focus, sheet, about: messageRoom } = view;
  const mainLevel = plan.levels.find((l) => l.stack === 0)?.id;
  const [layers, setLayers] = useState({ photos: true, messages: true });
  const [layersOpen, setLayersOpen] = useState(false);
  const { theme, toggle: toggleTheme } = useTheme();
  const [resetKey, setResetKey] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);
  const [compact, setCompact] = useState(false);
  const reducedMotion = useReducedMotion();
  const compass = useRef<SVGSVGElement>(null);

  useEffect(() => {
    setDay(today);
  }, [today]);

  // Once the last workday has passed, the project opens on its closeout, once.
  const shownCloseout = useRef(false);
  useEffect(() => {
    const end = workdayDate(cal, last);
    if (shownCloseout.current || Date.now() <= end.getTime() + 36 * 60 * 60 * 1000) return;
    shownCloseout.current = true;
    if (!sheet) open({ sheet: "closeout" });
  }, [cal, last, sheet, open]);

  // Esc steps out of a picked room or a level in focus (sheets handle their own).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !sheet && (selected || focus)) back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheet, selected, focus, back]);

  const looks = useMemo(() => roomLooks(plan.rooms, scheduled, day), [plan.rooms, scheduled, day]);
  const work = useMemo(() => dayWork(scheduled, day, state.expect), [scheduled, day, state.expect]);
  const dayNotes = useMemo(() => {
    const date = isoDate(workdayDate(cal, day));
    return state.notes.filter((n) => n.date === date);
  }, [state.notes, cal, day]);

  // The layers menu closes when anything else opens.
  useEffect(() => {
    if (sheet || selected) setLayersOpen(false);
  }, [sheet, selected]);

  // Play moves through the schedule one workday at a time and stops on the last day.
  useEffect(() => {
    if (!playing) return;
    if (day >= last) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => setDay((d) => Math.min(last, d + 1)), speed * 1000);
    return () => clearTimeout(timer);
  }, [playing, day, last, speed]);

  const pick = useCallback(
    (room: string | null) => {
      setCompact(true);
      if (room === selected) return;
      if (room === null) back();
      else open({ room }, selected !== null);
    },
    [selected, open, back],
  );

  const openSheet = (name: NonNullable<typeof sheet>, room: string | null = null) => open({ sheet: name, about: room });

  /** Work that covers most of the house gets one bubble instead of one per room. */
  const houseWork = useMemo(() => {
    const today = scheduled.filter((t) => isOn(t, day));
    const counts = new Map<string, number>();
    for (const t of today) counts.set(t.title, (counts.get(t.title) ?? 0) + 1);
    return [...counts].filter(([, n]) => n >= HOUSE_WIDE).map(([title]) => title);
  }, [scheduled, day]);

  const overlay = useCallback(
    (room: Room) => {
      if (focus && room.level !== focus) return null;
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
    [selected, scheduled, day, pick, houseWork, focus],
  );

  const houseOverlay =
    houseWork.length > 0 && !selected && (!focus || focus === mainLevel) ? (
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

  /** Photo and message counts per room, for the pins on the plan. */
  const pinCounts = useMemo(() => {
    const counts: Record<string, { photos: number; messages: number }> = {};
    for (const room of plan.rooms) {
      const photos = roomPhotos(state, room.id).length;
      const messages = state.messages.filter((m) => m.room === room.id).length;
      if (photos || messages) counts[room.id] = { photos, messages };
    }
    return counts;
  }, [plan.rooms, state]);
  const hasPins = Object.keys(pinCounts).length > 0;

  // Buttons appear only once there is something behind them.
  const hasPhotos = plan.rooms.some((r) => roomPhotos(state, r.id).length > 0);
  const finished = Date.now() > workdayDate(cal, last).getTime() + 36 * 60 * 60 * 1000;
  const { closeout } = state;
  const hasCloseout =
    finished || Boolean(closeout.walkthrough || closeout.warranty || closeout.punch.length || closeout.documents.length);

  const pins = (room: Room) => {
    const c = pinCounts[room.id];
    if (!c || selected || (focus && room.level !== focus)) return null;
    const showPhotos = layers.photos && c.photos > 0;
    const showMessages = layers.messages && c.messages > 0;
    if (!showPhotos && !showMessages) return null;
    return (
      <span className="pins">
        {showPhotos && (
          <button type="button" className="pin glass" aria-label={`${c.photos} photos in ${room.name}`} onClick={() => pick(room.id)}>
            <Camera />
            {c.photos}
          </button>
        )}
        {showMessages && (
          <button
            type="button"
            className="pin glass"
            aria-label={`${c.messages} messages about ${room.name}`}
            onClick={() => openSheet("messages", room.id)}
          >
            <MessageCircle />
            {c.messages}
          </button>
        )}
      </span>
    );
  };
  const openChanges = state.changeOrders.filter((c) => !c.answer).length;

  return (
    <main className="huddle" style={{ "--levels-height": `${plan.levels.length * 32 + 8}px` } as React.CSSProperties}>
      <Scene
        model={model}
        levels={plan.levels}
        focus={focus}
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
            {pins(r)}
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
          {hasPins && (
            <button
              type="button"
              className="tool"
              aria-label="Photos and messages on the plan"
              aria-expanded={layersOpen}
              onClick={() => setLayersOpen((o) => !o)}
            >
              <Layers />
            </button>
          )}
          <button
            type="button"
            className="tool"
            aria-label="Messages"
            onClick={() => openSheet("messages")}
          >
            <MessageCircle />
          </button>
          <button type="button" className="tool" aria-label="Your team" onClick={() => openSheet("team")}>
            <Users />
          </button>
          {hasPhotos && (
            <button type="button" className="tool" aria-label="Photos" onClick={() => openSheet("photos")}>
              <Images />
            </button>
          )}
          {state.changeOrders.length > 0 && (
            <button
              type="button"
              className="tool"
              aria-label={openChanges ? `Change orders, ${openChanges} waiting` : "Change orders"}
              data-badge={openChanges > 0}
              onClick={() => openSheet("changes")}
            >
              <FileSignature />
            </button>
          )}
          {state.selections.length > 0 && (
            <button type="button" className="tool" aria-label="Selections" onClick={() => openSheet("selections")}>
              <Palette />
            </button>
          )}
          {hasCloseout && (
            <button type="button" className="tool" aria-label="Closeout" onClick={() => openSheet("closeout")}>
              <ClipboardCheck />
            </button>
          )}
          <button
            type="button"
            className="tool"
            aria-label="Dark background"
            aria-pressed={theme === "dark"}
            onClick={toggleTheme}
          >
            <Moon />
          </button>
          <button
            type="button"
            className="tool"
            aria-label="Reset view"
            onClick={() => {
              home();
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

      {layersOpen && hasPins && (
        <div className="layers-menu glass" role="group" aria-label="Show on the plan">
          {(["photos", "messages"] as const).map((key) => (
            <button
              key={key}
              type="button"
              className="layers-option"
              aria-pressed={layers[key]}
              onClick={() => setLayers((l) => ({ ...l, [key]: !l[key] }))}
            >
              {key === "photos" ? <Camera /> : <MessageCircle />}
              {key === "photos" ? "Photos" : "Messages"}
            </button>
          ))}
        </div>
      )}

      <div className="compass" aria-hidden="true" data-hidden={selected !== null}>
        <span className="compass-n">
          N
          <ArrowUp ref={compass} />
        </span>
      </div>

      <nav className="levels glass" aria-label="Levels" data-hidden={selected !== null}>
        {plan.levels.map((l) => (
          <button
            key={l.id}
            type="button"
            className="level"
            aria-pressed={focus === l.id}
            onClick={() => (focus === l.id ? back() : open({ focus: l.id, room: null }, focus !== null))}
          >
            {l.name}
          </button>
        ))}
      </nav>

      {selectedRoom && <Connector key={`line-${selectedRoom.id}`} />}
      {selectedRoom && (
        <RoomCard
          key={selectedRoom.id}
          room={selectedRoom}
          tasks={scheduled.filter((t) => t.room === selectedRoom.id)}
          cal={cal}
          day={day}
          expect={state.expect}
          notes={state.notes.filter((n) => n.room === selectedRoom.id)}
          photos={state.photos[selectedRoom.id] ?? []}
          onClose={() => pick(null)}
        />
      )}

      <DayScrubber
        cal={cal}
        day={day}
        last={last}
        today={today}
        work={work}
        notes={dayNotes}
        playing={playing}
        speed={speed}
        onPlay={(on) => {
          if (selected) back();
          if (on && day >= last) setDay(0);
          setPlaying(on);
        }}
        onSpeed={setSpeed}
        onChange={(d) => {
          setPlaying(false);
          setDay(d);
          if (selected) back();
        }}
      />

      {sheet === "messages" && (
        <Messages
          slug={slug}
          role={role}
          rooms={plan.rooms}
          room={messageRoom ?? undefined}
          state={state}
          act={act}
          onClose={back}
        />
      )}
      {sheet === "changes" && (
        <ChangeOrders slug={slug} role={role} state={state} act={act} onClose={back} />
      )}
      {sheet === "selections" && <SelectionsSheet rooms={plan.rooms} state={state} onClose={back} />}
      {sheet === "photos" && <PhotosSheet rooms={plan.rooms} state={state} onClose={back} />}
      {sheet === "team" && (
        <PeopleSheet people={state.people} schedule={schedule} rooms={plan.rooms} cal={cal} onClose={back} />
      )}
      {sheet === "closeout" && (
        <CloseoutSheet
          rooms={plan.rooms}
          state={state}
          walkthrough={walkthroughDate(scheduled, cal)}
          onClose={back}
        />
      )}
    </main>
  );
}

const isOn = (t: ScheduledTask, day: number) => day >= t.day && day < t.day + t.days;

/** The production phases running on a day, with which of their days it is. */
function dayWork(tasks: ScheduledTask[], day: number, expect: Record<string, string>): DayWork[] {
  const out: DayWork[] = [];
  for (const t of tasks) {
    if (!isOn(t, day) || out.some((w) => w.phase === t.phase)) continue;
    out.push({
      phase: t.phase,
      title: t.title,
      expect: expect[t.step] ?? templateById(t.step)?.expect ?? "",
      part: day - t.day + 1,
      of: t.days,
    });
  }
  return out;
}

/** The date of the final walkthrough day, if the schedule has one. */
function walkthroughDate(tasks: ScheduledTask[], cal: Calendar) {
  const walk = tasks.find((t) => t.step === "final-walkthrough");
  return walk ? workdayDate(cal, walk.day) : null;
}

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

function useToday(cal: Calendar, last: number) {
  const [today, setToday] = useState(0);
  useEffect(() => {
    const now = new Date();
    const local = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    setToday(workdayIndex(cal, local, last));
  }, [cal, last]);
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
