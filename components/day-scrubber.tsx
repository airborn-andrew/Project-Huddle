"use client";

import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { useEffect, useRef } from "react";
import { longDayFormat, workdayDate } from "@/lib/sequence";

/** A production phase as it stands on the selected day. */
export type DayWork = { step: string; title: string; expect: string; part: number; of: number };

export const speeds = [1, 3, 5] as const;
export type Speed = (typeof speeds)[number];

export function DayScrubber({
  startDate,
  day,
  last,
  today,
  work,
  playing,
  speed,
  onChange,
  onPlay,
  onSpeed,
}: {
  startDate: string;
  day: number;
  last: number;
  today: number;
  work: DayWork[];
  playing: boolean;
  speed: Speed;
  onChange: (day: number) => void;
  onPlay: (playing: boolean) => void;
  onSpeed: (speed: Speed) => void;
}) {
  const go = (d: number) => onChange(Math.max(0, Math.min(last, d)));
  const box = useRef<HTMLDivElement>(null);

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

  return (
    <div ref={box} className="scrubber glass">
      <div className="scrubber-head">
        <div>
          <span className="scrubber-date">{longDayFormat.format(workdayDate(startDate, day))}</span>
          <span className="scrubber-count">
            Day {day + 1} of {last + 1}
          </span>
        </div>
        <div className="scrubber-actions">
          <button
            type="button"
            className="speed"
            aria-label={`Play speed, ${speed} seconds a day`}
            onClick={() => onSpeed(speeds[(speeds.indexOf(speed) + 1) % speeds.length])}
          >
            {speed}s
          </button>
          <button
            type="button"
            className="scrubber-step"
            aria-label={playing ? "Pause" : "Play the schedule"}
            onClick={() => onPlay(!playing)}
          >
            {playing ? <Pause /> : <Play />}
          </button>
          <button type="button" className="today" disabled={day === today} onClick={() => go(today)}>
            Today
          </button>
        </div>
      </div>
      {work.length > 0 && (
        <ul className="day-work" aria-live="polite">
          {work.map((w) => (
            <li key={w.step}>
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
      )}
      <div className="scrubber-row">
        <button type="button" className="scrubber-step" aria-label="Previous day" disabled={day === 0} onClick={() => go(day - 1)}>
          <ChevronLeft />
        </button>
        <div className="scrubber-track">
          <div className="scrubber-ticks" aria-hidden="true">
            {Array.from({ length: last + 1 }, (_, i) => (
              <span key={i} className="scrubber-tick" data-past={i < today} data-today={i === today} />
            ))}
          </div>
          <input
            type="range"
            min={0}
            max={last}
            step={1}
            value={day}
            aria-label="Day"
            aria-valuetext={longDayFormat.format(workdayDate(startDate, day))}
            onChange={(e) => go(Number(e.target.value))}
          />
        </div>
        <button type="button" className="scrubber-step" aria-label="Next day" disabled={day === last} onClick={() => go(day + 1)}>
          <ChevronRight />
        </button>
      </div>
    </div>
  );
}
