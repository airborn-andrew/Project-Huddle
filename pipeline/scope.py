"""Read an Xactimate scope PDF.

Usage:
    python pipeline/scope.py <scope.pdf>

Prints the homeowner code and each room the scope lists, with its line items.

The homeowner code is the house number from the property address, padded with
leading zeros to six digits (10305 becomes 010305).

Rooms are the blocks that start with "<Room> Height: ...". Each room carries its
wall height, floor area, doors, windows and line items. Line items listed
outside a room block (Crawlspace, General Conditions and the like) belong to a
section with that name. Nothing else in the PDF is kept.
"""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

from pypdf import PdfReader

CODE_LENGTH = 6

ITEM = re.compile(r"^(\d+)\.\s+(.+?)\s+[\d,]+\.\d+\s+[A-Z]{2}\s*$")
ROOM = re.compile(r"^(.+?) Height:\s*(.+)$")
FLOOR = re.compile(r"^([\d,]+\.\d+) SF Floor$")
OPENING = re.compile(r"^(Door|Window|Missing Wall) (.+?) X (.+?) Opens into (\S+)")
LEVEL = re.compile(r"^(?:(?:Main|Upper|Lower|Second|Third|First|Ground|Basement) (?:Level|Floor)|Basement|Attic)$")
CONTINUED = re.compile(r"^CONTINUED - (.+)$")
END = "Grand Total Areas:"


@dataclass
class Opening:
    kind: str  # "door" or "window"
    width: float  # inches
    height: float  # inches
    exterior: bool


@dataclass
class Group:
    name: str
    level: str
    is_room: bool
    height: float | None = None  # wall height in inches
    floor_sf: float | None = None
    openings: list[Opening] = field(default_factory=list)
    items: list[str] = field(default_factory=list)


@dataclass
class Scope:
    code: str
    groups: list[Group]

    @property
    def rooms(self) -> list[Group]:
        return [g for g in self.groups if g.is_room]

    def group(self, name: str) -> Group | None:
        return next((g for g in self.groups if g.name.lower() == name.lower()), None)


def read_text(path: Path) -> str:
    return "\n".join(page.extract_text() or "" for page in PdfReader(path).pages)


def house_code(text: str) -> str:
    match = re.search(r"^Property:\s*(\d+)\b", text, re.M)
    if not match:
        sys.exit("No property address with a house number in the scope")
    number = match.group(1)
    if len(number) > CODE_LENGTH:
        sys.exit(f"House number {number} is longer than {CODE_LENGTH} digits")
    return number.zfill(CODE_LENGTH)


def inches(text: str) -> float:
    """Xactimate lengths: 8', 4' 11", 8' 1/4", 0", 6"."""
    m = re.fullmatch(r"\s*(?:(\d+)')?\s*(?:(\d+)?\s*(?:(\d+)/(\d+))?\")?\s*", text)
    if not m or not any(m.groups()):
        raise ValueError(f"Not a length: {text!r}")
    feet, whole, num, den = m.groups()
    total = int(feet or 0) * 12 + int(whole or 0)
    if num:
        total += int(num) / int(den)
    return float(total)


def parse(text: str) -> Scope:
    code = house_code(text)
    lines = [l.strip() for l in text.splitlines()]
    groups: list[Group] = []
    current: Group | None = None
    level = "Main Level"

    for i, line in enumerate(lines):
        if line.startswith(END):
            break
        if LEVEL.match(line):
            level = line
            continue
        if m := ROOM.match(line):
            first = re.search(r"\d+'(?:\s*\d+(?:\s*\d+/\d+)?\")?", m.group(2))
            current = Group(m.group(1).strip(), level, True, height=inches(first.group(0)) if first else None)
            groups.append(current)
            continue
        if m := CONTINUED.match(line):
            current = next((g for g in groups if g.name == m.group(1).strip()), current)
            continue
        # A section heading sits between the previous group's NOTES: and its item table.
        nxt = lines[i + 1] if i + 1 < len(lines) else ""
        prev = lines[i - 1] if i else ""
        if nxt == "DESCRIPTION QTY" and prev == "NOTES:" and line:
            existing = next((g for g in groups if g.name == line), None)
            if existing is None and (current is None or line != current.name):
                current = Group(line, level, False)
                groups.append(current)
            elif existing is not None:
                current = existing
            continue
        if current is None:
            continue
        if current.is_room and current.floor_sf is None and (m := FLOOR.match(line)):
            current.floor_sf = float(m.group(1).replace(",", ""))
        elif current.is_room and (m := OPENING.match(line)):
            kind = m.group(1)
            if kind != "Missing Wall":
                current.openings.append(
                    Opening(kind.lower(), inches(m.group(2)), inches(m.group(3)), m.group(4).lower() == "exterior")
                )
        elif m := ITEM.match(line):
            current.items.append(m.group(2).strip())

    return Scope(code, groups)


def read_scope(path: Path) -> Scope:
    return parse(read_text(path))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    scope = read_scope(Path(sys.argv[1]))
    print(f"Homeowner code: {scope.code}")
    for g in scope.groups:
        kind = "room" if g.is_room else "section"
        extra = f", {g.floor_sf} SF floor, {len(g.openings)} doors and windows" if g.is_room else ""
        print(f"\n{g.name} ({kind}, {g.level}{extra})")
        for item in g.items:
            print(f"  - {item}")
