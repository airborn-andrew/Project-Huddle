"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type SheetName = "messages" | "changes" | "selections" | "closeout" | "photos" | "team";

/**
 * What is open on the plan, from the bottom layer up: a level in focus, a
 * picked room, and a sheet. `about` narrows Messages to one room.
 */
export type View = { focus: string | null; room: string | null; sheet: SheetName | null; about: string | null };

const root: View = { focus: null, room: null, sheet: null, about: null };
const sheets: SheetName[] = ["messages", "changes", "selections", "closeout", "photos", "team"];

/** ?level=main&room=kitchen&sheet=messages&about=kitchen */
export function viewQuery(view: Partial<View>) {
  const q = new URLSearchParams();
  if (view.focus) q.set("level", view.focus);
  if (view.room) q.set("room", view.room);
  if (view.sheet) q.set("sheet", view.sheet);
  if (view.about) q.set("about", view.about);
  const s = q.toString();
  return s ? `?${s}` : "";
}

function readQuery(search: string): View {
  const q = new URLSearchParams(search);
  const sheet = q.get("sheet") as SheetName | null;
  return {
    focus: q.get("level"),
    room: q.get("room"),
    sheet: sheet && sheets.includes(sheet) ? sheet : null,
    about: q.get("about"),
  };
}

const isRoot = (v: View) => !v.focus && !v.room && !v.sheet;

type Entry = { huddle: View; depth: number };

/**
 * Every layer that opens adds a browser history entry, so the phone's back
 * gesture and the browser's back button step out one layer at a time. The open
 * layers are in the URL, so a link can open a sheet or a room directly.
 */
export function useView() {
  const [view, setView] = useState<View>(root);
  const current = useRef(view);
  current.current = view;

  useEffect(() => {
    // A link that opens a layer lands with it open; closing it then clears the URL.
    const linked = (window.history.state as Entry | null)?.huddle ?? readQuery(window.location.search);
    if (!isRoot(linked)) {
      current.current = linked;
      setView(linked);
    }
    const onPop = (e: PopStateEvent) => setView((e.state as Entry | null)?.huddle ?? readQuery(window.location.search));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  /** Opens a layer on top, or swaps the top layer when `replace` is set. */
  const open = useCallback((change: Partial<View>, replace = false) => {
    const next = { ...current.current, ...change };
    const depth = (window.history.state as Entry | null)?.depth ?? 0;
    const url = window.location.pathname + viewQuery(next);
    if (replace) window.history.replaceState({ huddle: next, depth } satisfies Entry, "", url);
    else window.history.pushState({ huddle: next, depth: depth + 1 } satisfies Entry, "", url);
    current.current = next;
    setView(next);
  }, []);

  /** Steps out of the top layer. */
  const back = useCallback(() => {
    const depth = (window.history.state as Entry | null)?.depth ?? 0;
    if (depth > 0) window.history.back();
    else if (!isRoot(current.current)) open(root, true);
  }, [open]);

  /** Closes every layer. */
  const home = useCallback(() => {
    const depth = (window.history.state as Entry | null)?.depth ?? 0;
    if (depth > 0) window.history.go(-depth);
    else if (!isRoot(current.current)) open(root, true);
  }, [open]);

  return { view, open, back, home };
}
