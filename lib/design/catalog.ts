/**
 * The cabinets and appliances the Design Room can place. Sizes are in inches.
 * Every piece in a layout is one of these, so a layout always prices and
 * builds as real boxes.
 */

export type Group = "base" | "wall" | "tall" | "island" | "appliance";

/** Floor pieces stand on the floor; wall pieces hang at `elevation`; tall pieces are both. */
export type Layer = "floor" | "wall" | "both";

export type CatalogItem = {
  id: string;
  name: string;
  group: Group;
  width: number;
  depth: number;
  height: number;
  /** Inches from the floor to the bottom of the piece. */
  elevation: number;
  layer: Layer;
  /** Gets a countertop. */
  counter: boolean;
  /** What the piece is, for drawing it: a cabinet box or a kind of appliance. */
  kind: "cabinet" | "sink" | "drawers" | "refrigerator" | "range" | "dishwasher" | "microwave";
};

const BASE_HEIGHT = 34.5;
const WALL_ELEVATION = 54;
const steps = (from: number, to: number) => Array.from({ length: (to - from) / 3 + 1 }, (_, i) => from + i * 3);

const base = (width: number): CatalogItem => ({
  id: `B${width}`,
  name: `Base cabinet ${width}"`,
  group: "base",
  width,
  depth: 24,
  height: BASE_HEIGHT,
  elevation: 0,
  layer: "floor",
  counter: true,
  kind: "cabinet",
});

export const catalog: CatalogItem[] = [
  ...steps(9, 36).map(base),
  ...[30, 33, 36].map((width) => ({ ...base(width), id: `SB${width}`, name: `Sink base ${width}"`, kind: "sink" as const })),
  ...[15, 18, 24].map((width) => ({ ...base(width), id: `DB${width}`, name: `Drawer base ${width}"`, kind: "drawers" as const })),
  ...steps(9, 36).map(
    (width): CatalogItem => ({
      id: `W${width}30`,
      name: `Wall cabinet ${width}"`,
      group: "wall",
      width,
      depth: 12,
      height: 30,
      elevation: WALL_ELEVATION,
      layer: "wall",
      counter: false,
      kind: "cabinet",
    }),
  ),
  ...[18, 24, 30].map(
    (width): CatalogItem => ({
      id: `U${width}84`,
      name: `Tall pantry ${width}"`,
      group: "tall",
      width,
      depth: 24,
      height: 84,
      elevation: 0,
      layer: "both",
      counter: false,
      kind: "cabinet",
    }),
  ),
  ...[36, 48, 60, 72].map(
    (width): CatalogItem => ({
      id: `I${width}`,
      name: `Island ${width}"`,
      group: "island",
      width,
      depth: 36,
      height: BASE_HEIGHT,
      elevation: 0,
      layer: "floor",
      counter: true,
      kind: "cabinet",
    }),
  ),
  appliance("REF36", "Refrigerator 36\"", 36, 30, 70, "refrigerator"),
  appliance("REF33", "Refrigerator 33\"", 33, 30, 70, "refrigerator"),
  appliance("REF30", "Refrigerator 30\"", 30, 30, 70, "refrigerator"),
  appliance("RANGE30", "Range 30\"", 30, 26, 36, "range"),
  appliance("DW24", "Dishwasher 24\"", 24, 24, BASE_HEIGHT, "dishwasher"),
  {
    ...appliance("MW30", "Microwave hood 30\"", 30, 15, 17, "microwave"),
    elevation: 66,
    layer: "wall",
  },
];

function appliance(id: string, name: string, width: number, depth: number, height: number, kind: CatalogItem["kind"]): CatalogItem {
  return {
    id,
    name,
    group: "appliance",
    width,
    depth,
    height,
    elevation: 0,
    layer: "floor",
    // A dishwasher sits under the countertop.
    counter: kind === "dishwasher",
    kind,
  };
}

const byId = new Map(catalog.map((c) => [c.id, c]));

export const catalogItem = (id: string) => byId.get(id);

export const groups: { id: Group; name: string }[] = [
  { id: "base", name: "Base" },
  { id: "wall", name: "Wall" },
  { id: "tall", name: "Tall" },
  { id: "island", name: "Island" },
  { id: "appliance", name: "Appliances" },
];
