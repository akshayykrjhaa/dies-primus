"""Turns analyzed files into a low-poly city.

Layout, in order:
  1. Files group into districts by directory (collapsed to a sane depth).
  2. Each district is zoned from the mix of file roles inside it -- downtown,
     commercial, residential, campus, industrial or civic -- which decides its
     ground surface and street furniture.
  3. Plots are shelf-packed into blocks; the gaps between them become a real
     road network with lane markings, not just empty space.
  4. Inside a plot, files are placed centre-outwards so the important ones sit
     downtown, and each becomes an archetype building (see archetypes.py)
     whose footprint and storey count come from the file itself.

The point of the archetypes is that two different repositories should build
visibly different cities: a docs-heavy repo grows libraries and schools, a
service repo grows glass towers, a tooling repo grows factories.

All coordinates are world units, the city is centred on the origin, and the
entrance gate sits on the +Z (south) edge where the camera starts.
"""
from __future__ import annotations

import colorsys
import math
import os
from typing import Any

from . import archetypes, tech
from .selector import FileInfo

FLOOR_HEIGHT = 2.6
CELL = 9.4           # grid pitch inside a district
PLOT_PADDING = 3.4   # verge between buildings and the plot edge
ROAD = 11.5          # width of the streets between plots

# zone -> (ground colour, is_grass, tree density 0..1)
ZONES: dict[str, tuple[str, bool, float]] = {
    "downtown": ("#9BA3AE", False, 0.10),
    "commercial": ("#A8AEB8", False, 0.16),
    "residential": ("#86C06C", True, 0.42),
    "campus": ("#8FC98A", True, 0.34),
    "industrial": ("#8D949E", False, 0.06),
    "civic": ("#B3B9C2", False, 0.26),
    "park": ("#7CB963", True, 0.9),
}

ZONE_BY_ROLE = {
    "api": "downtown",
    "business-logic": "downtown",
    "entrypoint": "civic",
    "docs": "civic",
    "ui": "commercial",
    "styling": "commercial",
    "test": "campus",
    "data-model": "industrial",
    "build": "industrial",
    "infra": "industrial",
    "config": "industrial",
    "script": "industrial",
    "other": "residential",
}


def _shade(hex_color: str, amount: float) -> str:
    """Lighten (amount > 0) or darken (amount < 0) a hex colour."""
    hex_color = hex_color.lstrip("#")
    if len(hex_color) != 6:
        return "#" + hex_color
    r, g, b = (int(hex_color[i : i + 2], 16) / 255 for i in (0, 2, 4))
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    l = max(0.05, min(0.95, l + amount))
    r, g, b = colorsys.hls_to_rgb(h, l, s)
    return "#{:02X}{:02X}{:02X}".format(int(r * 255), int(g * 255), int(b * 255))


def _district_key(path: str, max_depth: int = 2) -> str:
    directory = os.path.dirname(path)
    if not directory:
        return "."
    parts = directory.split("/")
    return "/".join(parts[:max_depth])


def _cells_in_ring_order(cols: int, rows: int) -> list[tuple[int, int]]:
    """Grid cells sorted by distance from the plot centre (downtown first)."""
    cx, cz = (cols - 1) / 2, (rows - 1) / 2
    cells = [(c, r) for r in range(rows) for c in range(cols)]
    cells.sort(key=lambda cr: ((cr[0] - cx) ** 2 + (cr[1] - cz) ** 2, cr[1], cr[0]))
    return cells


def _zone_for(roles: list[str]) -> str:
    if not roles:
        return "residential"
    counts: dict[str, int] = {}
    for role in roles:
        zone = ZONE_BY_ROLE.get(role, "residential")
        counts[zone] = counts.get(zone, 0) + 1
    return max(counts, key=lambda key: counts[key])


def build_city(
    slug: str,
    html_url: str,
    branch: str,
    meta: dict[str, Any],
    project: dict[str, Any],
    files: list[FileInfo],
    descriptions: dict[str, dict[str, Any]],
    loc_by_path: dict[str, int],
    languages: dict[str, int],
    stats_extra: dict[str, Any],
) -> dict[str, Any]:
    district_names = {d.get("path", "").strip("/"): d for d in project.get("districts", [])}

    # Sizes are judged against this repository's own distribution, so a small
    # project builds a town and a large one builds a skyline.
    scale = archetypes.RepoScale.from_locs(
        [loc_by_path.get(f.path, f.loc) for f in files]
    )

    # --- group files into districts -------------------------------------
    groups: dict[str, list[FileInfo]] = {}
    for file in files:
        groups.setdefault(_district_key(file.path), []).append(file)

    # Fold single-file districts into their parent so the map is not confetti.
    for key in sorted(groups, key=lambda k: -k.count("/")):
        if len(groups[key]) == 1 and "/" in key:
            parent = key.rsplit("/", 1)[0]
            if parent in groups:
                groups[parent].extend(groups.pop(key))

    ordered_keys = sorted(groups, key=lambda k: (k != ".", -len(groups[k]), k))

    # --- size each plot --------------------------------------------------
    plots: list[dict[str, Any]] = []
    for key in ordered_keys:
        members = groups[key]
        roles = [descriptions.get(f.path, {}).get("role", "other") for f in members]
        zone = _zone_for(roles)
        count = len(members)
        # Leave a few empty cells so parks and street furniture have somewhere
        # to go -- a plot packed wall to wall reads as a spreadsheet.
        capacity = count + max(1, count // 6)
        cols = max(1, math.ceil(math.sqrt(capacity * 1.25)))
        rows = max(1, math.ceil(capacity / cols))
        plots.append(
            {
                "key": key,
                "zone": zone,
                "cols": cols,
                "rows": rows,
                "width": cols * CELL + PLOT_PADDING * 2,
                "depth": rows * CELL + PLOT_PADDING * 2,
            }
        )

    # A nine-file repo does not need motorways. Narrow the streets when there
    # are few blocks, or the road network visually swamps the city it serves.
    road = max(7.0, min(ROAD, 4.5 + 1.1 * len(plots)))

    # A big repository earns a stadium: an empty plot with a landmark in it.
    has_stadium = len(files) >= 55
    if has_stadium:
        plots.insert(
            min(2, len(plots)),
            {
                "key": "__stadium__",
                "zone": "park",
                "cols": 0,
                "rows": 0,
                "width": 42.0,
                "depth": 34.0,
            },
        )

    # --- shelf-pack plots into city blocks -------------------------------
    #
    # Two passes. The first is a plain greedy fill, used only to decide how
    # many rows the city wants. The second lays the plots out into exactly
    # that many rows, aiming each row at the average of what is still left to
    # place, which self-corrects as it goes.
    #
    # Greedy alone left a stubby final row -- often a fifth the width of the
    # others -- because it fills every row to the brim and dumps the remainder
    # at the end. That ragged edge is what produced streets with blocks along
    # one side and open snow along the other: legitimate boundary roads, but
    # they read as roads running off to nowhere. Balanced rows give the city a
    # tidy outline and the road network something to serve on both sides.
    total_area = sum(p["width"] * p["depth"] for p in plots) or 1.0
    total_run = sum(p["width"] for p in plots) + road * max(0, len(plots) - 1)

    def greedy_rows(target: float) -> int:
        count, x = 1, 0.0
        for plot in plots:
            if x > 0 and x + plot["width"] > target:
                count += 1
                x = 0.0
            x += plot["width"] + road
        return count

    row_count = max(1, min(len(plots), greedy_rows(math.sqrt(total_area) * 1.5)))

    def balanced_rows(count: int) -> list[dict[str, Any]]:
        """Split the plots into `count` rows, minimising the widest row.

        This is the classic linear-partition problem, and it is worth solving
        exactly rather than approximating: greedy fills every row to the brim
        and leaves a stub, while aiming at a running average tends to shunt
        the surplus into the final row instead. Either way the city comes out
        L-shaped, and an L-shaped city has streets with blocks along one side
        and open snow along the other.

        Plot order is preserved -- districts stay adjacent to their siblings --
        so this is a partition into contiguous runs, not a repacking. The
        input is districts rather than files, so `n` is small and the O(n^2 *
        rows) table costs nothing.
        """
        count = max(1, min(count, len(plots)))
        n = len(plots)

        # run[i][j] is the width of plots[i:j], roads between them included.
        prefix = [0.0]
        for plot in plots:
            prefix.append(prefix[-1] + plot["width"])

        def run(i: int, j: int) -> float:
            if j <= i:
                return 0.0
            return prefix[j] - prefix[i] + road * (j - i - 1)

        infinity = float("inf")
        # best[r][i]: the narrowest achievable widest-row, laying out
        # plots[i:] into exactly r rows.
        best = [[infinity] * (n + 1) for _ in range(count + 1)]
        cut = [[n] * (n + 1) for _ in range(count + 1)]
        best[0][n] = 0.0
        for rows_left in range(1, count + 1):
            for i in range(n):
                # Leave at least one plot for each row that follows.
                for j in range(i + 1, n - (rows_left - 1) + 1):
                    tail = best[rows_left - 1][j]
                    if tail == infinity:
                        continue
                    widest = run(i, j)
                    if tail > widest:
                        widest = tail
                    if widest < best[rows_left][i]:
                        best[rows_left][i] = widest
                        cut[rows_left][i] = j

        rows: list[dict[str, Any]] = []
        index = 0
        for rows_left in range(count, 0, -1):
            end_index = cut[rows_left][index] if best[rows_left][index] < infinity else n
            members = plots[index:end_index]
            rows.append(
                {
                    "depth": max((m["depth"] for m in members), default=0.0),
                    "from": index,
                    "to": end_index,
                    "width": run(index, end_index),
                }
            )
            index = end_index
        if index < n:  # never expected; keep every plot regardless
            last = rows[-1]
            last["to"] = n
            last["width"] = run(last["from"], n)
            last["depth"] = max(m["depth"] for m in plots[last["from"] : n])
        return rows

    shelves = balanced_rows(row_count)

    # Lay the rows out and give every plot its coordinates.
    cursor_z, city_width = 0.0, 0.0
    for shelf in shelves:
        cursor_x = 0.0
        for plot in plots[shelf["from"] : shelf["to"]]:
            plot["x"] = cursor_x
            plot["z"] = cursor_z
            cursor_x += plot["width"] + road
        shelf["z"] = cursor_z
        shelf["width"] = max(0.0, cursor_x - road)
        cursor_z += shelf["depth"] + road
        city_width = max(city_width, shelf["width"])
    city_depth = cursor_z - road

    offset_x = city_width / 2
    offset_z = city_depth / 2

    # --- place buildings --------------------------------------------------
    buildings: list[dict[str, Any]] = []
    districts: list[dict[str, Any]] = []
    props: list[dict[str, Any]] = []
    language_counts: dict[str, int] = {}
    type_counts: dict[str, int] = {}

    for plot in plots:
        plot_x = plot["x"] - offset_x
        plot_z = plot["z"] - offset_z
        ground, is_grass, tree_density = ZONES[plot["zone"]]

        if plot["key"] == "__stadium__":
            props.append(
                {
                    "type": "stadium",
                    "x": round(plot_x + plot["width"] / 2, 2),
                    "z": round(plot_z + plot["depth"] / 2, 2),
                    "rotation": 0.0,
                    "scale": 1.0,
                    "color": "#E63946",
                }
            )
            districts.append(
                {
                    "id": f"d{len(districts)}",
                    "path": "__stadium__",
                    "name": "City Stadium",
                    "purpose": "Every city needs one.",
                    "zone": "park",
                    "ground": ground,
                    "grass": is_grass,
                    "x": round(plot_x + plot["width"] / 2, 2),
                    "z": round(plot_z + plot["depth"] / 2, 2),
                    "width": round(plot["width"], 2),
                    "depth": round(plot["depth"], 2),
                    "color": "#7CB963",
                    "fileCount": 0,
                    "buildingIds": [],
                }
            )
            continue

        key = plot["key"]
        members = sorted(
            groups[key],
            key=lambda f: (
                -descriptions.get(f.path, {}).get("importance", round(f.score * 10)),
                -loc_by_path.get(f.path, f.loc),
            ),
        )
        cells = _cells_in_ring_order(plot["cols"], plot["rows"])
        ids: list[str] = []
        district_palette: dict[str, int] = {}

        for index, file in enumerate(members):
            col, row = cells[index]
            info = descriptions.get(file.path) or {}
            detected = tech.detect(file.path)
            importance = int(info.get("importance", max(1, round(file.score * 10))))
            loc = loc_by_path.get(file.path, file.loc)
            role = info.get("role", "other")
            seed = archetypes.seed_of(file.path)

            tier = scale.tier(loc, importance)
            archetype = archetypes.choose(file.path, role, tier)
            floors = archetypes.floors_for(archetype, loc, seed, scale)
            wall = archetypes.palette_for(archetype, seed)

            # Footprint grows with the file as well as the storey count, so a
            # low-rise archetype (a warehouse tops out at three floors) still
            # shows the difference between a 20-line file and a 2000-line one.
            # It is capped to the cell so a plot can never overflow into the
            # street, and floored so a stub is still a building.
            raw_width, raw_depth = archetypes.footprint_for(archetype, loc, seed, scale)
            width = round(min(CELL - 1.6, max(2.6, raw_width)), 2)
            depth = round(min(CELL - 1.6, max(2.6, raw_depth)), 2)
            height = round(max(2.4, floors * FLOOR_HEIGHT), 2)

            language_counts[detected.language] = language_counts.get(detected.language, 0) + 1
            type_counts[archetype.label] = type_counts.get(archetype.label, 0) + 1
            district_palette[detected.color] = district_palette.get(detected.color, 0) + 1

            # Buildings face the nearest street, which is what makes a block
            # read as a block rather than a field of loose boxes.
            facing = 0.0 if row >= plot["rows"] / 2 else math.pi

            buildings.append(
                {
                    "id": f"b{len(buildings)}",
                    "path": file.path,
                    "name": file.name,
                    "district": key,
                    "zone": plot["zone"],
                    "ext": file.ext,
                    "language": detected.language,
                    "languageColor": detected.color,
                    "iconSlug": info.get("iconSlug") or detected.icon_slug,
                    "archetype": archetype.key,
                    "archetypeLabel": archetype.label,
                    "color": wall,
                    "accent": archetype.accent,
                    "roofColor": _shade(wall, -0.16),
                    "roof": archetype.roof,
                    "floors": floors,
                    "seed": seed % 100000,
                    "rotation": round(facing, 3),
                    "x": round(plot_x + PLOT_PADDING + col * CELL + CELL / 2, 2),
                    "z": round(plot_z + PLOT_PADDING + row * CELL + CELL / 2, 2),
                    "width": width,
                    "depth": depth,
                    "height": height,
                    "role": role,
                    "importance": importance,
                    "loc": loc,
                    "bytes": file.size,
                    "isLandmark": file.is_landmark or importance >= 9,
                    "headline": info.get("headline") or f"{detected.language} file",
                    "summary": info.get("summary") or "",
                    "detail": info.get("detail") or "",
                    "tags": info.get("tags") or [],
                    "keySymbols": info.get("key_symbols") or [],
                    "connectsTo": info.get("connects_to") or [],
                    "ai": bool(info.get("ai")),
                    "githubUrl": f"{html_url}/blob/{branch}/{file.path}",
                }
            )
            ids.append(buildings[-1]["id"])

        # Spare cells become parks and street furniture.
        for index in range(len(members), len(cells)):
            col, row = cells[index]
            cx = plot_x + PLOT_PADDING + col * CELL + CELL / 2
            cz = plot_z + PLOT_PADDING + row * CELL + CELL / 2
            spot_seed = archetypes.seed_of(f"{key}:{col}:{row}")
            props.append(
                {
                    "type": "park",
                    "x": round(cx, 2),
                    "z": round(cz, 2),
                    "rotation": round((spot_seed % 628) / 100, 2),
                    "scale": round(0.85 + (spot_seed % 30) / 100, 2),
                    "color": "#7CB963",
                }
            )

        # Trees scattered along the plot verge, denser in green zones.
        perimeter_seed = archetypes.seed_of(key)
        tree_count = int(tree_density * (plot["cols"] + plot["rows"]) * 2)
        for i in range(tree_count):
            s = archetypes.seed_of(f"{key}:tree:{i}")
            edge = (s >> 2) % 4
            along = ((s >> 5) % 100) / 100.0
            if edge == 0:
                tx, tz = plot_x + along * plot["width"], plot_z + 1.6
            elif edge == 1:
                tx, tz = plot_x + along * plot["width"], plot_z + plot["depth"] - 1.6
            elif edge == 2:
                tx, tz = plot_x + 1.6, plot_z + along * plot["depth"]
            else:
                tx, tz = plot_x + plot["width"] - 1.6, plot_z + along * plot["depth"]
            props.append(
                {
                    "type": "palm" if (s % 11 == 0 and is_grass) else "tree",
                    "x": round(tx, 2),
                    "z": round(tz, 2),
                    "rotation": round((s % 628) / 100, 2),
                    "scale": round(0.8 + (s % 40) / 100, 2),
                    "color": "#4F772D" if s % 3 else "#5C9E3F",
                }
            )

        dominant = max(district_palette, key=district_palette.get) if district_palette else "#7C8296"
        described = district_names.get(key) or district_names.get(key.split("/")[0]) or {}
        label = "Project Root" if key == "." else key.split("/")[-1]
        districts.append(
            {
                "id": f"d{len(districts)}",
                "path": key,
                "name": described.get("name") or label.replace("_", " ").replace("-", " ").title(),
                "purpose": described.get("purpose") or "",
                "zone": plot["zone"],
                "ground": ground,
                "grass": is_grass,
                "x": round(plot_x + plot["width"] / 2, 2),
                "z": round(plot_z + plot["depth"] / 2, 2),
                "width": round(plot["width"], 2),
                "depth": round(plot["depth"], 2),
                "color": dominant,
                "fileCount": len(members),
                "buildingIds": ids,
            }
        )

    # --- the road network -------------------------------------------------
    roads: list[dict[str, Any]] = []

    # Avenues: one between every pair of shelves, plus the outer ring.
    #
    # Each is cut to the shelves it actually borders rather than to the width
    # of the whole city. Running every avenue the full city width meant the
    # rows that happened to be short -- the last one usually is -- got a road
    # continuing a hundred units past the final building and stopping in open
    # snow, which is what made the outskirts look like an unfinished map.
    # Length still carries half a road at either end so an avenue meets the
    # perimeter streets exactly instead of stopping short of them.
    for index in range(len(shelves) + 1):
        above = shelves[index - 1] if index > 0 else None
        below = shelves[index] if index < len(shelves) else None
        reach = max(shelf["width"] for shelf in (above, below) if shelf)
        z = (
            -offset_z - road / 2
            if above is None
            else above["z"] + above["depth"] + road / 2 - offset_z
        )
        roads.append(
            {
                "x": round(reach / 2 - offset_x, 2),
                "z": round(z, 2),
                "length": round(reach + road, 2),
                "width": round(road, 2),
                "axis": "x",
            }
        )

    # Streets: the vertical gaps inside each shelf, reaching the avenues at
    # both ends and no further.
    for shelf in shelves:
        z_centre = shelf["z"] + shelf["depth"] / 2 - offset_z
        for plot in plots[shelf["from"] : shelf["to"]]:
            roads.append(
                {
                    "x": round(plot["x"] + plot["width"] + road / 2 - offset_x, 2),
                    "z": round(z_centre, 2),
                    "length": round(shelf["depth"] + road, 2),
                    "width": round(road, 2),
                    "axis": "z",
                }
            )
        roads.append(
            {
                "x": round(-offset_x - road / 2, 2),
                "z": round(z_centre, 2),
                "length": round(shelf["depth"] + road, 2),
                "width": round(road, 2),
                "axis": "z",
            }
        )

    # Street furniture and traffic along the avenues. The loop variable is
    # deliberately not called `road`: that name holds the street width.
    for index, segment in enumerate(roads):
        if segment["axis"] != "x":
            continue
        lamps = max(2, int(segment["length"] / 26))
        for i in range(lamps):
            s = archetypes.seed_of(f"road:{index}:{i}")
            # Relative to the segment's own centre, *then* moved onto it.
            # Avenues used to be centred on x = 0 so the offset could be
            # omitted without anyone noticing; once they were cut to the
            # shelves they serve, that left lamps and traffic stranded out on
            # the open snow where the road no longer went.
            x = (
                segment["x"]
                - segment["length"] / 2
                + (i + 0.5) * (segment["length"] / lamps)
            )
            props.append(
                {
                    "type": "lamp",
                    "x": round(x, 2),
                    "z": round(segment["z"] - segment["width"] / 2 + 0.9, 2),
                    "rotation": 0.0,
                    "scale": 1.0,
                    "color": "#B8C0CC",
                }
            )
            if s % 3 == 0:
                props.append(
                    {
                        "type": ["car", "bus", "truck", "van"][(s >> 4) % 4],
                        "x": round(x + 4, 2),
                        "z": round(segment["z"] - segment["width"] * 0.22, 2),
                        "rotation": 1.5708,
                        "scale": 1.0,
                        "color": ["#E63946", "#457B9D", "#F4A259", "#2A9D8F", "#F1FAEE"][(s >> 7) % 5],
                    }
                )

    tallest = max(buildings, key=lambda b: b["height"])["id"] if buildings else ""

    # The gate used to stand a flat 30 units out at a fixed size, which left a
    # huge portal marooned in a field beside a nine-file town. Both the setback
    # and the portal's scale now follow the city.
    span = max(city_width, city_depth, 40.0)
    entrance_z = city_depth / 2 + max(15.0, min(30.0, city_depth * 0.28))
    entrance_scale = round(max(0.5, min(1.15, span / 210.0)), 3)

    return {
        "repo": {
            "slug": slug,
            "name": meta.get("name") or slug.split("/")[-1],
            "owner": slug.split("/")[0],
            "url": html_url,
            "branch": branch,
            "description": meta.get("description") or "",
            "stars": meta.get("stargazers_count", 0),
            "forks": meta.get("forks_count", 0),
            "openIssues": meta.get("open_issues_count", 0),
            "license": ((meta.get("license") or {}) or {}).get("spdx_id") or "",
            "topics": meta.get("topics") or [],
            "homepage": meta.get("homepage") or "",
            "pushedAt": meta.get("pushed_at") or "",
        },
        "project": project,
        "districts": districts,
        "buildings": buildings,
        "roads": roads,
        "props": props,
        "entrance": {
            "x": 0.0,
            "z": round(entrance_z, 2),
            "scale": entrance_scale,
            "road": round(road, 2),
        },
        "bounds": {"width": round(city_width, 2), "depth": round(city_depth, 2)},
        "stats": {
            "buildings": len(buildings),
            "districts": len([d for d in districts if d["path"] != "__stadium__"]),
            "totalLoc": sum(b["loc"] for b in buildings),
            "languages": dict(sorted(language_counts.items(), key=lambda kv: -kv[1])),
            "buildingTypes": dict(sorted(type_counts.items(), key=lambda kv: -kv[1])),
            "repoLanguages": languages,
            "landmarkId": tallest,
            **stats_extra,
        },
    }
