import { catalogItem, type CatalogItem } from "@/lib/design/catalog";
import { fits, footprint, newPieceId, sameSpace, type Piece, type Shell } from "@/lib/design/layout";

/**
 * Where a piece lands while someone drags it. Cabinets and appliances turn to
 * put their back on the nearest wall and slide flush to it, then close small
 * gaps against their neighbors and the room's corners. Islands only close gaps.
 * All in inches.
 */

const WALL_REACH = 12;
const GAP = 4;

type Wall = { from: [number, number]; to: [number, number]; normal: [number, number] };

/** Each wall of the room, with the direction that points into the room. */
export function wallsOf(shell: Shell): Wall[] {
  return shell.walls.map((from, i) => {
    const to = shell.walls[(i + 1) % shell.walls.length];
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const len = Math.hypot(dx, dy) || 1;
    // The outline runs counterclockwise, so the room is on the left of each wall.
    return { from, to, normal: [-dy / len, dx / len] };
  });
}

/** The rotation that faces a piece's front along `dir`: 0 south, 90 east, 180 north, 270 west. */
const facing = ([x, y]: [number, number]) => ((Math.round((Math.atan2(x, -y) * 180) / Math.PI / 90) * 90) % 360 + 360) % 360;

export function snapPiece(piece: Piece, others: Piece[], shell: Shell): Piece {
  const item = catalogItem(piece.item);
  if (!item) return piece;
  let next = { ...piece };

  if (item.group !== "island") {
    const wall = nearestWall(next, item, shell);
    if (wall) {
      const rotation = facing(wall.normal);
      const half = item.depth / 2;
      // Slide along the wall, back flush against it.
      const alongX = Math.abs(wall.normal[1]) > 0.5;
      next = alongX
        ? { ...next, rotation, y: wall.from[1] + wall.normal[1] * half }
        : { ...next, rotation, x: wall.from[0] + wall.normal[0] * half };
    }
  }

  next = closeGaps(next, item, others, shell);
  return { ...next, x: Math.round(next.x * 4) / 4, y: Math.round(next.y * 4) / 4 };
}

function nearestWall(piece: Piece, item: CatalogItem, shell: Shell) {
  let best: Wall | null = null;
  let bestGap = item.depth / 2 + WALL_REACH;
  for (const wall of wallsOf(shell)) {
    const alongX = Math.abs(wall.normal[1]) > 0.5;
    const [lo, hi] = alongX ? sorted(wall.from[0], wall.to[0]) : sorted(wall.from[1], wall.to[1]);
    const along = alongX ? piece.x : piece.y;
    if (along < lo - item.width / 2 || along > hi + item.width / 2) continue;
    // Distance from the piece's center into the room from this wall.
    const gap = alongX ? (piece.y - wall.from[1]) * wall.normal[1] : (piece.x - wall.from[0]) * wall.normal[0];
    if (gap > -item.depth && gap < bestGap) {
      best = wall;
      bestGap = gap;
    }
  }
  return best;
}

/** Moves the piece up to a few inches so it meets a neighbor or a wall instead of leaving a sliver. */
function closeGaps(piece: Piece, item: CatalogItem, others: Piece[], shell: Shell): Piece {
  const box = footprint(piece, item);
  const xs = shell.walls.map(([x]) => x);
  const ys = shell.walls.map(([, y]) => y);
  const lines = { x: [...xs], y: [...ys] };
  for (const o of others) {
    const other = catalogItem(o.item);
    if (o.id === piece.id || !other || !sameSpace(item, other)) continue;
    const b = footprint(o, other);
    const besideY = box.minY < b.maxY && b.minY < box.maxY;
    const besideX = box.minX < b.maxX && b.minX < box.maxX;
    if (besideY) lines.x.push(b.minX, b.maxX);
    if (besideX) lines.y.push(b.minY, b.maxY);
  }
  const shift = (min: number, max: number, at: number[]) => {
    let best = 0;
    for (const line of at) {
      for (const d of [line - min, line - max]) if (Math.abs(d) < GAP && (best === 0 || Math.abs(d) < Math.abs(best))) best = d;
    }
    return best;
  };
  return { ...piece, x: piece.x + shift(box.minX, box.maxX, lines.x), y: piece.y + shift(box.minY, box.maxY, lines.y) };
}

const sorted = (a: number, b: number): [number, number] => (a < b ? [a, b] : [b, a]);

/** The piece turned a quarter turn clockwise. */
export const turned = (p: Piece): Piece => ({ ...p, rotation: (p.rotation + 270) % 360 });

/**
 * A place for a new piece: along a wall where it fits, or for an island, the
 * open middle of the room. Null when the room has no room for it.
 */
export function freeSpot(itemId: string, pieces: Piece[], shell: Shell, near?: [number, number]): Piece | null {
  const item = catalogItem(itemId);
  if (!item) return null;
  const candidates: Piece[] = [];
  const xs = shell.walls.map(([x]) => x);
  const ys = shell.walls.map(([, y]) => y);
  const [cx, cy] = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  if (item.group === "island") {
    for (let r = 0; r < 60; r += 3) {
      for (const [dx, dy] of [
        [0, 0],
        [r, 0],
        [-r, 0],
        [0, r],
        [0, -r],
      ]) {
        candidates.push({ id: "", item: itemId, x: cx + dx, y: cy + dy, rotation: 0 });
      }
    }
  } else {
    for (const wall of wallsOf(shell)) {
      const len = Math.hypot(wall.to[0] - wall.from[0], wall.to[1] - wall.from[1]);
      const dir: [number, number] = [(wall.to[0] - wall.from[0]) / len, (wall.to[1] - wall.from[1]) / len];
      for (let t = item.width / 2; t <= len - item.width / 2; t += 3) {
        candidates.push({
          id: "",
          item: itemId,
          x: wall.from[0] + dir[0] * t + (wall.normal[0] * item.depth) / 2,
          y: wall.from[1] + dir[1] * t + (wall.normal[1] * item.depth) / 2,
          rotation: facing(wall.normal),
        });
      }
    }
    if (near) candidates.sort((a, b) => Math.hypot(a.x - near[0], a.y - near[1]) - Math.hypot(b.x - near[0], b.y - near[1]));
  }
  const spot = candidates.find((c) => fits(c, pieces, shell));
  return spot ? { ...spot, id: newPieceId(), x: Math.round(spot.x * 4) / 4, y: Math.round(spot.y * 4) / 4 } : null;
}
