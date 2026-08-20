import { useMemo } from 'react'
import * as THREE from 'three'

import type { Building } from '../../types'

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
 * A real grid of windows across all four facades.
 *
 * The previous version drew horizontal bands, which read as stripes rather
 * than as a building. This lays out one small pane per window on a single
 * instanced mesh, so a tower with 90 windows still costs one draw call — fewer
 * than the two dozen band meshes it replaces.
 *
 * Which panes are lit is seeded from the building, so a given file always has
 * the same windows on, and they only light up after dark.
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
  const lit = night > 0.08

  const { matrices, states } = useMemo(() => {
    const matrices: THREE.Matrix4[] = []
    const states: number[] = []

    const storeys = Math.max(1, Math.min(floors, detail ? 26 : 12))
    const storeyHeight = h / storeys
    const paneH = Math.min(1.5, storeyHeight * 0.52)
    const paneW = 0.95

    // Columns per face, from the real footprint.
    const pitch = detail ? 1.7 : 2.6
    const colsX = Math.max(1, Math.floor((w - 0.7) / pitch))
    const colsZ = Math.max(1, Math.floor((d - 0.7) / pitch))

    const place = (
      x: number, y: number, z: number, rotY: number, sx: number,
    ) => {
      const matrix = new THREE.Matrix4()
      matrix.compose(
        new THREE.Vector3(x, y, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0)),
        new THREE.Vector3(sx, paneH, 1),
      )
      matrices.push(matrix)
    }

    let index = 0
    for (let floor = 0; floor < storeys; floor++) {
      // Ground floor is lobby, not offices.
      const y = (floor + 0.55) * storeyHeight
      if (y > h - paneH * 0.6) continue

      for (let c = 0; c < colsZ; c++) {
        const t = colsZ === 1 ? 0 : c / (colsZ - 1) - 0.5
        const z = t * (d - 1.4)
        place(w / 2 + 0.03, y, z, Math.PI / 2, paneW)
        place(-w / 2 - 0.03, y, z, Math.PI / 2, paneW)
        states.push(rand(seed, index++), rand(seed, index++))
      }
      for (let c = 0; c < colsX; c++) {
        const t = colsX === 1 ? 0 : c / (colsX - 1) - 0.5
        const x = t * (w - 1.4)
        place(x, y, d / 2 + 0.03, 0, paneW)
        place(x, y, -d / 2 - 0.03, 0, paneW)
        states.push(rand(seed, index++), rand(seed, index++))
      }
    }
    return { matrices, states }
  }, [w, d, h, floors, seed, detail])

  // Lit and unlit panes get genuinely different materials rather than one
  // uniform emissive wash. A single material with a flat emissiveIntensity
  // applies to every instance regardless of its vertex colour, so the "off"
  // panes were picking up the same warm glow as the "on" ones and the whole
  // facade blurred into one muddy wash -- exactly what made a tall building
  // with dozens of windows read as evenly, badly lit rather than as a real
  // building with some windows on and some off. Lit panes use a basic
  // (unlit-by-scene) material, so they read as light sources; dark panes stay
  // a plain Lambert material and are shaded only by the ambient/moon light,
  // so they go properly dim at night instead of glowing along with everything
  // else.
  const built = useMemo(() => {
    const geometry = new THREE.PlaneGeometry(1, 1)
    const dark = new THREE.Color(frame)

    if (!lit) {
      const glass = new THREE.Color('#9FC4DE').lerp(dark, 0.45)
      const material = new THREE.MeshLambertMaterial({ color: glass })
      const day = new THREE.InstancedMesh(geometry, material, Math.max(1, matrices.length))
      matrices.forEach((matrix, i) => day.setMatrixAt(i, matrix))
      day.count = matrices.length
      day.instanceMatrix.needsUpdate = true
      day.frustumCulled = false
      return { day, on: null as THREE.InstancedMesh | null, off: null as THREE.InstancedMesh | null }
    }

    // Lit panes are drawn with a basic material, so their brightness has to
    // come from the colour itself -- scale it by how dark it actually is, or
    // dusk would be as blazing as midnight.
    const glow = 0.55 + Math.min(1, night) * 0.45
    const warm = new THREE.Color('#FFD489').multiplyScalar(glow)
    const warmAlt = new THREE.Color('#FFE9B8').multiplyScalar(glow)
    const onMatrices: THREE.Matrix4[] = []
    const onColors: THREE.Color[] = []
    const offMatrices: THREE.Matrix4[] = []

    matrices.forEach((matrix, i) => {
      // One roll per pane -- matrices and states are built 1:1 above.
      const roll = states[i] ?? 0.5
      if (roll > 0.38) {
        onMatrices.push(matrix)
        onColors.push(roll > 0.75 ? warmAlt : warm)
      } else {
        offMatrices.push(matrix)
      }
    })

    let on: THREE.InstancedMesh | null = null
    if (onMatrices.length > 0) {
      const material = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })
      on = new THREE.InstancedMesh(geometry, material, onMatrices.length)
      onMatrices.forEach((matrix, i) => {
        on!.setMatrixAt(i, matrix)
        on!.setColorAt(i, onColors[i])
      })
      on.count = onMatrices.length
      on.instanceMatrix.needsUpdate = true
      if (on.instanceColor) on.instanceColor.needsUpdate = true
      on.frustumCulled = false
    }

    let off: THREE.InstancedMesh | null = null
    if (offMatrices.length > 0) {
      const material = new THREE.MeshLambertMaterial({ color: dark })
      off = new THREE.InstancedMesh(geometry, material, offMatrices.length)
      offMatrices.forEach((matrix, i) => off!.setMatrixAt(i, matrix))
      off.count = offMatrices.length
      off.instanceMatrix.needsUpdate = true
      off.frustumCulled = false
    }

    return { day: null as THREE.InstancedMesh | null, on, off }
  }, [matrices, states, lit, frame, night])

  return (
    <>
      {built.day && <primitive object={built.day} />}
      {built.on && <primitive object={built.on} />}
      {built.off && <primitive object={built.off} />}
    </>
  )
}

/** Vertical glazing strips for towers. */
function Mullions({ w, d, h, color }: { w: number; d: number; h: number; color: string }) {
  return (
    <>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[(side * w) / 2 + side * 0.02, h / 2, 0]}>
          <boxGeometry args={[0.06, h * 0.9, d * 0.62]} />
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
          {detail &&
            Array.from({ length: Math.min(floors, 7) }).map((_, i) => (
              <mesh
                key={i}
                position={[0, (i + 0.75) * (h / Math.max(1, floors)), d / 2 + 0.22]}
                castShadow
              >
                <boxGeometry args={[w * 0.72, 0.5, 0.45]} />
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
