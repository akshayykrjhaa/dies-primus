import { useFrame } from '@react-three/fiber'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  onReady,
}: {
  slug: string
  label: string
  color: string
  y: number
  size: number
  seed: number
  /**
   * Fired once the badge's meshes exist. The badge waits on an async texture,
   * so it mounts well after its building; without this the parent's material
   * sweep had already run and the badge kept shining at full brightness over
   * a faded building.
   */
  onReady: () => void
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

  useEffect(() => {
    if (texture) onReady()
  }, [texture, onReady])

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
 * A soft, vertically-fading gradient. Painted once and shared: it is what
 * turns the focus beam from a slab into a shaft of light.
 */
let beamTexture: THREE.CanvasTexture | null = null
function beamGradient(): THREE.CanvasTexture {
  if (beamTexture) return beamTexture
  const canvas = document.createElement('canvas')
  canvas.width = 4
  canvas.height = 128
  const ctx = canvas.getContext('2d')!
  const gradient = ctx.createLinearGradient(0, 128, 0, 0)
  gradient.addColorStop(0, 'rgba(255, 232, 150, 0.85)')
  gradient.addColorStop(0.35, 'rgba(255, 220, 120, 0.32)')
  gradient.addColorStop(1, 'rgba(255, 210, 100, 0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 4, 128)
  beamTexture = new THREE.CanvasTexture(canvas)
  beamTexture.colorSpace = THREE.SRGBColorSpace
  return beamTexture
}

/** A radial falloff, for the pool of light the beam lands in. */
let poolTexture: THREE.CanvasTexture | null = null
function poolGradient(): THREE.CanvasTexture {
  if (poolTexture) return poolTexture
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const ctx = canvas.getContext('2d')!
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  gradient.addColorStop(0, 'rgba(255, 226, 150, 0.9)')
  gradient.addColorStop(0.55, 'rgba(255, 205, 90, 0.3)')
  gradient.addColorStop(1, 'rgba(255, 195, 70, 0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 64, 64)
  poolTexture = new THREE.CanvasTexture(canvas)
  poolTexture.colorSpace = THREE.SRGBColorSpace
  return poolTexture
}

/**
 * The spotlight on the building you clicked.
 *
 * Three parts: a shaft of light rising off the roof, a pool of light on the
 * ground it stands in, and a thin ring marking the plot.
 *
 * All three used to be flat colour. The shaft was a uniformly-opaque cylinder,
 * which reads as a grey slab standing in the street rather than as light, and
 * the ground marker was an opaque yellow annulus that turned olive wherever it
 * crossed a lawn. Everything is additive now and carries a gradient, so it
 * adds light to what is underneath instead of painting over it -- and the
 * shaft fades out as it rises, which is what makes it look like a beam.
 */
function FocusBeam({ height, width }: { height: number; width: number }) {
  const beam = useRef<THREE.Mesh>(null)
  const pool = useRef<THREE.Mesh>(null)
  const ring = useRef<THREE.Mesh>(null)
  const shown = useRef(0)

  useFrame((state, delta) => {
    shown.current = Math.min(1, shown.current + delta * 2.6)
    const pulse = 0.82 + Math.sin(state.clock.elapsedTime * 2.1) * 0.18
    if (beam.current) {
      const material = beam.current.material as THREE.MeshBasicMaterial
      material.opacity = 0.26 * shown.current * pulse
      beam.current.scale.setScalar(shown.current)
    }
    if (pool.current) {
      const material = pool.current.material as THREE.MeshBasicMaterial
      material.opacity = 0.62 * shown.current * pulse
    }
    if (ring.current) {
      const material = ring.current.material as THREE.MeshBasicMaterial
      material.opacity = 0.34 * shown.current * pulse
      ring.current.rotation.z += delta * 0.35
    }
  })

  // A slim glow standing on the roof, not a column over the whole block.
  //
  // At `width * 0.5` and `height * 1.4 + 22` this was wider than the building
  // and more than twice its height -- a nine-unit, fifty-unit-tall cylinder
  // of additive light, drawn twice because it is double-sided. Close up that
  // is a pale slab across half the frame, which is what it kept reading as.
  // The ground pool and ring are the real marker; the shaft only has to say
  // "up here".
  const beamHeight = height * 0.5 + 9
  const beamRadius = Math.max(0.55, width * 0.24)

  return (
    <group>
      <mesh ref={beam} position={[0, height + beamHeight / 2, 0]}>
        <cylinderGeometry args={[beamRadius * 1.9, beamRadius, beamHeight, 16, 1, true]} />
        <meshBasicMaterial
          map={beamGradient()}
          color="#FFE9A0"
          transparent
          opacity={0}
          side={THREE.DoubleSide}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>

      {/* The pool of light it lands in. */}
      <mesh ref={pool} position={[0, LAYERS.focusHalo, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[width * 4.2, width * 4.2]} />
        <meshBasicMaterial
          map={poolGradient()}
          color="#FFD98A"
          transparent
          opacity={0}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>

      {/* A thin turning ring, so the plot itself is marked. */}
      <mesh ref={ring} position={[0, LAYERS.focusHalo, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[width * 1.15, width * 1.28, 48]} />
        <meshBasicMaterial
          color="#FFC93C"
          transparent
          opacity={0}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
    </group>
  )
}

/**
 * How far an untagged material fades in focus mode. Materials that need to
 * stay legible (window panes, lit windows) carry their own, higher floor in
 * `userData.dimTo`.
 *
 * 0.3 rather than the 0.2 this started at: below about a quarter a shell stops
 * hiding its own interior, and a tall building reads as a wireframe of its far
 * side rather than as a faded building.
 */
const DIM_FLOOR = 0.3

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
  // 1 = fully present, 0 = fully dimmed. One value drives the whole building;
  // each material decides how far back *it* goes, via `userData.dimTo`.
  const fade = useRef(1)

  const [badgeReady, setBadgeReady] = useState(false)
  const handleBadgeReady = useCallback(() => setBadgeReady(true), [])

  /**
   * Push the current fade into a set of materials.
   *
   * Shared by the per-frame easing and by the collection pass below, so a
   * material can never be left holding a stale value: whichever runs last
   * writes the same answer.
   */
  const applyFade = useCallback((list: THREE.Material[], value: number) => {
    for (const material of list) {
      const m = material as THREE.MeshLambertMaterial
      // Walls fall back furthest; windows and lit panes hold on (they carry
      // their own floor in userData -- see Archetypes.tsx). Fading every
      // material to the same value is what made the windows and lights
      // disappear the moment you focused a building.
      const floor = (m.userData.dimTo as number | undefined) ?? DIM_FLOOR
      const opacity = floor + (1 - floor) * value
      m.opacity = opacity
      m.transparent = opacity < 1
      // Depth writing stays ON while faded. With it off, every mesh in the
      // shell landed in the transparent pass sorted only by its own centre,
      // so roof slabs, interior towers and double-sided pieces drew straight
      // through the near wall -- worst on the largest buildings and worst
      // again at night, when the lit panes shine through.
      m.depthWrite = true
      // Emissive surfaces ignore opacity as far as their own brightness goes,
      // so a lit window stayed at full glow over a wall that had faded away
      // beneath it. The window materials record the glow the time of day
      // asked for; scale that by the same fade.
      m.userData.dimFactor = opacity
      const glow = m.userData.emissiveBase as number | undefined
      if (glow !== undefined) m.emissiveIntensity = glow * opacity
    }
  }, [])

  // Re-collected whenever the dim state changes *or* new meshes appear, and
  // the current fade is pushed into them immediately rather than waiting for
  // the easing loop -- which stops as soon as it reaches its target and would
  // never touch a material that arrived afterwards. `night` is deliberately
  // not a dependency: the window meshes no longer rebuild at dusk.
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
    applyFade(found, fade.current)
  }, [building.id, detail, dimmed, badgeReady, applyFade])

  useFrame((_, delta) => {
    const k = Math.min(1, delta * 8)
    const active = hovered || selected || pointed

    if (group.current) {
      const target = active ? 1.05 : 1
      const next = group.current.scale.x + (target - group.current.scale.x) * k
      group.current.scale.set(next, 1 + (next - 1) * 0.4, next)
    }

    // Focus mode fades the rest of the city back behind the building you
    // clicked. Everything eases on one value; how far back a given material
    // actually goes is its own business.
    const target = dimmed ? 0 : 1
    if (fade.current !== target) {
      // Snap once inside the threshold. A plain exponential lerp only ever
      // approaches its target, so an undimmed building settled just shy of 1
      // and stayed in the transparent pass forever.
      fade.current =
        Math.abs(fade.current - target) < 0.004
          ? target
          : fade.current + (target - fade.current) * k
      applyFade(materials.current, fade.current)
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
        onReady={handleBadgeReady}
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
