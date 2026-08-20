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
    total_area = sum(p["width"] * p["depth"] for p in plots) or 1.0
    target_width = math.sqrt(total_area) * 1.5

    shelves: list[dict[str, Any]] = []
    cursor_x, cursor_z, shelf_depth, city_width = 0.0, 0.0, 0.0, 0.0
    shelf_start = 0
    for index, plot in enumerate(plots):
        if cursor_x > 0 and cursor_x + plot["width"] > target_width:
            shelves.append({"z": cursor_z, "depth": shelf_depth, "from": shelf_start, "to": index})
            cursor_x = 0.0
            cursor_z += shelf_depth + road
            shelf_depth = 0.0
            shelf_start = index
        plot["x"] = cursor_x
        plot["z"] = cursor_z
        cursor_x += plot["width"] + road
        shelf_depth = max(shelf_depth, plot["depth"])
        city_width = max(city_width, cursor_x - road)
    shelves.append({"z": cursor_z, "depth": shelf_depth, "from": shelf_start, "to": len(plots)})
    city_depth = cursor_z + shelf_depth

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

            # Footprint wobbles a little per building so terraces are not
            # perfectly aligned, but never enough to overflow its cell.
            jitter = 0.9 + ((seed >> 3) % 22) / 100.0
            width = round(min(CELL - 1.6, archetype.base_width * jitter), 2)
            depth = round(min(CELL - 1.6, archetype.base_depth * jitter), 2)
            height = round(max(2.2, floors * FLOOR_HEIGHT), 2)

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

    # Avenues: one between every pair of shelves, plus the outer ring. Each
    # runs the width of the city plus half a road at either end, so it meets
    # the perimeter streets exactly instead of trailing off into the grass.
    avenue_zs = [-offset_z - road / 2]
    for shelf in shelves:
        avenue_zs.append(shelf["z"] + shelf["depth"] + road / 2 - offset_z)
    for z in avenue_zs:
        roads.append(
            {
                "x": 0.0,
                "z": round(z, 2),
                "length": round(city_width + road, 2),
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
            x = -segment["length"] / 2 + (i + 0.5) * (segment["length"] / lamps)
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
