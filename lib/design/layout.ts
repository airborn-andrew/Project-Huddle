import { catalogItem, type CatalogItem } from "@/lib/design/catalog";
import type { Plan, Room } from "@/lib/types";

/**
 * A Design Room layout, in inches. x runs east and y runs north from the
 * room's southwest corner. A piece's x and y are its center; rotation is in
 * degrees, and a piece at 0 has its front facing south (toward y = 0),
 * 90 faces east, 180 north and 270 west.
 */

export type Opening = {
  kind: "door" | "window";
  /** Where the opening starts and ends along its wall. */
  from: [number, number];
  to: [number, number];
  /** Inches from the floor. */
  bottom: number;
  top: number;
};

/** The room from the sketch. It never changes in the Design Room. */
export type Shell = {
  /** Corners of the room, counterclockwise. */
  walls: [number, number][];
  height: number;
  openings: Opening[];
  /** Where the room's southwest corner sits in the plan, in feet, so the room lines up with the 3D model. */
  origin: [number, number];
};

export type Piece = {
  id: string;
  item: string;
  x: number;
  y: number;
  rotation: number;
};

export type LayoutStatus = "open" | "ready" | "locked";

/** The rooms that get a Design Room. */
export const designRooms = (plan: Plan): Room[] => plan.rooms.filter((r) => /kitchen/i.test(r.name));

type Rect = { minX: number; minY: number; maxX: number; maxY: number };

/** The floor area a piece covers. Rotation is always a quarter turn, so it is a box. */
export function footprint(p: Piece, item: CatalogItem): Rect {
  const turned = Math.round(p.rotation / 90) % 2 !== 0;
  const w = turned ? item.depth : item.width;
  const d = turned ? item.width : item.depth;
  return { minX: p.x - w / 2, minY: p.y - d / 2, maxX: p.x + w / 2, maxY: p.y + d / 2 };
}

export function pointInPolygon([x, y]: [number, number], poly: [number, number][]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** True when the box stays inside the room's walls. Walls run square, so corners and wall corners tell. */
export function insideRoom(r: Rect, walls: [number, number][], give = 0.5) {
  const s = { minX: r.minX + give, minY: r.minY + give, maxX: r.maxX - give, maxY: r.maxY - give };
  const corners: [number, number][] = [
    [s.minX, s.minY],
    [s.maxX, s.minY],
    [s.maxX, s.maxY],
    [s.minX, s.maxY],
  ];
  if (!corners.every((c) => pointInPolygon(c, walls))) return false;
  return !walls.some(([x, y]) => x > s.minX && x < s.maxX && y > s.minY && y < s.maxY);
}

const overlaps = (a: Rect, b: Rect, give = 0.5) =>
  a.minX < b.maxX - give && b.minX < a.maxX - give && a.minY < b.maxY - give && b.minY < a.maxY - give;

/** Pieces share space when both stand on the floor or both hang on the wall. Tall pieces do both. */
export const sameSpace = (a: CatalogItem, b: CatalogItem) => a.layer === "both" || b.layer === "both" || a.layer === b.layer;

/** Whether `piece` can sit where it is, given the other pieces. */
export function fits(piece: Piece, others: Piece[], shell: Shell) {
  const item = catalogItem(piece.item);
  if (!item) return false;
  const box = footprint(piece, item);
  if (!insideRoom(box, shell.walls)) return false;
  return others.every((o) => {
    const other = catalogItem(o.item);
    return o.id === piece.id || !other || !sameSpace(item, other) || !overlaps(box, footprint(o, other));
  });
}

export const MAX_PIECES = 120;

/**
 * Everything wrong with a set of pieces, in plain words. An empty list means
 * the layout can be saved.
 */
export function checkPieces(pieces: unknown, shell: Shell): { pieces: Piece[]; problems: string[] } {
  if (!Array.isArray(pieces)) return { pieces: [], problems: ["The layout has no list of pieces."] };
  const problems: string[] = [];
  if (pieces.length > MAX_PIECES) problems.push(`A layout can hold up to ${MAX_PIECES} pieces.`);
  const clean: Piece[] = [];
  const ids = new Set<string>();
  for (const raw of pieces.slice(0, MAX_PIECES)) {
    const p = raw as Partial<Piece> | null;
    const item = typeof p?.item === "string" ? catalogItem(p.item.trim().toUpperCase()) : undefined;
    if (!item) {
      problems.push(`"${String(p?.item ?? "")}" is not in the catalog.`);
      continue;
    }
    const x = Number(p?.x);
    const y = Number(p?.y);
    const rotation = Number(p?.rotation ?? 0);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      problems.push(`The ${item.id} needs an x and a y.`);
      continue;
    }
    if (!Number.isFinite(rotation) || Math.abs(rotation % 90) > 0.5) {
      problems.push(`The ${item.id} at ${round(x)}, ${round(y)} has to turn in quarter turns (0, 90, 180 or 270).`);
      continue;
    }
    let id = typeof p?.id === "string" && p.id.trim() ? p.id.trim().slice(0, 24) : "";
    if (!id || ids.has(id)) id = newPieceId();
    ids.add(id);
    clean.push({ id, item: item.id, x: round(x), y: round(y), rotation: (((Math.round(rotation / 90) * 90) % 360) + 360) % 360 });
  }

  for (const [i, p] of clean.entries()) {
    const item = catalogItem(p.item)!;
    const box = footprint(p, item);
    if (!insideRoom(box, shell.walls)) {
      problems.push(`The ${p.item} at ${p.x}, ${p.y} reaches past the walls.`);
      continue;
    }
    for (const o of clean.slice(i + 1)) {
      const other = catalogItem(o.item)!;
      if (sameSpace(item, other) && overlaps(box, footprint(o, other))) {
        problems.push(`The ${p.item} at ${p.x}, ${p.y} and the ${o.item} at ${o.x}, ${o.y} overlap.`);
      }
    }
  }
  return { pieces: clean, problems };
}

const round = (v: number) => Math.round(v * 4) / 4;

export const newPieceId = () => Math.random().toString(36).slice(2, 10);
