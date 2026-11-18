"""Turn scope line items into production days.

Each rule matches a line item description and names the day templates it
belongs to and the part of the model it lights up. A rule with no templates
marks a line item the homeowner never sees (labor minimums, materials, the
dump trailer). A line item that matches no rule stops the build, so a new
kind of work gets a rule before it reaches a homeowner.

Template ids and their order match lib/templates.ts.
"""

from __future__ import annotations

import re

TEMPLATES = [
    "insulate-crawlspace",
    "take-apart",
    "build-cabinets",
    "paint-walls",
    "install-flooring",
    "put-back",
    "hang-doors",
    "install-baseboard",
    "paint-trim",
    "final-clean",
    "final-walkthrough",
]

TAKE_APART_AND_PUT_BACK = ("take-apart", "put-back")

# (pattern, templates, category). First match wins.
RULES: list[tuple[str, tuple[str, ...], str | None]] = [
    # Line items the homeowner never sees.
    (r"labor minimum", (), None),
    (r"^carpenter\b.*per hour", (), None),
    (r"material only", (), None),
    (r"supply line", (), None),
    (r"dump trailer|dumpster|haul debris", (), None),
    (r"temporary toilet", (), None),
    # Crawlspace
    (r"insulation|vapor barrier", ("insulate-crawlspace",), "Insulation"),
    # Doors and their trim
    (r"interior door|exterior door|door unit|door slab|bifold|bypass", ("hang-doors",), "Doors"),
    (r"^r&r casing|^casing", ("hang-doors",), "Doors"),
    # Trim paint
    (r"^paint casing|^paint door|trim & jamb|^seal .*baseboard|^paint baseboard", ("paint-trim",), "Paint"),
    # Walls
    (r"^paint the walls|^paint walls|^seal .*walls", ("paint-walls",), "Paint"),
    # Baseboard and floors (quarter round mentions the flooring it sits on)
    (r"baseboard|quarter round|shoe mold", ("install-baseboard",), "Baseboard"),
    (r"vinyl plank|laminate|carpet|hardwood|floor covering|tile floor|^floor", ("install-flooring",), "Flooring"),
    # Cabinets
    (r"^remove cabinetry|^remove cabinet", ("take-apart",), "Cabinets"),
    (r"^cabinet|face frame", ("build-cabinets",), "Cabinets"),
    (r"countertop", TAKE_APART_AND_PUT_BACK, "Cabinets"),
    # Appliances and plumbing fixtures that come out and go back
    (r"dishwasher|refrigerator|range|oven|cooktop|microwave|disposal|washer|dryer", TAKE_APART_AND_PUT_BACK, "Appliances"),
    (r"sink|faucet|toilet|vanity|p-trap|tub|shower", TAKE_APART_AND_PUT_BACK, "Fixtures"),
    # Cleaning
    (r"clean", ("final-clean",), "Clean"),
]


def match(description: str):
    text = description.lower()
    for pattern, templates, category in RULES:
        if re.search(pattern, text):
            return templates, category
    return None


def build_days(groups: list[tuple[str | None, list[str]]], all_rooms: list[str]):
    """groups: (room id, or None for whole-house sections, line items).

    Returns the phases in template order, each with its rooms and the
    categories it lights in each room, and a list of unmatched line items.
    """
    phases: dict[str, dict[str, set[str]]] = {t: {} for t in TEMPLATES}
    unmatched = []
    for room, items in groups:
        for item in items:
            hit = match(item)
            if hit is None:
                unmatched.append((room or "whole house", item))
                continue
            templates, category = hit
            for t in templates:
                targets = [room] if room else all_rooms
                for r in targets:
                    phases[t].setdefault(r, set()).add(category)
    # Every job ends with a walkthrough of the whole house.
    phases["final-walkthrough"] = {r: set() for r in all_rooms}
    out = [
        {"template": t, "rooms": {r: sorted(c) for r, c in rooms.items()}}
        for t, rooms in phases.items()
        if rooms
    ]
    return out, unmatched
