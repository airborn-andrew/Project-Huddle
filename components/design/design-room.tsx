"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { Box, Camera, Check, Rotate3d, ChevronLeft, ClipboardList, Grid2x2, History, Lock, LockOpen, PencilLine, RotateCw, Trash2, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FinishCrop } from "@/components/design/finish-crop";
import { Sheet } from "@/components/sheet";
import type { StageApi, ViewMode } from "@/components/design/stage";
import { catalog, catalogItem, groups, type CatalogItem, type Group } from "@/lib/design/catalog";
import { useLayout, type LayoutState } from "@/lib/design/client";
import { arKind, openAr, type ArKind } from "@/lib/design/ar";
import { finishNames, planDxf, schedule, scheduleCsv } from "@/lib/design/schedule";
import { useLive, type LiveConfig } from "@/lib/design/live";
import { doorStyles, fits, newPieceId, paints, type DoorStyle, type Piece } from "@/lib/design/layout";
import { freeSpot, snapPiece, turned } from "@/lib/design/snap";
import type { Role } from "@/lib/types";

const Stage = dynamic(() => import("@/components/design/stage").then((m) => m.Stage), { ssr: false });

/** Room the dock takes at the bottom of the screen, for framing the room above it. */
const DOCK = 220;


export function DesignRoom({
  slug,
  project,
  room,
  roomName,
  role,
  initial,
  live,
}: {
  slug: string;
  project: string;
  room: string;
  roomName: string;
  role: Role;
  initial: LayoutState;
  live: LiveConfig;
}) {
  // Pieces the other side is moving right now, shown where their finger is.
  const [remote, setRemote] = useState<Record<string, Piece>>({});
  const refreshRef = useRef<() => void>(() => {});
  const { others, sendMove, sendSaved } = useLive(live, role, {
    onMove: (piece, id) =>
      setRemote((r) => {
        const next = { ...r };
        if (piece) next[id] = piece;
        else delete next[id];
        return next;
      }),
    onSaved: () => refreshRef.current(),
  });
  const { layout, versions, save, restore, refresh, setStatus, notice, clearNotice } = useLayout(slug, room, initial, sendSaved);
  refreshRef.current = () => void refresh();
  /** Who else has the room open, the other side first. */
  const here = others.find((r) => r !== role) ?? others[0];
  const [mode, setMode] = useState<ViewMode>("plan");
  const [selected, setSelected] = useState<string | null>(null);
  const [group, setGroup] = useState<Group>("base");
  const [draft, setDraft] = useState<Piece | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [pane, setPane] = useState<"size" | "doors" | "finish">("size");
  const [photo, setPhoto] = useState<File | null>(null);
  const [readyOpen, setReadyOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [ar, setAr] = useState<ArKind>(null);
  const [arBusy, setArBusy] = useState(false);
  const [arProblem, setArProblem] = useState<string | null>(null);
  useEffect(() => setAr(arKind()), []);
  const undo = useRef<Piece[][]>([]);
  const stage = useRef<StageApi | null>(null);
  const dock = useRef<HTMLDivElement>(null);
  const editable = layout.status === "open" || role === "ohi";

  const pieces = layout.pieces;
  const look = useMemo(() => kitchenLook(pieces), [pieces]);
  // A fresh layout replaces the other side's moves in progress.
  useEffect(() => setRemote({}), [layout.version]);

  const shown = useMemo(() => {
    const moving = { ...remote, ...(draft && { [draft.id]: draft }) };
    const placed = pieces.map((p) => moving[p.id] ?? p);
    return [...placed, ...Object.values(moving).filter((m) => !pieces.some((p) => p.id === m.id))];
  }, [pieces, draft, remote]);
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
        sendMove(last.id, last);
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        setDraft(null);
        sendMove(start.id, null);
        const placed = last;
        if (placed && fits(placed, others, layout.shell)) commit(pieces.map((p) => (p.id === placed.id ? placed : p)));
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
      move(first);
    },
    [pieces, layout.shell, commit, sendMove],
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

  /** A new cabinet takes the door style and finish the kitchen already has. */
  const styled = (p: Piece): Piece => (catalogItem(p.item)?.group === "appliance" ? p : { ...p, ...look });

  /** A catalog item: drag it up into the room, or tap it to place it in the first open spot. */
  const onItemDown = (item: CatalogItem) => (e: React.PointerEvent) => {
    if (!editable) return;
    const startY = e.clientY;
    const fromDock = (ev: PointerEvent) => {
      if (startY - ev.clientY < 24) return;
      window.removeEventListener("pointermove", fromDock);
      window.removeEventListener("pointerup", tap);
      followNew(styled({ id: newPieceId(), item: item.id, x: 0, y: 0, rotation: 0 }), ev);
    };
    const tap = () => {
      window.removeEventListener("pointermove", fromDock);
      window.removeEventListener("pointerup", tap);
      const spot = freeSpot(item.id, pieces, layout.shell);
      if (spot) {
        commit([...pieces, styled(spot)]);
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
        sendMove(seed.id, null);
        return;
      }
      last = snapPiece({ ...seed, x: at[0], y: at[1] }, pieces, layout.shell);
      setDraft(last);
      sendMove(seed.id, last);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setDraft(null);
      sendMove(seed.id, null);
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

  /** Sets a cabinet's door style or finish, or every cabinet's when `all` is set. */
  const restyle = (id: string, change: { door?: DoorStyle; finish?: string }, all = false) => {
    commit(pieces.map((p) => (p.id === id || (all && catalogItem(p.item)?.group !== "appliance") ? { ...p, ...change } : p)));
  };

  /** The cabinets at true size in the real kitchen, on phones that can show AR. */
  const seeInKitchen = async () => {
    const model = stage.current?.arModel();
    if (!ar || !model || arBusy) return;
    setArBusy(true);
    try {
      await openAr(
        ar,
        model,
        async (glb) => {
          const form = new FormData();
          form.append("file", new File([glb], "room.glb", { type: "model/gltf-binary" }));
          const res = await fetch(`/api/p/${slug}/design/${room}/ar`, { method: "POST", body: form });
          if (!res.ok) throw new Error("upload");
          return (await res.json()).url as string;
        },
        `${project} ${roomName}`,
      );
    } catch {
      setArProblem("The kitchen could not open in AR. Try again in a moment.");
      setTimeout(() => setArProblem(null), 5000);
    } finally {
      setArBusy(false);
    }
  };

  const download = (name: string, body: string, type: string) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([body], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const back = () => {
    const previous = undo.current.pop();
    if (previous) save(previous);
  };

  const swaps = chosenItem ? catalog.filter((c) => c.group === chosenItem.group) : [];
  const isCabinet = Boolean(chosenItem && chosenItem.group !== "appliance");
  const finishes = useMemo(
    () => [...Object.keys(paints), ...new Set(pieces.map((p) => p.finish).filter((f): f is string => Boolean(f) && !(f! in paints)))],
    [pieces],
  );
  const shownPane = isCabinet ? pane : "size";

  // A newly picked piece opens on its sizes.
  useEffect(() => setPane("size"), [selected]);

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
            <p className="title-sub">
              {project}
              {layout.status === "ready" && " · Ready for OHI"}
              {layout.status === "locked" && " · Locked for ordering"}
              {here && ` · ${here === "home" ? "Homeowner" : "OHI"} is here too`}
            </p>
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
          {ar && (
            <button type="button" className="tool" aria-label="See it in your kitchen" disabled={arBusy} onClick={seeInKitchen}>
              <Rotate3d />
            </button>
          )}
          {editable && (
            <button type="button" className="tool" aria-label="Undo" disabled={!undo.current.length} onClick={back}>
              <Undo2 />
            </button>
          )}
          {role === "home" && layout.status === "open" && (
            <button type="button" className="tool" aria-label="Ready for OHI" onClick={() => setReadyOpen(true)}>
              <Check />
            </button>
          )}
          {role === "home" && layout.status === "ready" && (
            <button type="button" className="tool" aria-label="Keep changing it" onClick={() => setStatus("open")}>
              <PencilLine />
            </button>
          )}
          {role === "ohi" && (
            <button
              type="button"
              className="tool"
              aria-label={layout.status === "locked" ? "Open it for changes" : "Lock for ordering"}
              onClick={() => setStatus(layout.status === "locked" ? "open" : "locked")}
            >
              {layout.status === "locked" ? <LockOpen /> : <Lock />}
            </button>
          )}
          {role === "ohi" && layout.status === "locked" && (
            <button type="button" className="tool" aria-label="Cabinet schedule" onClick={() => setScheduleOpen(true)}>
              <ClipboardList />
            </button>
          )}
          {role === "ohi" && (
            <button type="button" className="tool" aria-label="Earlier versions" onClick={() => setHistoryOpen(true)}>
              <History />
            </button>
          )}
        </nav>
      </header>

      {(notice || arProblem) && (
        <button
          type="button"
          className="design-notice glass"
          onClick={() => {
            clearNotice();
            setArProblem(null);
          }}
        >
          {notice ?? arProblem}
        </button>
      )}

      <div className="dock glass-thick" ref={dock}>
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
            {editable && isCabinet && (
              <nav className="dock-tabs dock-tabs-piece" aria-label="Change">
                {(
                  [
                    ["size", "Size"],
                    ["doors", "Doors"],
                    ["finish", "Finish"],
                  ] as const
                ).map(([id, name]) => (
                  <button key={id} type="button" className="dock-tab" aria-pressed={shownPane === id} onClick={() => setPane(id)}>
                    {name}
                  </button>
                ))}
              </nav>
            )}
            {editable && shownPane === "size" && (
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
            {editable && shownPane === "doors" && (
              <div className="dock-row">
                {doorStyles.map((style) => (
                  <button
                    key={style}
                    type="button"
                    className="dock-item"
                    aria-pressed={(chosen.door ?? "shaker") === style}
                    onClick={() => restyle(chosen.id, { door: style })}
                  >
                    <span className="door-shape" data-style={style} aria-hidden="true" />
                    <span className="dock-item-name">{style[0].toUpperCase() + style.slice(1)}</span>
                  </button>
                ))}
                <button type="button" className="dock-action" onClick={() => restyle(chosen.id, { door: chosen.door ?? "shaker" }, true)}>
                  <span className="dock-action-text">Every cabinet</span>
                </button>
              </div>
            )}
            {editable && shownPane === "finish" && (
              <div className="dock-row">
                {finishes.map((f) => (
                  <button
                    key={f}
                    type="button"
                    className="dock-item"
                    aria-pressed={(chosen.finish ?? "white") === f}
                    aria-label={f in paints ? f : "Your finish"}
                    onClick={() => restyle(chosen.id, { finish: f })}
                  >
                    <span
                      className="finish-swatch"
                      style={f in paints ? { background: paints[f as keyof typeof paints] } : { backgroundImage: `url(${f})` }}
                    />
                    <span className="dock-item-name">{f in paints ? f[0].toUpperCase() + f.slice(1) : "Yours"}</span>
                  </button>
                ))}
                <label className="dock-action">
                  <Camera />
                  Photo
                  <input
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (file) setPhoto(file);
                    }}
                  />
                </label>
                <button type="button" className="dock-action" onClick={() => restyle(chosen.id, { finish: chosen.finish ?? "white" }, true)}>
                  <span className="dock-action-text">Every cabinet</span>
                </button>
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

      {photo && chosen && (
        <FinishCrop
          slug={slug}
          file={photo}
          onClose={() => setPhoto(null)}
          onDone={(url) => {
            setPhoto(null);
            restyle(chosen.id, { finish: url });
          }}
        />
      )}

      {readyOpen && (
        <Sheet
          title="Ready for OHI"
          onClose={() => setReadyOpen(false)}
          footer={
            <div className="sheet-foot">
              <button
                type="button"
                className="button"
                onClick={async () => {
                  await setStatus("ready");
                  setReadyOpen(false);
                }}
              >
                Send to OHI
              </button>
            </div>
          }
        >
          <p className="sheet-text">
            OHI gets word that your {roomName.toLowerCase()} is ready to look over. The layout stays as it is while OHI has it, and you can take it back to
            make more changes until OHI locks it for ordering.
          </p>
        </Sheet>
      )}

      {scheduleOpen && (
        <Sheet
          title="Cabinet schedule"
          onClose={() => setScheduleOpen(false)}
          footer={
            <div className="sheet-foot sheet-foot-pair">
              <button
                type="button"
                className="button button-quiet"
                onClick={() => download(`${project} ${roomName} schedule.csv`, scheduleCsv(pieces), "text/csv")}
              >
                Schedule (CSV)
              </button>
              <button
                type="button"
                className="button"
                onClick={() =>
                  download(
                    `${project} ${roomName} plan.dxf`,
                    planDxf({ project, roomName, shell: layout.shell, pieces, date: dateFormat.format(new Date()).toUpperCase() }),
                    "application/dxf",
                  )
                }
              >
                Plan view (DXF)
              </button>
            </div>
          }
        >
          <ScheduleTable pieces={pieces} />
        </Sheet>
      )}

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

function ScheduleTable({ pieces }: { pieces: Piece[] }) {
  const { lines } = schedule(pieces);
  const photos = [...new Set(pieces.map((p) => p.finish).filter((f): f is string => Boolean(f) && !(f! in paints)))];
  const name = finishNames(pieces);
  return (
    <>
      <table className="schedule">
        <thead>
          <tr>
            <th>Tag</th>
            <th>Qty</th>
            <th>Size</th>
            <th>Door, finish</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.tag}>
              <td>{l.tag}</td>
              <td>{l.count}</td>
              <td>{[l.item.width, l.item.depth, l.item.height].map((v) => String(v).replace(".5", "½")).join(" × ")}</td>
              <td>{[l.door && l.door[0].toUpperCase() + l.door.slice(1), l.finish].filter(Boolean).join(" · ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {photos.length > 0 && (
        <div className="schedule-finishes">
          {photos.map((url) => (
            <a key={url} href={url} target="_blank" rel="noreferrer" className="schedule-finish">
              <span className="finish-swatch" style={{ backgroundImage: `url(${url})` }} />
              {name(url)}
            </a>
          ))}
        </div>
      )}
    </>
  );
}

const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

/** The door style and finish most of the kitchen's cabinets have. */
function kitchenLook(pieces: Piece[]): { door?: DoorStyle; finish?: string } {
  const most = <T,>(values: (T | undefined)[]) => {
    const counts = new Map<T, number>();
    for (const v of values) if (v !== undefined) counts.set(v, (counts.get(v) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  };
  const cabinets = pieces.filter((p) => catalogItem(p.item)?.group !== "appliance");
  const door = most(cabinets.map((p) => p.door));
  const finish = most(cabinets.map((p) => p.finish));
  return { ...(door && { door }), ...(finish && { finish }) };
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
