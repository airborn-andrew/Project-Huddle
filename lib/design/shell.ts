import { catalog, catalogItem } from "@/lib/design/catalog";
import { fits, newPieceId, type Opening, type Piece, type Shell } from "@/lib/design/layout";
import type { Plan, Room } from "@/lib/types";

/**
 * Builds a room's Design Room shell from the project's plan and 3D model, and
 * a first layout from the cabinets and appliances the sketch already shows.
 * The plan has each room's outline in feet; the model has every door leaf and
 * window pane as a named part, and glTF stores each part's bounds, so the
 * openings come straight from those bounds without reading any geometry.
 * The model's z axis is the plan's y turned around (z = -y).
 */

type Box = { min: [number, number, number]; max: [number, number, number] };
type Fixture = { kind: string; room: string };

/** Each named part of a .glb and its bounds. */
export function glbParts(bytes: ArrayBuffer): Map<string, Box> {
  const view = new DataView(bytes);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error("Not a glb file");
  const length = view.getUint32(12, true);
  const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, length)));
  const parts = new Map<string, Box>();
  for (const node of gltf.nodes ?? []) {
    if (node.mesh === undefined || !node.name) continue;
    const accessor = gltf.accessors[gltf.meshes[node.mesh].primitives[0].attributes.POSITION];
    const [tx, ty, tz] = node.translation ?? [0, 0, 0];
    parts.set(node.name, {
      min: [accessor.min[0] + tx, accessor.min[1] + ty, accessor.min[2] + tz],
      max: [accessor.max[0] + tx, accessor.max[1] + ty, accessor.max[2] + tz],
    });
  }
  return parts;
}

const inches = (feet: number) => Math.round(feet * 12 * 4) / 4;

export function buildShell(plan: Plan, room: Room, parts: Map<string, Box>): Shell {
  const xs = room.polygon.map(([x]) => x);
  const ys = room.polygon.map(([, y]) => y);
  const origin: [number, number] = [Math.min(...xs), Math.min(...ys)];
  const walls = tidy(room.polygon.map(([x, y]) => [inches(x - origin[0]), inches(y - origin[1])]));
  const level = plan.levels.find((l) => l.id === room.level);

  const openings: Opening[] = [];
  for (const [name, box] of parts) {
    const [level, , part = ""] = name.split("__");
    if (level !== room.level || !/^(glass|door)_\d+$/.test(part)) continue;
    // The opening's line in room inches: along the long side of its bounds, through the middle of the short side.
    const x0 = inches(box.min[0] - origin[0]);
    const x1 = inches(box.max[0] - origin[0]);
    const y0 = inches(-box.max[2] - origin[1]);
    const y1 = inches(-box.min[2] - origin[1]);
    const along: [[number, number], [number, number]] =
      x1 - x0 >= y1 - y0
        ? [
            [x0, (y0 + y1) / 2],
            [x1, (y0 + y1) / 2],
          ]
        : [
            [(x0 + x1) / 2, y0],
            [(x0 + x1) / 2, y1],
          ];
    const edge = nearestEdge(walls, along);
    if (!edge) continue;
    openings.push({
      kind: part.startsWith("glass") ? "window" : "door",
      from: project(along[0], edge),
      to: project(along[1], edge),
      bottom: inches(box.min[1]),
      top: inches(box.max[1]),
    });
  }

  return { walls, height: inches(level?.height ?? 8), openings, origin };
}

/**
 * The cabinets and appliances the sketch already has in the room, as catalog
 * pieces. A run of cabinets becomes the fewest standard boxes that fill it.
 */
export function seedPieces(plan: Plan & { fixtures?: Fixture[] }, room: Room, shell: Shell, parts: Map<string, Box>): Piece[] {
  const nodes = [...parts]
    .map(([name, box]) => ({ name, box, match: name.match(new RegExp(`^${room.level}__${room.id}__(cabinets|appliances|fixtures)_(\\d+)$`)) }))
    .filter((n) => n.match)
    .sort((a, b) => Number(a.match![2]) - Number(b.match![2]));
  const kinds = (plan.fixtures ?? []).filter((f) => f.room === room.id).map((f) => f.kind);
  const sameOrder = kinds.length === nodes.length;

  const pieces: Piece[] = [];
  const add = (p: Omit<Piece, "id">) => {
    const piece = { ...p, id: newPieceId() };
    if (fits(piece, pieces, shell)) pieces.push(piece);
  };

  // Each piece backs onto a wall. A square piece in a corner touches two;
  // it takes the wall most of the other pieces back onto, so runs stay runs.
  const runs = nodes.map((n, i) => {
    const [ox, oy] = shell.origin;
    const box = {
      minX: (n.box.min[0] - ox) * 12,
      maxX: (n.box.max[0] - ox) * 12,
      minY: (-n.box.max[2] - oy) * 12,
      maxY: (-n.box.min[2] - oy) * 12,
    };
    const kind = sameOrder ? kinds[i] : n.match![1] === "cabinets" ? "cabinet" : "";
    // A cabinet or appliance is about two feet deep, whichever way the sketch drew its width.
    const sides = backSides(box, shell);
    const deep = sides.filter((s) => {
      const depth = s.alongX ? box.maxY - box.minY : box.maxX - box.minX;
      return s.gap <= 3 && depth >= 18 && depth <= 32;
    });
    const candidates = deep.length ? deep : sides;
    return { box, kind, candidates };
  });
  const votes = new Map<string, number>();
  for (const r of runs) for (const s of r.candidates) if (s.gap <= 3) votes.set(s.wall, (votes.get(s.wall) ?? 0) + 1);

  for (const { box, kind, candidates } of runs) {
    const back = [...candidates].sort((a, b) => (b.gap <= 3 ? votes.get(b.wall) ?? 0 : -1) - (a.gap <= 3 ? votes.get(a.wall) ?? 0 : -1) || a.gap - b.gap)[0];
    if (!back) continue;
    const start = back.alongX ? box.minX : box.minY;
    const length = (back.alongX ? box.maxX : box.maxY) - start;

    const place = (itemId: string, along: number) => {
      const item = catalogItem(itemId)!;
      const across = back.at + (back.inward * item.depth) / 2;
      add({ item: itemId, rotation: back.rotation, x: snap(back.alongX ? along : across), y: snap(back.alongX ? across : along) });
    };

    const appliance = { range: "RANGE30", dishwasher: "DW24", refrigerator: length >= 34.5 ? "REF36" : length >= 31.5 ? "REF33" : "REF30" }[kind];
    if (appliance) {
      place(appliance, start + length / 2);
      continue;
    }
    if (kind !== "cabinet") continue;
    let at = start;
    for (const width of fillRun(length)) {
      place(`B${width}`, at + width / 2);
      at += width;
    }
  }
  return pieces;
}

const snap = (v: number) => Math.round(v * 4) / 4;

type Side = { wall: string; alongX: boolean; at: number; inward: 1 | -1; rotation: number; gap: number };

/**
 * The four sides of a piece of the sketch, each with the wall line nearest it.
 * `at` is where the piece's back goes: on the wall when it is within 3 inches.
 */
function backSides(box: { minX: number; maxX: number; minY: number; maxY: number }, shell: Shell): Side[] {
  const xs = [...new Set(shell.walls.map(([x]) => x))];
  const ys = [...new Set(shell.walls.map(([, y]) => y))];
  const side = (alongX: boolean, edge: number, inward: 1 | -1, rotation: number): Side => {
    const lines = alongX ? ys : xs;
    const wall = lines.reduce((best, v) => (Math.abs(v - edge) < Math.abs(best - edge) ? v : best));
    const gap = Math.abs(wall - edge);
    return { wall: `${alongX ? "y" : "x"}${wall}`, alongX, at: gap <= 3 ? wall : edge, inward, rotation, gap };
  };
  return [side(true, box.minY, 1, 180), side(true, box.maxY, -1, 0), side(false, box.minX, 1, 90), side(false, box.maxX, -1, 270)];
}

const baseWidths = catalog.filter((c) => /^B\d+$/.test(c.id)).map((c) => c.width).sort((a, b) => b - a);

/** The fewest base cabinet widths that fill a run, within an inch. */
function fillRun(length: number) {
  const out: number[] = [];
  let left = length;
  while (left >= baseWidths[baseWidths.length - 1] - 1) {
    const width = baseWidths.find((w) => w <= left + 1);
    if (!width) break;
    out.push(width);
    left -= width;
  }
  return out;
}

/** Drops repeated corners and corners in the middle of a straight wall, and turns the outline counterclockwise. */
function tidy(points: [number, number][]): [number, number][] {
  let pts = points.filter((p, i) => i === 0 || p[0] !== points[i - 1][0] || p[1] !== points[i - 1][1]);
  if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts = pts.slice(0, -1);
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i - 1 + pts.length) % pts.length];
      const b = pts[i];
      const c = pts[(i + 1) % pts.length];
      const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      const short = Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.5;
      if (Math.abs(cross) < 1 || short) {
        pts.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  const area = pts.reduce((sum, [x, y], i) => {
    const [nx, ny] = pts[(i + 1) % pts.length];
    return sum + x * ny - nx * y;
  }, 0);
  return area < 0 ? pts.reverse() : pts;
}

type Edge = [[number, number], [number, number]];

/** The wall an opening sits in: both its ends within 9 inches of the same wall. */
function nearestEdge(walls: [number, number][], [a, b]: Edge): Edge | null {
  let best: Edge | null = null;
  let bestGap = 9;
  walls.forEach((p, i) => {
    const edge: Edge = [p, walls[(i + 1) % walls.length]];
    const gap = Math.max(distance(a, edge), distance(b, edge));
    if (gap <= bestGap) {
      best = edge;
      bestGap = gap;
    }
  });
  return best;
}

function project([x, y]: [number, number], [[ax, ay], [bx, by]]: Edge): [number, number] {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return [Math.round((ax + t * dx) * 4) / 4, Math.round((ay + t * dy) * 4) / 4];
}

function distance(p: [number, number], edge: Edge) {
  const [x, y] = project(p, edge);
  return Math.hypot(p[0] - x, p[1] - y);
}
