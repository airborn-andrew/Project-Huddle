import type { Room } from "@/lib/types";

/**
 * Production day templates, in trade order. The pipeline decides which ones a
 * job uses and which rooms each one covers (the project's phases); the words
 * the homeowner reads live here and are the same on every job.
 * Ids match pipeline/day_rules.py.
 */
export type Template = {
  id: string;
  /** Verb-led title; may name the rooms it covers. */
  title: (rooms: Room[]) => string;
  what: string;
  expect: string;
  /** Default length in workdays. */
  days: number;
};

/** "the kitchen and baths", "the bath", "the kitchen"... from the rooms a day covers. */
export function places(rooms: Room[]) {
  const kitchen = rooms.some((r) => /kitchen/i.test(r.name));
  const baths = rooms.filter((r) => /bath/i.test(r.name)).length;
  const bathWord = baths > 1 ? "baths" : "bath";
  if (kitchen && baths) return `the kitchen and ${bathWord}`;
  if (kitchen) return "the kitchen";
  if (baths) return `the ${bathWord}`;
  return "these rooms";
}

export const templates: Template[] = [
  {
    id: "insulate-crawlspace",
    title: () => "Insulate the crawlspace",
    what: "New insulation goes up under the floor, with a vapor barrier over the ground.",
    expect: "The crew works from the crawlspace hatch. Nothing inside the house needs to move.",
    days: 1,
  },
  {
    id: "take-apart",
    title: (rooms) => `Take apart ${places(rooms)}`,
    what: "Cabinets, appliances and fixtures in the way are disconnected and moved out so the floors and walls can be worked on.",
    expect: "Empty the cabinets, counters and vanities before this day.",
    days: 1,
  },
  {
    id: "build-cabinets",
    title: (rooms) => (rooms.every((r) => /kitchen/i.test(r.name)) ? "Build new kitchen cabinets" : "Build new cabinets"),
    what: "New cabinet boxes and face frames are built in place.",
    expect: "The kitchen is a work area on these days.",
    days: 2,
  },
  {
    id: "paint-walls",
    title: () => "Paint the walls",
    what: "Walls are patched, caulked and painted.",
    expect: "Keep the rooms clear and aired out. Paint is dry to the touch the same day.",
    days: 2,
  },
  {
    id: "install-flooring",
    title: () => "Install new flooring",
    what: "New flooring goes down.",
    expect: "Rooms need to be empty, including closets and anything under beds.",
    days: 3,
  },
  {
    id: "put-back",
    title: (rooms) => `Put ${places(rooms)} back together`,
    what: "Cabinets, counters, appliances and fixtures go back in and are reconnected.",
    expect: "These rooms are ready to use again once this day is done.",
    days: 1,
  },
  {
    id: "hang-doors",
    title: () => "Hang new doors",
    what: "Doors and their trim are hung and adjusted.",
    expect: "Doorways are open for part of the day.",
    days: 1,
  },
  {
    id: "install-baseboard",
    title: () => "Install baseboard",
    what: "Baseboard and trim go in along the new floors.",
    expect: "Keep furniture a couple of feet off the walls.",
    days: 1,
  },
  {
    id: "paint-trim",
    title: () => "Paint trim and doors",
    what: "Baseboard, door trim and casing get their paint.",
    expect: "Keep doors open while the paint dries.",
    days: 1,
  },
  {
    id: "final-clean",
    title: () => "Final clean",
    what: "The whole house is cleaned once the work is finished.",
    expect: "Your walkthrough with OHI follows.",
    days: 1,
  },
  {
    id: "final-walkthrough",
    title: () => "Final walkthrough",
    what: "You and OHI walk the house together and note anything left to finish.",
    expect: "Anything left to finish goes on the punch list in Closeout.",
    days: 1,
  },
];

export const templateById = (id: string) => templates.find((t) => t.id === id);
