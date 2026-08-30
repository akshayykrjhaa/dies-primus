import { useEffect, useMemo } from 'react'
import * as THREE from 'three'

import type { Building } from '../../types'
import { useLightRamp } from './useLightRamp'

/**
 * The shape catalogue.
 *
 * Every archetype from the backend gets a distinct low-poly silhouette built
 * from primitives — no textures, flat saturated colours, readable from across
 * the map. This is what stops two repositories looking like the same grid of
 * boxes: a docs-heavy repo grows libraries and schools, a service repo grows
 * glass towers, a tooling repo grows factories with chimneys.
 *
 * Shells take `w`, `d`, `h` (the footprint and total height the generator
 * asked for) and draw within that envelope, so the layout never collides.
 */

export interface ShellProps {
  building: Building
  detail: boolean // false in very large cities: skip the small trimmings
  /** 0 = daylight, 1 = full dark. Lights the window bands. */
  night?: number
}

const FLOOR = 2.6

/** Deterministic per-building randomness, so a city never reshuffles. */
function rand(seed: number, index: number): number {
  const x = Math.sin(seed * 12.9898 + index * 78.233) * 43758.5453
  return x - Math.floor(x)
}

/**
 * The four facades of a box, and the rotation that turns a plane to face out
 * of each one.
 *
 * This table is the fix for the long-standing "half the windows are missing"
 * bug. Every pane used to be placed with a `rotY` of either 0 or PI/2 and
 * then pushed to whichever side of the building it belonged on -- but a
 * PlaneGeometry's normal is +Z, so a plane at -w/2 rotated by *+*PI/2 has its
 * normal pointing at +X, straight into the building. Materials are front-side
 * by default, so those panes were backface-culled: the -X and -Z facades of
 * every building in the city rendered as blank walls, and the two that did
 * show were lit as if they faced the wrong way. Each face now gets the
 * rotation that actually points its normal outward.
 */
const FACES = [
  { rotY: 0, axis: 'z' as const, sign: 1 },
  { rotY: Math.PI, axis: 'z' as const, sign: -1 },
  { rotY: Math.PI / 2, axis: 'x' as const, sign: 1 },
  { rotY: -Math.PI / 2, axis: 'x' as const, sign: -1 },
]

/**
 * How far a pane floats off its wall. Big enough to clear the shell at any
 * distance the camera can reach, small enough to read as flush glazing.
 */
const PANE_OFFSET = 0.06

/**
 * One pane, shared by every window in the city.
 *
 * This used to be a fresh `PlaneGeometry` per building. The geometry is
 * identical every time, so a 300-building city was uploading three hundred
 * copies of the same four vertices to the GPU during the single frame the
 * city mounts -- a large part of the hitch on arriving. Never disposed: it
 * outlives any one building by design.
 */
const PANE_GEOMETRY = new THREE.PlaneGeometry(1, 1)

/** The wall colour a lit pane takes on, behind its emissive glow. */
const WINDOW_WARM = new THREE.Color('#8A7048')

/**
 * A real grid of windows across all four facades.
 *
 * One small pane per window on a pair of instanced meshes, so a tower with
 * ninety windows still costs two draw calls. Which panes are lit is seeded
 * from the building, so a given file always has the same windows on.
 *
 * The lit/unlit split is fixed by the seed and does *not* change with the
 * time of day -- only the two colours do. Rebuilding the meshes at dusk (the
 * old behaviour, which swapped a single "day" mesh for a lit/unlit pair the
 * moment `night` crossed 0.08) made every facade in the city pop at once.
 * Panes are now glass reflecting the sky by day and warm rooms by night,
 * easing between the two, with the geometry untouched.
 */
function Windows({
  w,
  d,
  h,
  floors,
  seed,
  night = 0,
  frame = '#2F3D52',
  detail = true,
}: {
  w: number
  d: number
  h: number
  floors: number
  seed: number
  night?: number
  frame?: string
  /** Large cities thin the grid rather than dropping it. */
  detail?: boolean
}) {
  const built = useMemo(() => {
    const storeys = Math.max(1, Math.min(floors, detail ? 26 : 12))
    const storeyHeight = h / storeys
    const paneH = Math.min(1.2, Math.max(0.45, storeyHeight * 0.42))
    const margin = 0.75
    const pitch = detail ? 1.7 : 2.6

    /** Columns and pane width for one facade, from the wall it sits on. */
    const layout = (wallWidth: number) => {
      const usable = wallWidth - margin * 2
      if (usable <= 0.4) return { cols: 0, paneW: 0, usable: 0 }
      const cols = Math.max(1, Math.min(9, Math.floor(usable / pitch) + 1))
      // Panes take a little under two-thirds of their column, so the wall
      // shows between them and the grid reads as windows rather than a band.
      const paneW = Math.min(1.05, Math.max(0.38, (usable / cols) * 0.54))
      return { cols, paneW, usable }
    }

    const alongX = layout(w)
    const alongZ = layout(d)

    const onMatrices: THREE.Matrix4[] = []
    const onTints: number[] = []
    const offMatrices: THREE.Matrix4[] = []

    const position = new THREE.Vector3()
    const quaternion = new THREE.Quaternion()
    const scale = new THREE.Vector3()
    const euler = new THREE.Euler()

    let roll = 0
    for (let floor = 0; floor < storeys; floor++) {
      const y = (floor + 0.5) * storeyHeight
      // Never let a pane poke through the roof slab or below the pavement.
      if (y + paneH / 2 > h - 0.2 || y - paneH / 2 < 0.25) continue

      // Whether a *storey* is occupied, so lit rooms cluster by floor the way
      // they do in a real building instead of scattering like static.
      const floorLife = rand(seed + 977, floor)
      // ...but only tall buildings have enough floors for that to read. On a
      // two-storey shop the floor roll *was* the whole building, so a bad
      // seed switched every window off and the little buildings sat dark all
      // night. Short buildings decide pane by pane instead.
      const clustering = Math.min(0.6, storeys / 22)

      for (const face of FACES) {
        const grid = face.axis === 'z' ? alongX : alongZ
        if (grid.cols === 0) continue
        const wallDepth = (face.axis === 'z' ? d : w) / 2 + PANE_OFFSET

        for (let c = 0; c < grid.cols; c++) {
          const t = grid.cols === 1 ? 0 : c / (grid.cols - 1) - 0.5
          const along = t * grid.usable

          if (face.axis === 'z') {
            position.set(along, y, face.sign * wallDepth)
          } else {
            position.set(face.sign * wallDepth, y, along)
          }
          euler.set(0, face.rotY, 0)
          quaternion.setFromEuler(euler)
          scale.set(grid.paneW, paneH, 1)

          const matrix = new THREE.Matrix4().compose(position, quaternion, scale)

          const pane = rand(seed, roll++)
          // Mostly the storey's own state, nudged per window, so a lit floor
          // still has the odd dark room in it.
          if (floorLife * clustering + pane * (1 - clustering) > 0.46) {
            onMatrices.push(matrix)
            onTints.push(0.86 + pane * 0.28)
          } else {
            offMatrices.push(matrix)
          }
        }
      }
    }

    // A last resort: whatever the seed said, no building is completely dark.
    // One unlit window is a detail; a whole unlit building at midnight is a
    // bug, and on a small facade the odds of it are not small.
    if (onMatrices.length === 0 && offMatrices.length > 0) {
      const take = Math.max(1, Math.round(offMatrices.length * 0.3))
      for (let i = 0; i < take; i++) {
        onMatrices.push(offMatrices.splice((i * 7) % offMatrices.length, 1)[0])
        onTints.push(0.9 + (i % 3) * 0.1)
      }
    }

    const geometry = PANE_GEOMETRY

    // Both sets are *shaded* materials. The lit set used to be an unlit
    // MeshBasicMaterial, which meant its panes glowed in broad daylight --
    // the lights read as permanently on. A Lambert material with its
    // emissive ramped from zero is lit glass by day and a lit room after
    // dark, which is the behaviour the day/night toggle is supposed to show.
    //
    // polygonOffset nudges the panes' depth values towards the camera in
    // screen space, which holds at every distance -- unlike the fixed world
    // offset alone, whose margin shrinks in the depth buffer as the far side
    // of a large city recedes.
    const onMaterial = new THREE.MeshLambertMaterial({
      color: new THREE.Color('#C4DDEF'),
      emissive: new THREE.Color('#FFC97A'),
      emissiveIntensity: 0,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2,
    })
    const offMaterial = new THREE.MeshLambertMaterial({
      color: new THREE.Color('#7E9BB4'),
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2,
    })

    // How far each set fades when the city dims around a focused building.
    // Windows hold on much harder than the walls do: dimming every material to
    // the same value multiplied the panes down until they vanished, and a
    // building with no windows reads as a blank slab rather than a faded one.
    // Lit panes hold on hardest of all, so the lights stay lit as the city
    // recedes behind them. See `DIM_FLOOR` in Building.tsx.
    onMaterial.userData.dimTo = 0.46
    offMaterial.userData.dimTo = 0.36

    const pack = (
      matrices: THREE.Matrix4[],
      material: THREE.Material,
      tints: number[] | null,
    ) => {
      if (matrices.length === 0) return null
      const mesh = new THREE.InstancedMesh(geometry, material, matrices.length)
      // Windows draw after the shells. Combined with depth writing (kept on
      // even while faded, see Building.tsx) this is what makes a translucent
      // building correct from every angle: the near wall lays down depth, the
      // far wall and far-side panes are backface-culled, and the near panes
      // sit on top where they belong.
      mesh.renderOrder = 1
      const color = new THREE.Color()
      matrices.forEach((matrix, i) => {
        mesh.setMatrixAt(i, matrix)
        // instanceColor multiplies the material colour, so a grey tint here
        // varies brightness per pane while leaving the hue to the material --
        // which is what lets the time of day animate without touching these.
        if (tints) mesh.setColorAt(i, color.setScalar(tints[i]))
      })
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      // Culled, unlike most instanced meshes in the city.
      //
      // The usual reason to switch culling off is that a set spans everything
      // -- the road network, the street furniture -- so the test can only ever
      // cost time and never save any. A window grid is the opposite: it
      // belongs to exactly one building, and in a large repository there are
      // several hundred of them. Leaving them all switched on meant every
      // facade in the city was submitted on every frame, including the two
      // thirds of them behind the camera. `InstancedMesh` derives its own
      // bounding sphere from the instance matrices, so this is simply correct
      // once the panes are placed.
      mesh.frustumCulled = true
      return mesh
    }

    return {
      on: pack(onMatrices, onMaterial, onTints),
      off: pack(offMatrices, offMaterial, null),
      onMaterial,
      offMaterial,
    }
  }, [w, d, h, floors, seed, detail])

  // Time of day is a material update, not a rebuild -- rebuilding the meshes
  // at dusk made every facade in the city pop at once. The ramp eases per
  // frame, so flipping to night mode fades the windows up alongside the sky
  // instead of switching them on a frame ahead of it.
  const frameColor = useMemo(() => new THREE.Color(frame), [frame])
  useLightRamp(night, (lit) => {
    // By day both sets are glass, differing only in shade, so a facade reads
    // as windows rather than as a grid of lamps. `lit` is flat zero right
    // through daylight, so nothing glows before dusk.
    built.onMaterial.color.set('#C4DDEF').lerp(WINDOW_WARM, lit * 0.42)
    // The glow is stored as well as applied. Focus mode scales it back by the
    // same amount it fades the building (see Building.tsx): opacity alone
    // cannot dim an emissive surface, so dimmed buildings kept shouting their
    // lit windows at full strength while their walls receded behind them.
    built.onMaterial.userData.emissiveBase = lit * 1.05
    built.onMaterial.emissiveIntensity =
      lit * 1.05 * ((built.onMaterial.userData.dimFactor as number) ?? 1)

    // Unlit panes just go darker as the sky does; they never glow.
    built.offMaterial.color.set('#8FAEC8').lerp(frameColor, 0.3 + lit * 0.42)
  }, built)

  useEffect(
    () => () => {
      // The geometry is shared and deliberately outlives this building.
      built.onMaterial.dispose()
      built.offMaterial.dispose()
    },
    [built],
  )

  return (
    <>
      {built.on && <primitive object={built.on} />}
      {built.off && <primitive object={built.off} />}
    </>
  )
}

/**
 * Corner pilasters for towers.
 *
 * These used to be two slabs laid flat against the middle of the -X and +X
 * walls, which is exactly where that facade's window grid runs -- harmless
 * while those panes were invisible, but a stack of half-buried windows the
 * moment they rendered. Moving them to the four vertical edges gives a tower
 * the same banded silhouette without ever crossing a pane.
 */
function Mullions({ w, d, h, color }: { w: number; d: number; h: number; color: string }) {
  const corners: Array<[number, number]> = [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ]
  return (
    <>
      {corners.map(([sx, sz]) => (
        <mesh key={`${sx}:${sz}`} position={[(sx * w) / 2, h / 2, (sz * d) / 2]} castShadow>
          <boxGeometry args={[0.22, h * 0.96, 0.22]} />
          <meshLambertMaterial color={color} />
        </mesh>
      ))}
    </>
  )
}

function Door({ w, d, color }: { w: number; d: number; color: string }) {
  return (
    <mesh position={[0, 1.05, d / 2 + 0.03]}>
      <boxGeometry args={[Math.min(1.6, w * 0.32), 2.1, 0.08]} />
      <meshLambertMaterial color={color} />
    </mesh>
  )
}

/** A flat sign board over the entrance — reads as a shopfront at distance. */
function Sign({ w, d, y, color }: { w: number; d: number; y: number; color: string }) {
  return (
    <mesh position={[0, y, d / 2 + 0.09]}>
      <boxGeometry args={[w * 0.78, 0.72, 0.12]} />
      <meshLambertMaterial color={color} />
    </mesh>
  )
}

export function Shell({ building, detail, night = 0 }: ShellProps) {
  const { width: w, depth: d, height: h, color, roofColor, accent, floors, seed } = building

  switch (building.archetype) {
    // ---------------------------------------------------------- towers
    case 'skyscraper': {
      const midH = h * 0.62
      const topH = h - midH
      // Floors split proportionally between the shaft and the crown, so a
      // very tall tower doesn't leave its top third with zero windows -- at
      // night that read as a lit shaft under a pitch-black cap.
      const midFloors = Math.max(1, Math.round(floors * (midH / h)))
      const topFloors = Math.max(1, floors - midFloors)
      return (
        <group>
          <mesh position={[0, midH / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, midH, d]} />
            <meshLambertMaterial color={color} />
          </mesh>
          <mesh position={[0, midH + topH / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w * 0.74, topH, d * 0.74]} />
            <meshLambertMaterial color={color} />
          </mesh>
          <Mullions w={w} d={d} h={midH} color={accent} />
          <Windows w={w} d={d} h={midH} floors={midFloors} seed={seed} night={night} frame={accent} detail={detail} />
          <group position={[0, midH, 0]}>
            <Windows
              w={w * 0.74}
              d={d * 0.74}
              h={topH}
              floors={topFloors}
              seed={seed + 4111}
              night={night}
              frame={accent}
              detail={detail}
            />
          </group>
          <mesh position={[0, h + 1.6, 0]}>
            <cylinderGeometry args={[0.07, 0.11, 3.2, 5]} />
            <meshLambertMaterial color="#C9D2DE" />
          </mesh>
          <mesh position={[0, h + 3.3, 0]}>
            <sphereGeometry args={[0.24, 8, 8]} />
            <meshBasicMaterial color="#FF4D4D" />
          </mesh>
        </group>
      )
    }

    case 'office':
      return (
        <group>
          <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, h, d]} />
            <meshLambertMaterial color={color} />
          </mesh>
          <Windows w={w} d={d} h={h} floors={floors} seed={seed} night={night} frame={accent} detail={detail} />
          <mesh position={[0, h + 0.16, 0]} castShadow>
            <boxGeometry args={[w * 1.06, 0.32, d * 1.06]} />
            <meshLambertMaterial color={roofColor} />
          </mesh>
          {detail && (
            <mesh position={[w * 0.2, h + 0.75, -d * 0.2]} castShadow>
              <boxGeometry args={[w * 0.3, 0.9, d * 0.3]} />
              <meshLambertMaterial color="#9AA6B4" />
            </mesh>
          )}
          <Door w={w} d={d} color={accent} />
        </group>
      )

    case 'apartment':
      return (
        <group>
          <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, h, d]} />
            <meshLambertMaterial color={color} />
          </mesh>
          {/* Apartments were the largest archetype with no glazing at all, so
              a whole residential district read as a field of blank slabs. */}
          <Windows w={w} d={d} h={h} floors={floors} seed={seed} night={night} frame={accent} detail={detail} />
          {/* Balconies sit at the foot of each storey, clear of that floor's
              windows, and stand far enough proud not to bury them. */}
          {detail &&
            Array.from({ length: Math.min(floors, 7) }).map((_, i) => (
              <mesh
                key={i}
                position={[0, (i + 0.14) * (h / Math.max(1, floors)) + 0.3, d / 2 + 0.34]}
                castShadow
              >
                <boxGeometry args={[w * 0.72, 0.42, 0.62]} />
                <meshLambertMaterial color={roofColor} />
              </mesh>
            ))}
          <mesh position={[0, h + 0.15, 0]} castShadow>
            <boxGeometry args={[w * 1.05, 0.3, d * 1.05]} />
            <meshLambertMaterial color={accent} />
          </mesh>
          <Door w={w} d={d} color={accent} />
        </group>
      )

    // ------------------------------------------------------ small stuff
    case 'house': {
      const wallH = Math.max(2.4, h * 0.62)
      return (
        <group>
          <mesh position={[0, wallH / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, wallH, d]} />
            <meshLambertMaterial color={color} />
          </mesh>
          {/* A house gets two panes a side rather than a grid, which is all
              its 4-unit walls have room for -- but a street of unlit cottages
              was the darkest thing in the city after sunset. Gated on
              `detail`, with the other small archetypes: glazing every cottage
              in a 300-building city doubles the window draw calls to add
              detail nobody is close enough to see. */}
          {detail && (
            <Windows w={w} d={d} h={wallH} floors={1} seed={seed} night={night} frame="#6E5A46" detail={detail} />
          )}
          {/* gable roof */}
          <mesh position={[0, wallH + (h - wallH) / 2, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
            <coneGeometry args={[Math.max(w, d) * 0.78, h - wallH, 4]} />
            <meshLambertMaterial color={accent} />
          </mesh>
          {detail && (
            <mesh position={[w * 0.28, h + 0.3, -d * 0.2]} castShadow>
              <boxGeometry args={[0.5, 1.2, 0.5]} />
              <meshLambertMaterial color={accent} />
            </mesh>
          )}
          <Door w={w} d={d} color="#7A4B2A" />
        </group>
      )
    }

    case 'shop':
      return (
        <group>
          <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, h, d]} />
            <meshLambertMaterial color={color} />
          </mesh>
          {/* awning */}
          <mesh position={[0, 2.5, d / 2 + 0.55]} rotation={[-0.42, 0, 0]} castShadow>
            <boxGeometry args={[w * 0.94, 0.12, 1.5]} />
            <meshLambertMaterial color={accent} />
          </mesh>
          <mesh position={[0, 1.2, d / 2 + 0.04]}>
            <boxGeometry args={[w * 0.72, 1.7, 0.08]} />
            <meshLambertMaterial color="#BFE3F2" />
          </mesh>
          {/* The flat above the shop. Offset so the grid starts above the
              awning and the shopfront rather than behind them. */}
          {detail && h > 4.4 && (
            <group position={[0, 3.4, 0]}>
              <Windows
                w={w}
                d={d}
                h={h - 3.4}
                floors={Math.max(1, floors - 1)}
                seed={seed + 2207}
                night={night}
                frame={accent}
                detail={detail}
              />
            </group>
          )}
          <Sign w={w} d={d} y={h - 0.6} color={accent} />
          <mesh position={[0, h + 0.12, 0]} castShadow>
            <boxGeometry args={[w * 1.04, 0.24, d * 1.04]} />
            <meshLambertMaterial color={roofColor} />
          </mesh>
        </group>
      )

    case 'utility':
      return (
        <group>
          <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, h, d]} />
            <meshLambertMaterial color={color} />
          </mesh>
          <mesh position={[0, h + 0.22, 0]} castShadow>
            <boxGeometry args={[w * 0.5, 0.44, d * 0.5]} />
            <meshLambertMaterial color={accent} />
          </mesh>
        </group>
      )

    // ---------------------------------------------------------- civic
    case 'civic': {
      const baseH = h * 0.7
      return (
        <group>
          <mesh position={[0, baseH / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, baseH, d]} />
            <meshLambertMaterial color={color} />
          </mesh>
          <Windows w={w} d={d} h={baseH} floors={Math.max(2, floors)} seed={seed} night={night} frame="#9A8258" detail={detail} />
          {/* portico columns */}
          {detail &&
            [-0.34, -0.12, 0.12, 0.34].map((offset) => (
              <mesh key={offset} position={[w * offset, baseH * 0.45, d / 2 + 0.4]} castShadow>
                <cylinderGeometry args={[0.24, 0.24, baseH * 0.9, 8]} />
                <meshLambertMaterial color="#F6F1E4" />
              </mesh>
            ))}
          <mesh position={[0, baseH + 0.2, d * 0.32]} castShadow>
            <boxGeometry args={[w * 1.05, 0.4, d * 0.5]} />
            <meshLambertMaterial color="#F6F1E4" />
          </mesh>
          {/* clock tower */}
          <mesh position={[0, baseH + (h - baseH) / 2, -d * 0.1]} castShadow>
            <boxGeometry args={[w * 0.3, h - baseH, d * 0.3]} />
            <meshLambertMaterial color={color} />
          </mesh>
          <mesh position={[0, h + 0.9, -d * 0.1]} castShadow>
            <coneGeometry args={[w * 0.24, 1.8, 4]} />
            <meshLambertMaterial color={accent} />
          </mesh>
          <mesh position={[0, h - 0.5, -d * 0.1 + w * 0.16]}>
            <cylinderGeometry args={[0.42, 0.42, 0.08, 12]} />
            <meshBasicMaterial color="#FFF6D8" />
          </mesh>
        </group>
      )
    }

    case 'hospital':
      return (
        <group>
          <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, h, d]} />
            <meshLambertMaterial color={color} />
          </mesh>
          <Windows w={w} d={d} h={h} floors={floors} seed={seed} night={night} frame={'#BBD3E4'} detail={detail} />
          {/* red cross on the facade */}
          <mesh position={[0, h * 0.72, d / 2 + 0.05]}>
            <boxGeometry args={[1.5, 0.42, 0.08]} />
            <meshBasicMaterial color={accent} />
          </mesh>
          <mesh position={[0, h * 0.72, d / 2 + 0.05]}>
            <boxGeometry args={[0.42, 1.5, 0.08]} />
            <meshBasicMaterial color={accent} />
          </mesh>
          {/* helipad */}
          <mesh position={[0, h + 0.14, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[Math.min(w, d) * 0.34, 20]} />
            <meshLambertMaterial color="#5C6672" />
          </mesh>
          <Door w={w} d={d} color="#8FB8DE" />
        </group>
      )

    case 'school':
    case 'library': {
      const baseH = Math.max(3, h * 0.86)
      return (
        <group>
          <mesh position={[0, baseH / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, baseH, d]} />
            <meshLambertMaterial color={color} />
          </mesh>
          <Windows w={w} d={d} h={baseH} floors={Math.max(2, floors)} seed={seed} night={night} frame={accent} detail={detail} />
          {/* pediment over the entrance */}
          <mesh position={[0, baseH + 0.55, d * 0.2]} rotation={[0, Math.PI / 4, 0]} castShadow>
            <coneGeometry args={[w * 0.34, 1.1, 4]} />
            <meshLambertMaterial color="#F4EFE2" />
          </mesh>
          {detail &&
            [-0.22, 0, 0.22].map((offset) => (
              <mesh key={offset} position={[w * offset, baseH * 0.42, d / 2 + 0.35]} castShadow>
                <cylinderGeometry args={[0.2, 0.2, baseH * 0.84, 8]} />
                <meshLambertMaterial color="#F4EFE2" />
              </mesh>
            ))}
          {building.archetype === 'school' && detail && (
            <mesh position={[w * 0.42, baseH + 2, d * 0.3]}>
              <cylinderGeometry args={[0.05, 0.05, 4, 5]} />
              <meshLambertMaterial color="#CFD6DF" />
            </mesh>
          )}
          <Door w={w} d={d} color={accent} />
        </group>
      )
    }

    case 'police':
      return (
        <group>
          <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, h, d]} />
            <meshLambertMaterial color={color} />
          </mesh>
          <Windows w={w} d={d} h={h} floors={floors} seed={seed} night={night} frame={'#22364F'} detail={detail} />
          <Sign w={w} d={d} y={h - 0.5} color={accent} />
          <mesh position={[0, h + 0.4, 0]}>
            <sphereGeometry args={[0.3, 8, 8]} />
            <meshBasicMaterial color="#4FA3FF" />
          </mesh>
          <Door w={w} d={d} color={accent} />
        </group>
      )

    case 'fire':
      return (
        <group>
          <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, h, d]} />
            <meshLambertMaterial color={color} />
          </mesh>
          {/* The bays take the ground floor, so the glazing starts above
              them rather than behind them. */}
          {detail && h > 4.2 && (
            <group position={[0, 3.0, 0]}>
              <Windows
                w={w}
                d={d}
                h={h - 3.0}
                floors={Math.max(1, floors - 1)}
                seed={seed + 5303}
                night={night}
                frame="#7E2C31"
                detail={detail}
              />
            </group>
          )}
          {/* engine bay doors */}
          {[-0.24, 0.24].map((offset) => (
            <mesh key={offset} position={[w * offset, 1.5, d / 2 + 0.05]}>
              <boxGeometry args={[w * 0.4, 2.6, 0.09]} />
              <meshLambertMaterial color={accent} />
            </mesh>
          ))}
          {/* hose tower */}
          <mesh position={[w * 0.36, h * 0.68, -d * 0.24]} castShadow>
            <boxGeometry args={[w * 0.26, h * 1.3, d * 0.26]} />
            <meshLambertMaterial color={color} />
          </mesh>
          <mesh position={[0, h + 0.16, 0]} castShadow>
            <boxGeometry args={[w * 1.04, 0.3, d * 1.04]} />
            <meshLambertMaterial color={accent} />
          </mesh>
        </group>
      )

    // ------------------------------------------------------ industrial
    case 'factory':
      return (
        <group>
          <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, h, d]} />
            <meshLambertMaterial color={color} />
          </mesh>
          {/* Factories are lit from a clerestory band high on the wall, not
              from a grid of office windows -- one storey's worth of panes at
              the top of the shed. */}
          {detail && h > 3.2 && (
            <group position={[0, h - 2.4, 0]}>
              <Windows
                w={w}
                d={d}
                h={2.4}
                floors={1}
                seed={seed + 8117}
                night={night}
                frame="#4A525C"
                detail={detail}
              />
            </group>
          )}
          {/* sawtooth roof */}
          {[-0.28, 0, 0.28].map((offset, i) => (
            <mesh
              key={i}
              position={[0, h + 0.5, d * offset]}
              rotation={[Math.PI / 5, 0, 0]}
              castShadow
            >
              <boxGeometry args={[w * 0.96, 0.16, d * 0.3]} />
              <meshLambertMaterial color={i % 2 ? '#9FD3E8' : accent} />
            </mesh>
          ))}
          {[-0.3, 0.3].map((offset) => (
            <mesh key={offset} position={[w * offset, h + 2.1, -d * 0.34]} castShadow>
              <cylinderGeometry args={[0.34, 0.42, 4.2, 8]} />
              <meshLambertMaterial color={accent} />
            </mesh>
          ))}
        </group>
      )

    case 'warehouse':
      return (
        <group>
          <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, h, d]} />
            <meshLambertMaterial color={color} />
          </mesh>
          {/* barrel roof */}
          <mesh
            position={[0, h + 0.1, 0]}
            rotation={[0, 0, Math.PI / 2]}
            castShadow
          >
            <cylinderGeometry args={[d * 0.5, d * 0.5, w, 12, 1, false, 0, Math.PI]} />
            <meshLambertMaterial color={accent} />
          </mesh>
          {[-0.26, 0.26].map((offset) => (
            <mesh key={offset} position={[w * offset, 1.4, d / 2 + 0.05]}>
              <boxGeometry args={[w * 0.34, 2.4, 0.09]} />
              <meshLambertMaterial color={roofColor} />
            </mesh>
          ))}
        </group>
      )

    case 'power':
      return (
        <group>
          <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w * 0.9, h, d * 0.7]} />
            <meshLambertMaterial color={color} />
          </mesh>
          {/* cooling towers */}
          {[-0.28, 0.3].map((offset, i) => (
            <mesh
              key={offset}
              position={[w * offset, h * 0.9 + 1.4, d * 0.22]}
              castShadow
            >
              <cylinderGeometry args={[1.25, 1.7, h * 0.9 + 2.8, 14, 1, true]} />
              <meshLambertMaterial color={accent} side={THREE.DoubleSide} />
            </mesh>
          ))}
        </group>
      )

    case 'gas':
      return (
        <group>
          {/* kiosk */}
          <mesh position={[-w * 0.28, h / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w * 0.42, h, d * 0.8]} />
            <meshLambertMaterial color={accent} />
          </mesh>
          {/* forecourt canopy */}
          <mesh position={[w * 0.2, 3.4, 0]} castShadow>
            <boxGeometry args={[w * 0.72, 0.32, d * 0.95]} />
            <meshLambertMaterial color={color} />
          </mesh>
          {[-0.3, 0.3].map((offset) => (
            <mesh key={offset} position={[w * 0.2, 1.7, d * offset]}>
              <cylinderGeometry args={[0.14, 0.14, 3.4, 6]} />
              <meshLambertMaterial color="#D8DEE6" />
            </mesh>
          ))}
          <mesh position={[w * 0.2, 0.6, 0]}>
            <boxGeometry args={[0.5, 1.2, 0.4]} />
            <meshLambertMaterial color="#E0E6ED" />
          </mesh>
        </group>
      )

    case 'lab':
      return (
        <group>
          <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, h, d]} />
            <meshLambertMaterial color={color} />
          </mesh>
          <Windows w={w} d={d} h={h} floors={floors} seed={seed} night={night} frame={accent} detail={detail} />
          <mesh position={[0, h + 0.7, 0]} castShadow>
            <sphereGeometry args={[Math.min(w, d) * 0.34, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshLambertMaterial color="#EAF6F2" />
          </mesh>
          <Door w={w} d={d} color={accent} />
        </group>
      )

    default:
      return (
        <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[w, h, d]} />
          <meshLambertMaterial color={color} />
        </mesh>
      )
  }
}

export { rand }
