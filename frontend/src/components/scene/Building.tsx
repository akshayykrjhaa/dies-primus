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
 * Roughly how many pixels tall something of `radius` at (x, y, z) is on
 * screen.
 *
 * The whole of the city's level-of-detail rests on this one number. A city is
 * drawn as a few thousand small separate meshes -- chimneys, mullions, signs,
 * aerials, window grids, logo badges -- and from the establishing shot most of
 * them cover less than a pixel. They still cost a draw call each, which is
 * what made a large repository stutter: the frame was almost entirely spent on
 * detail nobody could see.
 *
 * Measuring in pixels rather than in world units is what makes the test
 * honest. A threshold in metres either hides trimmings on a building you are
 * standing next to or keeps drawing them right across the valley, depending on
 * the size of the repo; a threshold in pixels means the same thing at every
 * distance and in every city.
 */
function screenPixels(
  state: { camera: THREE.Camera; size: { height: number } },
  x: number,
  y: number,
  z: number,
  radius: number,
): number {
  const camera = state.camera as THREE.PerspectiveCamera
  const dx = camera.position.x - x
  const dy = camera.position.y - y
  const dz = camera.position.z - z
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz)
  if (distance < 1e-3) return Infinity
  // height / (2 tan(fov/2)) is the focal length in pixels.
  const focal = state.size.height / (2 * Math.tan((camera.fov * Math.PI) / 360))
  return (radius / distance) * focal
}

/** Below this a logo badge is a speck; it stops being drawn. */
const BADGE_MIN_PIXELS = 7
/** Below this a trimming -- a chimney, an aerial, a window grid -- is dropped. */
const TRIM_MIN_PIXELS = 3.5
/**
 * How often a building re-checks its own level of detail, in frames.
 *
 * Buildings are staggered across the cycle by their id, so the work is spread
 * evenly rather than landing on one frame in four as a spike.
 */
const LOD_PERIOD = 4

/**
 * The rotating tech badge above a roof: a cube, so whichever way it turns a
 * face with the logo is pointing at you.
 */
function LogoBadge({
  slug,
  label,
  color,
  x,
  z,
  y,
  size,
  seed,
  onReady,
}: {
  slug: string
  label: string
  color: string
  /** Where the building stands, so the range test needs no matrix walk. */
  x: number
  z: number
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

    // Badges are two draw calls each -- a cube and the pole under it -- and
    // every building in the city wears one, so in a three-hundred-file repo
    // they were six hundred draw calls on their own: a quarter of the whole
    // frame, spent on logos too small to make out. Below a few pixels the
    // badge is a speck, so it is simply not drawn.
    const shown = screenPixels(state, x, y, z, size) > BADGE_MIN_PIXELS
    if (node.visible !== shown) node.visible = shown
    if (!shown) return

    node.rotation.y += delta * 0.8
    node.position.y = y + Math.sin(state.clock.elapsedTime * 1.1 + phase) * 0.2
  })

  if (!texture) return null

  return (
    <group ref={group} position={[0, y, 0]}>
      <mesh userData={{ badge: true }}>
        <boxGeometry args={[size, size, size]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
      <mesh position={[0, -size * 0.85, 0]} userData={{ badge: true }}>
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
/**
 * The shaft's gradient: soft at both sides, fading out as it rises.
 *
 * Two dimensions matter. Vertical is obvious -- light thins out with height.
 * Horizontal is the one that was missing: a cylinder always has a hard
 * rectangular silhouette however faint you make it, which is why the beam kept
 * reading as a pale slab standing in the street. Fading the *sides* to nothing
 * is what gives it an edge you cannot point at.
 */
let beamTexture: THREE.CanvasTexture | null = null
function beamGradient(): THREE.CanvasTexture {
  if (beamTexture) return beamTexture
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 128
  const ctx = canvas.getContext('2d')!

  const vertical = ctx.createLinearGradient(0, 128, 0, 0)
  vertical.addColorStop(0, 'rgba(255, 234, 160, 1)')
  vertical.addColorStop(0.4, 'rgba(255, 222, 130, 0.4)')
  vertical.addColorStop(1, 'rgba(255, 212, 105, 0)')
  ctx.fillStyle = vertical
  ctx.fillRect(0, 0, 64, 128)

  // Cut the sides away with a horizontal falloff.
  const sides = ctx.createLinearGradient(0, 0, 64, 0)
  sides.addColorStop(0, 'rgba(0,0,0,1)')
  sides.addColorStop(0.22, 'rgba(0,0,0,0)')
  sides.addColorStop(0.78, 'rgba(0,0,0,0)')
  sides.addColorStop(1, 'rgba(0,0,0,1)')
  ctx.globalCompositeOperation = 'destination-out'
  ctx.fillStyle = sides
  ctx.fillRect(0, 0, 64, 128)
  ctx.globalCompositeOperation = 'source-over'

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

  const facing = useMemo(
    () => ({ world: new THREE.Vector3(), quaternion: new THREE.Quaternion(), euler: new THREE.Euler() }),
    [],
  )

  // The spotlight drives its own opacity every frame, and its pieces are
  // additive with depth writing off. Claim them so the building's dim sweep
  // leaves them alone -- see `applyFade`.
  useEffect(() => {
    for (const node of [beam.current, pool.current, ring.current]) {
      if (node) (node.material as THREE.Material).userData.selfLit = true
    }
  }, [])

  useFrame((state, delta) => {
    shown.current = Math.min(1, shown.current + delta * 2.6)
    const pulse = 0.82 + Math.sin(state.clock.elapsedTime * 2.1) * 0.18
    if (beam.current) {
      const material = beam.current.material as THREE.MeshBasicMaterial
      material.opacity = 0.42 * shown.current * pulse
      beam.current.scale.setScalar(shown.current)

      // Billboard, but only about the vertical axis: a shaft of light should
      // turn to face you, never tip over. The building group carries its own
      // rotation, so the camera bearing is taken in world space and the
      // parent's is subtracted back off.
      beam.current.getWorldPosition(facing.world)
      const bearing = Math.atan2(
        state.camera.position.x - facing.world.x,
        state.camera.position.z - facing.world.z,
      )
      const parent = beam.current.parent
      let parentBearing = 0
      if (parent) {
        parent.getWorldQuaternion(facing.quaternion)
        parentBearing = facing.euler.setFromQuaternion(facing.quaternion, 'YXZ').y
      }
      beam.current.rotation.y = bearing - parentBearing
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

  // A slim shaft standing on the roof, not a column over the whole block.
  // The ground pool and ring are the real marker; this only has to say
  // "up here".
  const beamHeight = height * 0.55 + 11
  const beamWidth = Math.max(1.6, width * 0.85)

  return (
    <group>
      {/* A single card that turns to face you, rather than a cylinder.
          
          No matter how narrow or faint a cylinder is, you are still looking at
          a tube: it has a hard rectangular outline and two visible walls, and
          it kept reading as a slab. One camera-facing quad with a gradient
          that dies away at both sides has no silhouette to give it away, and
          costs a single triangle pair. */}
      <mesh ref={beam} position={[0, height + beamHeight / 2, 0]}>
        <planeGeometry args={[beamWidth, beamHeight]} />
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
  /**
   * The trimmings, with the radius each one covers, for the level-of-detail
   * pass. The building's main volumes are deliberately excluded: a silhouette
   * that blinks out is far worse than a chimney that does.
   */
  const trim = useRef<Array<{ mesh: THREE.Mesh; radius: number }>>([])
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
      // Anything that animates its own opacity is off limits -- the focus
      // beam's three additive pieces live inside this same group.
      if (material.userData.selfLit) continue
      const m = material as THREE.MeshLambertMaterial

      // Remember how it started, once, so releasing focus restores it
      // exactly. Some materials are already translucent by design -- the
      // logo badge's texture has an alpha channel -- and must not be forced
      // opaque on the way back.
      if (m.userData.wasTransparent === undefined) {
        m.userData.wasTransparent = m.transparent
        m.userData.wasDepthWrite = m.depthWrite
        m.userData.wasOpacity = m.opacity
      }

      // Walls fall back furthest; windows and lit panes hold on, so a faded
      // building still reads as a building rather than a blank slab.
      const floor = (m.userData.dimTo as number | undefined) ?? DIM_FLOOR
      const fade = floor + (1 - floor) * value

      if (value >= 1) {
        m.opacity = m.userData.wasOpacity as number
        m.transparent = m.userData.wasTransparent as boolean
        m.depthWrite = m.userData.wasDepthWrite as boolean
      } else {
        m.opacity = fade * (m.userData.wasOpacity as number)
        m.transparent = true
        // Depth writing OFF while faded, and this is the whole trick.
        //
        // With it on, a faded building's near wall still writes depth, so
        // everything behind it -- the building you actually selected, other
        // faded buildings, the city -- is depth-rejected and simply
        // disappears. That is what made this look broken from some angles and
        // fine from others: it depended entirely on which surface happened to
        // be drawn first.
        //
        // With it off nothing can be rejected, so the fade is real see-through
        // glass from every angle. The cost is that a faded building shows a
        // little of its own interior, which is exactly what a ghosted object
        // is supposed to look like.
        m.depthWrite = false
      }

      // Emissive ignores opacity as far as its own brightness goes, so a lit
      // window would keep shining out of a building that had faded away.
      m.userData.dimFactor = fade
      const glow = m.userData.emissiveBase as number | undefined
      if (glow !== undefined) m.emissiveIntensity = glow * fade
    }
  }, [])

  // Re-collected whenever the dim state changes *or* new meshes appear, and
  // the current fade is pushed into them immediately rather than waiting for
  // the easing loop -- which stops as soon as it reaches its target and would
  // never touch a material that arrived afterwards. `night` is deliberately
  // not a dependency: the window meshes no longer rebuild at dusk.
  useEffect(() => {
    const found: THREE.Material[] = []
    const parts: Array<{ mesh: THREE.Mesh; radius: number }> = []
    let largest = 0

    group.current?.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (!mesh.isMesh || !mesh.material) return
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const material of list) found.push(material)

      // The badge drives its own visibility on its own range, and the focus
      // beam only ever exists on a building you are standing in front of.
      // Neither wants a second opinion.
      if (mesh.userData.badge || list.some((m) => m.userData.selfLit)) return
      const geometry = mesh.geometry
      if (!geometry.boundingSphere) geometry.computeBoundingSphere()
      const radius = (geometry.boundingSphere?.radius ?? 0) * Math.max(
        mesh.scale.x,
        mesh.scale.y,
        mesh.scale.z,
      )
      if (radius > largest) largest = radius
      parts.push({ mesh, radius })
    })

    materials.current = found
    // Anything under a third of the building's own extent is a trimming. The
    // shell's main volumes stay drawn at every distance, so a building never
    // changes shape as you approach -- only the things standing on it appear.
    const cut = largest * 0.34
    trim.current = parts.filter((part) => part.radius < cut)
    for (const part of parts) if (part.radius >= cut) part.mesh.visible = true
    applyFade(found, fade.current)
  }, [building.id, detail, dimmed, badgeReady, applyFade])

  const lodTick = useRef(building.seed % LOD_PERIOD)

  useFrame((state, delta) => {
    const k = Math.min(1, delta * 8)
    const active = hovered || selected || pointed

    if (group.current) {
      const target = active ? 1.05 : 1
      const current = group.current.scale.x
      // Settled buildings -- almost all of them, almost all of the time --
      // skip the write entirely rather than lerping the last thousandth
      // forever.
      if (Math.abs(current - target) > 0.0015) {
        const next =
          Math.abs(current - target) < 0.0015 ? target : current + (target - current) * k
        group.current.scale.set(next, 1 + (next - 1) * 0.4, next)
      } else if (current !== target) {
        group.current.scale.set(target, 1, target)
      }
    }

    // Level of detail. Only a quarter of the city re-checks on any one frame,
    // and the check is a handful of arithmetic per trimming.
    if (++lodTick.current % LOD_PERIOD === 0) {
      const parts = trim.current
      if (parts.length > 0) {
        for (const part of parts) {
          const pixels = screenPixels(
            state,
            building.x,
            building.height * 0.5,
            building.z,
            part.radius,
          )
          const shown = pixels > TRIM_MIN_PIXELS
          if (part.mesh.visible !== shown) part.mesh.visible = shown
        }
      }
    }

    // Focus mode fades the rest of the city back behind the building you
    // clicked. Everything eases on one value; how far back a given material
    // actually goes is its own business.
    const target = dimmed ? 0 : 1
    const moving = fade.current !== target
    if (moving) {
      // Snap once inside the threshold. A plain exponential lerp only ever
      // approaches its target, so an undimmed building settled just shy of 1
      // and stayed in the transparent pass forever.
      fade.current =
        Math.abs(fade.current - target) < 0.004
          ? target
          : fade.current + (target - fade.current) * k
    }
    // Written every frame while anything is faded, not only while the value
    // is still moving. The easing loop used to stop the instant it reached
    // its target, so any material that appeared or was replaced *after* that
    // -- a window set rebuilt by a change in the time of day, a logo badge
    // finishing its texture load -- was never touched again and stayed at
    // full strength over a building that had faded behind it. Skipped
    // entirely at rest, which is the common case, so it costs nothing.
    if (moving || fade.current !== 1) applyFade(materials.current, fade.current)

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
        x={building.x}
        z={building.z}
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
