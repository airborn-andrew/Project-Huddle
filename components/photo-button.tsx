"use client";

import { Camera } from "lucide-react";
import { useRef, useState } from "react";
import { uploadPhoto } from "@/lib/client";
import type { Photo } from "@/lib/types";

/** Camera button that uploads the chosen photos and hands them back. */
export function PhotoButton({ slug, onAdd }: { slug: string; onAdd: (photos: Photo[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  return (
    <>
      <button
        type="button"
        className="icon-button"
        aria-label="Add photo"
        disabled={busy}
        onClick={() => input.current?.click()}
      >
        <Camera />
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={async (e) => {
          const files = Array.from(e.target.files ?? []).slice(0, 6);
          e.target.value = "";
          if (!files.length) return;
          setBusy(true);
          try {
            onAdd(await Promise.all(files.map((f) => uploadPhoto(slug, f))));
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}
