import * as THREE from 'three'

import type { Road } from '../types'

/**
 * The traffic simulation, with no rendering in it.
 *
 * The road network is turned into a proper directed graph before anything
 * drives on it. Every crossing between a horizontal and a vertical road
 * becomes a junction; each road is cut into segments between its junctions;
 * each segment carries two directed edges, one per direction. A vehicle
 * therefore always has somewhere to go when it runs out of road -- it picks an
 * exit and carries on.
 *
 * That is the whole reason for the graph. Driving whole streets and wrapping
 * back to the start made cars disappear at one end of the city and reappear at
 * the other, which is exactly what it looked like.
 *
 * On top of the graph they behave like traffic rather than like markers:
 *
 *   - they prefer to carry straight on, and never immediately double back
 *   - they keep their distance, easing off as the car in front gets closer
 *     and stopping altogether if it has stopped
 *   - each carries its own patience, so some cruise and some wait at junctions
 *   - they give way at crossings, holding at the *edge* of the box rather than
 *     in the middle of it, and a movement that crosses the other carriageway
 *     waits for it to be clear
 *
 * It lives apart from the component that draws it so that the rules above can
 * be run and checked without a canvas -- see `tools/traffic-check.mjs`, which
 * drives a real city's road network for several simulated minutes and asserts
 * that no two vehicles ever share the same piece of road.
 */

export type VehicleKind = 'car' | 'van' | 'bus' | 'truck'

export interface Shape {
  length: number
  width: number
  height: number
  cab: number
  /** Where the cabin sits along the body: + is forward. */
  cabAt: number
}

export const SHAPES: Record<VehicleKind, Shape> = {
  car: { length: 4.0, width: 1.8, height: 0.78, cab: 0.66, cabAt: -0.05 },
  van: { length: 4.9, width: 2.0, height: 1.15, cab: 0.5, cabAt: 0.12 },
  bus: { length: 8.6, width: 2.5, height: 1.95, cab: 0.22, cabAt: 0 },
  truck: { length: 7.4, width: 2.35, height: 1.6, cab: 0.42, cabAt: 0.3 },
}

const KINDS: VehicleKind[] = ['car', 'car', 'car', 'car', 'van', 'bus', 'truck']

const PAINT = [
  '#E63946', '#457B9D', '#F4A259', '#2A9D8F', '#F1FAEE',
  '#8E7DBE', '#E0B33C', '#3D5A80', '#C1554E', '#7FB069',
]

export const WHEEL_RADIUS = 0.36
/** Gap a driver wants in front, on top of the vehicle's own length. */
const FOLLOW_GAP = 3.2
/** Half the widest vehicle, plus a little air. */
const LANE_HALF = 1.5
/** Half the widest vehicle that is ever left at the kerb. */
const PARKED_HALF = 1.0
/** A metre of air around every vehicle's own box at a junction. */
const JUNCTION_AIR = 1.0

/** Which way an edge runs. Kept as bits so a claim can cover both. */
const AXIS_X = 1
const AXIS_Z = 2
const BOTH_AXES = AXIS_X | AXIS_Z

/** Past this turn angle a movement counts as crossing the other axis. */
const TURN_ANGLE = 0.35

/**
 * May a movement occupying `mask` enter a junction box already held by
 * `taken`?
 *
 * Only in two cases: the box is empty, or what is already in it is exactly the
 * same single carriageway -- two vehicles running opposite ways down the same
 * street, which pass each other in their own lanes and always could.
 *
 * The obvious test, `(mask & taken) === 0`, says the opposite of what it looks
 * like it says. Two movements on *perpendicular* streets have masks that share
 * no bits, so a bitwise test waves them into the box together: the one case
 * the whole rule exists to prevent is the one case it permitted. Written out
 * as the question actually being asked, there is nowhere for that to hide.
 */
function compatible(mask: number, taken: number): boolean {
  if (taken === 0) return true
  return taken === mask && mask !== BOTH_AXES
}

/**
 * Where the two lanes sit, measured from the road's centre line.
 *
 * Both offsets used to be flat constants, which put parked vehicles between
 * 1.85 and 4.85 units out and moving ones between 0.25 and 3.10 -- overlapping
 * by up to a bus width. That is why stationary cars appeared to be sitting in
 * the carriageway, and why moving cars drove straight through them.
 *
 * Derived from the road instead. Two rules have to hold at once, and the
 * previous version only checked the first:
 *
 *  - the two *driving* lanes must clear each other, so an oncoming bus passes
 *    rather than passing through: `drive` is never less than half the widest
 *    vehicle, putting the lane centres a full bus width apart;
 *  - the driving lane must clear the *parked* lane, which is the case the old
 *    arithmetic left with barely a hand's breadth on an ordinary street. It is
 *    now an explicit test against the two half-widths involved, and a road
 *    that cannot satisfy it simply gets no parking.
 */
function lanesOn(width: number) {
  const half = width / 2
  // A little wider than two half-widths would strictly need. The extra is for
  // the moment a vehicle turning into the street is still broadside across it:
  // it is drawn where it really is, so the lane it is joining has to have room
  // for it to swing into.
  const drive = Math.max(LANE_HALF * 1.1, half * 0.3)
  const park = half - PARKED_HALF * 1.15
  // Enough for a bus in the carriageway to clear a parked car, with air.
  const room = park - drive >= LANE_HALF + PARKED_HALF + 0.3
  return { drive, park: room ? park : null }
}

export interface Edge {
  x: number
  z: number
  /** Unit direction of travel. */
  dx: number
  dz: number
  length: number
  /** The width of the road this edge runs down, for placing lanes. */
  width: number
  /** Half that width: the reach of a junction box measured from its node. */
  half: number
  /** `AXIS_X` or `AXIS_Z`, so crossing movements can be told apart. */
  axis: number
  /** Y rotation that points a body's length along this edge. */
  heading: number
  /** Node this edge leaves from, and the one it arrives at. */
  from: string
  to: string
  /** Edges leaving `to`, excluding the straight reverse of this one. */
  exits: number[]
  /** The reverse edge, used only when the far node is a dead end. */
  reverse: number
}

export interface Vehicle {
  kind: VehicleKind
  edge: number
  /** Distance travelled along the current edge. */
  at: number
  speed: number
  parked: boolean
  /** Sideways offset from the centre line, on the right of travel. */
  offset: number
  /** How much of its own wave a driver spends waiting. */
  dwell: number
  stopRate: number
  stopPhase: number
  colour: THREE.Color
  /** Eased heading, so corners are taken rather than snapped. */
  facing: number
  /** Eased throttle, so pulling away and braking are gradual. */
  throttle: number
  /**
   * The exit this driver has already committed to, chosen on the approach
   * rather than at the line. Give-way has to know whether a vehicle intends
   * to cross the other carriageway *before* it is allowed into the box; a
   * decision made at the moment of arrival is a decision made too late.
   * -1 while none is held.
   */
  intent: number
  /** True while the move that brought it onto this edge was a turn. */
  turned: boolean
  /** Seconds spent held at a junction, so a stand-off cannot last forever. */
  waited: number
  /** Where it stands. Derived from `edge` and `at`, never lagged behind them. */
  renderX: number
  renderZ: number
  /**
   * The corner currently being taken: how far along the new road the lane
   * offset finishes swinging round, and the lateral offset it arrived with.
   * Zero length means it is not turning. See the position step for why the
   * corner is drawn this way rather than by letting the body trail.
   */
  turnLen: number
  entryX: number
  entryZ: number
  /** The heading it arrived on, so the body can follow the arc exactly. */
  entryFacing: number
}

function mulberry(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * The Y rotation that points a vehicle's *length* along a direction.
 *
 * A body is a unit box scaled on local X, so this has to satisfy
 * `rotY(h) * (1,0,0) = (dx, 0, dz)`. Rotating about Y sends `(1,0,0)` to
 * `(cos h, 0, -sin h)`, giving `h = atan2(-dz, dx)`. The compass-style
 * `atan2(dx, dz)` is the obvious thing to reach for and is a quarter turn
 * out, which drives every vehicle broadside down the road.
 */
function headingAlong(dx: number, dz: number): number {
  return Math.atan2(-dz, dx)
}

/** Shortest signed angle from `a` to `b`. */
function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return d
}

/**
 * How far apart two crossings have to be before they count as two junctions.
 *
 * Generated layouts routinely put parallel streets within a metre of each
 * other, and sometimes lay two down in exactly the same place. Their crossings
 * with a third road are then a metre apart, and a key built by rounding
 * coordinates turned that one physical crossroads into two separate graph
 * nodes: neither road knew the other was there, no junction rule applied
 * between them, and traffic drove through the crossing as though it were open
 * road. Junctions on roads this wide are never really this close together, so
 * anything within a few units is one place.
 */
const NODE_MERGE = 5

/** Assigns stable node identities, merging crossings that are the same place. */
function nodeNamer() {
  const nodes: Array<{ x: number; z: number; key: string }> = []
  return (x: number, z: number) => {
    for (const node of nodes) {
      if (Math.abs(node.x - x) < NODE_MERGE && Math.abs(node.z - z) < NODE_MERGE) {
        return node.key
      }
    }
    const key = `n${nodes.length}`
    nodes.push({ x, z, key })
    return key
  }
}

/** Cuts the road network into a directed graph of segments between junctions. */
export function buildGraph(roads: Road[]): Edge[] {
  const usable = roads.filter((r) => r.length > 8)
  const horizontal = usable.filter((r) => r.axis === 'x')
  const vertical = usable.filter((r) => r.axis === 'z')
  const edges: Edge[] = []
  const leaving = new Map<string, number[]>()
  const nodeKey = nodeNamer()

  const addSegment = (ax: number, az: number, bx: number, bz: number, width: number) => {
    const rawX = bx - ax
    const rawZ = bz - az
    const length = Math.hypot(rawX, rawZ)
    if (length < 6) return
    const dx = rawX / length
    const dz = rawZ / length
    for (const forward of [true, false]) {
      const sx = forward ? ax : bx
      const sz = forward ? az : bz
      const ex = forward ? bx : ax
      const ez = forward ? bz : az
      const ux = forward ? dx : -dx
      const uz = forward ? dz : -dz
      const index = edges.length
      edges.push({
        x: sx, z: sz, dx: ux, dz: uz, length, width,
        half: width / 2,
        axis: Math.abs(dx) >= Math.abs(dz) ? AXIS_X : AXIS_Z,
        heading: headingAlong(ux, uz),
        from: nodeKey(sx, sz),
        to: nodeKey(ex, ez),
        exits: [], reverse: -1,
      })
      const from = nodeKey(sx, sz)
      const list = leaving.get(from)
      if (list) list.push(index)
      else leaving.set(from, [index])
    }
    edges[edges.length - 2].reverse = edges.length - 1
    edges[edges.length - 1].reverse = edges.length - 2
  }

  const cut = (road: Road, crossings: number[]) => {
    const centre = road.axis === 'x' ? road.x : road.z
    const points = [centre - road.length / 2, ...crossings, centre + road.length / 2]
      .sort((a, b) => a - b)
      .filter((v, i, arr) => i === 0 || v - arr[i - 1] > 1)
    for (let i = 0; i < points.length - 1; i++) {
      if (road.axis === 'x') addSegment(points[i], road.z, points[i + 1], road.z, road.width)
      else addSegment(road.x, points[i], road.x, points[i + 1], road.width)
    }
  }

  /**
   * Do two roads meet?
   *
   * Measured between the road *rectangles*, not their centre lines, and this
   * is not a nicety. A side street that ends on an avenue -- an ordinary
   * T-junction, and most of the junctions in a generated city are these --
   * reaches exactly as far as the avenue's centre, so the centre-line test
   * came down to `32.650000000000006 <= 32.65` and answered no. Every T in
   * the city was therefore missing from the graph: neither road was cut at
   * it, so the two carried on as unrelated segments with no node between
   * them, and the give-way rules had nothing to give way at. Traffic drove
   * straight through the crossing and through each other.
   *
   * Half the other road's width is the honest tolerance -- that is the point
   * at which the asphalt actually touches -- and it puts the decision a
   * comfortable five metres away from any floating-point boundary.
   */
  const meets = (along: number, centre: number, length: number, width: number) =>
    Math.abs(along - centre) <= length / 2 + width / 2

  /**
   * Is a crossing genuinely on this road, rather than just beside its end?
   *
   * A node's coordinate has to come out *identical* on both of the roads that
   * form it, because that coordinate is its identity in the graph -- and the
   * key is rounded to half a unit, so half a unit of disagreement is a whole
   * extra junction. An earlier version clamped an out-of-span crossing back
   * onto the road, which moved it off the other road's centre line by exactly
   * that sort of hair: one crossroads became the two nodes `47:298` and
   * `46:298`, neither road knew about the other, and traffic drove through it
   * as though it were not there. A crossing that lies past the end of the road
   * is simply not on it, and is dropped rather than dragged into range.
   */
  const inside = (along: number, centre: number, length: number) =>
    Math.abs(along - centre) < length / 2

  for (const road of horizontal) {
    cut(
      road,
      vertical
        .filter(
          (v) =>
            meets(v.x, road.x, road.length, v.width) &&
            meets(road.z, v.z, v.length, road.width),
        )
        .map((v) => v.x)
        .filter((x) => inside(x, road.x, road.length)),
    )
  }
  for (const road of vertical) {
    cut(
      road,
      horizontal
        .filter(
          (h) =>
            meets(h.z, road.z, road.length, h.width) &&
            meets(road.x, h.x, h.length, road.width),
        )
        .map((h) => h.z)
        .filter((z) => inside(z, road.z, road.length)),
    )
  }

  // Wire each edge to whatever leaves the node it arrives at. Doubling back
  // down the same segment is excluded unless there is nothing else -- a
  // dead-end street, where turning round is the only legal move.
  for (const edge of edges) {
    const options = leaving.get(edge.to) ?? []
    edge.exits = options.filter((i) => i !== edge.reverse)
    if (edge.exits.length === 0 && edge.reverse >= 0) edge.exits = [edge.reverse]
  }
  return edges
}

/**
 * How far from a node a vehicle's junction box still reaches.
 *
 * Half the road it is crossing, plus half its own length, plus air. The
 * constants this replaced were flat: six units of "still inside" against a
 * road 11.5 wide and a bus 8.6 long, so a bus was declared clear of a
 * crossroads while its back half was still standing in it, and the next car
 * drove straight through it.
 */
function claimReach(edge: Edge, shape: Shape): number {
  return edge.half + shape.length / 2 + JUNCTION_AIR
}

/**
 * How close to a node a vehicle can still be talked out of crossing.
 *
 * Distinct from `claimReach`, and the distinction is what makes short blocks
 * work. Where a road is cut into a nine-unit stretch between two junctions
 * eleven wide, a bus standing on it is inside *both* boxes: there is nowhere
 * on that block for it to wait. Judged by its physical reach it was therefore
 * permanently committed at both ends, never once asked to give way, and it
 * drove through whatever was crossing.
 *
 * So the two questions are asked separately. *Where am I* is answered by the
 * geometry, and a vehicle on a short block rightly claims both its junctions
 * -- cross traffic waits for it to leave, which is exactly what a driver would
 * do. *Can I still stop* is answered by the block, so every vehicle has a
 * stretch of every road on which it is still negotiating.
 */
function edgeReach(edge: Edge, shape: Shape): number {
  // A block this vehicle cannot stand clear on is not somewhere it can be
  // asked to wait, so it is never treated as negotiating there: it drives
  // through. Together with the claims it holds at both ends of such a block,
  // that makes the block and its two junctions behave as a single box --
  // entered only when the whole of it is clear, and crossed without stopping.
  // Letting it stop halfway was what put a bus across a crossroads it had
  // never been given, with its tail in the one behind.
  if (!fitsOn(edge, shape)) return Infinity
  return Math.min(claimReach(edge, shape), edge.length * 0.45)
}

/**
 * Can this vehicle stand on this block without any part of it lying in the
 * junction at either end?
 *
 * A generated street grid throws up the occasional very short block -- ten
 * units between two roads eleven and a half wide, which leaves no clear road
 * at all. A bus waiting there has its tail in one junction and its nose in the
 * other, whatever it does, and every remaining collision in the city was a
 * vehicle stuck on one of these while cross traffic used the box it was
 * standing in.
 *
 * A block that fails this is treated as part of the junction rather than as a
 * road: traffic prefers not to use it, and a driver that does must have both
 * ends clear before it sets off, the way you would not pull onto a short
 * stretch you could not get off again.
 */
function fitsOn(edge: Edge, shape: Shape): boolean {
  return edge.length >= shape.length + edge.width + JUNCTION_AIR * 2
}

/** The per-frame working set, allocated once and reused. */
export interface TrafficScratch {
  /** Who is on which edge, for car-following. */
  occupancy: Map<number, number[]>
  /** Who is closing on which junction, for giving way. */
  approaching: Map<string, number[]>
  /**
   * Junction boxes with someone in them.
   *
   * Each entry packs the vehicle and the axes it blocks into one integer, so
   * that a driver can ask what is in a box *other than itself*. A plain mask
   * per node could not answer that: a vehicle turning across a crossing blocks
   * both carriageways, so subtracting its own contribution from the total
   * subtracted everyone else's too, and it read every junction as empty.
   */
  claims: Map<string, number[]>
  /** Who has to wait this frame. */
  yielding: Set<number>
}

export function trafficScratch(): TrafficScratch {
  return {
    occupancy: new Map(),
    approaching: new Map(),
    claims: new Map(),
    yielding: new Set(),
  }
}

/**
 * Populates a city with vehicles.
 *
 * Deterministic in the city's own dimensions, so a given repository always
 * gets the same traffic.
 */
export function buildFleet(edges: Edge[], span: number): Vehicle[] {
  const drivable = edges.filter((e) => e.exits.length > 0)
  if (drivable.length === 0) return []
  const random = mulberry(Math.round(span * 613) + edges.length)
  // Sized from the total length of road rather than the segment count, so a
  // nine-file town does not get a metropolis's fleet.
  const total = edges.reduce((sum, e) => sum + e.length, 0) / 2
  const count = Math.max(5, Math.min(64, Math.round(total / 110)))
  const list: Vehicle[] = []

  /** The radius a vehicle of this kind sweeps, whichever way it is pointing. */
  const reachOf = (kind: VehicleKind) =>
    Math.hypot(SHAPES[kind].length, SHAPES[kind].width) / 2

  /**
   * One attempt at putting a vehicle somewhere legal, or null.
   *
   * Nothing starts anywhere it could not legally have driven to. A car dropped
   * on a crossing at the moment the city loads is a car the give-way rules
   * were never consulted about: already committed, already claiming a box
   * somebody else is crossing. The first seconds of every city used to be
   * spent untangling those, and some of them never did come apart -- two buses
   * placed two units apart on the same street are inside one another, and the
   * car-following rule cannot separate them, because it only ever slows the
   * one behind, which is already through the one in front.
   */
  const attempt = (): Vehicle | null => {
    const index = Math.floor(random() * edges.length)
    const edge = edges[index]
    if (edge.exits.length === 0) return null

    const lanes = lanesOn(edge.width)
    // Long vehicles need room to pass each other; a narrow street gets cars
    // and vans only.
    const roomy = lanes.drive * 2 > 3.0
    let kind = KINDS[Math.floor(random() * KINDS.length)]
    if (!roomy && (kind === 'bus' || kind === 'truck')) kind = 'car'
    const parked = lanes.park !== null && random() < 0.24
    // Only cars and vans are left at the kerb. `lanesOn` sizes the parking
    // lane against `PARKED_HALF`, so a bus abandoned there would hang a
    // quarter of its width into the carriageway.
    if (parked && (kind === 'bus' || kind === 'truck')) kind = 'car'
    const shape = SHAPES[kind]

    // Clear of the junction boxes at either end of the stretch.
    const clearance = claimReach(edge, shape)
    const room = edge.length - clearance * 2
    if (room < 1) return null

    const offset = parked ? (lanes.park as number) : lanes.drive
    const at = clearance + random() * room
    const x = edge.x + edge.dx * at + -edge.dz * offset
    const z = edge.z + edge.dz * at + edge.dx * offset

    // Room around it, measured in world space rather than along the edge, so
    // a vehicle on the next street over counts too: the old test compared
    // only vehicles that shared an edge *and* a parking state, which is to
    // say it missed every case that was not already a queue.
    const mine = reachOf(kind) + 1
    for (const other of list) {
      const keep = mine + reachOf(other.kind)
      const dx = other.renderX - x
      const dz = other.renderZ - z
      if (dx * dx + dz * dz < keep * keep) return null
    }

    return {
      kind,
      edge: index,
      at,
      speed: (kind === 'bus' || kind === 'truck' ? 5.5 : 8.5) * (0.75 + random() * 0.5),
      parked,
      offset,
      dwell: -1 + random() * 1.5,
      stopRate: 0.1 + random() * 0.26,
      stopPhase: random() * Math.PI * 2,
      colour: new THREE.Color(PAINT[Math.floor(random() * PAINT.length)]),
      facing: edge.heading,
      throttle: 0,
      intent: -1,
      turned: false,
      waited: 0,
      // Placed rather than left at the origin, so the test above can read
      // where everything already is.
      renderX: x,
      renderZ: z,
      turnLen: 0,
      entryX: -edge.dz * offset,
      entryZ: edge.dx * offset,
      entryFacing: edge.heading,
    }
  }

  for (let i = 0; i < count; i++) {
    // A city can simply run out of room -- a short street with two buses on
    // it has nowhere for a third. Give up on that vehicle rather than putting
    // it somewhere impossible.
    for (let tries = 0; tries < 24; tries++) {
      const vehicle = attempt()
      if (vehicle) {
        list.push(vehicle)
        break
      }
    }
  }
  return list
}

/**
 * Advances the whole fleet by one frame.
 *
 * Pure: it reads and writes the vehicles it is handed and touches nothing
 * else, which is what lets the junction rules be exercised headlessly. Every
 * collision this file has ever had was a rule that only ever ran inside a
 * render loop, where it could not be tested.
 *
 * The scratch maps are passed in rather than allocated, so a sixty-vehicle
 * fleet does not produce four new collections every frame.
 */
export function stepFleet(
  edges: Edge[],
  fleet: Vehicle[],
  delta: number,
  time: number,
  scratch: TrafficScratch,
): void {
  const { occupancy, approaching, claims, yielding } = scratch

  const step = Math.min(delta, 0.05)

  // How far from a node this vehicle's box still reaches: half the road it
  // is crossing, plus half its own length. The old constants were flat --
  // 6 units of "still inside" against a road 11.5 wide and a bus 8.6 long,
  // so a bus was declared clear of a crossroads while its back half was
  // still standing in it, and the next car drove straight through it.
  /** Which carriageways a movement occupies: a turn crosses both. */
  const maskOf = (vehicle: Vehicle, turning: boolean) =>
    turning ? BOTH_AXES : edges[vehicle.edge].axis

  /**
   * Is the exit this driver holds a turn rather than a straight-on?
   *
   * An undecided driver counts as turning, and the difference matters. A
   * vehicle whose every exit was momentarily blocked kept no intent, was
   * therefore read as going straight on, and was waved into the box beside
   * another straight-on movement -- whereupon it re-picked at the line and
   * turned across it. Unknown has to mean "assume the worst" here, or the
   * give-way rule is deciding on information it does not have.
   */
  const isTurning = (vehicle: Vehicle) => {
    if (vehicle.intent < 0) return true
    const edge = edges[vehicle.edge]
    return Math.abs(angleDelta(edge.heading, edges[vehicle.intent].heading)) > TURN_ANGLE
  }

  /** Somebody already sitting just inside `option`, blocking the turn in. */
  const blocked = (option: number, self: number, length: number) => {
    const waiting = occupancy.get(option)
    if (!waiting) return false
    const need = length + FOLLOW_GAP
    for (const j of waiting) {
      if (j === self) continue
      if (fleet[j].at < need) return true
    }
    return false
  }

  /** The cheapest way out of a junction: straight on, if it is free. */
  const pickExit = (self: number, vehicle: Vehicle, mustTurn: boolean | null = null) => {
    const edge = edges[vehicle.edge]
    const shape = SHAPES[vehicle.kind]
    let best = -1
    let bestCost = Infinity
    for (const option of edge.exits) {
      if (blocked(option, self, shape.length)) continue
      const turn = Math.abs(angleDelta(edge.heading, edges[option].heading))
      // Only movements of the kind already declared to the junction.
      if (mustTurn !== null && turn > TURN_ANGLE !== mustTurn) continue
      // A little noise, so identical junctions do not all resolve the same
      // way and put the whole fleet into one loop.
      const jitter = (Math.sin((self + 1) * 12.9898 + option * 78.233) * 0.5 + 0.5) * 0.85
      // A block too short to stand on is a last resort -- worse than any turn,
      // so it is only ever taken when there is genuinely nowhere else to go.
      const cramped = fitsOn(edges[option], shape) ? 0 : 100
      const cost = turn + jitter + cramped
      if (cost < bestCost) {
        bestCost = cost
        best = option
      }
    }
    return best
  }

  // Who is on which edge, so a driver can see the car in front. Parked
  // vehicles sit in their own lane at the kerb and are not in the way.
  occupancy.clear()
  approaching.clear()
  claims.clear()

  const claim = (node: string, who: number, mask: number) => {
    const entry = (who << 2) | mask
    const list = claims.get(node)
    if (list) list.push(entry)
    else claims.set(node, [entry])
  }

  /** The axes blocked in `node` by everyone other than the listed vehicles. */
  const heldExcept = (node: string, exempt: number[]) => {
    const list = claims.get(node)
    if (!list) return 0
    let mask = 0
    for (const entry of list) {
      if (exempt.includes(entry >> 2)) continue
      mask |= entry & BOTH_AXES
    }
    return mask
  }

  fleet.forEach((vehicle, i) => {
    if (vehicle.parked) return
    const list = occupancy.get(vehicle.edge)
    if (list) list.push(i)
    else occupancy.set(vehicle.edge, [i])

    const edge = edges[vehicle.edge]
    const shape = SHAPES[vehicle.kind]
    const reach = edgeReach(edge, shape)
    const body = claimReach(edge, shape)
    const toGo = edge.length - vehicle.at

    // Where this vehicle physically is, which is not the same question as
    // whether it can still stop. Both boxes are claimed if it is standing in
    // both -- on a block shorter than the junctions at either end of it, that
    // is simply the truth, and cross traffic has to wait for it to leave.
    // A block too short to stand clear on is treated as part of the junctions
    // at either end: a vehicle on one holds both of them for as long as it is
    // there. Claiming only within reach of each end left a window in the
    // middle where the far junction looked free, and somebody would take it
    // from the other side -- into a driver who by then had no way to stop.
    const wholeBlock = !fitsOn(edge, shape)

    if (wholeBlock || vehicle.at < body) {
      claim(edge.from, i, maskOf(vehicle, vehicle.turned))
    }
    if (wholeBlock || toGo < body) {
      claim(edge.to, i, maskOf(vehicle, isTurning(vehicle)))

      // Heading onto a block it will not be able to stop on: the junction
      // beyond that block is part of the same manoeuvre, so it is reserved
      // now rather than on arrival. Between committing to the turn and
      // reaching the short block there was a second or so in which the far
      // junction looked free to everybody else, and two drivers would take it
      // from opposite ends -- neither of them able to stop once they had.
      if (vehicle.intent >= 0) {
        const exit = edges[vehicle.intent]
        if (!fitsOn(exit, shape)) claim(exit.to, i, BOTH_AXES)
      }
    }

    // Committed: past the last point it could have been talked out of it, so
    // it holds the box rather than negotiating for it.
    if (toGo < reach) return

    // On the approach. The look-ahead is a braking distance, not a fixed
    // seven units -- at 7 from the node a car on an 11.5-wide street is
    // barely a metre from the box, far too late to give way to anything.
    const look = reach + vehicle.speed * 1.5 + 4
    if (toGo > look) {
      vehicle.intent = -1
      vehicle.waited = 0
      return
    }
    const queue = approaching.get(edge.to)
    if (queue) queue.push(i)
    else approaching.set(edge.to, [i])
  })

  // Decide where each approaching driver is going *before* it gets there,
  // so give-way can tell a straight-on from a turn across the oncoming
  // carriageway. A separate pass, because choosing an exit needs the whole
  // occupancy table and the one above is still building it.
  approaching.forEach((queue) => {
    for (const i of queue) {
      const vehicle = fleet[i]
      if (vehicle.intent < 0 || edges[vehicle.intent] === undefined) {
        vehicle.intent = pickExit(i, vehicle)
      }
    }
  })

  // Give way. Where several movements converge on one junction the nearest
  // goes; anything whose path crosses it holds at the line. Two vehicles
  // running opposite ways down the *same* street do not conflict -- they
  // are in their own lanes -- so they are let through together, which is
  // what keeps a crossroads from turning into a four-way stop.
  yielding.clear()
  approaching.forEach((queue, node) => {
    /**
     * What is crossing this junction that nobody can do anything about:
     * traffic that is past the point of stopping, and traffic on its way out
     * of the box. Everyone waiting has to respect it.
     *
     * Crucially this leaves out the *other people waiting*. On a tight street
     * grid -- fifteen-unit blocks between roads eleven wide -- a vehicle
     * halted at the line still has its nose over the box's edge, because
     * there is nowhere else for it to be. Counting those noses as an occupied
     * junction meant four drivers each waiting for the other three to leave a
     * crossing none of them could leave, and the city came to a permanent
     * standstill. They are contending for the box, not using it.
     */
    const crossing = heldExcept(node, queue)

    // Longest wait first, then nearest, then by index. Ordering on distance
    // alone let a driver on a busy approach be passed over indefinitely; a
    // contest that changed its mind frame to frame left everyone creeping.
    queue.sort((a, b) => {
      const wa = fleet[b].waited - fleet[a].waited
      if (Math.abs(wa) > 0.05) return wa
      const ga = edges[fleet[a].edge].length - fleet[a].at
      const gb = edges[fleet[b].edge].length - fleet[b].at
      return ga - gb || a - b
    })

    /** Axes spoken for by whoever has already been waved through. */
    let granted = 0
    for (const i of queue) {
      const vehicle = fleet[i]
      const mask = maskOf(vehicle, isTurning(vehicle))

      // A driver heading onto a block too short to stand on needs the junction
      // at the *far* end of it clear as well, because it will not be able to
      // stop before reaching it. This is the same rule as not entering a box
      // without an exit, applied one block further out; without it a bus ends
      // up parked across a crossing it never agreed to occupy.
      let onward = 0
      if (vehicle.intent >= 0) {
        const exit = edges[vehicle.intent]
        if (!fitsOn(exit, SHAPES[vehicle.kind])) onward = heldExcept(exit.to, queue)
      }

      if (compatible(mask, crossing | granted) && onward === 0) {
        granted |= mask
        vehicle.waited = 0
        continue
      }
      vehicle.waited += delta
      yielding.add(i)
    }
  })

  fleet.forEach((vehicle, i) => {
    const shape = SHAPES[vehicle.kind]

    if (!vehicle.parked) {
      const edge = edges[vehicle.edge]

      // Patience: the driver's own slow wave, eased rather than switched.
      const wave = Math.sin(time * vehicle.stopRate + vehicle.stopPhase)
      let want = THREE.MathUtils.smoothstep(wave, vehicle.dwell - 0.3, vehicle.dwell + 0.5)

      // Keep your distance: ease off as the gap to the car ahead closes,
      // and stop if it has stopped.
      //
      // `at` is a vehicle's *centre*, so the gap that has to be kept is half
      // of each of the two lengths plus the air between them. Sizing it from
      // the follower's own length alone -- which is what this did -- meant a
      // bus tucked in behind another bus was told to stop 6.5 units back,
      // when the two of them take up 8.6 between their centres before either
      // has left any room at all. It was overlapping by two metres and being
      // told it had arrived. Almost every collision in the city was this.
      let gap = Infinity
      /** The closest two centres may ever come, for whoever is in front. */
      let bumper = 0
      /** How far along this edge that puts the limit. */
      let limit = Infinity

      /**
       * Consider one vehicle as the one in front. `base` is where its edge
       * begins, measured along this one, so a car on the far side of a
       * junction can be compared against a car on this side.
       */
      const consider = (j: number, ahead: number, base: number) => {
        if (ahead <= 0 || ahead >= gap) return
        gap = ahead
        bumper = (shape.length + SHAPES[fleet[j].kind].length) / 2 + 0.6
        limit = base + fleet[j].at - bumper
      }

      const others = occupancy.get(vehicle.edge)
      if (others) {
        for (const j of others) {
          if (j === i) continue
          consider(j, fleet[j].at - vehicle.at, 0)
        }
      }

      // Look through the junction, not just up to it.
      //
      // A driver could only ever see along its own stretch of road, so a
      // vehicle that had crossed a junction and stopped just beyond it was
      // invisible to the one following it through -- which duly crossed and
      // drove into the back of it. This is the box-junction rule: do not
      // enter unless your exit is clear.
      const toEnd = edge.length - vehicle.at
      if (vehicle.intent >= 0) {
        const beyond = occupancy.get(vehicle.intent)
        if (beyond) {
          for (const j of beyond) {
            if (j === i) continue
            consider(j, toEnd + fleet[j].at, edge.length)
          }
        }
      }

      if (gap < Infinity) {
        // The band above the bumper is a braking distance: the throttle eases
        // rather than switching, so a driver at speed needs room to shed it.
        const wanted = bumper + FOLLOW_GAP + vehicle.speed * 0.8
        want = Math.min(want, THREE.MathUtils.smoothstep(gap, bumper, wanted))
      }

      // Never come to rest inside a junction.
      //
      // Once a vehicle's nose is over the line it stops negotiating -- it has
      // to clear the box, and everyone else is waiting for it to. Left to its
      // own patience it could simply decide to idle there, in the middle of a
      // crossroads, which is both wrong to look at and a blockage nothing can
      // route around. Only ever applied with room genuinely ahead, so it can
      // never override the vehicle in front.
      const reach = edgeReach(edge, shape)
      if ((toEnd < reach || vehicle.at < reach) && gap > bumper + 2) {
        want = Math.max(want, 0.55)
      }

      // Holding back at a junction for somebody with priority. Eased down
      // rather than cut, so it reads as slowing for the crossing.
      //
      // The stop line is the edge of the junction box, not the node itself.
      // Stopping at `toGo = 0.5` -- which is what this used to do -- parked
      // the yielding vehicle in the middle of the crossroads, directly in
      // the path of whoever it was giving way to. Most of the remaining
      // collisions were vehicles waiting politely inside the box.
      let stopAt = Infinity
      if (yielding.has(i)) {
        const toGo = edge.length - vehicle.at
        const line = edgeReach(edge, shape)
        stopAt = edge.length - line
        want = Math.min(
          want,
          THREE.MathUtils.smoothstep(toGo, line, line + shape.length + 4),
        )
      }

      vehicle.throttle += (want - vehicle.throttle) * Math.min(1, delta * 2.2)
      const before = vehicle.at
      vehicle.at += vehicle.speed * vehicle.throttle * step

      // The same backstop as the one below, for the same reason, at the stop
      // line rather than at a bumper. Braking is a request: a driver that is
      // told to give way a moment before it reaches the line still carries
      // its speed over it, and once its nose is in the box it stops being a
      // negotiation and becomes a collision. A vehicle that has been told to
      // wait waits, whatever its momentum was doing.
      if (vehicle.at > stopAt) vehicle.at = Math.max(before, stopAt)

      // A hard backstop under the throttle rule above.
      //
      // Easing a throttle toward zero is a request, not a guarantee: a driver
      // that comes over a junction into the back of a stopped queue has real
      // speed to shed and will travel some way doing it. The rule keeps the
      // traffic *looking* right; this keeps it correct. A vehicle may never
      // end a frame closer to the one in front than their two half-lengths,
      // and it is never pushed backwards to achieve that.
      if (vehicle.at > limit) vehicle.at = Math.max(before, limit)

      // Out of road: turn onto the next stretch. Straight on is preferred,
      // so traffic runs down a street rather than pinballing round a block.
      if (vehicle.at > edge.length && edge.exits.length > 0) {
        const overshoot = vehicle.at - edge.length
        // The exit was chosen on the approach; only re-pick if the road has
        // filled up behind that decision in the meantime.
        //
        // A re-pick may not change the *kind* of movement, though. Give-way
        // let this vehicle into the box on the strength of what it said it
        // was going to do: a driver waved through because it was carrying
        // straight on, that then found its exit full and turned across the
        // oncoming carriageway instead, has taken a right nobody granted it
        // -- and it was already too far in to be stopped. Every remaining
        // graze in the city was one of these. If nothing of the declared kind
        // is free, it waits at the line rather than substituting a manoeuvre.
        const declared = vehicle.intent >= 0 ? isTurning(vehicle) : null
        let best = vehicle.intent
        if (best < 0 || blocked(best, i, shape.length)) {
          best = pickExit(i, vehicle, declared)
        }

        if (best < 0) {
          // Every way out is occupied. Wait at the line rather than turning
          // into the back of whatever is in the way.
          vehicle.at = edge.length
          vehicle.throttle = 0
        } else {
          const turn =
            Math.abs(angleDelta(edge.heading, edges[best].heading)) > TURN_ANGLE
          // Leave the edge it is on and join the new one *now*, in the
          // shared map, so a second vehicle turning into the same street on
          // this very frame can see it. Both used to read an occupancy
          // table built before either had moved, so both were waved onto
          // the same few metres of road and started life inside each other.
          const leaving = occupancy.get(vehicle.edge)
          if (leaving) {
            const spot = leaving.indexOf(i)
            if (spot >= 0) leaving.splice(spot, 1)
          }
          vehicle.edge = best
          vehicle.at = Math.min(overshoot, edges[best].length)
          vehicle.turned = turn
          vehicle.intent = -1
          vehicle.waited = 0
          const joining = occupancy.get(best)
          if (joining) joining.push(i)
          else occupancy.set(best, [i])
          // The lateral offset it arrives with, which the corner arc eases
          // away from over the first few units of the new road.
          vehicle.entryX = -edge.dz * vehicle.offset
          vehicle.entryZ = edge.dx * vehicle.offset
          vehicle.entryFacing = vehicle.facing
          // Its lane offset belongs to the new road's width.
          const lanes = lanesOn(edges[best].width)
          vehicle.offset = lanes.drive
          // Long enough to read as a curve, short enough that the vehicle is
          // straight again well before the next junction. A vehicle carrying
          // straight on has no corner to take.
          vehicle.turnLen = turn ? Math.max(3, vehicle.offset * 2.4) : 0
        }
      }
    }

    const current = edges[vehicle.edge]
    const turning = vehicle.turnLen > 0 && vehicle.at < vehicle.turnLen
    const progress = turning ? vehicle.at / vehicle.turnLen : 1
    const swing = progress * progress * (3 - 2 * progress)

    if (turning) {
      // Through a corner the body follows the arc rather than easing toward
      // the new heading on a clock. The two are not the same thing: the path
      // is measured in distance travelled and the ease was measured in
      // seconds, so a vehicle slowing for the junction turned its body faster
      // than it went round, and swung its nose out of the lane it was still
      // in. Sharing one progress value keeps the body on the path it is
      // actually driving.
      vehicle.facing = vehicle.entryFacing + angleDelta(vehicle.entryFacing, current.heading) * swing
    } else {
      vehicle.facing += angleDelta(vehicle.facing, current.heading) * Math.min(1, delta * 4.5)
    }

    // The corner, taken as an arc rather than as a lag.
    //
    // A lane offset is applied at right angles to the road, so at a turn the
    // direction it points in swings a quarter circle and the vehicle's target
    // position jumps sideways across the street -- by about two and a half
    // units on a right angle, and twice the lane offset on a U-turn.
    //
    // That jump used to be hidden by drawing the vehicle behind where the
    // simulation thought it was and letting it catch up. It looked right, and
    // it meant the car was not where any of the rules believed: the follow and
    // give-way tests both reason about `at`, so a vehicle halfway through a
    // corner could be drawn well into the oncoming lane while every rule that
    // might have objected was looking at its lane centre. Bounding the lag
    // tightly enough to be safe took all the smoothness back out of it.
    //
    // So the offset is swung round instead of the vehicle being dragged: over
    // the first few units of the new road the lateral vector eases from the
    // one it arrived on to the one it is joining. That is continuous at the
    // node by construction, it draws a proper arc through the junction, and
    // the drawn position is the simulated position again.
    const along = Math.min(vehicle.at, current.length)
    let lateralX = -current.dz * vehicle.offset
    let lateralZ = current.dx * vehicle.offset
    if (turning) {
      const eased = swing
      const blendX = vehicle.entryX + (lateralX - vehicle.entryX) * eased
      const blendZ = vehicle.entryZ + (lateralZ - vehicle.entryZ) * eased
      // Swung, not slid. Straight-line interpolation between two offsets a
      // quarter turn apart passes *inside* the corner -- shortest at the
      // midpoint, where it is only seven tenths as far from the centre line --
      // so a turning vehicle leaned half a metre into the oncoming lane. The
      // direction is taken from the blend and the distance from the road, so
      // it sweeps an arc that stays in its own lane the whole way round.
      const reach = Math.hypot(blendX, blendZ)
      if (reach > 1e-3) {
        const entry = Math.hypot(vehicle.entryX, vehicle.entryZ)
        const want = entry + (vehicle.offset - entry) * eased
        lateralX = (blendX / reach) * want
        lateralZ = (blendZ / reach) * want
      }
      // A U-turn's two offsets point straight at each other and the blend
      // passes through zero, where there is no direction to take. Falling
      // through to the new lane is right: it is where it is going anyway.
    }

    vehicle.renderX = current.x + current.dx * along + lateralX
    vehicle.renderZ = current.z + current.dz * along + lateralZ
  })
}
