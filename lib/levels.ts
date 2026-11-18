import type { Plan } from "@/lib/types";

export type Level = Plan["levels"][number];

/** How far apart the levels float in the 3D plan, in feet. */
export const LEVEL_GAP = 7;

/** Height of each level in the 3D plan, by level id. */
export const levelHeights = (levels: Level[]): Record<string, number> =>
  Object.fromEntries(levels.map((l) => [l.id, l.stack * LEVEL_GAP]));
