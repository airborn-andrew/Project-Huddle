"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { Box, ChevronLeft, Grid2x2, History, RotateCw, Trash2, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sheet } from "@/components/sheet";
import type { StageApi, ViewMode } from "@/components/design/stage";
import { catalog, catalogItem, groups, type CatalogItem, type Group } from "@/lib/design/catalog";
import { useLayout, type LayoutState } from "@/lib/design/client";
import { fits, newPieceId, type Piece } from "@/lib/design/layout";
import { freeSpot, snapPiece, turned } from "@/lib/design/snap";
import type { Role } from "@/lib/types";

const Stage = dynamic(() => import("@/components/design/stage").then((m) => m.Stage), { ssr: false });

const DOCK = 196;


export function DesignRoom({
  slug,
  project,
  room,
  roomName,
  role,
  initial,
}: {
  slug: string;
  project: string;
  room: string;
  roomName: string;
  role: Role;
  initial: LayoutState;
}) {
  const { layout, versions, save, restore, notice, clearNotice } = useLayout(slug, room, initial);
  const [mode, setMode] = useState<ViewMode>("plan");
  const [selected, setSelected] = useState<string | null>(null);
  const [group, setGroup] = useState<Group>("base");
  const [draft, setDraft] = useState<Piece | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const undo = useRef<Piece[][]>([]);
  const stage = useRef<StageApi | null>(null);
  const dock = useRef<HTMLDivElement>(null);
  const editable = layout.status === "open" || role === "ohi";

  const pieces = layout.pieces;
  const shown = useMemo(() => {
    if (!draft) return pieces;
    return pieces.some((p) => p.id === draft.id) ? pieces.map((p) => (p.id === draft.id ? draft : p)) : [...pieces, draft];
  }, [pieces, draft]);
  const blocked = draft && !fits(draft, pieces, layout.shell) ? draft.id : null;

  const commit = useCallback(
    (next: Piece[]) => {
      undo.current.push(pieces);
      if (undo.current.length > 50) undo.current.shift();
      save(next);
    },
    [pieces, save],
  );

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(clearNotice, 5000);
    return () => clearTimeout(timer);
  }, [notice, clearNotice]);

  // A selected piece that someone else removed is no longer selected.
  useEffect(() => {
    if (selected && !pieces.some((p) => p.id === selected) && draft?.id !== selected) setSelected(null);
  }, [pieces, selected, draft]);

  /** Moves a piece in the room with the pointer until it is let go. */
  const follow = useCallback(
    (start: Piece, offset: [number, number], first: PointerEvent) => {
      let last: Piece | null = null;
      const others = pieces.filter((p) => p.id !== start.id);
      const move = (e: PointerEvent) => {
        const at = stage.current?.toFloor(e.clientX, e.clientY);
        if (!at) return;
        const moved = { ...start, x: at[0] - offset[0], y: at[1] - offset[1] };
        // A tap selects without moving anything.
        if (!last && Math.hypot(moved.x - start.x, moved.y - start.y) < 1.5) return;
        last = snapPiece(moved, others, layout.shell);
        setDraft(last);
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        setDraft(null);
        const placed = last;
        if (placed && fits(placed, others, layout.shell)) commit(pieces.map((p) => (p.id === placed.id ? placed : p)));
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
      move(first);
    },
    [pieces, layout.shell, commit],
  );

  const onPieceDown = useCallback(
    (id: string, e: PointerEvent) => {
      const piece = pieces.find((p) => p.id === id);
      const at = stage.current?.toFloor(e.clientX, e.clientY);
      if (!piece || !at) return;
      follow(piece, [at[0] - piece.x, at[1] - piece.y], e);
    },
    [pieces, follow],
  );

  /** A catalog item: drag it up into the room, or tap it to place it in the first open spot. */
  const onItemDown = (item: CatalogItem) => (e: React.PointerEvent) => {
    if (!editable) return;
    const startY = e.clientY;
    const fromDock = (ev: PointerEvent) => {
      if (startY - ev.clientY < 24) return;
      window.removeEventListener("pointermove", fromDock);
      window.removeEventListener("pointerup", tap);
      followNew({ id: newPieceId(), item: item.id, x: 0, y: 0, rotation: 0 }, ev);
    };
    const tap = () => {
      window.removeEventListener("pointermove", fromDock);
      window.removeEventListener("pointerup", tap);
      const spot = freeSpot(item.id, pieces, layout.shell);
      if (spot) {
        commit([...pieces, spot]);
        setSelected(spot.id);
      }
    };
    window.addEventListener("pointermove", fromDock);
    window.addEventListener("pointerup", tap);
  };

  const followNew = (seed: Piece, first: PointerEvent) => {
    let last: Piece | null = null;
    const move = (e: PointerEvent) => {
      const at = stage.current?.toFloor(e.clientX, e.clientY);
      const overDock = dock.current && e.clientY > dock.current.getBoundingClientRect().top;
      if (!at || overDock) {
        last = null;
        setDraft(null);
        return;
      }
      last = snapPiece({ ...seed, x: at[0], y: at[1] }, pieces, layout.shell);
      setDraft(last);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setDraft(null);
      if (last && fits(last, pieces, layout.shell)) {
        commit([...pieces, last]);
        setSelected(last.id);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    move(first);
  };

  const chosen = pieces.find((p) => p.id === selected) ?? null;
  const chosenItem = chosen ? catalogItem(chosen.item) : null;

  const rotate = (id: string) => {
    const piece = pieces.find((p) => p.id === id);
    if (!piece) return;
    const others = pieces.filter((p) => p.id !== id);
    const next = turned(piece);
    const snapped = snapPiece(next, others, layout.shell);
    // An island turns in place; a piece on a wall turns and finds the wall it now backs onto.
    const placed = [snapped, next].find((p) => fits(p, others, layout.shell) && p.rotation === next.rotation);
    if (placed) commit(pieces.map((p) => (p.id === id ? placed : p)));
  };

  const remove = (id: string) => {
    commit(pieces.filter((p) => p.id !== id));
    setSelected(null);
  };

  const swap = (id: string, itemId: string) => {
    const piece = pieces.find((p) => p.id === id);
    if (!piece || piece.item === itemId) return;
    const others = pieces.filter((p) => p.id !== id);
    const next = snapPiece({ ...piece, item: itemId }, others, layout.shell);
    if (fits(next, others, layout.shell)) commit(pieces.map((p) => (p.id === id ? next : p)));
  };

  const back = () => {
    const previous = undo.current.pop();
    if (previous) save(previous);
  };

  const swaps = chosenItem ? catalog.filter((c) => c.group === chosenItem.group) : [];

  return (
    <main className="huddle design">
      <Stage
        shell={layout.shell}
        pieces={shown}
        selected={selected}
        blocked={blocked}
        mode={mode}
        dockHeight={DOCK}
        editable={editable}
        onReady={(api) => {
          stage.current = api;
        }}
        onPieceDown={onPieceDown}
        onSelect={setSelected}
        onRotate={rotate}
      />

      <header className="topbar">
        <div className="design-title">
          <Link className="tool glass" aria-label="Back to the project" href={`/p/${slug}`}>
            <ChevronLeft />
          </Link>
          <div>
            <h1 className="title">{roomName}</h1>
            <p className="title-sub">{project}</p>
          </div>
        </div>
        <nav className="tools glass" aria-label="Design Room">
          <button
            type="button"
            className="tool"
            aria-label={mode === "plan" ? "Look around in 3D" : "Back to the plan"}
            onClick={() => setMode((m) => (m === "plan" ? "3d" : "plan"))}
          >
            {mode === "plan" ? <Box /> : <Grid2x2 />}
          </button>
          {editable && (
            <button type="button" className="tool" aria-label="Undo" disabled={!undo.current.length} onClick={back}>
              <Undo2 />
            </button>
          )}
          {role === "ohi" && (
            <button type="button" className="tool" aria-label="Earlier versions" onClick={() => setHistoryOpen(true)}>
              <History />
            </button>
          )}
        </nav>
      </header>

      {notice && (
        <button type="button" className="design-notice glass" onClick={clearNotice}>
          {notice}
        </button>
      )}

      <div className="dock glass-thick" ref={dock} style={{ height: DOCK }}>
        {chosen && chosenItem ? (
          <>
            <div className="dock-head">
              <div>
                <h2 className="dock-title">{chosenItem.name}</h2>
                <p className="dock-sub">
                  {chosenItem.id} · {inches(chosenItem.width)} wide, {inches(chosenItem.depth)} deep, {inches(chosenItem.height)} high
                </p>
              </div>
              <button type="button" className="close" aria-label="Done" onClick={() => setSelected(null)}>
                <X />
              </button>
            </div>
            {editable && (
              <div className="dock-row">
                <button type="button" className="dock-action" onClick={() => rotate(chosen.id)}>
                  <RotateCw />
                  Turn
                </button>
                <button type="button" className="dock-action" onClick={() => remove(chosen.id)}>
                  <Trash2 />
                  Remove
                </button>
                {swaps.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="dock-item"
                    aria-pressed={c.id === chosen.item}
                    onClick={() => swap(chosen.id, c.id)}
                  >
                    <ItemShape item={c} />
                    <span className="dock-item-name">{shortName(c)}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <nav className="dock-tabs" aria-label="Catalog">
              {groups.map((g) => (
                <button key={g.id} type="button" className="dock-tab" aria-pressed={group === g.id} onClick={() => setGroup(g.id)}>
                  {g.name}
                </button>
              ))}
            </nav>
            <div className="dock-row">
              {catalog
                .filter((c) => c.group === group)
                .map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="dock-item"
                    disabled={!editable}
                    aria-label={`${c.name}. Drag it into the room, or tap to add it.`}
                    onPointerDown={onItemDown(c)}
                  >
                    <ItemShape item={c} />
                    <span className="dock-item-name">{shortName(c)}</span>
                  </button>
                ))}
            </div>
          </>
        )}
      </div>

      {historyOpen && (
        <Sheet title="Earlier versions" onClose={() => setHistoryOpen(false)}>
          {versions.map((v) => (
            <div key={v.version} className="row version-row">
              <div>
                <p className="row-title">{when.format(new Date(v.savedAt))}</p>
                <p className="row-when">
                  {v.savedBy === "home" ? "Homeowner" : "OHI"} · {v.count} {v.count === 1 ? "piece" : "pieces"}
                </p>
              </div>
              {v.version === layout.version ? (
                <span className="row-when">Showing</span>
              ) : (
                <button
                  type="button"
                  className="button button-quiet"
                  onClick={() => {
                    restore(v.version);
                    setHistoryOpen(false);
                  }}
                >
                  Put back
                </button>
              )}
            </div>
          ))}
        </Sheet>
      )}
    </main>
  );
}

const when = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const inches = (v: number) => `${String(v).replace(".5", "½")}"`;

/** The width people shop by, plus the kind when the group holds more than one. */
function shortName(c: CatalogItem) {
  if (c.group === "appliance") return c.name.replace("Refrigerator", "Fridge").replace("Microwave hood", "Microwave");
  const kind = c.kind === "sink" ? "Sink " : c.kind === "drawers" ? "Drawers " : "";
  return `${kind}${inches(c.width)}`;
}

/** The piece seen from above, to scale within the dock. */
function ItemShape({ item }: { item: CatalogItem }) {
  const scale = 0.62;
  return (
    <span className="dock-item-shape" aria-hidden="true">
      <span style={{ width: Math.min(item.width, 72) * scale, height: Math.min(item.depth, 36) * scale }} />
    </span>
  );
}
