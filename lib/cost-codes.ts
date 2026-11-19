/**
 * The CSI MasterFormat sections jobs are costed by. The same list is seeded
 * into the cost_codes table by supabase/migrations/20261119000000_job_costing.sql;
 * add a section to both.
 */
export const costCodes = [
  { code: "01 50 00", name: "Temporary Facilities and Controls" },
  { code: "01 74 00", name: "Cleaning and Waste Management" },
  { code: "02 41 00", name: "Demolition" },
  { code: "06 10 00", name: "Rough Carpentry" },
  { code: "06 20 00", name: "Finish Carpentry" },
  { code: "06 40 00", name: "Architectural Woodwork" },
  { code: "07 20 00", name: "Thermal Protection" },
  { code: "07 30 00", name: "Steep Slope Roofing" },
  { code: "07 60 00", name: "Flashing and Sheet Metal" },
  { code: "08 10 00", name: "Doors and Frames" },
  { code: "08 50 00", name: "Windows" },
  { code: "09 20 00", name: "Plaster and Gypsum Board" },
  { code: "09 30 00", name: "Tiling" },
  { code: "09 60 00", name: "Flooring" },
  { code: "09 90 00", name: "Painting and Coating" },
  { code: "11 30 00", name: "Residential Equipment" },
  { code: "12 36 00", name: "Countertops" },
  { code: "22 00 00", name: "Plumbing" },
  { code: "23 00 00", name: "HVAC" },
  { code: "26 00 00", name: "Electrical" },
  { code: "32 31 00", name: "Fences and Gates" },
] as const;

export type CostCode = (typeof costCodes)[number]["code"];

export const isCostCode = (v: unknown): v is CostCode => costCodes.some((c) => c.code === v);
export const costCodeName = (code: string | null) => costCodes.find((c) => c.code === code)?.name ?? "Unassigned";

type Kind = "material" | "labor" | "equipment" | "other";

/**
 * Which section an Xactimate component lands in, by its kind and code. First
 * match wins. A component no rule covers stays unassigned until OHI or a bot
 * assigns it; nothing is guessed.
 */
const rules: [Kind, RegExp, CostCode][] = [
  ["equipment", /^DMO/, "01 74 00"],
  ["equipment", /^TMP/, "01 50 00"],
  ["labor", /^CARP-FNC/, "06 20 00"],
  ["labor", /^CARP/, "06 10 00"],
  ["labor", /^DMO/, "02 41 00"],
  ["labor", /^FLR/, "09 60 00"],
  ["labor", /^INS/, "07 20 00"],
  ["labor", /^PLM/, "22 00 00"],
  ["labor", /^PNT/, "09 90 00"],
  ["labor", /^CLN/, "01 74 00"],
  ["labor", /^DRY/, "09 20 00"],
  ["labor", /^TIL/, "09 30 00"],
  ["labor", /^ELE/, "26 00 00"],
  ["labor", /^HVC/, "23 00 00"],
  ["labor", /^RFG/, "07 30 00"],
  ["material", /^CAB/, "06 40 00"],
  ["material", /^DOR/, "08 10 00"],
  ["material", /^FCT/, "09 30 00"],
  ["material", /^FC/, "09 60 00"],
  ["material", /^FNC/, "06 20 00"],
  ["material", /^INS/, "07 20 00"],
  ["material", /^PLM/, "22 00 00"],
  ["material", /^PNT/, "09 90 00"],
  ["material", /^DRY/, "09 20 00"],
  ["material", /^TIL/, "09 30 00"],
  ["material", /^ELE/, "26 00 00"],
  ["material", /^HVC/, "23 00 00"],
  ["material", /^APP/, "11 30 00"],
  ["material", /^RFG/, "07 30 00"],
  ["material", /^WDW/, "08 50 00"],
  ["material", /^FEN/, "32 31 00"],
  ["material", /^FRM/, "06 10 00"],
];

export function costCodeFor(kind: Kind, xactCode: string | null, description: string): CostCode | null {
  if (!xactCode) return null;
  if (kind === "material" && /^NAIL/.test(xactCode) && /finish/i.test(description)) return "06 20 00";
  return rules.find(([k, pattern]) => k === kind && pattern.test(xactCode))?.[2] ?? null;
}

/** The section each production day template works in, for percent complete. */
export const templateCostCode: Record<string, CostCode> = {
  "insulate-crawlspace": "07 20 00",
  "take-apart": "02 41 00",
  "build-cabinets": "06 40 00",
  "paint-walls": "09 90 00",
  "install-flooring": "09 60 00",
  "hang-doors": "08 10 00",
  "install-baseboard": "06 20 00",
  "paint-trim": "09 90 00",
  "final-clean": "01 74 00",
};
