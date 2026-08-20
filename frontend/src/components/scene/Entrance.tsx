import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import * as THREE from 'three'

import { LAYERS } from '../../lib/layers'
import type { RepoMeta } from '../../types'
import { Portal } from './Portal'

interface Props {
  repo: RepoMeta
  position: { x: number; z: number; scale?: number; road?: number }
  cityDepth: number
  onOpenBriefing: () => void
  briefingOpen: boolean
}

/**
 * The city gate: the portal you arrived through, still humming, at the head of
 * an approach road.
 *
 * Everything here scales with the city. A nine-file town was getting the same
 * full-size portal and 12-unit boulevard as a 300-file metropolis, which left
 * the gate looking marooned in a field beside the thing it was meant to serve.
 *
 * The heights are also deliberate: the approach road sits *above* the
 * generated street network rather than level with it. The two used to share
 * y = 0.02 exactly, and coplanar surfaces are what set the road flickering
 * where it met the plaza.
 */
export function Entrance({ repo, position, cityDepth, onOpenBriefing, briefingOpen }: Props) {
  const glow = useRef<THREE.Mesh>(null)

  const scale = position.scale ?? 1
  const roadWidth = position.road ?? 11.5
  // Reach from the plaza back toward the city's outer avenue, no further.
  const roadLength = Math.max(22, cityDepth * 0.12 + 24) * (0.6 + scale * 0.4)
  const plazaRadius = 6.5 + 5 * scale
  // The portal's footing sits ~11 units below its origin at scale 1.
  const portalY = 11 * scale + 0.24

  useFrame(({ clock }) => {
    if (glow.current) {
      const material = glow.current.material as THREE.MeshBasicMaterial
      material.opacity = 0.32 + Math.sin(clock.elapsedTime * 1.6) * 0.14
    }
  })

  return (
    <group position={[position.x, 0, position.z]}>
      {/* Approach road running north into the city */}
      <mesh position={[0, LAYERS.approachRoad, -roadLength / 2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[roadWidth, roadLength]} />
        <meshLambertMaterial color="#4A4F58" />
      </mesh>
      <mesh position={[0, LAYERS.approachMarking, -roadLength / 2]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.42, roadLength * 0.9]} />
        <meshBasicMaterial color="#F2E9C9" transparent opacity={0.9} />
      </mesh>

      {/* Plaza */}
      <mesh position={[0, LAYERS.plaza, 2 * scale]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[plazaRadius, 48]} />
        <meshLambertMaterial color="#C6CBD2" />
      </mesh>
      <mesh ref={glow} position={[0, LAYERS.plazaRing, 2 * scale]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[plazaRadius * 0.85, plazaRadius * 0.96, 48]} />
        <meshBasicMaterial color="#E8A33D" transparent opacity={0.4} />
      </mesh>

      {/* The portal you arrived through. */}
      <group position={[0, portalY, 2 * scale]} scale={scale}>
        <Portal intensity={0.1} />
      </group>

      {/* A single soft bounce light so the gate reads against the sky */}
      <pointLight
        position={[0, portalY, 8 * scale]}
        intensity={30 * scale}
        distance={48 * scale}
        color="#FFE9C9"
      />

      <Html
        position={[0, portalY + 10 * scale, 2 * scale]}
        center
        // The sign is read from the arrival shot, which now sits closer for
        // small cities — so its apparent size has to follow the gate too.
        distanceFactor={8 + 26 * scale}
        zIndexRange={[30, 20]}
      >
        <button
          className={`gate-sign${briefingOpen ? ' gate-sign--open' : ''}`}
          onClick={(event) => {
            event.stopPropagation()
            onOpenBriefing()
          }}
        >
          <span className="gate-sign__eyebrow">Welcome to</span>
          <span className="gate-sign__name">{repo.name}</span>
          <span className="gate-sign__cta">
            {briefingOpen ? 'Hide the briefing' : 'Read the project briefing'}
          </span>
        </button>
      </Html>
    </group>
  )
}
