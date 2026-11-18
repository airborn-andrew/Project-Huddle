"""Read an Xactimate scope PDF.

Usage:
    python pipeline/scope.py <scope.pdf>

Prints the homeowner code: the house number from the property address,
padded with leading zeros to six digits (10305 becomes 010305).
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

from pypdf import PdfReader

CODE_LENGTH = 6


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


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    print(f"Homeowner code: {house_code(read_text(Path(sys.argv[1])))}")
