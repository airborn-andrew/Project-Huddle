"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Piece } from "@/lib/design/layout";
import type { Layout, SavedVersion } from "@/lib/design/store";

export type LayoutState = { layout: Layout; versions: SavedVersion[] };

/**
 * A room's layout on the client. Changes show at once and save in order; a
 * save that lands after someone else's takes their layout instead, and a
 * refused save puts back what was saved. Refreshes when the page comes back
 * into view and every 20 seconds.
 */
export function useLayout(slug: string, room: string, initial: LayoutState, onSaved?: (version: number) => void) {
  const [state, setState] = useState(initial);
  const [notice, setNotice] = useState<string | null>(null);
  const saved = useRef(initial.layout);
  const queue = useRef<{ body: Record<string, unknown> } | null>(null);
  const busy = useRef(false);
  const url = `/api/p/${slug}/design/${room}`;

  const adopt = useCallback((next: LayoutState) => {
    saved.current = next.layout;
    setState(next);
  }, []);

  const saved$ = useRef(onSaved);
  saved$.current = onSaved;

  const refresh = useCallback(async () => {
    if (document.hidden || busy.current) return;
    const res = await fetch(url, { cache: "no-store" });
    if (res.ok && !busy.current) {
      const next = (await res.json()) as LayoutState;
      if (next.layout.version !== saved.current.version) adopt(next);
    }
  }, [url, adopt]);

  useEffect(() => {
    const timer = setInterval(refresh, 20_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [refresh]);

  const flush = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    while (queue.current) {
      const { body } = queue.current;
      queue.current = null;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, version: saved.current.version }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        saved.current = data.layout;
        saved$.current?.(data.layout.version);
        // Keep what is on screen when more changes are waiting to save.
        setState((s) => (queue.current ? { ...s, versions: data.versions } : data));
      } else {
        queue.current = null;
        if (data.layout) adopt({ layout: data.layout, versions: data.versions ?? [] });
        else setState((s) => ({ ...s, layout: saved.current }));
        setNotice(
          res.status === 409
            ? "The layout changed on the other side. This is the latest."
            : (data.error as string | undefined) ?? "That change could not be saved.",
        );
      }
    }
    busy.current = false;
  }, [url, adopt]);

  /** Shows the pieces now and saves them. */
  const save = useCallback(
    (pieces: Piece[]) => {
      setState((s) => ({ ...s, layout: { ...s.layout, pieces } }));
      queue.current = { body: { action: "save", pieces } };
      void flush();
    },
    [flush],
  );

  const restore = useCallback(
    (version: number) => {
      queue.current = { body: { action: "restore", restore: version } };
      void flush();
    },
    [flush],
  );

  /** Saves a layout file back from an AI. Returns what is wrong with it, or null once it is saved. */
  const upload = useCallback(
    async (text: string): Promise<string[] | null> => {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "upload", text, version: saved.current.version }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.layout) {
        adopt({ layout: data.layout, versions: data.versions ?? [] });
        if (res.ok) saved$.current?.(data.layout.version);
      }
      if (res.ok) return null;
      if (res.status === 409) return ["The layout changed while you were away. Send your AI the latest file and try again."];
      return (data.problems as string[] | undefined) ?? [(data.error as string | undefined) ?? "That file could not be saved."];
    },
    [url, adopt],
  );

  return { layout: state.layout, versions: state.versions, save, restore, refresh, upload, notice, clearNotice: () => setNotice(null) };
}
