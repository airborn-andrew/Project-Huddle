import { catalogItem, type CatalogItem } from "@/lib/design/catalog";
import { footprint, paints, type Piece, type Shell } from "@/lib/design/layout";

/**
 * What a locked layout produces for ordering: the cabinet schedule (one line
 * per box, door style and finish, with a tag on every piece) and a DXF plan
 * view of the room with each piece drawn and tagged. Inches throughout.
 */

export type ScheduleLine = { tag: string; item: CatalogItem; count: number; door: string; finish: string };

/** Finish photos are numbered in the order they first appear, so a sub can match them to the photos sent with the order. */
export function finishNames(pieces: Piece[]) {
  const photos = [...new Set(pieces.map((p) => p.finish).filter((f): f is string => Boolean(f) && !(f! in paints)))];
  return (finish?: string) => {
    const f = finish ?? "white";
    if (f in paints) return `Painted ${f}`;
    return `Homeowner finish ${photos.indexOf(f) + 1}`;
  };
}

export function schedule(pieces: Piece[]): { lines: ScheduleLine[]; tags: Map<string, string> } {
  const name = finishNames(pieces);
  const groups = new Map<string, ScheduleLine>();
  const tags = new Map<string, string>();
  const sorted = [...pieces].sort((a, b) => a.item.localeCompare(b.item, "en", { numeric: true }));
  for (const p of sorted) {
    const item = catalogItem(p.item);
    if (!item) continue;
    const appliance = item.group === "appliance";
    const door = appliance ? "" : p.door ?? "shaker";
    const finish = appliance ? "" : name(p.finish);
    const key = `${item.id}|${door}|${finish}`;
    let line = groups.get(key);
    if (!line) {
      const same = [...groups.values()].filter((l) => l.item.id === item.id).length;
      line = { tag: same ? `${item.id}-${String.fromCharCode(65 + same)}` : item.id, item, count: 0, door, finish };
      groups.set(key, line);
    }
    line.count++;
    tags.set(p.id, line.tag);
  }
  return { lines: [...groups.values()], tags };
}

export const feetInches = (v: number) => {
  const total = Math.round(v * 4) / 4;
  const ft = Math.floor(total / 12);
  const inch = total - ft * 12;
  return `${ft}'-${String(inch).replace(/\.25$/, " 1/4").replace(/\.5$/, " 1/2").replace(/\.75$/, " 3/4")}"`;
};

export function scheduleCsv(pieces: Piece[]) {
  const { lines } = schedule(pieces);
  const rows = [["Tag", "Description", "Qty", "Width", "Depth", "Height", "Door", "Finish"]];
  for (const l of lines) rows.push([l.tag, l.item.name, String(l.count), `${l.item.width}`, `${l.item.depth}`, `${l.item.height}`, l.door, l.finish]);
  return rows.map((r) => r.map((c) => (/[",]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\r\n") + "\r\n";
}

/** A plan view in AutoCAD R12 DXF: walls, doors and windows, every piece outlined and tagged, wall lengths, the schedule and a title block. */
export function planDxf({ project, roomName, shell, pieces, date }: { project: string; roomName: string; shell: Shell; pieces: Piece[]; date: string }) {
  const out: string[] = [];
  const pair = (code: number, value: string | number) => out.push(String(code), typeof value === "number" ? fmt(value) : value);
  const line = (layer: string, [x1, y1]: [number, number], [x2, y2]: [number, number]) => {
    pair(0, "LINE");
    pair(8, layer);
    pair(10, x1);
    pair(20, y1);
    pair(30, 0);
    pair(11, x2);
    pair(21, y2);
    pair(31, 0);
  };
  const text = (layer: string, [x, y]: [number, number], height: number, value: string, centered = false, angle = 0) => {
    pair(0, "TEXT");
    pair(8, layer);
    pair(10, x);
    pair(20, y);
    pair(30, 0);
    pair(40, height);
    pair(1, value);
    if (angle) pair(50, angle);
    if (centered) {
      pair(72, 1);
      pair(73, 2);
      pair(11, x);
      pair(21, y);
      pair(31, 0);
    }
  };
  const rect = (layer: string, x0: number, y0: number, x1: number, y1: number) => {
    line(layer, [x0, y0], [x1, y0]);
    line(layer, [x1, y0], [x1, y1]);
    line(layer, [x1, y1], [x0, y1]);
    line(layer, [x0, y1], [x0, y0]);
  };

  pair(0, "SECTION");
  pair(2, "HEADER");
  pair(9, "$ACADVER");
  pair(1, "AC1009");
  pair(9, "$INSUNITS");
  pair(70, 1);
  pair(0, "ENDSEC");
  pair(0, "SECTION");
  pair(2, "ENTITIES");

  const xs = shell.walls.map(([x]) => x);
  const ys = shell.walls.map(([, y]) => y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];

  // Walls, broken at doors; windows drawn across their opening.
  shell.walls.forEach((a, i) => {
    const b = shell.walls[(i + 1) % shell.walls.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const dir: [number, number] = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const at = (t: number): [number, number] => [a[0] + dir[0] * t, a[1] + dir[1] * t];
    const along = (p: [number, number]) => (p[0] - a[0]) * dir[0] + (p[1] - a[1]) * dir[1];
    const off = (p: [number, number]) => Math.abs((p[0] - a[0]) * dir[1] - (p[1] - a[1]) * dir[0]);
    const doors = shell.openings
      .filter((o) => off(o.from) < 1 && off(o.to) < 1)
      .map((o) => ({ ...o, t0: Math.min(along(o.from), along(o.to)), t1: Math.max(along(o.from), along(o.to)) }))
      .sort((p, q) => p.t0 - q.t0);
    let t = 0;
    for (const o of doors) {
      if (o.kind === "door") {
        if (o.t0 > t) line("WALLS", at(t), at(o.t0));
        t = o.t1;
      } else {
        line("WINDOWS", at(o.t0), at(o.t1));
      }
    }
    if (t < len) line("WALLS", at(t), at(len));
    // The wall's length, set just outside it.
    const mid = at(len / 2);
    const normal: [number, number] = [-dir[1], dir[0]];
    text("DIMENSIONS", [mid[0] - normal[0] * 8, mid[1] - normal[1] * 8], 3, feetInches(len), true, Math.abs(dir[0]) > 0.5 ? 0 : 90);
  });

  const { lines, tags } = schedule(pieces);
  for (const p of pieces) {
    const item = catalogItem(p.item);
    if (!item) continue;
    const box = footprint(p, item);
    const layer = item.layer === "wall" ? "WALL_CABINETS" : item.group === "appliance" ? "APPLIANCES" : "CABINETS";
    rect(layer, box.minX, box.minY, box.maxX, box.maxY);
    // A short line on the front face.
    const front = { 0: [[box.minX, box.minY + 1.5], [box.maxX, box.minY + 1.5]], 90: [[box.maxX - 1.5, box.minY], [box.maxX - 1.5, box.maxY]], 180: [[box.minX, box.maxY - 1.5], [box.maxX, box.maxY - 1.5]], 270: [[box.minX + 1.5, box.minY], [box.minX + 1.5, box.maxY]] }[p.rotation] as [number, number][] | undefined;
    if (front) line(layer, front[0], front[1]);
    const tag = tags.get(p.id) ?? item.id;
    if (item.layer === "wall") {
      // Wall cabinet tags sit along the wall, clear of the base cabinet tags under them.
      const back = { 0: [p.x, box.maxY - 3], 90: [box.minX + 3, p.y], 180: [p.x, box.minY + 3], 270: [box.maxX - 3, p.y] }[p.rotation] as [number, number];
      text("TAGS", back, 2, tag, true, p.rotation % 180 === 0 ? 0 : 90);
    } else {
      text("TAGS", [p.x, p.y], 2.5, tag, true);
    }
  }

  // The schedule, to the right of the room.
  const sx = maxX + 36;
  let sy = maxY;
  text("SCHEDULE", [sx, sy], 4, "CABINET SCHEDULE");
  sy -= 9;
  const columns = [0, 22, 82, 94, 136, 166];
  const header = ["TAG", "DESCRIPTION", "QTY", "W x D x H", "DOOR", "FINISH"];
  header.forEach((h, i) => text("SCHEDULE", [sx + columns[i], sy], 2.5, h));
  for (const l of lines) {
    sy -= 6;
    [l.tag, l.item.name.replace(/"/g, "in"), String(l.count), `${l.item.width} x ${l.item.depth} x ${l.item.height}`, l.door, l.finish].forEach((v, i) =>
      text("SCHEDULE", [sx + columns[i], sy], 2.5, v.toUpperCase()),
    );
  }

  // Title block under the room and schedule.
  const tx0 = minX;
  const tx1 = sx + 230;
  const ty1 = Math.min(minY, sy) - 24;
  const ty0 = ty1 - 30;
  rect("TITLE", tx0, ty0, tx1, ty1);
  text("TITLE", [tx0 + 6, ty1 - 10], 5, `${project.toUpperCase()} - ${roomName.toUpperCase()} CABINET PLAN`);
  text("TITLE", [tx0 + 6, ty1 - 21], 3, `OHI CONSTRUCTION    ${date}    UNITS: INCHES`);

  pair(0, "ENDSEC");
  pair(0, "EOF");
  return out.join("\r\n") + "\r\n";
}

const fmt = (v: number) => String(Math.round(v * 1000) / 1000);
