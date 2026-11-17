"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { longDayFormat, workdayDate } from "@/lib/sequence";

export function DayScrubber({
  startDate,
  day,
  last,
  today,
  onChange,
}: {
  startDate: string;
  day: number;
  last: number;
  today: number;
  onChange: (day: number) => void;
}) {
  const go = (d: number) => onChange(Math.max(0, Math.min(last, d)));

  return (
    <div className="scrubber glass">
      <div className="scrubber-head">
        <div>
          <span className="scrubber-date">{longDayFormat.format(workdayDate(startDate, day))}</span>
          <span className="scrubber-count">
            Day {day + 1} of {last + 1}
          </span>
        </div>
        <button type="button" className="today" disabled={day === today} onClick={() => go(today)}>
          Today
        </button>
      </div>
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
