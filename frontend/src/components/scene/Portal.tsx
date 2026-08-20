import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'

import { vortexTexture } from '../../lib/vortex'

/**
 * The gate you step through to enter a repository.
 *
 * Modelled here in three.js rather than loaded: the Sketchfab reference cannot
 * be fetched at runtime (downloads need an account and the asset is licensed),
 * so the silhouette is rebuilt from primitives — an armoured ring of plates
 * around a spinning vortex, orange coolant pipes arcing into a machine base,
 * and a stair up to the threshold.
 *
 * `intensity` drives the whole thing: 0 is idle, 1 is fully spun up as the
 * camera dives through. Everything that animates reads from it, so the warp
 * is one number rather than a dozen tweens.
 */

const HULL = '#5C6180'
const HULL_DARK = '#3E4260'
const PIPE = '#C86A2E'
const PIPE_DARK = '#8E4A20'
const STEEL = '#8D93A8'
const GLOW = '#FF2E88'

export interface PortalProps {
  /** 0 = idle hum, 1 = fully charged. */
  intensity?: number
  scale?: number
}

/** The armoured plates ringing the aperture. */
function RingPlates({ radius }: { radius: number }) {
  const plates = useMemo(
    () =>
      // Uneven arc lengths and gaps: a perfectly regular ring reads as CAD.
      [
        { start: -0.28, span: 0.5, depth: 1.5, out: 1.16 },
        { start: 0.34, span: 0.44, depth: 1.2, out: 1.1 },
        { start: 0.9, span: 0.62, depth: 1.6, out: 1.2 },
        { start: 1.62, span: 0.4, depth: 1.1, out: 1.08 },
        { start: 2.12, span: 0.58, depth: 1.5, out: 1.17 },
        { start: 2.82, span: 0.46, depth: 1.25, out: 1.12 },
        { start: 3.4, span: 0.6, depth: 1.55, out: 1.18 },
        { start: 4.12, span: 0.42, depth: 1.15, out: 1.09 },
        { start: 4.66, span: 0.56, depth: 1.45, out: 1.16 },
        { start: 5.34, span: 0.5, depth: 1.3, out: 1.12 },
      ],
    [],
  )

  return (
    <group>
      {plates.map((plate, index) => (
        <mesh
          key={index}
          rotation={[0, 0, plate.start]}
          castShadow
          receiveShadow
        >
          <torusGeometry
            args={[radius * plate.out, radius * 0.1 * plate.depth, 6, 14, plate.span]}
          />
          <meshStandardMaterial
            color={index % 3 === 0 ? STEEL : HULL}
            metalness={0.75}
            roughness={0.42}
          />
        </mesh>
      ))}
    </group>
  )
}

/** Coolant pipes looping from the base up into the ring. */
function Pipes({ radius }: { radius: number }) {
  const arcs = useMemo(
    () => [
      { x: -1, tilt: 0.5, r: radius * 0.52, y: -radius * 0.72, z: 0.35 },
      { x: 1, tilt: -0.5, r: radius * 0.52, y: -radius * 0.72, z: 0.35 },
      { x: -1, tilt: 0.9, r: radius * 0.36, y: -radius * 0.95, z: -0.2 },
      { x: 1, tilt: -0.9, r: radius * 0.36, y: -radius * 0.95, z: -0.2 },
    ],
    [radius],
  )

  return (
    <group>
      {arcs.map((arc, index) => (
        <group
          key={index}
          position={[arc.x * radius * 0.62, arc.y, arc.z]}
          rotation={[Math.PI / 2, 0, arc.tilt]}
        >
          <mesh castShadow receiveShadow>
            <torusGeometry args={[arc.r, radius * 0.085, 8, 18, Math.PI * 1.15]} />
            <meshStandardMaterial color={PIPE} metalness={0.5} roughness={0.55} />
          </mesh>
          {/* collar where the pipe meets the hull */}
          <mesh position={[arc.r, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[radius * 0.11, radius * 0.11, radius * 0.1, 10]} />
            <meshStandardMaterial color={PIPE_DARK} metalness={0.6} roughness={0.5} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

/** The two capped cylinders flanking the ring, glowing from within. */
function Canisters({ radius, glow }: { radius: number; glow: React.MutableRefObject<number> }) {
  const left = useRef<THREE.MeshStandardMaterial>(null)
  const right = useRef<THREE.MeshStandardMaterial>(null)

  useFrame(() => {
    const value = 0.9 + glow.current * 2.6
    if (left.current) left.current.emissiveIntensity = value
    if (right.current) right.current.emissiveIntensity = value
  })

  return (
    <group>
      {[-1, 1].map((side, index) => (
        <group
          key={side}
          position={[side * radius * 1.16, -radius * 0.5, -radius * 0.1]}
          rotation={[0, 0, side * -0.5]}
        >
          <mesh castShadow>
            <cylinderGeometry args={[radius * 0.19, radius * 0.19, radius * 0.42, 12]} />
            <meshStandardMaterial color={HULL_DARK} metalness={0.7} roughness={0.4} />
          </mesh>
          {/* the lit window in the canister */}
          <mesh position={[0, radius * 0.02, 0]}>
            <cylinderGeometry args={[radius * 0.2, radius * 0.2, radius * 0.22, 12]} />
            <meshStandardMaterial
              ref={index === 0 ? left : right}
              color={GLOW}
              emissive={GLOW}
              emissiveIntensity={1.2}
              toneMapped={false}
            />
          </mesh>
          <mesh position={[0, radius * 0.23, 0]}>
            <cylinderGeometry args={[radius * 0.21, radius * 0.21, radius * 0.06, 12]} />
            <meshStandardMaterial color={STEEL} metalness={0.8} roughness={0.35} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

/** Machine housing, footing pads and the stair up to the threshold. */
function Base({ radius }: { radius: number }) {
  const y = -radius * 1.16

  return (
    <group>
      {/* main housing */}
      <mesh position={[0, y, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[radius * 0.92, radius * 1.02, radius * 0.44, 14]} />
        <meshStandardMaterial color={HULL} metalness={0.65} roughness={0.48} />
      </mesh>
      <mesh position={[0, y - radius * 0.24, 0]} castShadow>
        <cylinderGeometry args={[radius * 1.0, radius * 0.86, radius * 0.16, 14]} />
        <meshStandardMaterial color={HULL_DARK} metalness={0.7} roughness={0.45} />
      </mesh>

      {/* vent panel on the front */}
      <mesh position={[0, y + radius * 0.1, radius * 0.94]} castShadow>
        <boxGeometry args={[radius * 0.5, radius * 0.3, radius * 0.08]} />
        <meshStandardMaterial color={HULL_DARK} metalness={0.6} roughness={0.6} />
      </mesh>
      {[-0.09, -0.03, 0.03, 0.09].map((offset) => (
        <mesh
          key={offset}
          position={[0, y + radius * (0.1 + offset), radius * 0.99]}
        >
          <boxGeometry args={[radius * 0.44, radius * 0.02, radius * 0.02]} />
          <meshStandardMaterial color="#22242F" metalness={0.4} roughness={0.8} />
        </mesh>
      ))}

      {/* footing pads */}
      {[-1, 1].map((side) =>
        [-1, 1].map((front) => (
          <group
            key={`${side}${front}`}
            position={[side * radius * 0.86, y - radius * 0.5, front * radius * 0.5]}
          >
            <mesh castShadow receiveShadow>
              <cylinderGeometry args={[radius * 0.24, radius * 0.27, radius * 0.3, 10]} />
              <meshStandardMaterial color={HULL_DARK} metalness={0.7} roughness={0.45} />
            </mesh>
            <mesh position={[0, -radius * 0.17, 0]}>
              <cylinderGeometry args={[radius * 0.3, radius * 0.3, radius * 0.06, 10]} />
              <meshStandardMaterial color={STEEL} metalness={0.75} roughness={0.4} />
            </mesh>
          </group>
        )),
      )}

      {/* stair up to the aperture */}
      {Array.from({ length: 6 }).map((_, index) => (
        <mesh
          key={index}
          position={[0, y - radius * 0.42 + index * radius * 0.11, radius * (1.5 - index * 0.1)]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[radius * 0.46, radius * 0.06, radius * 0.16]} />
          <meshStandardMaterial color="#4A3B46" metalness={0.35} roughness={0.7} />
        </mesh>
      ))}
      {[-1, 1].map((side) => (
        <mesh
          key={side}
          position={[side * radius * 0.26, y - radius * 0.16, radius * 1.28]}
          rotation={[0.52, 0, 0]}
        >
          <boxGeometry args={[radius * 0.03, radius * 0.03, radius * 0.72]} />
          <meshStandardMaterial color="#3A2F38" metalness={0.4} roughness={0.7} />
        </mesh>
      ))}
    </group>
  )
}

export function Portal({ intensity = 0, scale = 1 }: PortalProps) {
  const radius = 6
  const swirl = useRef<THREE.Mesh>(null)
  const swirlBack = useRef<THREE.Mesh>(null)
  const rim = useRef<THREE.MeshBasicMaterial>(null)
  const light = useRef<THREE.PointLight>(null)
  const charge = useRef(0)

  const texture = useMemo(() => vortexTexture(), [])
  const backTexture = useMemo(() => {
    const clone = texture.clone()
    clone.needsUpdate = true
    return clone
  }, [texture])

  useFrame((state, delta) => {
    // Ease toward the requested intensity so the spin-up is never a jump.
    charge.current += (intensity - charge.current) * Math.min(1, delta * 3.2)
    const spin = 0.22 + charge.current * 3.4
    const pulse = 0.85 + Math.sin(state.clock.elapsedTime * 2.4) * 0.15

    if (swirl.current) {
      const material = swirl.current.material as THREE.MeshBasicMaterial
      material.map!.rotation -= delta * spin
      material.opacity = 0.92
      swirl.current.scale.setScalar(1 + charge.current * 0.08)
    }
    if (swirlBack.current) {
      const material = swirlBack.current.material as THREE.MeshBasicMaterial
      material.map!.rotation += delta * spin * 0.55
      material.opacity = 0.5 + charge.current * 0.3
    }
    if (rim.current) {
      rim.current.opacity = (0.5 + charge.current * 0.5) * pulse
    }
    if (light.current) {
      light.current.intensity = (28 + charge.current * 220) * pulse
    }
  })

  return (
    <group scale={scale}>
      {/* the vortex itself: two counter-rotating discs for parallax */}
      <mesh ref={swirlBack} position={[0, 0, -0.5]}>
        <circleGeometry args={[radius * 0.92, 48]} />
        <meshBasicMaterial
          map={backTexture}
          transparent
          opacity={0.6}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <mesh ref={swirl}>
        <circleGeometry args={[radius * 0.89, 48]} />
        <meshBasicMaterial
          map={texture}
          transparent
          opacity={0.92}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>

      {/* hot rim around the aperture */}
      <mesh position={[0, 0, 0.06]}>
        <ringGeometry args={[radius * 0.87, radius * 0.97, 64]} />
        <meshBasicMaterial
          ref={rim}
          color={GLOW}
          transparent
          opacity={0.7}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>
      <pointLight ref={light} color={GLOW} distance={radius * 12} intensity={30} />

      {/* the machine */}
      <RingPlates radius={radius} />
      <Pipes radius={radius} />
      <Canisters radius={radius} glow={charge} />
      <Base radius={radius} />
    </group>
  )
}
