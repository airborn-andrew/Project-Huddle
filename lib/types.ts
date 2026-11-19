export type Category =
  | "Insulation"
  | "Cabinets"
  | "Appliances"
  | "Fixtures"
  | "Paint"
  | "Flooring"
  | "Doors"
  | "Baseboard"
  | "Clean";

export type Room = {
  id: string;
  name: string;
  /** Level id from plan.levels; "crawlspace" for the crawlspace under the lowest level. */
  level: string;
  areaSF: number;
  /** Plan feet: x east, y north. In the scene, z = -y. */
  center: [number, number];
  polygon: [number, number][];
};

export type Plan = {
  size: [number, number];
  /** Top to bottom. `stack` is 0 for the main level, +1 per level up and -1 per level down. */
  levels: { id: string; name: string; height: number; stack: number }[];
  rooms: Room[];
};

/** One production phase from the pipeline: a template and the rooms it covers. */
export type Phase = {
  template: string;
  /** Room id to the parts of the model the phase works on in that room. */
  rooms: Record<string, Category[]>;
};

/** A production phase as OHI schedules it. `start` is a workday index from the start date. */
export type PhaseEdit = {
  id: string;
  template: string;
  rooms: Record<string, Category[]>;
  start: number;
  days: number;
  done: boolean;
};

/** One room's share of a scheduled production phase. `step` is the template id. */
export type ScheduledTask = {
  id: string;
  phase: string;
  room: string;
  step: string;
  title: string;
  categories: Category[];
  day: number;
  days: number;
  done: boolean;
};

export type Photo = { url: string; width: number; height: number };

export type Role = "home" | "ohi";

export type Message = {
  id: string;
  from: Role;
  body: string;
  photos: Photo[];
  room?: string;
  at: string;
};

export type ChangeOrder = {
  id: string;
  title: string;
  body: string;
  photos: Photo[];
  createdAt: string;
  answer?: { choice: "yes" | "no" | "other"; note?: string; photos: Photo[]; at: string };
};

/** The kinds of finish the homeowner picks at the supplier's showroom, in the order they show. */
export const selectionCategories = ["Flooring", "Tile", "Countertops", "Cabinets", "Fixtures", "Appliances"] as const;

export type SelectionCategory = (typeof selectionCategories)[number];

/** What the homeowner picked, with OHI's screenshots of it. No prices. */
export type Selection = {
  id: string;
  category: SelectionCategory;
  name: string;
  style?: string;
  room?: string;
  photos: Photo[];
};

export type PunchItem ={ id: string; room?: string; text: string; done: boolean };

export type Closeout = {
  walkthrough?: string;
  warranty: string;
  punch: PunchItem[];
  documents: { name: string; url: string }[];
};

/** A note OHI posts to a day, a room, or both. `date` is the calendar day it belongs to. */
export type Note = { id: string; body: string; photos: Photo[]; room?: string; date?: string; at: string };

export type Sub = { id: string; name: string; trade: string; phases: string[] };

export type People = { pm: { name: string }; subs: Sub[] };

/** Everything OHI edits. OHI works on a draft copy and pushes it to the homeowner. */
export type Editable = {
  startDate: string;
  /** null until OHI changes the schedule; until then it is the project's production days end to end. */
  schedule: PhaseEdit[] | null;
  offDays: string[];
  notes: Note[];
  /** Expect lines rewritten for this project, by template id. */
  expect: Record<string, string>;
  changeOrders: ChangeOrder[];
  selections: Selection[];
  photos: Record<string, Photo[]>;
  closeout: Closeout;
  people: People;
};

export type LogEntry = { at: string; text: string };

/** The published project, plus OHI's draft, undo history and change log. */
export type ProjectState = Editable & {
  messages: Message[];
  draft: Editable | null;
  undo: Editable[];
  log: LogEntry[];
  /** When OHI last opened the project; homeowner posts after it show as new on the project list. */
  ohiSeen: string | null;
};
