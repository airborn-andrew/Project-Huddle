"use client";

import { useCallback, useEffect, useState } from "react";
import type { Photo, ProjectState } from "@/lib/types";

/** Shared project state on the client: refreshed every 20 seconds and after each change. */
export function useProject(slug: string, initial: ProjectState) {
  const [state, setState] = useState(initial);

  useEffect(() => {
    const refresh = async () => {
      if (document.hidden) return;
      const res = await fetch(`/api/p/${slug}`, { cache: "no-store" });
      if (res.ok) setState(await res.json());
    };
    const timer = setInterval(refresh, 20_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [slug]);

  const act = useCallback(
    async (action: string, body: Record<string, unknown> = {}) => {
      const res = await fetch(`/api/p/${slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...body }),
      });
      if (res.ok) setState(await res.json());
      return res.ok;
    },
    [slug],
  );

  return { state, act };
}

/** Resizes a photo in the browser, then uploads it. */
export async function uploadPhoto(slug: string, file: File): Promise<Photo> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
  const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), "image/jpeg", 0.82));
  const form = new FormData();
  form.append("file", new File([blob], "photo.jpg", { type: "image/jpeg" }));
  const res = await fetch(`/api/p/${slug}/photo`, { method: "POST", body: form });
  const { url } = await res.json();
  return { url, width, height };
}
