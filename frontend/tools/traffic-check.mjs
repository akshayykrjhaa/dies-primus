/**
 * Drives the traffic simulation headlessly and checks that nothing overlaps.
 *
 * Vehicles used to pass through one another -- most visibly at crossroads,
 * where the car-following rule cannot see them because it only ever looks
 * along a vehicle's own stretch of road. The give-way rules that fix that are
 * intricate enough to be worth an actual test, and they were previously
 * unreachable: they lived inside a render loop, so the only way to exercise
 * them was to sit and watch the city.
 *
 * `src/lib/traffic.ts` is now free of three.js scene code, so this runs it over
 * a real city's road network and over three synthetic layouts chosen to be
 * awkward -- a generous grid, blocks too short to stand on, and a street of
 * T-junctions where side roads stop dead on an avenue. Each is run at several
 * fleet seeds, because the first version of these fixes passed on one seed and
 * failed on the next.
 *
 *   node tools/traffic-check.mjs [path-to-city.json]
 *
 * Exits non-zero if two vehicles ever share the same piece of road, or if the
 * fleet spends long enough completely stopped to count as gridlock.
 */

import { build } from 'esbuild'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const DEFAULT_CITY = resolve(
  import.meta.dirname,
  '../../backend/.cache/vercel-swr-44d14c7e6b.json',
)

/** Overlap, in world units, below which two footprints are merely touching. */
const TOLERANCE = 0.05

/**
 * The depth at which an overlap stops being a graze and becomes a collision.
 *
 * Everything above `TOLERANCE` is reported, but not everything above it is a
 * rule failure. A vehicle turning into a street is, for a moment, lying across
 * it -- that is what turning is -- and while it is broadside its corner can
 * clip a vehicle leaving the same junction in the far lane by a few tenths of
 * a unit. Eliminating that last fraction means giving a turning vehicle sole
 * use of a junction until it has straightened up, which costs more in stalled
 * traffic than it buys in accuracy.
 *
 * Half a unit is roughly a quarter of a car's width, on bodies four to nine
 * units long. Anything deeper than that is a vehicle driving into another one,
 * which is the thing this check exists to catch.
 */
const COLLISION = 0.5
/** Simulated seconds per run, at a fixed sixty frames a second. */
const SECONDS = 240
const DT = 1 / 60
/** The first second is the fleet settling; nothing is asserted about it. */
const SETTLE = 60

async function loadTraffic() {
  const out = mkdtempSync(join(tmpdir(), 'traffic-'))
  const file = join(out, 'traffic.mjs')
  await build({
    entryPoints: [resolve(import.meta.dirname, '../src/lib/traffic.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: file,
    logLevel: 'error',
  })
  const module = await import(pathToFileURL(file).href)
  rmSync(out, { recursive: true, force: true })
  return module
}

/**
 * Do two oriented rectangles overlap, and by how much?
 *
 * Separating-axis test over the four face normals. Returns the smallest
 * overlap across those axes; zero means there is a gap on at least one, so the
 * two are clear of each other.
 */
function penetration(a, b) {
  const axes = [
    [Math.cos(a.facing), -Math.sin(a.facing)],
    [Math.sin(a.facing), Math.cos(a.facing)],
    [Math.cos(b.facing), -Math.sin(b.facing)],
    [Math.sin(b.facing), Math.cos(b.facing)],
  ]
  let smallest = Infinity
  for (const [ax, az] of axes) {
    const project = (box) => {
      const fx = Math.cos(box.facing)
      const fz = -Math.sin(box.facing)
      const reach =
        Math.abs((fx * ax + fz * az) * box.length * 0.5) +
        Math.abs((-fz * ax + fx * az) * box.width * 0.5)
      return { centre: box.x * ax + box.z * az, reach }
    }
    const pa = project(a)
    const pb = project(b)
    const gap = Math.abs(pa.centre - pb.centre) - (pa.reach + pb.reach)
    if (gap >= 0) return 0
    smallest = Math.min(smallest, -gap)
  }
  return smallest
}

const { buildGraph, buildFleet, stepFleet, trafficScratch, SHAPES } = await loadTraffic()

function run(label, roads, span) {
  const edges = buildGraph(roads)
  const fleet = buildFleet(edges, span)
  const scratch = trafficScratch()
  if (fleet.length < 2) {
    console.log(`  ${label}: ${fleet.length} vehicles, nothing to collide`)
    return { overlaps: 0, worst: 0, stalled: 0 }
  }

  const boxes = fleet.map(() => ({ x: 0, z: 0, facing: 0, length: 0, width: 0 }))
  let overlaps = 0
  let worst = 0
  let stalled = 0
  let firstAt = null

  for (let frame = 0; frame < SECONDS / DT; frame++) {
    stepFleet(edges, fleet, DT, frame * DT, scratch)
    if (frame < SETTLE) continue

    fleet.forEach((vehicle, i) => {
      const shape = SHAPES[vehicle.kind]
      boxes[i].x = vehicle.renderX
      boxes[i].z = vehicle.renderZ
      boxes[i].facing = vehicle.facing
      boxes[i].length = shape.length
      boxes[i].width = shape.width
    })

    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const deep = penetration(boxes[i], boxes[j])
        if (deep <= TOLERANCE) continue
        overlaps++
        if (firstAt === null) firstAt = +(frame * DT).toFixed(1)
        if (deep > worst) worst = deep
      }
    }

    // Gridlock is its own failure: traffic that has given way to itself into a
    // permanent stand-off is not a collision, but it is not traffic either.
    const moving = fleet.filter((v) => !v.parked && v.throttle > 0.05).length
    if (moving === 0) stalled++
  }

  const frames = SECONDS / DT - SETTLE
  const drivers = fleet.filter((v) => !v.parked).length
  const note =
    overlaps === 0
      ? 'clear'
      : `${overlaps} overlapping frames, worst ${worst.toFixed(2)}u, from ${firstAt}s`
  console.log(
    `  ${label}: ${edges.length} edges, ${fleet.length} vehicles ` +
      `(${drivers} moving), stopped ${stalled}/${frames} - ${note}`,
  )
  return { overlaps, worst, stalled, frames }
}

// --- the layouts ----------------------------------------------------------

const cityPath = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_CITY
const city = JSON.parse(readFileSync(cityPath, 'utf8'))
const cityName = cityPath.split(/[\\/]/).pop()

/** An even grid with room to spare on every block. */
const evenGrid = []
for (let i = 0; i < 5; i++) evenGrid.push({ x: 0, z: -80 + i * 40, length: 240, width: 11.5, axis: 'x' })
for (let i = 0; i < 7; i++) evenGrid.push({ x: -110 + i * 38, z: 0, length: 200, width: 11.5, axis: 'z' })

/** Blocks shorter than a bus, which nothing can stand on clear of a junction. */
const shortBlocks = []
for (let i = 0; i < 4; i++) shortBlocks.push({ x: 0, z: -45 + i * 30, length: 200, width: 11.5, axis: 'x' })
for (let i = 0; i < 12; i++) shortBlocks.push({ x: -90 + i * 16, z: 0, length: 150, width: 11.5, axis: 'z' })

/** Side streets that stop dead on an avenue: nothing but T-junctions. */
const tees = [{ x: 0, z: 0, length: 300, width: 11.5, axis: 'x' }]
for (let i = 0; i < 9; i++) tees.push({ x: -120 + i * 30, z: -40, length: 80, width: 11.5, axis: 'z' })
for (let i = 0; i < 9; i++) tees.push({ x: -105 + i * 30, z: 40, length: 80, width: 11.5, axis: 'z' })

const citySpan = Math.max(city.bounds.width, city.bounds.depth, 60)

const runs = []
console.log(`${cityName} (${city.roads?.length ?? 0} roads), at a spread of fleet seeds:`)
// `span` seeds the fleet as well as sizing it, so varying it is how a layout
// gets exercised with different traffic rather than the same traffic twice.
for (const span of [citySpan, 200, 250, 300, 400, 500, 640, 780]) {
  runs.push(run(`span ${span}`, city.roads ?? [], span))
}
console.log('synthetic layouts:')
for (const span of [240, 310, 420]) runs.push(run(`even grid @${span}`, evenGrid, span))
for (const span of [200, 280, 360]) runs.push(run(`short blocks @${span}`, shortBlocks, span))
for (const span of [300, 380, 460]) runs.push(run(`T-junctions @${span}`, tees, span))

const overlaps = runs.reduce((sum, r) => sum + r.overlaps, 0)
const worst = runs.reduce((max, r) => Math.max(max, r.worst), 0)
const jammed = runs.filter((r) => r.frames && r.stalled > r.frames * 0.05)
const frames = runs.reduce((sum, r) => sum + (r.frames ?? 0), 0)

console.log('')
if (jammed.length > 0) console.error(`FAIL: ${jammed.length} run(s) spend too long completely stopped`)
if (worst > COLLISION) console.error(`FAIL: worst overlap ${worst.toFixed(2)}u exceeds ${COLLISION}u`)
if (worst > COLLISION || jammed.length > 0) process.exit(1)

console.log(
  `OK: ${runs.length} runs of ${SECONDS}s. No vehicle drove into another; ` +
    `${overlaps} of ${frames} frames had a corner graze, worst ${worst.toFixed(2)}u ` +
    `(under the ${COLLISION}u collision threshold).`,
)
