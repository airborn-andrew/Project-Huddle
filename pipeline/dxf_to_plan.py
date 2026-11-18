"""Build a project from its Xactimate sketch DXF and scope PDF.

Usage:
    python pipeline/dxf_to_plan.py <slug>

Reads  pipeline/input/<slug>/  the sketch DXF (one flat layer of LINE and TEXT,
       1 unit = 1 inch) and the scope PDF, both exported from the same estimate.
       The input folder is never committed.
Writes data/<slug>/plan.json, data/<slug>/days.json and public/models/<slug>.glb

Walls are the 4 in face pairs. Openings are found from the jamb lines that
cross a wall. Rooms are the spaces the walls enclose, named by the room label
inside each one; the scope's floor areas guide how open-plan rooms are divided.

The build stops when the sketch and the scope disagree (room names, or a floor
area off by more than 0.5%) or when a line item fits no day rule.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from dataclasses import dataclass
from pathlib import Path

import ezdxf
import numpy as np
import trimesh
from shapely import affinity
from shapely.geometry import LineString, MultiPoint, MultiPolygon, Point, Polygon
from shapely.geometry.polygon import orient
from shapely.ops import polygonize, unary_union

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "pipeline"))

from day_rules import build_days  # noqa: E402
from scope import read_scope  # noqa: E402

WALL_THICKNESS = 4.0  # in
CRAWL_HEIGHT = 30.0

# Windows: the sill starts 3 ft off the floor. Every window keeps at least 8 in
# of wall above it; a window that would come closer slides down, the sill never
# goes below 1 ft, and a window that still does not fit is cut to fit.
WINDOW_SILL = 36.0
WINDOW_TOP_CLEARANCE = 8.0
WINDOW_MIN_SILL = 12.0
PANE_THICKNESS = 0.6
FIXTURE_COLOR = 92
ROOM_TEXT_HEIGHT = 3.6
AREA_TOLERANCE = 0.005

FIXTURE_HEIGHTS = {
    "cabinet": 36.0,
    "range": 36.0,
    "dishwasher": 36.0,
    "refrigerator": 70.0,
    "tub": 20.0,
}


@dataclass
class Seg:
    a: np.ndarray
    b: np.ndarray
    color: int

    @property
    def vec(self):
        return self.b - self.a

    @property
    def length(self):
        return float(np.linalg.norm(self.vec))

    @property
    def unit(self):
        return self.vec / self.length

    def line(self):
        return LineString([tuple(self.a), tuple(self.b)])


def cross2(u, v) -> float:
    return float(u[0] * v[1] - u[1] * v[0])


def slug_id(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


def read_dxf(path: Path):
    doc = ezdxf.readfile(path)
    segs, texts = [], []
    for e in doc.modelspace():
        if e.dxftype() == "LINE":
            a = np.array([e.dxf.start.x, e.dxf.start.y])
            b = np.array([e.dxf.end.x, e.dxf.end.y])
            if np.linalg.norm(b - a) > 1e-6:
                segs.append(Seg(a, b, int(e.dxf.get("color", 0))))
        elif e.dxftype() == "TEXT":
            texts.append(
                {
                    "text": e.dxf.text.strip(),
                    "x": e.dxf.insert.x,
                    "y": e.dxf.insert.y,
                    "height": e.dxf.height,
                }
            )
    return segs, texts


def pair_band(s: Seg, t: Seg):
    """Quad between two parallel faces 4 in apart, over the length they share."""
    if abs(cross2(s.unit, t.unit)) > 0.01:
        return None
    normal = np.array([-s.unit[1], s.unit[0]])
    d = float(np.dot(t.a - s.a, normal))
    if abs(abs(d) - WALL_THICKNESS) > 0.15:
        return None
    ta = float(np.dot(t.a - s.a, s.unit))
    tb = float(np.dot(t.b - s.a, s.unit))
    lo, hi = max(0.0, min(ta, tb)), min(s.length, max(ta, tb))
    if hi - lo < 0.05:
        return None
    p0, p1 = s.a + s.unit * lo, s.a + s.unit * hi
    return Polygon([p0, p1, p1 + normal * d, p0 + normal * d])


def corner_fills(bands: list[Polygon]) -> list[Polygon]:
    """Wall face pairs stop short of the square where two walls meet.

    Each band is extended by one wall thickness at both ends, and the
    extension is kept only where it reaches another wall, which fills L and T
    corners without spilling into door and window openings.
    """
    fills = []
    for i, b in enumerate(bands):
        c = list(b.exterior.coords)[:4]
        p0, p1, p2, p3 = (np.array(v) for v in c)
        axis = p1 - p0
        if np.linalg.norm(axis) < 1e-6:
            continue
        u = axis / np.linalg.norm(axis) * WALL_THICKNESS
        others = unary_union(bands[:i] + bands[i + 1 :])
        for a, d, sign in ((p0, p3, -1), (p1, p2, 1)):
            sq = Polygon([a, a + sign * u, d + sign * u, d])
            if sq.distance(others) < 0.05 and sq.difference(b).area > 1:
                fills.append(sq)
    return fills


def find_openings(jambs: list[Seg], bands):
    """Pair jamb lines that face each other across a gap in the same wall."""
    openings = []
    used = set()
    for i, j1 in enumerate(jambs):
        best = None
        for k, j2 in enumerate(jambs):
            if k == i or k in used or i in used:
                continue
            if abs(cross2(j1.unit, j2.unit)) > 0.01:
                continue
            along = np.array([j1.unit[1], -j1.unit[0]])
            off = j2.a - j1.a
            # same wall: no sideways shift across the wall thickness
            if abs(np.dot(off, j1.unit)) > 0.2 and abs(np.dot(j2.b - j1.a, j1.unit)) > 0.2:
                continue
            gap = abs(float(np.dot(off, along)))
            if gap < 12 or gap > 120:
                continue
            quad = MultiPoint([tuple(j1.a), tuple(j1.b), tuple(j2.a), tuple(j2.b)]).convex_hull
            # nothing solid inside the gap
            if bands.intersection(quad.buffer(-0.3)).area > 1.0:
                continue
            if best is None or gap < best[0]:
                best = (gap, k, quad)
        if best:
            used.update({i, best[1]})
            openings.append(best[2].minimum_rotated_rectangle)
    return openings


def classify(segs: list[Seg], texts):
    """Separate drawing lines from dimension lines (returned as kept, dimensions)."""
    dim_texts = [t for t in texts if abs(t["height"] - ROOM_TEXT_HEIGHT) > 0.2]
    dim_pts = [np.array([t["x"], t["y"]]) for t in dim_texts]

    def is_tick(s: Seg):
        ang = abs(math.degrees(math.atan2(s.vec[1], s.vec[0]))) % 90
        diag = s.length < 2.2 and 40 < ang < 50
        perp = 2.8 < s.length < 2.95
        return diag or perp

    def near_dim_text(s: Seg):
        return any(min(np.linalg.norm(s.a - p), np.linalg.norm(s.b - p)) < 3.0 for p in dim_pts)

    drawn = [s for s in segs if s.color != FIXTURE_COLOR]
    dims = {id(s) for s in drawn if is_tick(s) or near_dim_text(s)}
    # the second half of each dimension line runs along the same axis
    for s in [s for s in drawn if id(s) in dims and not is_tick(s)]:
        for t in drawn:
            if id(t) in dims or abs(cross2(s.unit, t.unit)) > 0.001:
                continue
            normal = np.array([-s.unit[1], s.unit[0]])
            if abs(np.dot(t.a - s.a, normal)) < 0.01:
                ends = [np.linalg.norm(p - q) for p in (s.a, s.b) for q in (t.a, t.b)]
                if min(ends) < 40 and t.length > 6:
                    dims.add(id(t))
    kept = [s for s in drawn if id(s) not in dims]
    dim_lines = [s for s in drawn if id(s) in dims and not is_tick(s)]
    return kept, dim_lines


def dimension_spans(dim_lines: list[Seg], texts):
    """Each dimension is two collinear lines with its text in the gap between them."""
    spans = []
    for t in texts:
        if abs(t["height"] - ROOM_TEXT_HEIGHT) < 0.2:
            continue
        p = np.array([t["x"], t["y"]])
        near = sorted(dim_lines, key=lambda d: min(np.linalg.norm(d.a - p), np.linalg.norm(d.b - p)))
        if not near or min(np.linalg.norm(near[0].a - p), np.linalg.norm(near[0].b - p)) > 3.5:
            continue
        first = near[0]
        n = np.array([-first.unit[1], first.unit[0]])
        mates = [
            d
            for d in dim_lines
            if d is not first
            and abs(cross2(d.unit, first.unit)) < 0.001
            and abs(np.dot(d.a - first.a, n)) < 0.01
        ]
        if not mates:
            continue
        u = first.unit
        ends = [first.a, first.b]
        # The mate is the collinear half whose near end is closest to the text.
        mate = min(mates, key=lambda d: min(np.linalg.norm(d.a - p), np.linalg.norm(d.b - p)))
        ends += [mate.a, mate.b]
        proj = [float(np.dot(e, u)) for e in ends]
        lo, hi = ends[int(np.argmin(proj))], ends[int(np.argmax(proj))]
        spans.append((lo, hi, u))
    return spans


def divider_candidates(space: Polygon, kept: list[Seg], dim_lines: list[Seg], texts):
    """Possible missing walls inside one open space.

    Xactimate dimensions every wall, including the invisible ones that split an
    open plan, 6 in off the wall. A dimension with no wall face 6 in away marks
    a missing wall. Wall faces that stop in open space are also extended until
    they reach a wall.
    """
    cands = []
    inner = space.buffer(-0.5)
    for a, b, u in dimension_spans(dim_lines, texts):
        n = np.array([-u[1], u[0]])
        for side in (6.0, -6.0):
            pa, pb = a + n * side, b + n * side
            seg = LineString([tuple(pa), tuple(pb)])
            if seg.length < 12 or inner.intersection(seg).length < 0.9 * seg.length:
                continue
            cands.append(seg)
    reach = max(space.bounds[2] - space.bounds[0], space.bounds[3] - space.bounds[1]) * 2
    for s in kept:
        for start, direction in ((s.b, s.unit), (s.a, -s.unit)):
            if not space.buffer(0.6).contains(Point(start)):
                continue
            ray = LineString([tuple(start + direction * 0.3), tuple(start + direction * reach)])
            inside = ray.intersection(space)
            first = inside.geoms[0] if hasattr(inside, "geoms") else inside
            if first.is_empty or first.length < 12:
                continue
            if Point(first.coords[0]).distance(Point(start)) > 1:
                continue
            cands.append(LineString([tuple(start), first.coords[-1]]))
    unique = []
    for c in cands:
        if not any(c.hausdorff_distance(o) < 0.5 for o in unique):
            unique.append(c)
    return unique


def split_space(space: Polygon, labels, cands: list[LineString], targets):
    """Split one enclosed space that holds several room labels.

    Tries sets of candidate dividers and keeps the set that leaves every piece
    with exactly one room label. With estimate areas, the set that matches
    them best wins; without them, the shortest set of dividers wins.
    """
    from itertools import combinations

    if len(labels) == 1:
        return [(labels[0]["text"], space)]
    pts = [Point(t["x"], t["y"]) for t in labels]
    best = None
    for k in range(len(labels) - 1, len(labels) + 1):
        for combo in combinations(cands, k):
            lines = unary_union([space.exterior, *[extend(c, 0.8) for c in combo]])
            faces = [f for f in polygonize(lines) if f.area > 1 and space.buffer(0.1).contains(f.representative_point())]
            if len(faces) != len(labels):
                continue
            names = []
            for f in faces:
                hit = [t["text"] for t, pt in zip(labels, pts) if f.contains(pt)]
                if len(hit) != 1:
                    break
                names.append(hit[0])
            else:
                sub = list(zip(names, faces))
                if targets and all(n in targets for n in names):
                    score = sum(abs(f.area / 144 - targets[n]) for n, f in sub)
                else:
                    score = sum(c.length for c in combo)
                if best is None or score < best[0]:
                    best = (score, sub)
    return best[1] if best else None


def extend(line: LineString, by: float) -> LineString:
    (x0, y0), (x1, y1) = line.coords[0], line.coords[-1]
    v = np.array([x1 - x0, y1 - y0])
    v = v / np.linalg.norm(v) * by
    return LineString([(x0 - v[0], y0 - v[1]), (x1 + v[0], y1 + v[1])])


def inputs(slug: str):
    folder = ROOT / "pipeline" / "input" / slug
    dxfs = sorted(folder.glob("*.dxf"))
    pdfs = sorted(folder.glob("*.pdf"))
    if len(dxfs) != 1 or len(pdfs) != 1:
        sys.exit(f"Put one sketch .dxf and one scope .pdf in {folder.relative_to(ROOT)}")
    return dxfs[0], pdfs[0]


def build(slug: str):
    dxf_path, scope_path = inputs(slug)
    scope = read_scope(scope_path)
    segs, texts = read_dxf(dxf_path)
    kept, dim_lines = classify(segs, texts)

    bands = []
    for i, s in enumerate(kept):
        for t in kept[i + 1 :]:
            q = pair_band(s, t)
            if q is not None:
                bands.append(q)
    solid = unary_union([*bands, *corner_fills(bands)]).buffer(0.05, join_style=2).buffer(-0.05, join_style=2)

    jambs = [
        s
        for s in kept
        if abs(s.length - WALL_THICKNESS) < 0.15
        and solid.buffer(0.05).contains(s.line())
    ]
    openings = find_openings(jambs, solid)
    walls_closed = unary_union([solid, *[o.buffer(0.02) for o in openings]]).buffer(0)

    # The house outline and the rooms are the shell and the holes of the closed walls.
    shells = list(walls_closed.geoms) if isinstance(walls_closed, MultiPolygon) else [walls_closed]
    shell = max(shells, key=lambda p: p.area)
    footprint = Polygon(shell.exterior)
    holes = [Polygon(r) for r in shell.interiors if Polygon(r).area > 144]

    room_labels = [t for t in texts if abs(t["height"] - ROOM_TEXT_HEIGHT) < 0.2 and "(" not in t["text"]]
    fixture_labels = [t for t in texts if abs(t["height"] - ROOM_TEXT_HEIGHT) < 0.2 and "(" in t["text"]]

    targets = {r.name: r.floor_sf for r in scope.rooms if r.floor_sf}
    rooms = []
    for hole in holes:
        labels = [t for t in room_labels if hole.contains(Point(t["x"], t["y"]))]
        if not labels:
            continue
        cands = divider_candidates(hole, kept, dim_lines, texts) if len(labels) > 1 else []
        parts = split_space(hole, labels, cands, targets)
        if parts is None:
            sys.exit("Could not separate rooms: " + ", ".join(t["text"] for t in labels))
        rooms.extend({"name": name, "poly": poly} for name, poly in parts)
    missing = {t["text"] for t in room_labels} - {r["name"] for r in rooms}
    if missing:
        sys.exit("Room labels outside any enclosed space: " + ", ".join(sorted(missing)))

    open_list = match_openings(openings, rooms, footprint, scope)

    # Fixtures: color 92 rectangles with a label inside.
    fx_lines = [s.line() for s in segs if s.color == FIXTURE_COLOR]
    fx_polys = [p for p in polygonize(unary_union(fx_lines)) if p.minimum_rotated_rectangle.area > 50]
    fixtures = []
    for t in fixture_labels:
        pt = Point(t["x"], t["y"])
        inside = [p for p in fx_polys if p.buffer(0.5).contains(pt)]
        if not inside:
            continue
        poly = min(inside, key=lambda p: p.area)
        label = re.sub(r"\s*\(.*\)", "", t["text"])
        kind = next((k for k in FIXTURE_HEIGHTS if k in label.lower()), "cabinet")
        room = next((r["name"] for r in rooms if r["poly"].buffer(1).contains(poly.centroid)), None)
        fixtures.append({"label": label, "kind": kind, "poly": poly, "room": room})

    check_against_scope(rooms, scope)
    write_days(slug, scope, [r["name"] for r in rooms])
    print(f"Homeowner code: {scope.code}")
    for r in rooms:
        r["height"] = next((g.height for g in scope.rooms if g.name == r["name"]), None)
    wall_height = max((r["height"] or 96.0) for r in rooms)
    write_outputs(slug, footprint, solid, rooms, open_list, fixtures, wall_height)


def opening_span(poly: Polygon):
    """Width along the wall, and the opening's centerline as (start, end) points."""
    pts = np.array(poly.minimum_rotated_rectangle.exterior.coords[:4])
    e0, e1 = pts[1] - pts[0], pts[2] - pts[1]
    if np.linalg.norm(e0) >= np.linalg.norm(e1):
        a, b = (pts[0] + pts[3]) / 2, (pts[1] + pts[2]) / 2
    else:
        a, b = (pts[0] + pts[1]) / 2, (pts[3] + pts[2]) / 2
    return float(np.linalg.norm(b - a)), a, b


def match_openings(openings, rooms, footprint, scope):
    """Give each opening in the sketch its kind and height from the scope.

    The sketch sets where an opening is and how wide. The scope lists every
    door and window by room; each opening takes the closest-width entry in the
    room it opens from. The build stops when a room has a different number of
    doors and windows in the sketch and the scope.
    """
    listed = {g.name: list(g.openings) for g in scope.rooms}
    heights = {g.name: g.height for g in scope.rooms}
    touching = []
    for o in openings:
        near = [r for r in rooms if r["poly"].buffer(2.5).intersects(o)]
        # Closest room first, so an opening between open-plan rooms goes to the room it is in.
        near.sort(key=lambda r: r["poly"].distance(o.centroid))
        touching.append([r["name"] for r in near])

    problems = []
    for name, entries in listed.items():
        in_sketch = sum(name in t for t in touching)
        if in_sketch != len(entries):
            problems.append(f"{name}: {in_sketch} doors and windows in the sketch, {len(entries)} in the scope")
    if problems:
        sys.exit("The sketch and the scope disagree on doors and windows:\n  " + "\n  ".join(problems))

    remaining = {name: list(entries) for name, entries in listed.items()}
    result = []
    for o, names in zip(openings, touching):
        exterior = o.buffer(0.5).intersects(footprint.exterior)
        width, a, b = opening_span(o)
        pool = [(n, e) for n in names for e in remaining.get(n, []) if e.exterior == exterior]
        if not pool:
            sys.exit(f"No door or window in the scope for the {width:.0f} in opening at {', '.join(names)}")
        room, entry = min(pool, key=lambda ne: (round(abs(ne[1].width - width), 1), names.index(ne[0])))
        remaining[room].remove(entry)
        if not exterior:
            # An interior door is listed in both rooms it joins.
            for other in names:
                twin = [e for e in remaining.get(other, []) if e.kind == entry.kind and not e.exterior]
                if other != room and twin:
                    remaining[other].remove(min(twin, key=lambda e: abs(e.width - entry.width)))
        wall = max(heights.get(n) or 96.0 for n in names)
        item = {"kind": entry.kind, "poly": o, "exterior": exterior, "width": width, "a": a, "b": b, "wall": wall}
        if entry.kind == "door":
            item["bottom"], item["top"] = 0.0, min(entry.height, wall - 1)
        else:
            item["bottom"], item["top"] = place_window(entry.height, wall)
        result.append(item)
    return result


def place_window(height: float, wall: float):
    top_limit = wall - WINDOW_TOP_CLEARANCE
    sill = WINDOW_SILL
    if sill + height > top_limit:
        sill = max(WINDOW_MIN_SILL, top_limit - height)
    return sill, min(sill + height, top_limit)


def check_against_scope(rooms, scope):
    """Stop the build when the sketch and the scope do not describe the same rooms."""
    sketch = {r["name"] for r in rooms}
    listed = {r.name for r in scope.rooms}
    problems = []
    if sketch - listed:
        problems.append("In the sketch but not the scope: " + ", ".join(sorted(sketch - listed)))
    if listed - sketch:
        problems.append("In the scope but not the sketch: " + ", ".join(sorted(listed - sketch)))
    for r in rooms:
        want = next((g.floor_sf for g in scope.rooms if g.name == r["name"]), None)
        if not want:
            continue
        sf = r["poly"].area / 144
        miss = abs(sf - want) / want
        print(f"{'ok  ' if miss <= AREA_TOLERANCE else 'FAIL'} {r['name']:<14} {sf:8.2f} SF  scope {want:8.2f}  ({miss * 100:.2f}%)")
        if miss > AREA_TOLERANCE:
            problems.append(f"{r['name']} floor is {sf:.2f} SF in the sketch and {want:.2f} SF in the scope")
    if problems:
        sys.exit("The sketch and the scope disagree:\n  " + "\n  ".join(problems))


def write_days(slug: str, scope, room_names: list[str]):
    """Production days from the scope's line items. The line items are not kept."""
    all_rooms = [slug_id(n) for n in room_names]
    groups = []
    for g in scope.groups:
        if g.is_room:
            groups.append((slug_id(g.name), g.items))
        elif slug_id(g.name) == "crawlspace":
            groups.append(("crawlspace", g.items))
        else:
            groups.append((None, g.items))
    phases, unmatched = build_days(groups, all_rooms)
    if unmatched:
        lines = [f"{room}: {item}" for room, item in unmatched]
        sys.exit("Line items with no day rule (add one in pipeline/day_rules.py):\n  " + "\n  ".join(lines))
    out = ROOT / "data" / slug / "days.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"phases": phases}, indent=2) + "\n")
    print(f"wrote {out.relative_to(ROOT)} ({len(phases)} production phases)")


# ---------- output ----------


def to_world(geom, cx: float, cy: float):
    """Plan inches (y = north) to scene feet on the ground plane (x = east, y = north)."""
    g = affinity.translate(geom, -cx, -cy)
    return affinity.scale(g, 1 / 12, 1 / 12, origin=(0, 0))


# Plan (x east, y north, extrusion up) to glTF (x east, y up, z south).
PLAN_TO_GLTF = np.array([[1, 0, 0, 0], [0, 0, 1, 0], [0, -1, 0, 0], [0, 0, 0, 1]], dtype=float)


def extrude(geom, z0: float, z1: float):
    """Extrude a plan polygon in feet from height z0 to z1 and turn it Y-up."""
    parts = list(geom.geoms) if hasattr(geom, "geoms") else [geom]
    meshes = []
    for p in parts:
        if not isinstance(p, Polygon) or p.is_empty or p.area < 1e-4:
            continue
        m = trimesh.creation.extrude_polygon(orient(p), z1 - z0)
        m.apply_translation([0, 0, z0])
        meshes.append(m)
    if not meshes:
        return None
    mesh = trimesh.util.concatenate(meshes)
    mesh.apply_transform(PLAN_TO_GLTF)
    return mesh


def box(poly: Polygon, z0: float, z1: float):
    return extrude(poly, z0, z1)


def cut(mesh, holes):
    """Subtract opening boxes from a wall mesh, leaving one clean piece."""
    holes = [h for h in holes if h is not None]
    if mesh is None or not holes:
        return mesh
    return trimesh.boolean.difference([mesh, *holes], engine="manifold")


def write_outputs(slug, footprint, solid, rooms, openings, fixtures, wall_height):
    minx, miny, maxx, maxy = footprint.bounds
    cx, cy = (minx + maxx) / 2, (miny + maxy) / 2
    W = lambda p: to_world(p, cx, cy)  # noqa: E731
    ft = lambda v: v / 12  # noqa: E731

    scene = trimesh.Scene()

    def add(name, mesh):
        if mesh is not None:
            scene.add_geometry(mesh, node_name=name, geom_name=name)

    # The sketch leaves a gap in the wall at each opening. The wall is built
    # closed, then each opening is cut out from its bottom to its top, so the
    # wall stays one piece above doors and above and below windows.
    closed = unary_union([solid, *[o["poly"].buffer(0.02, join_style=2) for o in openings]]).buffer(0)
    holes = [box(W(o["poly"].buffer(0.3, join_style=2)), ft(o["bottom"]), ft(o["top"])) for o in openings]
    add("main__house__walls", cut(extrude(W(closed), 0, ft(wall_height)), holes))
    for i, o in enumerate(openings):
        if o["kind"] != "window":
            continue
        pane = LineString([tuple(o["a"]), tuple(o["b"])]).buffer(PANE_THICKNESS / 2, cap_style=2)
        add(f"main__house__glass_{i}", extrude(W(pane), ft(o["bottom"]), ft(o["top"])))

    plan_rooms = []
    for r in rooms:
        rid = slug_id(r["name"])
        poly = r["poly"]
        here = [o for o in openings if o["poly"].buffer(1).intersects(poly)]
        floor = W(poly)
        # Wall finish and baseboard follow real walls only, not open-plan dividers.
        along_walls = solid.buffer(1.0, join_style=2)
        doors = unary_union([o["poly"] for o in here if o["kind"] == "door"]).buffer(1.5)
        skin = W(poly.buffer(0.6, join_style=2).difference(poly).intersection(along_walls))
        base = W(poly.difference(poly.buffer(-0.75, join_style=2)).difference(doors).intersection(along_walls))
        skin_holes = [box(W(o["poly"].buffer(1.5, join_style=2)), ft(o["bottom"]), ft(o["top"])) for o in here]
        height = r.get("height") or wall_height
        add(f"main__{rid}__floor", extrude(floor, 0, ft(0.75)))
        add(f"main__{rid}__walls", cut(extrude(skin, 0, ft(height)), skin_holes))
        add(f"main__{rid}__baseboard", extrude(base, ft(0.75), ft(4.0)))
        c = floor.representative_point() if not floor.centroid.within(floor) else floor.centroid
        plan_rooms.append(
            {
                "id": rid,
                "name": r["name"],
                "level": "main",
                "areaSF": round(poly.area / 144, 2),
                "center": [round(c.x, 3), round(c.y, 3)],
                "polygon": [[round(x, 3), round(y, 3)] for x, y in floor.exterior.coords],
            }
        )

    # Door leaves sit in their openings so a "Doors" day has something to light up.
    for i, o in enumerate(openings):
        if o["kind"] != "door":
            continue
        owner = max(rooms, key=lambda r: r["poly"].buffer(2).intersection(o["poly"]).area)
        others = [r for r in rooms if r is not owner and r["poly"].buffer(2).intersects(o["poly"])]
        # A door belongs to the smaller room it serves (bedroom over hallway).
        if others:
            owner = min([owner, *others], key=lambda r: r["poly"].area)
        rid = "house" if o["exterior"] else slug_id(owner["name"])
        add(f"main__{rid}__door_{i}", extrude(W(o["poly"]).buffer(-0.08), 0, ft(o["top"])))

    plan_fixtures = []
    for i, f in enumerate(fixtures):
        rid = slug_id(f["room"]) if f["room"] else "house"
        group = "cabinets" if f["kind"] == "cabinet" else ("fixtures" if f["kind"] == "tub" else "appliances")
        add(f"main__{rid}__{group}_{i}", extrude(W(f["poly"]).buffer(-0.02), ft(0.75), ft(FIXTURE_HEIGHTS[f["kind"]])))
        plan_fixtures.append({"label": f["label"], "kind": f["kind"], "room": rid})

    # Crawlspace: ground, stem walls under the exterior walls, and the insulation layer.
    fp = W(footprint)
    ring = W(footprint.difference(footprint.buffer(-6, join_style=2)))
    add("crawlspace__crawlspace__ground", extrude(fp, 0, ft(1)))
    add("crawlspace__house__stem", extrude(ring, 0, ft(CRAWL_HEIGHT)))
    add("crawlspace__crawlspace__insulation", extrude(W(footprint.buffer(-6, join_style=2)), ft(CRAWL_HEIGHT - 10), ft(CRAWL_HEIGHT)))

    out_glb = ROOT / "public" / "models" / f"{slug}.glb"
    out_glb.parent.mkdir(parents=True, exist_ok=True)
    out_glb.write_bytes(scene.export(file_type="glb"))

    w, d = (maxx - minx) / 12, (maxy - miny) / 12
    plan = {
        "units": "ft",
        "size": [round(w, 3), round(d, 3)],
        "levels": [
            {"id": "main", "name": "Main Level", "height": wall_height / 12},
            {"id": "crawlspace", "name": "Crawlspace", "height": CRAWL_HEIGHT / 12},
        ],
        "rooms": plan_rooms
        + [
            {
                "id": "crawlspace",
                "name": "Crawlspace",
                "level": "crawlspace",
                "areaSF": round(footprint.area / 144, 2),
                "center": [0, 0],
                "polygon": [[round(x, 3), round(y, 3)] for x, y in fp.exterior.coords],
            }
        ],
        "fixtures": plan_fixtures,
        "openings": [
            {
                "kind": o["kind"],
                "exterior": o["exterior"],
                "width": round(o["width"] / 12, 3),
                "bottom": round(o["bottom"] / 12, 3),
                "top": round(o["top"] / 12, 3),
            }
            for o in openings
        ],
    }
    out_json = ROOT / "data" / slug / "plan.json"
    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_json.write_text(json.dumps(plan, indent=2) + "\n")
    print(f"wrote {out_glb.relative_to(ROOT)} ({out_glb.stat().st_size // 1024} KB) and {out_json.relative_to(ROOT)}")
    print(f"{len(rooms)} rooms, {len(openings)} openings, {len(fixtures)} fixtures")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("slug")
    args = ap.parse_args()
    build(args.slug)
