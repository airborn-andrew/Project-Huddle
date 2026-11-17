"use client";

import { useEffect, useRef } from "react";

/** A thin line from the picked room on the plan to its detail card. */
export function Connector() {
  const line = useRef<SVGLineElement>(null);
  const dot = useRef<SVGCircleElement>(null);

  useEffect(() => {
    let frame = 0;
    const draw = () => {
      const from = document.querySelector('[data-picked="true"]')?.getBoundingClientRect();
      const to = document.querySelector(".room-panel")?.getBoundingClientRect();
      const l = line.current;
      const d = dot.current;
      if (l && d) {
        if (from && to) {
          const x1 = from.left + from.width / 2;
          const y1 = from.bottom + 18;
          // Meet the card on its nearest side.
          const below = to.top > y1;
          const x2 = below ? Math.min(Math.max(x1, to.left + 24), to.right - 24) : to.left;
          const y2 = below ? to.top : Math.min(Math.max(y1, to.top + 24), to.bottom - 24);
          l.setAttribute("x1", String(x1));
          l.setAttribute("y1", String(y1));
          l.setAttribute("x2", String(x2));
          l.setAttribute("y2", String(y2));
          d.setAttribute("cx", String(x1));
          d.setAttribute("cy", String(y1));
          l.style.opacity = d.style.opacity = "1";
        } else {
          l.style.opacity = d.style.opacity = "0";
        }
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <svg className="connector" aria-hidden="true">
      <line ref={line} />
      <circle ref={dot} r="3.5" />
    </svg>
  );
}
