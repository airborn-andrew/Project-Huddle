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
  level: "main" | "crawlspace";
  areaSF: number;
  /** Plan feet: x east, y north. In the scene, z = -y. */
  center: [number, number];
  polygon: [number, number][];
};

export type Plan = {
  size: [number, number];
  levels: { id: string; name: string; height: number }[];
  rooms: Room[];
};

/** One production phase from data/<slug>/days.json: a template and the rooms it covers. */
export type Phase = {
  template: string;
  /** Room id to the parts of the model the phase works on in that room. */
  rooms: Record<string, Category[]>;
};

/** One room's share of a production phase. `step` is the template id. */
export type Task = {
  id: string;
  room: string;
  step: string;
  title: string;
  categories: Category[];
};

/** A task placed on the calendar. `day` is a workday index from the start date. */
export type ScheduledTask = Task & { day: number; days: number; done: boolean };

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

export type PunchItem = { id: string; room?: string; text: string; done: boolean };

export type Closeout = {
  walkthrough?: string;
  warranty: string;
  punch: PunchItem[];
  documents: { name: string; url: string }[];
};

export type ProjectState = {
  startDate: string;
  /** Per-task changes made by OHI. */
  overrides: Record<string, { day?: number; done?: boolean }>;
  changeOrders: ChangeOrder[];
  messages: Message[];
  photos: Record<string, Photo[]>;
  closeout: Closeout;
};
