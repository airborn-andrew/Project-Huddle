"use client";

import { useEffect, useRef, useState } from "react";
import { Sheet } from "@/components/sheet";

/**
 * Crops a photo of a door sample to a square of its finish. The square moves
 * with a drag and changes size with the slider; the result is a 512-pixel
 * square saved with the project's photos.
 */
export function FinishCrop({ slug, file, onDone, onClose }: { slug: string; file: File; onDone: (url: string) => void; onClose: () => void }) {
  const [src] = useState(() => URL.createObjectURL(file));
  const [box, setBox] = useState({ x: 0.5, y: 0.5, size: 0.5 });
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const drag = useRef<{ x: number; y: number; start: typeof box } | null>(null);

  useEffect(() => () => URL.revokeObjectURL(src), [src]);

  // The square's side, as a share of the photo's shorter side.
  const side = natural ? Math.min(natural.w, natural.h) * box.size : 0;
  const clamp = (b: typeof box) => {
    if (!natural) return b;
    const s = Math.min(natural.w, natural.h) * b.size;
    const hx = s / 2 / natural.w;
    const hy = s / 2 / natural.h;
    return { ...b, x: Math.min(1 - hx, Math.max(hx, b.x)), y: Math.min(1 - hy, Math.max(hy, b.y)) };
  };

  const down = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, start: box };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    const rect = image.current?.getBoundingClientRect();
    if (!d || !rect) return;
    setBox(clamp({ ...d.start, x: d.start.x + (e.clientX - d.x) / rect.width, y: d.start.y + (e.clientY - d.y) / rect.height }));
  };

  const save = async () => {
    if (!natural || !image.current) return;
    setSaving(true);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 512;
    canvas.getContext("2d")!.drawImage(image.current, box.x * natural.w - side / 2, box.y * natural.h - side / 2, side, side, 0, 0, 512, 512);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), "image/jpeg", 0.85));
    const form = new FormData();
    form.append("file", new File([blob], "finish.jpg", { type: "image/jpeg" }));
    const res = await fetch(`/api/p/${slug}/photo`, { method: "POST", body: form });
    setSaving(false);
    if (res.ok) onDone((await res.json()).url);
  };

  return (
    <Sheet
      title="Your finish"
      onClose={onClose}
      footer={
        <div className="sheet-foot">
          <button type="button" className="button" disabled={!natural || saving} onClick={save}>
            {saving ? "Saving" : "Use this finish"}
          </button>
        </div>
      }
    >
      <p className="crop-hint">Move the square over the door sample.</p>
      <div className="crop" ref={frame}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a local photo before upload */}
        <img
          ref={image}
          src={src}
          alt=""
          onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
        />
        {natural && (
          <div
            className="crop-square"
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={() => (drag.current = null)}
            style={{
              left: `${(box.x - side / 2 / natural.w) * 100}%`,
              top: `${(box.y - side / 2 / natural.h) * 100}%`,
              width: `${(side / natural.w) * 100}%`,
              height: `${(side / natural.h) * 100}%`,
            }}
          />
        )}
      </div>
      <input
        className="crop-size"
        type="range"
        min={0.15}
        max={1}
        step={0.01}
        value={box.size}
        aria-label="Size of the square"
        onChange={(e) => setBox((b) => clamp({ ...b, size: Number(e.target.value) }))}
      />
    </Sheet>
  );
}
