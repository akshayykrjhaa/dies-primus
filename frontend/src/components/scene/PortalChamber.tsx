import { useFrame, useThree } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'

import { Portal } from './Portal'

/**
 * The antechamber: a dark void holding nothing but the portal.
 *
 * The city is not mounted while this is on screen, so there is genuinely
 * nothing behind the gate — you have to step through it. When `warping` turns
 * true the camera dives into the aperture and the vortex spins up, which is
 * the handover the white flash then covers.
 */

export interface PortalChamberProps {
  warping: boolean
  title: string
}

/** Slow-drifting motes so the void has depth and scale. */
function Dust({ count = 220 }: { count?: number }) {
  const points = useRef<THREE.Points>(null)

  const geometry = useMemo(() => {
    const positions = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      const radius = 12 + Math.random() * 60
      const angle = Math.random() * Math.PI * 2
      positions[i * 3] = Math.cos(angle) * radius
      positions[i * 3 + 1] = -14 + Math.random() * 46
      positions[i * 3 + 2] = Math.sin(angle) * radius - 10
    }
    const buffer = new THREE.BufferGeometry()
    buffer.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    return buffer
  }, [count])

  useFrame((state, delta) => {
    if (points.current) {
      points.current.rotation.y += delta * 0.03
      points.current.position.y = Math.sin(state.clock.elapsedTime * 0.3) * 0.6
    }
  })

  return (
    <points ref={points} geometry={geometry}>
      <pointsMaterial
        size={0.34}
        color="#FFB8E6"
        transparent
        opacity={0.5}
        depthWrite={false}
        sizeAttenuation
      />
    </points>
  )
}

/** Drives the camera: an idle drift, then the dive through the aperture. */
function ChamberCamera({ warping }: { warping: boolean }) {
  const camera = useThree((state) => state.camera)
  const progress = useRef(0)
  const start = useMemo(() => new THREE.Vector3(0, 12, 46), [])

  useFrame((state, delta) => {
    if (!warping) {
      // Gentle approach and sway while the visitor decides.
      progress.current = Math.max(0, progress.current - delta * 0.9)
      const t = state.clock.elapsedTime
      camera.position.set(
        start.x + Math.sin(t * 0.32) * 2.6,
        start.y + Math.sin(t * 0.44) * 0.7,
        start.z - Math.sin(t * 0.22) * 1.4,
      )
      camera.lookAt(0, 12.5, 0)
      return
    }

    // Accelerating dive: slow lean-in, then a rush through the ring.
    progress.current = Math.min(1, progress.current + delta * 0.62)
    const eased = Math.pow(progress.current, 2.4)
    camera.position.lerp(new THREE.Vector3(0, 11, -6), Math.min(1, eased * 0.9 + delta))
    camera.lookAt(0, 11, -30)
  })

  return null
}

export function PortalChamber({ warping }: PortalChamberProps) {
  const intensity = warping ? 1 : 0.12

  return (
    <>
      <color attach="background" args={['#06060E']} />
      <fog attach="fog" args={['#0A0714', 30, 130]} />

      <ambientLight intensity={0.25} color="#8894C8" />
      <directionalLight position={[10, 18, 14]} intensity={0.7} color="#C9D4FF" />
      {/* Rim light from behind, so the machine reads against the dark. */}
      <directionalLight position={[-12, 6, -16]} intensity={0.9} color="#FF6FB5" />

      <group position={[0, 11, 0]}>
        <Portal intensity={intensity} scale={1.12} />
      </group>

      {/* The dais the portal stands on. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.4, 0]} receiveShadow>
        <circleGeometry args={[26, 48]} />
        <meshStandardMaterial color="#14121F" metalness={0.3} roughness={0.85} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.34, 0]}>
        <ringGeometry args={[20, 22, 64]} />
        <meshBasicMaterial color="#FF2E88" transparent opacity={0.32} toneMapped={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.28, 0]}>
        <ringGeometry args={[9.6, 10.4, 64]} />
        <meshBasicMaterial color="#7A4BFF" transparent opacity={0.35} toneMapped={false} />
      </mesh>

      <Dust />
      <ChamberCamera warping={warping} />
    </>
  )
}
