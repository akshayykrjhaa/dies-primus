import { useFrame, useThree } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'

import { Portal } from './Portal'

/**
 * The gate while it is still being built.
 *
 * Deliberately the same antechamber the visitor lands in next — same void,
 * same lights, same machine as {@link PortalChamber} — but caught earlier:
 * the vortex is only part charged, a welding arc is still tracing its way
 * around the aperture, and the city rises out of the dark behind it as the
 * backend reports work done. Analysis finishing is therefore the end of a
 * move the visitor has been watching, not a card being swapped for a scene.
 *
 * `progress` is the job's own 0..1. Everything here reads from one eased
 * copy of it, so a poll that lands twelve points at once is still spent as a
 * sweep rather than a jump.
 */

export interface PortalForgeProps {
  /** Job progress, 0..1. */
  progress: number
}

const GLOW = '#FF2E88'
const ARC_SEGMENTS = 180
const ARC_RADIUS = 10.9
const PORTAL_Y = 11
const GROUND_Y = -1.4

/** Deterministic per-index noise, so the skyline is the same on every mount. */
function hash(index: number, salt: number): number {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453
  return value - Math.floor(value)
}

/**
 * The arc tracing round the gate: the progress bar, rebuilt as geometry.
 *
 * Advanced by moving the index draw range over one static ring rather than
 * rebuilding geometry per frame — a ring segment is six indices, so the arc
 * steps round in two-degree increments for the cost of an integer.
 */
function ProgressArc({ charge }: { charge: React.MutableRefObject<number> }) {
  const arc = useRef<THREE.Mesh>(null)
  const head = useRef<THREE.Group>(null)
  const headLight = useRef<THREE.PointLight>(null)

  // A negative thetaLength runs the segments clockwise from twelve o'clock,
  // which flips the winding — hence DoubleSide on the material below.
  const geometry = useMemo(
    () =>
      new THREE.RingGeometry(
        ARC_RADIUS - 0.34,
        ARC_RADIUS + 0.34,
        ARC_SEGMENTS,
        1,
        Math.PI / 2,
        -Math.PI * 2,
      ),
    [],
  )

  useFrame((state) => {
    const value = charge.current
    if (arc.current) {
      arc.current.geometry.setDrawRange(0, Math.floor(value * ARC_SEGMENTS) * 6)
    }

    const angle = Math.PI / 2 - value * Math.PI * 2
    const pulse = 0.7 + Math.sin(state.clock.elapsedTime * 5) * 0.3
    if (head.current) {
      head.current.visible = value > 0.004
      head.current.position.set(
        Math.cos(angle) * ARC_RADIUS,
        Math.sin(angle) * ARC_RADIUS,
        0.1,
      )
      head.current.scale.setScalar(0.85 + pulse * 0.3)
    }
    if (headLight.current) headLight.current.intensity = 12 + pulse * 16
  })

  return (
    <group position={[0, PORTAL_Y, -0.4]}>
      {/* the unlit track the arc runs along, so progress reads against a whole */}
      <mesh>
        <ringGeometry args={[ARC_RADIUS - 0.14, ARC_RADIUS + 0.14, 96]} />
        <meshBasicMaterial
          color="#3B2450"
          transparent
          opacity={0.5}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>

      <mesh ref={arc} geometry={geometry}>
        <meshBasicMaterial
          color={GLOW}
          transparent
          opacity={0.92}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* the welding head at the leading edge */}
      <group ref={head} visible={false}>
        <mesh>
          <sphereGeometry args={[0.62, 12, 12]} />
          <meshBasicMaterial color="#FFE6F4" toneMapped={false} />
        </mesh>
        <pointLight ref={headLight} color={GLOW} distance={22} intensity={16} />
      </group>
    </group>
  )
}

interface Block {
  angle: number
  radius: number
  width: number
  depth: number
  height: number
  threshold: number
  color: string
  spin: number
}

const SKYLINE = ['#2A2C48', '#333254', '#252A44', '#3A2E52', '#1F2440']

/**
 * The city assembling itself around the gate.
 *
 * Each block owns a slice of the bar and rises when the job crosses it, so
 * the skyline growing behind the portal is the real measure of the analysis
 * rather than decoration keyed to a timer.
 */
function RisingCity({ charge }: { charge: React.MutableRefObject<number> }) {
  const meshes = useRef<(THREE.Mesh | null)[]>([])

  const blocks = useMemo<Block[]>(() => {
    const count = 34
    return Array.from({ length: count }, (_, index) => {
      const ring = index % 2
      return {
        angle: (index / count) * Math.PI * 2 + hash(index, 3) * 0.22 + ring * 0.09,
        radius: 17 + ring * 7.5 + hash(index, 1) * 3.2,
        width: 1.6 + hash(index, 2) * 1.9,
        depth: 1.6 + hash(index, 5) * 1.9,
        height: 3 + hash(index, 4) * 9.5,
        // Keyed to index rather than angle, so the skyline closes as a ring
        // rather than sweeping round one way like a second progress bar.
        threshold: 0.04 + (index / count) * 0.86,
        color: SKYLINE[index % SKYLINE.length],
        spin: hash(index, 7) * Math.PI,
      }
    })
  }, [])

  useFrame((state) => {
    const value = charge.current
    for (let index = 0; index < blocks.length; index++) {
      const mesh = meshes.current[index]
      if (!mesh) continue
      const block = blocks[index]
      // Each block spends 12% of the bar rising, so several are always in
      // motion and the skyline never advances in visible steps.
      const raw = THREE.MathUtils.clamp((value - block.threshold) / 0.12, 0, 1)
      mesh.visible = raw > 0.001
      if (!mesh.visible) continue

      // A little overshoot on landing: the block settles instead of stopping.
      const eased = 1 - Math.pow(1 - raw, 3) + Math.sin(raw * Math.PI) * 0.05
      mesh.scale.y = Math.max(0.001, eased)
      mesh.position.y = GROUND_Y + (block.height * eased) / 2

      // Windows come on as the block tops out, then breathe.
      const material = mesh.material as THREE.MeshStandardMaterial
      material.emissiveIntensity =
        raw * raw * (0.55 + Math.sin(state.clock.elapsedTime * 1.4 + block.spin) * 0.14)
    }
  })

  return (
    <group>
      {blocks.map((block, index) => (
        <mesh
          key={index}
          ref={(node) => {
            meshes.current[index] = node
          }}
          position={[
            Math.cos(block.angle) * block.radius,
            GROUND_Y,
            Math.sin(block.angle) * block.radius,
          ]}
          rotation={[0, block.spin, 0]}
          visible={false}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[block.width, block.height, block.depth]} />
          <meshStandardMaterial
            color={block.color}
            emissive="#FF7FC4"
            emissiveIntensity={0}
            metalness={0.35}
            roughness={0.72}
          />
        </mesh>
      ))}
    </group>
  )
}

/** Sparks drawn up off the dais and into the aperture as it charges. */
function Embers({
  count = 170,
  charge,
}: {
  count?: number
  charge: React.MutableRefObject<number>
}) {
  const points = useRef<THREE.Points>(null)

  const swarm = useMemo(() => {
    const positions = new Float32Array(count * 3)
    const angles = new Float32Array(count)
    const radii = new Float32Array(count)
    const lives = new Float32Array(count)
    const speeds = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      angles[i] = Math.random() * Math.PI * 2
      radii[i] = 6 + Math.random() * 20
      lives[i] = Math.random()
      speeds[i] = 0.16 + Math.random() * 0.3
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    return { geometry, positions, angles, radii, lives, speeds }
  }, [count])

  useFrame((_, delta) => {
    const { positions, angles, radii, lives, speeds, geometry } = swarm
    const rush = 0.55 + charge.current * 1.3
    for (let i = 0; i < count; i++) {
      lives[i] += delta * speeds[i] * rush
      if (lives[i] > 1) {
        lives[i] -= 1
        angles[i] = Math.random() * Math.PI * 2
        radii[i] = 6 + Math.random() * 20
      }
      const life = lives[i]
      // Spiral in and up: the closer to the aperture, the tighter the turn.
      const angle = angles[i] + life * 1.9
      const radius = radii[i] * (1 - life * 0.72)
      positions[i * 3] = Math.cos(angle) * radius
      positions[i * 3 + 1] = GROUND_Y + life * (PORTAL_Y + 1.4)
      positions[i * 3 + 2] = Math.sin(angle) * radius
    }
    geometry.attributes.position.needsUpdate = true

    if (points.current) {
      const material = points.current.material as THREE.PointsMaterial
      material.opacity = 0.35 + charge.current * 0.4
    }
  })

  return (
    <points ref={points} geometry={swarm.geometry}>
      <pointsMaterial
        size={0.3}
        color="#FFB8E6"
        transparent
        opacity={0.5}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        sizeAttenuation
        toneMapped={false}
      />
    </points>
  )
}

/** A slow orbit that closes on the gate as the job finishes. */
function ForgeCamera({ charge }: { charge: React.MutableRefObject<number> }) {
  const camera = useThree((state) => state.camera)

  useFrame((state) => {
    const t = state.clock.elapsedTime
    const closing = charge.current
    const radius = 62 - closing * 15
    const drift = Math.sin(t * 0.11) * 0.38
    camera.position.set(
      Math.sin(drift) * radius,
      15 - closing * 2.4 + Math.sin(t * 0.42) * 0.8,
      Math.cos(drift) * radius,
    )
    camera.lookAt(0, PORTAL_Y + 0.8, 0)
  })

  return null
}

export function PortalForge({ progress }: PortalForgeProps) {
  // One eased number drives the arc, the skyline, the embers and the camera.
  // The Portal eases its own `intensity` internally, so it is handed the raw
  // target instead.
  const charge = useRef(0)
  const target = useRef(0)
  target.current = THREE.MathUtils.clamp(progress, 0, 1)

  useFrame((_, delta) => {
    charge.current += (target.current - charge.current) * Math.min(1, delta * 1.6)
  })

  return (
    <>
      <color attach="background" args={['#06060E']} />
      <fog attach="fog" args={['#0A0714', 34, 150]} />

      <ambientLight intensity={0.25} color="#8894C8" />
      <directionalLight position={[10, 18, 14]} intensity={0.7} color="#C9D4FF" />
      {/* Rim light from behind, so the machine reads against the dark. */}
      <directionalLight position={[-12, 6, -16]} intensity={0.9} color="#FF6FB5" />

      <group position={[0, PORTAL_Y, 0]}>
        {/* Tops out well short of the chamber's spun-up gate: the portal is
            not open until the city behind it actually exists. */}
        <Portal intensity={0.04 + target.current * 0.42} scale={1.12} />
      </group>

      <ProgressArc charge={charge} />

      {/* The dais, matching the chamber the visitor lands in next. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, GROUND_Y, 0]} receiveShadow>
        <circleGeometry args={[30, 48]} />
        <meshStandardMaterial color="#14121F" metalness={0.3} roughness={0.85} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, GROUND_Y + 0.06, 0]}>
        <ringGeometry args={[20, 22, 64]} />
        <meshBasicMaterial color={GLOW} transparent opacity={0.22} toneMapped={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, GROUND_Y + 0.12, 0]}>
        <ringGeometry args={[9.6, 10.4, 64]} />
        <meshBasicMaterial color="#7A4BFF" transparent opacity={0.3} toneMapped={false} />
      </mesh>

      <RisingCity charge={charge} />
      <Embers charge={charge} />
      <ForgeCamera charge={charge} />
    </>
  )
}
