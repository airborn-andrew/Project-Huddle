import { catalog } from "@/lib/design/catalog";
import { doorStyles, paints, type Piece, type Shell } from "@/lib/design/layout";

/**
 * The layout file a homeowner hands to their own AI. It opens with a short
 * note in plain words, then the room, the sizes that exist, and the pieces.
 * The AI sends back the same file with the pieces changed.
 */
export function layoutFile({ project, roomName, shell, pieces }: { project: string; roomName: string; shell: Shell; pieces: Piece[] }) {
  const room = roomName.toLowerCase();
  const note = [
    `This is the ${room} layout for the ${project} project from OHI Construction's Huddle app. The walls, doors and windows come from the measured sketch, so they stay as they are. Everything under "pieces" can be moved, added, swapped or removed. Positions are in inches from the room corner at 0, 0, and rotation is in degrees. Cabinet widths come from the "catalog" list because they are real cabinet sizes, so pick the closest catalog size when a change needs a new cabinet.`,
    `To change the layout, send back this whole file with the changes, as a .json file to download, so it can be uploaded to Huddle. For a picture, start from the attached snapshot and keep every cabinet where it is, changing only finishes, colors and lighting.`,
  ];
  const finishes = [...Object.keys(paints), ...new Set(pieces.map((p) => p.finish).filter((f): f is string => Boolean(f) && !(f! in paints)))];
  return {
    note,
    units:
      "Inches. x runs east and y runs north from the room's southwest corner. A piece's x and y are its center. Rotation 0 has the front facing south, 90 east, 180 north and 270 west.",
    room: {
      name: roomName,
      corners: shell.walls,
      ceiling: shell.height,
      doors: shell.openings.filter((o) => o.kind === "door").map(({ from, to, top }) => ({ from, to, height: top })),
      windows: shell.openings.filter((o) => o.kind === "window").map(({ from, to, bottom, top }) => ({ from, to, sill: bottom, top })),
    },
    catalog: catalog.map((c) => ({ item: c.id, name: c.name, width: c.width, depth: c.depth, height: c.height, ...(c.elevation && { fromFloor: c.elevation }) })),
    doorStyles,
    finishes,
    pieces,
  };
}

/** The pieces in what came back from an AI: the whole file, just its pieces, or either wrapped in other text. */
export function readBack(text: string): unknown {
  const start = text.search(/[{[]/);
  const end = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
  if (start < 0 || end <= start) return null;
  try {
    const data = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(data) ? data : data?.pieces ?? null;
  } catch {
    return null;
  }
}
