"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

/** A bottom sheet in the iOS style: drag the grabber down, tap outside or press Esc to close. */
export function Sheet({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const down = (e: React.PointerEvent) => {
    start.current = e.clientY;
    setDragging(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    if (start.current !== null) setDrag(Math.max(0, e.clientY - start.current));
  };
  const up = () => {
    start.current = null;
    setDragging(false);
    if (drag > 120) onClose();
    else setDrag(0);
  };

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <section
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-dragging={dragging}
        style={{ "--drag": `${drag}px` } as React.CSSProperties}
      >
        <div className="grabber" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
        <header className="sheet-head" onPointerDown={down} onPointerMove={move} onPointerUp={up}>
          <h2 className="sheet-title">{title}</h2>
          <button type="button" className="close" aria-label="Close" onClick={onClose} onPointerDown={(e) => e.stopPropagation()}>
            <X />
          </button>
        </header>
        <div className="sheet-body">{children}</div>
        {footer}
      </section>
    </>
  );
}
