"""Chooses what kind of building each file becomes.

The previous generator gave every file the same box and varied only its
height, so two unrelated repositories produced near-identical skylines. Here a
file's role, size and language pick from a catalogue of low-poly city
archetypes -- a hospital, a school, a fire station, a glass tower, a corner
shop -- so the shape of a repository is legible from across the map.

Each archetype declares the footprint and floor count it wants; the caller
scales those by the file's real line count.
"""
from __future__ import annotations

import bisect
import hashlib
import math
from dataclasses import dataclass

# Bounds of the log-scale magnitude ramp used by ``RepoScale.magnitude``.
_LOG_MIN = math.log10(5.0)
_LOG_MAX = math.log10(3000.0)


@dataclass(frozen=True)
class Archetype:
    key: str
    label: str          # shown in the legend and the hover label
    base_width: float   # footprint in world units before size scaling
    base_depth: float
    floors: tuple[int, int]   # (min, max) storeys this archetype supports
    palette: tuple[str, ...]  # low-poly wall colours, picked per building
    roof: str
    accent: str


# --- the catalogue -------------------------------------------------------
# Colours follow the reference pack: saturated but not neon, with white and
# warm neutrals doing most of the work so the accents read.

SKYSCRAPER = Archetype(
    "skyscraper", "Skyscraper", 6.4, 6.4, (8, 24),
    ("#5FA8D3", "#7FC6E8", "#4F8FBF", "#9AD1EA"), "glass", "#1B4965",
)
OFFICE = Archetype(
    "office", "Office block", 6.0, 6.0, (3, 11),
    ("#8FB8DE", "#A7C7E7", "#6E9DC9", "#C9DDF0"), "flat", "#2C5F8A",
)
APARTMENT = Archetype(
    "apartment", "Apartment", 5.6, 5.6, (2, 8),
    ("#E8B87D", "#D99A6C", "#F0C99A", "#C98A5B"), "flat", "#8C5A32",
)
HOUSE = Archetype(
    "house", "House", 4.2, 4.6, (1, 2),
    ("#F2E3C8", "#E8D5B0", "#DCC9A8", "#FBF0DC"), "gable", "#B4603F",
)
SHOP = Archetype(
    "shop", "Shop", 4.6, 4.8, (1, 3),
    ("#F4A259", "#EF6F6C", "#7FB069", "#59C3C3"), "awning", "#3D405B",
)
CIVIC = Archetype(
    "civic", "City hall", 7.4, 6.6, (2, 6),
    ("#EADDC4", "#E3D3B4"), "clocktower", "#8A6D3B",
)
HOSPITAL = Archetype(
    "hospital", "Hospital", 6.6, 5.8, (2, 8),
    ("#F7FBFF", "#E9F2F8"), "helipad", "#E63946",
)
SCHOOL = Archetype(
    "school", "School", 7.0, 5.6, (1, 5),
    ("#D9BF9A", "#CBAE85"), "pediment", "#7A5C3E",
)
POLICE = Archetype(
    "police", "Police station", 6.0, 5.4, (1, 5),
    ("#3D5A80", "#2F4B6E"), "flat", "#98C1D9",
)
FIRE = Archetype(
    "fire", "Fire station", 6.0, 5.4, (1, 4),
    ("#E63946", "#C1272D"), "tower", "#F1FAEE",
)
FACTORY = Archetype(
    "factory", "Factory", 7.0, 6.0, (1, 4),
    ("#9AA4B0", "#848E9C", "#B0B9C4"), "chimneys", "#5C646E",
)
WAREHOUSE = Archetype(
    "warehouse", "Warehouse", 7.2, 6.2, (1, 3),
    ("#B8B3A6", "#A5A093"), "curved", "#6E6A60",
)
POWER = Archetype(
    "power", "Power plant", 6.8, 6.2, (1, 4),
    ("#8D99AE", "#7A8699"), "cooling", "#EDF2F4",
)
GAS = Archetype(
    "gas", "Service station", 6.2, 5.2, (1, 2),
    ("#EF476F", "#F78C6B"), "canopy", "#FFFFFF",
)
LIBRARY = Archetype(
    "library", "Library", 6.4, 5.6, (1, 5),
    ("#C9A227", "#B8912A", "#DDB63D"), "pediment", "#5E4B1F",
)
LAB = Archetype(
    "lab", "Laboratory", 5.8, 5.4, (1, 6),
    ("#94D2BD", "#79C2AC", "#B7E4D4"), "dish", "#005F73",
)
UTILITY = Archetype(
    "utility", "Utility hut", 3.4, 3.4, (1, 2),
    ("#A3B18A", "#8E9C78"), "flat", "#3A5A40",
)
STADIUM = Archetype(
    "stadium", "Stadium", 16.0, 12.0, (2, 3),
    ("#E5E5E5",), "stadium", "#E63946",
)
PARK = Archetype(
    "park", "Park", 7.0, 7.0, (0, 0),
    ("#7FB069",), "park", "#4F772D",
)

ALL: dict[str, Archetype] = {
    a.key: a
    for a in (
        SKYSCRAPER, OFFICE, APARTMENT, HOUSE, SHOP, CIVIC, HOSPITAL, SCHOOL,
        POLICE, FIRE, FACTORY, WAREHOUSE, POWER, GAS, LIBRARY, LAB, UTILITY,
        STADIUM, PARK,
    )
}

# role -> the archetypes that role can become, smallest file first.
# A role with several options gets visual variety without losing its meaning.
BY_ROLE: dict[str, tuple[Archetype, ...]] = {
    "entrypoint": (CIVIC, CIVIC, SKYSCRAPER),
    "api": (OFFICE, OFFICE, SKYSCRAPER),
    "ui": (SHOP, SHOP, APARTMENT),
    "styling": (SHOP, SHOP, APARTMENT),
    "business-logic": (APARTMENT, OFFICE, SKYSCRAPER),
    "data-model": (WAREHOUSE, WAREHOUSE, LIBRARY),
    "config": (UTILITY, UTILITY, GAS),
    "build": (FACTORY, FACTORY, POWER),
    "infra": (POWER, FACTORY, POWER),
    "test": (LAB, LAB, HOSPITAL),
    "docs": (LIBRARY, SCHOOL, SCHOOL),
    "script": (GAS, UTILITY, FACTORY),
    "other": (HOUSE, APARTMENT, OFFICE),
}

# A handful of filenames are landmarks in any repository and get a building
# everyone recognises, regardless of what the model called their role.
BY_NAME: dict[str, Archetype] = {
    "readme.md": LIBRARY,
    "license": CIVIC,
    "dockerfile": FACTORY,
    "docker-compose.yml": FACTORY,
    "package.json": WAREHOUSE,
    "requirements.txt": WAREHOUSE,
    "pyproject.toml": WAREHOUSE,
    "cargo.toml": WAREHOUSE,
    "go.mod": WAREHOUSE,
    "makefile": FACTORY,
    ".gitignore": UTILITY,
    "nginx.conf": POWER,
}

SECURITY_HINTS = ("auth", "login", "security", "permission", "guard", "session")
EMERGENCY_HINTS = ("error", "exception", "fallback", "recover", "retry", "alert")


def seed_of(path: str) -> int:
    """Stable per-file randomness: the same repo always builds the same city."""
    return int(hashlib.sha1(path.encode("utf-8")).hexdigest()[:8], 16)


@dataclass
class RepoScale:
    """How this repository sizes its own buildings.

    Absolute line counts made every city look the same: a 400-line file is
    "large" in a 9-file utility but unremarkable in a framework, and judging
    it against a fixed threshold grew skyscrapers in villages. Sizes are
    therefore judged against this repo's own distribution, and the overall
    height ceiling scales with how much code there is, so a small project
    builds a town and a large one builds a skyline.

    The whole sorted line-count list is kept, not just two percentiles. A
    file's `progress` is its percentile rank in that list, which is uniform
    by construction -- so the shortest file in the repo really is the
    shortest building and the longest really is the tallest, with everything
    in between spread evenly rather than bunched at one height.
    """

    p50: float
    p85: float
    file_count: int
    #: Every file's line count, ascending. The rank lookup bisects this.
    locs: tuple[int, ...] = ()

    @classmethod
    def from_locs(cls, locs: list[int]) -> "RepoScale":
        if not locs:
            return cls(50.0, 200.0, 0, ())
        ordered = sorted(locs)
        def pct(q: float) -> float:
            if len(ordered) == 1:
                return float(ordered[0])
            index = min(len(ordered) - 1, max(0, int(round(q * (len(ordered) - 1)))))
            return float(ordered[index])
        return cls(pct(0.5), pct(0.85), len(ordered), tuple(ordered))

    @property
    def height_scale(self) -> float:
        """A village should not have the skyline of a metropolis."""
        if self.file_count < 12:
            return 0.58
        if self.file_count < 30:
            return 0.70
        if self.file_count < 70:
            return 0.82
        if self.file_count < 150:
            return 0.92
        return 1.0

    @property
    def max_tier(self) -> int:
        """Small repos cap out below the skyscraper tier."""
        return 1 if self.file_count < 14 else 2

    def rank(self, loc: int) -> float:
        """This file's percentile rank among the repo's line counts, 0..1.

        Ties share the midpoint of the run they belong to, so ten identical
        200-line files all get the same building rather than a staircase
        decided by their order in the list.
        """
        if len(self.locs) < 2:
            return 0.5
        lo = bisect.bisect_left(self.locs, loc)
        hi = bisect.bisect_right(self.locs, loc)
        if hi == lo:  # not present (a fallback line count); use its position
            return min(1.0, lo / (len(self.locs) - 1))
        return ((lo + hi - 1) / 2.0) / (len(self.locs) - 1)

    @staticmethod
    def magnitude(loc: int) -> float:
        """Absolute size on a log scale, 0 at a stub and 1 at ~3000 lines.

        Rank alone says only "bigger than its neighbours", so a repo of
        uniformly tiny files would still grow a skyscraper for its 40-line
        winner. Blending in the real magnitude keeps a village a village.
        """
        clamped = min(3000.0, max(5.0, float(loc)))
        return (math.log10(clamped) - _LOG_MIN) / (_LOG_MAX - _LOG_MIN)

    def progress(self, loc: int) -> float:
        """0..1 driving both storey count and footprint. Monotone in `loc`."""
        return max(0.0, min(1.0, 0.62 * self.rank(loc) + 0.38 * self.magnitude(loc)))

    def tier(self, loc: int, importance: int) -> int:
        tier = 0
        if loc > self.p50:
            tier = 1
        if loc > self.p85:
            tier = 2
        # The handful of genuinely central files earn a bump regardless.
        if importance >= 9:
            tier += 1
        return max(0, min(self.max_tier, tier))


def choose(path: str, role: str, tier: int) -> Archetype:
    """Pick the archetype for one file, given its size tier within the repo."""
    name = path.rsplit("/", 1)[-1].lower()
    lower = path.lower()

    if name in BY_NAME:
        return BY_NAME[name]

    # Semantic overrides: security code becomes the police station, error
    # handling the fire station. Small touches, but they make a repo readable.
    if any(hint in lower for hint in SECURITY_HINTS):
        return POLICE
    if any(hint in lower for hint in EMERGENCY_HINTS):
        return FIRE

    options = BY_ROLE.get(role, BY_ROLE["other"])
    return options[min(tier, len(options) - 1)]


def floors_for(archetype: Archetype, loc: int, seed: int, scale: RepoScale) -> int:
    """Storey count from the real line count, kept inside the archetype range.

    This used to run the line count through a log curve floored at 10 lines,
    which put a three-line stub at 47% of its archetype's range -- so a stub
    and a 50-line module were the same height, and a random coin flip on the
    seed then broke even that ordering. The mapping is now
    `RepoScale.progress`, which is monotone in `loc`: a shorter file is never
    a taller building than a longer one of the same archetype.
    """
    low, high = archetype.floors
    if high == 0:
        return 0
    if high == low:
        return low
    span = (high - low) * scale.height_scale
    floors = low + int(round(span * scale.progress(loc)))
    return max(low, min(high, floors))


def footprint_for(archetype: Archetype, loc: int, seed: int, scale: RepoScale) -> tuple[float, float]:
    """Ground footprint, in world units, before the caller clamps to its cell.

    Height alone cannot carry the line count: a warehouse and a factory top
    out at two or three storeys whatever is in them, so without this a
    2000-line data model looked exactly like a 20-line one. Spreading the
    footprint over the same `progress` ramp means every archetype grows with
    its file, and the small per-building jitter keeps a terrace of equal-sized
    files from looking stamped.
    """
    progress = scale.progress(loc)
    spread = 0.78 + 0.38 * progress
    jitter = 0.96 + ((seed >> 3) % 9) / 100.0  # 0.96 .. 1.04
    return (
        archetype.base_width * spread * jitter,
        archetype.base_depth * spread * jitter,
    )


def palette_for(archetype: Archetype, seed: int) -> str:
    return archetype.palette[(seed >> 9) % len(archetype.palette)]
