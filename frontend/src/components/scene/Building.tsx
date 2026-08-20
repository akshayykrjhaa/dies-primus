import { useFrame } from '@react-three/fiber'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'

import { letterTexture, logoTexture } from '../../lib/logos'
import { LAYERS } from '../../lib/layers'
import type { Building as BuildingModel } from '../../types'
import { Shell } from './Archetypes'

interface Props {
  building: BuildingModel
  hovered: boolean
  selected: boolean
  pointed: boolean
  dimmed: boolean
  detail: boolean
  /** 0 = daylight, 1 = full dark. Turns the windows on. */
  night: number
  onHover: (building: BuildingModel | null) => void
  onSelect: (building: BuildingModel) => void
}

/**
 * The rotating tech badge above a roof: a cube, so whichever way it turns a
 * face with the logo is pointing at you.
 */
function LogoBadge({
  slug,
  label,
  color,
  y,
  size,
  seed,
}: {
  slug: string
  label: string
  color: string
  y: number
  size: number
  seed: number
}) {
  const group = useRef<THREE.Group>(null)
  const [texture, setTexture] = useState<THREE.Texture | null>(null)

  useEffect(() => {
    let alive = true
    logoTexture(slug).then((loaded) => {
      if (alive) setTexture(loaded ?? letterTexture(label, color))
    })
    return () => {
      alive = false
    }
  }, [slug, label, color])

  const phase = useMemo(() => (seed % 628) / 100, [seed])

  useFrame((state, delta) => {
    const node = group.current
    if (!node) return
    node.rotation.y += delta * 0.8
    node.position.y = y + Math.sin(state.clock.elapsedTime * 1.1 + phase) * 0.2
  })

  if (!texture) return null

  return (
    <group ref={group} position={[0, y, 0]}>
      <mesh>
        <boxGeometry args={[size, size, size]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
      <mesh position={[0, -size * 0.85, 0]}>
        <cylinderGeometry args={[size * 0.03, size * 0.03, size * 0.8, 5]} />
        <meshBasicMaterial color={color} />
      </mesh>
    </group>
  )
}

/**
 * The beam that rises off the building you clicked. Additive blending and a
 * cone that fades upward reads as light rather than as geometry.
 */
function FocusBeam({ height, width }: { height: number; width: number }) {
  const beam = useRef<THREE.Mesh>(null)
  const halo = useRef<THREE.Mesh>(null)
  const shown = useRef(0)

  useFrame((state, delta) => {
    shown.current = Math.min(1, shown.current + delta * 2.6)
    const pulse = 0.78 + Math.sin(state.clock.elapsedTime * 2.1) * 0.22
    if (beam.current) {
      const material = beam.current.material as THREE.MeshBasicMaterial
      material.opacity = 0.24 * shown.current * pulse
      beam.current.scale.setScalar(shown.current)
    }
    if (halo.current) {
      const material = halo.current.material as THREE.MeshBasicMaterial
      material.opacity = 0.6 * shown.current * pulse
      halo.current.rotation.z += delta * 0.5
    }
  })

  const beamHeight = height * 2 + 30

  return (
    <group>
      <mesh ref={beam} position={[0, height + beamHeight / 2, 0]}>
        <cylinderGeometry args={[width * 1.4, width * 0.7, beamHeight, 18, 1, true]} />
        <meshBasicMaterial
          color="#FFE066"
          transparent
          opacity={0}
          side={THREE.DoubleSide}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
      <mesh ref={halo} position={[0, LAYERS.focusHalo, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[width * 0.9, width * 1.3, 40]} />
        <meshBasicMaterial
          color="#FFC93C"
          transparent
          opacity={0}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  )
}

function BuildingImpl({
  building,
  hovered,
  selected,
  pointed,
  dimmed,
  detail,
  night,
  onHover,
  onSelect,
}: Props) {
  const group = useRef<THREE.Group>(null)
  const marker = useRef<THREE.Group>(null)

  // Dimming touches every material in the shell, so it is applied by walking
  // the group rather than by threading a prop through each archetype.
  const materials = useRef<THREE.Material[]>([])
  const opacity = useRef(1)

  useEffect(() => {
    const found: THREE.Material[] = []
    group.current?.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (mesh.isMesh && mesh.material) {
        const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        for (const material of list) found.push(material)
      }
    })
    materials.current = found
  }, [building.id, detail, night])

  useFrame((_, delta) => {
    const k = Math.min(1, delta * 8)
    const active = hovered || selected || pointed

    if (group.current) {
      const target = active ? 1.05 : 1
      const next = group.current.scale.x + (target - group.current.scale.x) * k
      group.current.scale.set(next, 1 + (next - 1) * 0.4, next)
    }

    const targetOpacity = dimmed ? 0.2 : 1
    if (Math.abs(opacity.current - targetOpacity) > 0.005) {
      opacity.current += (targetOpacity - opacity.current) * k
      for (const material of materials.current) {
        const m = material as THREE.MeshLambertMaterial
        m.opacity = opacity.current
        m.transparent = opacity.current < 0.985
        m.depthWrite = opacity.current > 0.6
      }
    }

    if (marker.current) {
      marker.current.rotation.y += delta * 1.5
      marker.current.position.y =
        building.height + 6 + Math.sin(performance.now() / 380) * 0.5
    }
  })

  return (
    <group
      ref={group}
      position={[building.x, 0, building.z]}
      rotation={[0, building.rotation, 0]}
      onPointerOver={(event) => {
        event.stopPropagation()
        onHover(building)
      }}
      onPointerOut={(event) => {
        event.stopPropagation()
        onHover(null)
      }}
      onClick={(event) => {
        event.stopPropagation()
        onSelect(building)
      }}
    >
      <Shell building={building} detail={detail} night={night} />

      {/* Every building wears the logo of the tech it belongs to. */}
      <LogoBadge
        slug={building.iconSlug}
        label={building.ext.replace('.', '') || building.language}
        color={building.languageColor}
        y={building.height + Math.max(2.6, building.width * 0.7)}
        size={Math.min(2.2, Math.max(1.35, building.width * 0.32))}
        seed={building.seed}
      />

      {(pointed || selected) && (
        <group ref={marker} position={[0, building.height + 6, 0]}>
          <mesh rotation={[Math.PI, 0, 0]}>
            <coneGeometry args={[0.7, 1.8, 5]} />
            <meshBasicMaterial color={selected ? '#FFC93C' : '#FF7A45'} toneMapped={false} />
          </mesh>
        </group>
      )}

      {selected && <FocusBeam height={building.height} width={building.width} />}
    </group>
  )
}

export const BuildingMesh = memo(BuildingImpl)
