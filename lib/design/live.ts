"use client";

import { createClient, type RealtimeChannel } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Piece } from "@/lib/design/layout";
import type { Role } from "@/lib/types";

/** Where the page joins the room's live channel. Null when live editing is not set up. */
export type LiveConfig = { url: string; key: string; channel: string } | null;

type Handlers = {
  /** Someone else is moving a piece; null when they let go. */
  onMove: (piece: Piece | null, id: string) => void;
  /** Someone else saved; the layout should be fetched again. */
  onSaved: (version: number) => void;
};

/**
 * Live editing over Supabase Realtime. Both sides see a piece move while it is
 * dragged, hear about each save the moment it lands, and see who else has the
 * room open. Nothing here is saved: saves still go through the server, which
 * checks them. The channel's name is a signed secret, and the tables stay
 * closed to the publishable key.
 */
export function useLive(config: LiveConfig, role: Role, handlers: Handlers) {
  const [others, setOthers] = useState<Role[]>([]);
  const channel = useRef<RealtimeChannel | null>(null);
  const ready = useRef(false);
  const on = useRef(handlers);
  on.current = handlers;

  useEffect(() => {
    if (!config) return;
    const me = Math.random().toString(36).slice(2);
    const client = createClient(config.url, config.key, { auth: { persistSession: false, autoRefreshToken: false } });
    const ch = client.channel(config.channel, { config: { broadcast: { self: false }, presence: { key: me } } });
    ch.on("broadcast", { event: "move" }, ({ payload }) => on.current.onMove(payload.piece ?? null, payload.id));
    ch.on("broadcast", { event: "saved" }, ({ payload }) => on.current.onSaved(payload.version));
    ch.on("presence", { event: "sync" }, () => {
      const state = ch.presenceState<{ role: Role }>();
      setOthers(Object.entries(state).filter(([k]) => k !== me).flatMap(([, v]) => v.map((p) => p.role)));
    });
    ch.subscribe(async (status) => {
      ready.current = status === "SUBSCRIBED";
      if (ready.current) await ch.track({ role });
    });
    channel.current = ch;
    return () => {
      ready.current = false;
      channel.current = null;
      void client.removeChannel(ch);
    };
  }, [config, role]);

  // Moves go out at most every 60 ms, with the last one always sent.
  const pending = useRef<{ piece: Piece | null; id: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendMove = useCallback((id: string, piece: Piece | null) => {
    pending.current = { id, piece };
    if (timer.current) return;
    const flush = () => {
      timer.current = null;
      const next = pending.current;
      pending.current = null;
      if (next && ready.current) void channel.current?.send({ type: "broadcast", event: "move", payload: next });
    };
    if (piece === null) flush();
    else timer.current = setTimeout(flush, 60);
  }, []);

  const sendSaved = useCallback((version: number) => {
    if (ready.current) void channel.current?.send({ type: "broadcast", event: "saved", payload: { version } });
  }, []);

  return { others, sendMove, sendSaved };
}
