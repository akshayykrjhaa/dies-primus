import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

import { lampsOn } from '../../lib/daylight'

/**
 * Birds over the valley.
 *
 * A flock of silhouettes turning slow circles above the city, sized and placed
 * from the city's own span like everything else in the landscape. They are
 * pure decoration, so they are deliberately cheap: one instanced mesh for the
 * whole flock, no shadows, no lighting, and no per-vertex animation.
 *
 * The wingbeat is the one thing worth explaining. Instancing gives every bird
 * its own transform but they all share one geometry, so the wings cannot be
 * moved individually. Instead each bird's *span* is squeezed and released on
 * its own phase -- scaling local X between roughly a half and full width.
 * From any distance you would actually see a bird from, a wing sweeping in
 * and out is exactly what a wingbeat looks like.
 *
 * They fade out after dusk, on the same ramp the street lamps come up on, so
 * the sky empties as the city lights fill in.
 */

interface Props {
  /** The city's larger dimension; the flock is scaled and placed from it. */
  span: number
  /** 0 = day, 1 = full dark. */
  night: number
}

interface Bird {
  /** Radius of the circle this bird is turning. */
  radius: number
  height: number
  /** Radians per second, signed: negative birds circle the other way. */
  speed: number
  phase: number
  /** Ellipse squash, so the flock is not a set of perfect circles. */
  squash: number
  size: number
  /** How fast the wings beat, and where in the beat this bird starts. */
  flapRate: number
  flapPhase: number
  /** Slow vertical drift, so the flock does not sit on one plane. */
  bobRate: number
  bobDepth: number
}

/** Deterministic, so a given city always gets the same flock. */
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
 * One bird: a shallow V of two triangles, wings raised a little above the
 * body so the silhouette still reads when it passes overhead.
 */
function birdGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  // Nose at +Z, wings out along X, tips lifted in Y.
  const vertices = new Float32Array([
    // left wing
    0, 0, 0.35,
    -1, 0.34, -0.4,
    0, 0.02, -0.16,
    // right wing
    0, 0, 0.35,
    0, 0.02, -0.16,
    1, 0.34, -0.4,
  ])
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3))
  geometry.computeVertexNormals()
  return geometry
}

export function Birds({ span, night }: Props) {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const material = useRef<THREE.MeshBasicMaterial>(null)
  const shown = useRef(0)

  const geometry = useMemo(() => birdGeometry(), [])

  const flock = useMemo<Bird[]>(() => {
    const random = mulberry(Math.round(span * 977))
    // Enough to read as a flock, few enough to be free. Three loose groups,
    // because birds arriving in one evenly-spaced ring looks like a fairground
    // ride rather than a flock.
    const groups = 3
    const birds: Bird[] = []
    for (let g = 0; g < groups; g++) {
      const baseRadius = span * (0.34 + random() * 0.44)
      const baseHeight = span * (0.2 + random() * 0.22)
      const direction = random() > 0.5 ? 1 : -1
      const baseSpeed = (0.045 + random() * 0.05) * direction
      const lead = random() * Math.PI * 2
      const count = 4 + Math.floor(random() * 5)
      for (let i = 0; i < count; i++) {
        birds.push({
          radius: baseRadius * (0.9 + random() * 0.2),
          height: baseHeight + (random() - 0.5) * span * 0.06,
          speed: baseSpeed * (0.94 + random() * 0.12),
          // Spread through the group rather than around the whole circle, so
          // they travel together.
          phase: lead + (i - count / 2) * 0.09 + (random() - 0.5) * 0.05,
          squash: 0.7 + random() * 0.4,
          size: span * 0.011 * (0.75 + random() * 0.5),
          flapRate: 5.5 + random() * 3.5,
          flapPhase: random() * Math.PI * 2,
          bobRate: 0.35 + random() * 0.5,
          bobDepth: span * 0.012 * (0.5 + random()),
        })
      }
    }
    return birds
  }, [span])

  const scratch = useMemo(
    () => ({
      matrix: new THREE.Matrix4(),
      position: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      scale: new THREE.Vector3(),
      euler: new THREE.Euler(),
    }),
    [],
  )

  useEffect(() => {
    if (material.current) material.current.userData.selfLit = true
  }, [])

  useFrame((state, delta) => {
    const node = mesh.current
    if (!node) return

    // Daylight only. Eased rather than switched, so dusk empties the sky
    // gradually instead of the flock blinking out.
    const target = 1 - lampsOn(night)
    shown.current += (target - shown.current) * Math.min(1, delta * 1.2)
    if (material.current) material.current.opacity = shown.current * 0.85
    node.visible = shown.current > 0.02
    if (!node.visible) return

    const time = state.clock.elapsedTime
    const { matrix, position, quaternion, scale, euler } = scratch

    flock.forEach((bird, index) => {
      const angle = bird.phase + time * bird.speed
      const x = Math.cos(angle) * bird.radius
      const z = Math.sin(angle) * bird.radius * bird.squash
      const y = bird.height + Math.sin(time * bird.bobRate + bird.phase) * bird.bobDepth

      // Face along the direction of travel: the derivative of the ellipse.
      const heading = Math.atan2(
        -Math.sin(angle) * bird.radius * Math.sign(bird.speed),
        Math.cos(angle) * bird.radius * bird.squash * Math.sign(bird.speed),
      )
      // Bank into the turn, which is most of what sells a circling bird.
      const bank = Math.sign(bird.speed) * 0.35

      const beat = Math.sin(time * bird.flapRate + bird.flapPhase)
      const spanScale = bird.size * (0.55 + Math.abs(beat) * 0.45)

      position.set(x, y, z)
      euler.set(0, heading, bank)
      quaternion.setFromEuler(euler)
      scale.set(spanScale, bird.size, bird.size)
      matrix.compose(position, quaternion, scale)
      node.setMatrixAt(index, matrix)
    })
    node.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh
      ref={mesh}
      args={[geometry, undefined, flock.length]}
      frustumCulled={false}
    >
      <meshBasicMaterial
        ref={material}
        color="#2A3242"
        transparent
        opacity={0}
        side={THREE.DoubleSide}
        depthWrite={false}
        toneMapped={false}
      />
    </instancedMesh>
  )
}
