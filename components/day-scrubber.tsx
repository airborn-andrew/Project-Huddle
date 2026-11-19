"use client";

import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { NoteList } from "@/components/notes";
import { dayFormat, longDayFormat, workdayDate, type Calendar } from "@/lib/sequence";
import type { Note } from "@/lib/types";

/** A production phase as it stands on the selected day. */
export type DayWork = { phase: string; title: string; expect: string; part: number; of: number };

/** A production phase on the track: where it sits in the schedule and whether it is finished. */
export type TrackPhase = { id: string; title: string; start: number; days: number; done: boolean };

export const speeds = [1, 3, 5] as const;
export type Speed = (typeof speeds)[number];

/** A run of days on the track: one phase's days, or days with no work. */
type Segment = { from: number; to: number; phase: TrackPhase | null };

/** Splits the schedule into runs of days by the first phase working each day. */
function segmentsOf(phases: TrackPhase[], last: number): Segment[] {
  const sorted = [...phases].sort((a, b) => a.start - b.start);
  const at = (d: number) => sorted.find((p) => d >= p.start && d < p.start + p.days) ?? null;
  const out: Segment[] = [];
  for (let d = 0; d <= last; d++) {
    const phase = at(d);
    const prev = out[out.length - 1];
    if (prev && prev.phase?.id === phase?.id) prev.to = d;
    else out.push({ from: d, to: d, phase });
  }
  return out;
}

export function DayScrubber({
  cal,
  day,
  last,
  today,
  work,
  phases,
  notes,
  playing,
  speed,
  compact,
  onChange,
  onPlay,
  onSpeed,
  onExpand,
}: {
  cal: Calendar;
  day: number;
  last: number;
  today: number;
  work: DayWork[];
  phases: TrackPhase[];
  notes: Note[];
  playing: boolean;
  speed: Speed;
  /** Shrunk to a pill while the homeowner moves around the house. */
  compact: boolean;
  onChange: (day: number) => void;
  onPlay: (playing: boolean) => void;
  onSpeed: (speed: Speed) => void;
  onExpand: () => void;
}) {
  const go = (d: number) => onChange(Math.max(0, Math.min(last, d)));
  const box = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const segments = useMemo(() => segmentsOf(phases, last), [phases, last]);
  const next = useMemo(
    () => [...phases].filter((p) => p.start > day).sort((a, b) => a.start - b.start)[0] ?? null,
    [phases, day],
  );
  const current = segments.find((s) => day >= s.from && day <= s.to)?.phase ?? null;

  // Its height changes with the day's work; cards and labels above it follow.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const set = () => document.documentElement.style.setProperty("--scrubber-height", `${el.offsetHeight}px`);
    const observer = new ResizeObserver(set);
    observer.observe(el);
    set();
    return () => observer.disconnect();
  }, []);

  const playButton = (
    <button type="button" className="scrubber-step" aria-label={playing ? "Pause" : "Play the schedule"} onClick={() => onPlay(!playing)}>
      {playing ? <Pause /> : <Play />}
    </button>
  );

  if (compact) {
    return (
      <div ref={box} className="scrubber scrubber-pill glass-thick">
        <button type="button" className="pill-body" aria-label="Show the schedule" onClick={onExpand}>
          <span className="pill-date">{dayFormat.format(workdayDate(cal, day))}</span>
          <span className="pill-work">{work[0]?.title ?? "No work this day"}</span>
        </button>
        {playButton}
      </div>
    );
  }

  // A share of the track's width, so a run of days lines up under the slider's thumb.
  const at = (d: number) => (last ? Math.min(1, Math.max(0, d / last)) : 0.5);

  return (
    <div ref={box} className="scrubber glass-thick">
      <div className="scrubber-head">
        <div>
          <span className="scrubber-date">
            <span className="date-long">{longDayFormat.format(workdayDate(cal, day))}</span>
            <span className="date-short">{dayFormat.format(workdayDate(cal, day))}</span>
          </span>
          <span className="scrubber-count">
            Day {day + 1} of {last + 1}
          </span>
        </div>
        <div className="scrubber-actions">
          {playing && (
            <button
              type="button"
              className="speed"
              aria-label={`Play speed, ${speed} seconds a day`}
              onClick={() => onSpeed(speeds[(speeds.indexOf(speed) + 1) % speeds.length])}
            >
              {speed}s
            </button>
          )}
          {playButton}
          <button type="button" className="today" disabled={day === today} onClick={() => go(today)}>
            Today
          </button>
        </div>
      </div>
      <div className="day-work" aria-live="polite">
        {work.length > 0 ? (
          <ul>
            {work.map((w) => (
              <li key={w.phase}>
                <span className="day-work-title">
                  {w.title}
                  {w.of > 1 && (
                    <span className="day-work-part">
                      Day {w.part} of {w.of}
                    </span>
                  )}
                </span>
                <span className="day-work-expect">{w.expect}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="day-work-none">No work this day</p>
        )}
        {next && (
          <p className="day-next">
            <span>Next</span> {next.title} · {dayFormat.format(workdayDate(cal, next.start))}
          </p>
        )}
      </div>
      {notes.length > 0 && <NoteList notes={notes} />}
      <div className="scrubber-row">
        <button type="button" className="scrubber-step" aria-label="Previous day" disabled={day === 0} onClick={() => go(day - 1)}>
          <ChevronLeft />
        </button>
        <div className="scrubber-track">
          <div className="phase-track" aria-hidden="true">
            {segments.map((s) => {
              const state = !s.phase
                ? "gap"
                : day >= s.from && day <= s.to
                  ? "active"
                  : s.phase.done || s.to < today
                    ? "done"
                    : "next";
              const left = at(s.from - 0.5);
              const right = at(s.to + 0.5);
              return (
                <span
                  key={`${s.from}-${s.phase?.id ?? "gap"}`}
                  className="phase-segment"
                  data-state={state}
                  style={{ left: `calc(${left * 100}% + 1.5px)`, width: `max(6px, calc(${(right - left) * 100}% - 3px))` }}
                />
              );
            })}
            <span className="today-notch" style={{ left: `${at(today) * 100}%` }} />
          </div>
          {dragging && current && (
            <span className="track-label glass" style={{ left: `${at(day) * 100}%` }}>
              {current.title}
            </span>
          )}
          <input
            type="range"
            min={0}
            max={last}
            step={1}
            value={day}
            aria-label="Day"
            aria-valuetext={`${longDayFormat.format(workdayDate(cal, day))}${current ? `, ${current.title}` : ""}`}
            onChange={(e) => go(Number(e.target.value))}
            onPointerDown={() => setDragging(true)}
            onPointerUp={() => setDragging(false)}
            onPointerCancel={() => setDragging(false)}
            onBlur={() => setDragging(false)}
          />
        </div>
        <button type="button" className="scrubber-step" aria-label="Next day" disabled={day === last} onClick={() => go(day + 1)}>
          <ChevronRight />
        </button>
      </div>
    </div>
  );
}
