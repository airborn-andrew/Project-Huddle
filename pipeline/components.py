"""Read an Xactimate Components report.

Usage:
    python pipeline/components.py <components.pdf>

Prints the report as JSON for the job costing import
(POST /api/agent/jobs/<slug>/budget): the estimate name, the price list, and
every material, equipment and labor component with its code, description,
quantity, unit, unit price, total, and whether the total carries an asterisk.

Run it on the report from the carrier-approved version of the estimate. Each
page's components must add up to the total printed on that page, or the read
stops: a component the reader missed would leave a hole in the budget.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from pypdf import PdfReader

SECTIONS = {
    "MATERIAL COMPONENTS": "material",
    "EQUIPMENT COMPONENTS": "equipment",
    "LABOR COMPONENTS": "labor",
}

NUMBER = r"[\d,]+\.\d+"
LINE = re.compile(rf"^(\S+) (.+?) ({NUMBER}) ([A-Z]{{2}}) @ ({NUMBER}) ({NUMBER})(\*?)$")
MISC_LABOR = re.compile(rf"^Miscellaneous Labor ({NUMBER})$")
TOTAL = re.compile(rf"^Total ({NUMBER})$")
PRICE_LIST = re.compile(r"^Price List:\s*(\S+)")
ESTIMATE = re.compile(r"^Estimate:\s*(\S+)")


def number(text: str) -> float:
    return float(text.replace(",", ""))


def read(path: Path) -> dict:
    estimate = price_list = None
    lines: list[dict] = []
    totals: dict[str, float] = {}

    for page in PdfReader(path).pages:
        section = None
        for raw in (page.extract_text() or "").splitlines():
            line = raw.strip()
            if estimate is None and (m := ESTIMATE.match(line)):
                estimate = m.group(1)
            if price_list is None and (m := PRICE_LIST.match(line)):
                price_list = m.group(1)
            heading = next((kind for title, kind in SECTIONS.items() if line.startswith(title)), None)
            if heading:
                section = heading
                continue
            if section is None:
                continue
            if m := LINE.match(line):
                code, description, quantity, unit, unit_price, total, star = m.groups()
                lines.append(
                    {
                        "kind": section,
                        "code": code,
                        "description": description.strip(),
                        "quantity": number(quantity),
                        "unit": unit,
                        "unit_price": number(unit_price),
                        "total": number(total),
                        "flagged": star == "*",
                    }
                )
            elif section == "labor" and (m := MISC_LABOR.match(line)):
                lines.append(
                    {
                        "kind": "labor",
                        "code": None,
                        "description": "Miscellaneous labor",
                        "quantity": None,
                        "unit": None,
                        "unit_price": None,
                        "total": number(m.group(1)),
                        "flagged": False,
                    }
                )
            elif m := TOTAL.match(line):
                totals[section] = number(m.group(1))
                section = None

    if not lines:
        sys.exit("No components found; is this the Components report?")
    for kind, total in totals.items():
        found = round(sum(l["total"] for l in lines if l["kind"] == kind), 2)
        if abs(found - total) > 0.01:
            sys.exit(f"{kind.title()} components add up to {found:,.2f} but the page total is {total:,.2f}")
    missing = {l["kind"] for l in lines} - set(totals)
    if missing:
        sys.exit(f"No page total found for {', '.join(sorted(missing))} components")

    return {"source": "components", "estimate": estimate, "price_list": price_list, "lines": lines, "totals": totals}


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    print(json.dumps(read(Path(sys.argv[1])), indent=2))
