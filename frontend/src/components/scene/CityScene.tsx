import { OrbitControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import {
  MutableRefObject,
  RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import * as THREE from 'three'

import { daylight, hoursForMode, type Daylight, type TimeMode } from '../../lib/daylight'
import { LAYERS } from '../../lib/layers'
import type { Building, CityData, District } from '../../types'
import { Birds } from './Birds'
import { Landscape, mountainPlacements, PEAK_BASE_Y, type Peak } from './Landscape'
import { BuildingMesh } from './Building'
import { DistrictPlot } from './District'
import { Entrance } from './Entrance'
import { Pedestrians } from './Pedestrians'
import { CityProps } from './Props'
import { Traffic } from './Traffic'
import { Roads } from './Roads'

export interface FocusRequest {
  x: number
  y: number
  z: number
  distance: number
  key: number
  /**
   * Keep the viewer's current bearing when flying in. Clicking a building
   * should bring you closer from wherever you were standing, not swing you
   * round to a fixed "front"; the gate and overview shots want their own
   * framing and leave this off.
   */
  preserveBearing?: boolean
  /**
   * An explicit compass bearing (radians, 0 = looking north / -Z) and pitch
   * to approach from. The guided tour and the navigation globe both need to
   * *choose* an angle rather than inherit one -- the tour because sampling
   * the live camera mid-flight gave it a different arbitrary angle at every
   * hop, the globe because pointing at "north" has to mean north.
   */
  azimuth?: number
  pitch?: number
  /**
   * Place the camera at once rather than flying it there.
   *
   * Arrival used this: the city mounted wherever the camera happened to be
   * and then flew to the establishing shot, so stepping through the gate gave
   * you a lurch across the map on the very frame the whole city was being
   * built. Landing already framed means the first thing drawn is the shot you
   * are meant to see.
   */
  immediate?: boolean
}

export interface ZoomRequest {
  factor: number
  key: number
}

export interface CameraPose {
  x: number
  z: number
  angle: number
}

interface Props {
  data: CityData
  hovered: Building | null
  selected: Building | null
  pointedId: string | null
  activeDistrict: string | null
  matchIds: Set<string> | null
  focus: FocusRequest | null
  zoom: ZoomRequest | null
  hoverAnchor: RefObject<HTMLDivElement>
  cameraPose: MutableRefObject<CameraPose>
  /** Set while the compass is dragged; see `BearingDriver`. */
  bearingDrag: MutableRefObject<number | null>
  briefingOpen: boolean
  timeMode: TimeMode
  touring: boolean
  onHover: (building: Building | null) => void
  onSelect: (building: Building) => void
  onDistrictFocus: (district: District) => void
  onOpenBriefing: () => void
  onBackgroundClick: () => void
  onLeaveSelected: () => void
}

/** Flies the camera to a requested point, then hands control back to the user. */
function CameraRig({ focus }: { focus: FocusRequest | null }) {
  const controls = useThree((state) => state.controls) as any
  const camera = useThree((state) => state.camera)
  const goal = useRef<{ position: THREE.Vector3; target: THREE.Vector3 } | null>(null)
  const ease = useRef(0)

  useEffect(() => {
    if (!focus) return
    ease.current = 0
    const target = new THREE.Vector3(focus.x, focus.y, focus.z)

    let direction: THREE.Vector3
    if (focus.azimuth !== undefined) {
      // Explicit angle: spherical phi is measured from +Y, theta around it.
      const spherical = new THREE.Spherical(
        1,
        THREE.MathUtils.clamp(focus.pitch ?? 1.0, 0.25, 1.45),
        focus.azimuth,
      )
      direction = new THREE.Vector3().setFromSpherical(spherical).normalize()
    } else if (focus.preserveBearing && controls?.target) {
      // Reuse the current offset, so the approach comes from the side the
      // viewer is already on. Only the pitch is clamped, so a click from a
      // near-overhead or ground-level angle still ends up readable.
      const offset = camera.position.clone().sub(controls.target)
      if (offset.lengthSq() < 1e-4) offset.set(0.62, 0.55, 1)
      const spherical = new THREE.Spherical().setFromVector3(offset)
      spherical.phi = THREE.MathUtils.clamp(spherical.phi, 0.62, 1.32)
      spherical.radius = 1
      direction = new THREE.Vector3().setFromSpherical(spherical).normalize()
    } else {
      direction = new THREE.Vector3(0.62, 0.55, 1).normalize()
    }

    const position = target.clone().add(direction.multiplyScalar(focus.distance))

    if (focus.immediate) {
      camera.position.copy(position)
      if (controls?.target) {
        controls.target.copy(target)
        controls.update()
      }
      goal.current = null
      return
    }

    goal.current = { target, position }
  }, [focus, camera, controls])

  useFrame((_, delta) => {
    if (!goal.current || !controls) return

    // Ease in as well as out. A plain exponential lerp starts at full speed,
    // so every fly-to began with a lurch; ramping the rate up over the first
    // third of a second gives the move a gentle departure and still lands
    // softly, and the rate is frame-rate independent either way.
    ease.current = Math.min(1, ease.current + delta * 3.2)
    const shaped = ease.current * ease.current * (3 - 2 * ease.current) // smoothstep
    const k = 1 - Math.pow(0.0025, delta * shaped)

    camera.position.lerp(goal.current.position, k)
    controls.target.lerp(goal.current.target, k)
    controls.update()

    // Hand back to the user only once both the eye and what it is looking at
    // have arrived -- releasing on position alone left the target still
    // drifting, which read as a slow slide after the move had "finished".
    const settled =
      camera.position.distanceTo(goal.current.position) < 0.5 &&
      controls.target.distanceTo(goal.current.target) < 0.5
    if (settled) goal.current = null
  })

  return null
}

/** Smooth dolly for the on-screen zoom buttons. */
function ZoomController({ zoom }: { zoom: ZoomRequest | null }) {
  const controls = useThree((state) => state.controls) as any
  const camera = useThree((state) => state.camera)
  const goal = useRef<THREE.Vector3 | null>(null)

  useEffect(() => {
    if (!zoom || !controls) return
    const target = controls.target as THREE.Vector3
    const offset = camera.position.clone().sub(target)
    const distance = THREE.MathUtils.clamp(
      offset.length() * zoom.factor,
      controls.minDistance ?? 8,
      controls.maxDistance ?? 1200,
    )
    goal.current = target.clone().add(offset.setLength(distance))
  }, [zoom, controls, camera])

  useFrame((_, delta) => {
    if (!goal.current) return
    const k = 1 - Math.pow(0.004, delta)
    camera.position.lerp(goal.current, k)
    controls?.update()
    if (camera.position.distanceTo(goal.current) < 0.3) goal.current = null
  })

  return null
}

/**
 * Closes the file panel once you genuinely leave the building behind.
 *
 * This is the reason focus "stopped working". The radius used to be
 * `height * 2.4 + 70`, which for an ordinary five-unit building is about
 * eighty units -- less than half the width of a modest city. Pulling back to
 * see the building in context, or orbiting around it, crossed that line and
 * silently dropped the selection: the whole city un-dimmed and the spotlight
 * vanished, mid-look, with nothing to explain it. Both symptoms at once,
 * intermittently, and always *after* it had been working.
 *
 * The radius now scales with the city rather than with one building, so it
 * only fires when you have actually flown away, and it has to hold for a
 * moment before it counts -- a brief overshoot while orbiting is not leaving.
 */
function ProximityWatcher({
  selected,
  enabled,
  span,
  onLeave,
}: {
  selected: Building | null
  /** Off while the guided tour is driving; it moves you on purpose. */
  enabled: boolean
  /** The city's larger dimension; the keep-radius is measured against it. */
  span: number
  onLeave: () => void
}) {
  const camera = useThree((state) => state.camera)
  const armed = useRef(false)
  const outFor = useRef(0)
  const position = useMemo(() => new THREE.Vector3(), [])

  useEffect(() => {
    armed.current = false
    outFor.current = 0
  }, [selected, enabled])

  useFrame((_, delta) => {
    if (!selected || !enabled) return
    position.set(selected.x, selected.height * 0.5, selected.z)
    const distance = camera.position.distanceTo(position)
    const keepRadius = Math.max(span * 0.85, selected.height * 3 + 130)

    if (!armed.current) {
      if (distance < keepRadius * 0.6) armed.current = true
      return
    }
    if (distance > keepRadius) {
      // Has to stay out there, not just clip the boundary on the way past.
      outFor.current += delta
      if (outFor.current > 0.8) {
        armed.current = false
        outFor.current = 0
        onLeave()
      }
    } else {
      outFor.current = 0
    }
  })

  return null
}

/** Projects the hovered building into screen space for the floating label. */
function HoverProjector({
  building,
  anchor,
}: {
  building: Building | null
  anchor: RefObject<HTMLDivElement>
}) {
  const camera = useThree((state) => state.camera)
  const size = useThree((state) => state.size)
  const vector = useMemo(() => new THREE.Vector3(), [])

  useFrame(() => {
    const element = anchor.current
    if (!element || !building) return
    vector.set(building.x, building.height + 4, building.z).project(camera)
    const x = Math.min(Math.max(((vector.x + 1) / 2) * size.width, 120), size.width - 120)
    const y = Math.min(Math.max(((1 - vector.y) / 2) * size.height, 90), size.height - 40)
    element.style.setProperty('--hover-x', `${x}px`)
    element.style.setProperty('--hover-y', `${y}px`)
    element.dataset.behind = vector.z > 1 ? 'true' : 'false'
  })

  return null
}

/**
 * Applies the time of day to the scene, easing between values so the change
 * across a keyframe boundary is a slow shift rather than a cut.
 */
function DaylightRig({ sky, sun, hemi }: {
  sky: Daylight
  sun: RefObject<THREE.DirectionalLight>
  hemi: RefObject<THREE.HemisphereLight>
}) {
  const scene = useThree((state) => state.scene)

  useFrame((_, delta) => {
    const k = Math.min(1, delta * 1.4)

    if (scene.background instanceof THREE.Color) {
      scene.background.lerp(sky.skyColor, k)
    }
    if (scene.fog) scene.fog.color.lerp(sky.fogColor, k)

    if (sun.current) {
      sun.current.color.lerp(sky.sunColor, k)
      sun.current.intensity += (sky.sunIntensity - sun.current.intensity) * k
    }
    if (hemi.current) {
      hemi.current.color.lerp(sky.hemiSky, k)
      hemi.current.groundColor.lerp(sky.hemiGround, k)
      hemi.current.intensity += (sky.hemiIntensity - hemi.current.intensity) * k
    }
  })

  return null
}

/**
 * The moon: a disc high in the sky, with a soft halo around it.
 *
 * Drawn far out and unlit, so it reads as a light source rather than a
 * sphere in the scene, and parented to the camera's target distance so it
 * never falls outside the far plane. It fades in with `moonUp`, alongside the
 * window lights and the street lamps.
 */
/** How high the moon *disc* hangs, in radians above the horizon. */
const MOON_ELEVATION = 0.17

function Moon({ sky, span }: { sky: Daylight; span: number }) {
  const camera = useThree((state) => state.camera)
  const group = useRef<THREE.Group>(null)
  const disc = useRef<THREE.MeshBasicMaterial>(null)
  const halo = useRef<THREE.MeshBasicMaterial>(null)
  const shown = useRef(0)

  useFrame((_, delta) => {
    // Ease, so the moon rises with the rest of the night rather than blinking
    // into existence when the clock ticks past a keyframe.
    shown.current += (sky.moonUp - shown.current) * Math.min(1, delta * 1.6)
    if (disc.current) disc.current.opacity = shown.current
    if (halo.current) halo.current.opacity = shown.current * 0.32
    if (group.current) {
      group.current.visible = shown.current > 0.01
      // Only the moon's *bearing* comes from the light vector; its height in
      // the sky is chosen for framing. The two have to be decoupled: the key
      // light wants to be high (a low moon rakes the city and leaves half of
      // every building black), but the establishing shot looks slightly down,
      // so a disc placed at the light's own elevation sits above the frame
      // and is never seen. Low and far puts it over the range at the back.
      //
      // Positioned relative to the *camera*, like the celestial body it is
      // pretending to be. Anchored to the world it sat at a fixed point, so
      // orbiting to the far side of the valley pushed it past the far plane
      // and it vanished mid-pan -- and its elevation drifted as you moved.
      // Camera-relative, it holds the same place in the sky from everywhere,
      // and can never be clipped.
      const bearing = Math.atan2(sky.moon.x, sky.moon.z)
      const distance = span * 3.6
      const flat = Math.cos(MOON_ELEVATION) * distance
      group.current.position.set(
        camera.position.x + Math.sin(bearing) * flat,
        camera.position.y + Math.sin(MOON_ELEVATION) * distance,
        camera.position.z + Math.cos(bearing) * flat,
      )
    }
  })

  const size = span * 0.14

  return (
    <group ref={group}>
      <mesh>
        <sphereGeometry args={[size, 24, 16]} />
        <meshBasicMaterial ref={disc} color="#F2F6FF" transparent opacity={0} fog={false} toneMapped={false} />
      </mesh>
      {/* Halo: a bigger, additive shell so the moon glows into the sky. */}
      <mesh>
        <sphereGeometry args={[size * 2.1, 20, 12]} />
        <meshBasicMaterial
          ref={halo}
          color="#9FB6F0"
          transparent
          opacity={0}
          side={THREE.BackSide}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          fog={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  )
}

/**
 * Lets the compass swing the camera around the city, one-to-one with the drag.
 *
 * The globe's N/E/S/W buttons ask for a *fly-to*, which eases over about a
 * second -- right for a click, useless for a drag, where the view has to
 * follow the pointer. This drives the camera directly instead: it keeps the
 * orbit target, the distance and the pitch exactly as they are and rewrites
 * only the compass bearing, which is precisely what dragging with the mouse in
 * the scene does.
 */
function BearingDriver({ bearing }: { bearing: MutableRefObject<number | null> }) {
  const camera = useThree((state) => state.camera)
  const controls = useThree((state) => state.controls) as any
  const spherical = useMemo(() => new THREE.Spherical(), [])
  const offset = useMemo(() => new THREE.Vector3(), [])

  useFrame(() => {
    const heading = bearing.current
    if (heading === null || !controls) return

    offset.copy(camera.position).sub(controls.target)
    spherical.setFromVector3(offset)
    // The camera stands on the far side of its target from the way it looks,
    // so the orbit angle is the heading turned through half a circle.
    spherical.theta = heading - Math.PI
    camera.position.copy(controls.target).add(offset.setFromSpherical(spherical))
    controls.update()
  })

  return null
}

/**
 * Fades everything inside it back while a building holds the focus.
 *
 * Dimming used to reach only the buildings, so clicking one left the streets,
 * trees, lamps, traffic and people at full brightness -- most of what is
 * actually on screen at street level. The city did not visibly recede, which
 * is why focus mode looked as though it were not working at all.
 *
 * Materials are collected by walking the group, the same approach the
 * buildings use, because these are instanced meshes owned by several
 * different components and there is no prop to thread through them.
 */
function Recede({ active, floor, children }: {
  active: boolean
  /** How far back this content goes: 0 is invisible, 1 is untouched. */
  floor: number
  children: React.ReactNode
}) {
  const group = useRef<THREE.Group>(null)
  const materials = useRef<THREE.Material[]>([])
  const fade = useRef(1)

  const apply = useCallback(
    (list: THREE.Material[], value: number) => {
      const opacity = floor + (1 - floor) * value
      for (const material of list) {
        // Street lamps, vehicle lamps and birds animate their own opacity
        // every frame. Writing to them here does not dim them -- it just
        // means whichever loop runs last that frame wins, which reads as a
        // flicker. Leave them to their owners.
        if (material.userData.selfLit) continue

        if (material.userData.wasTransparent === undefined) {
          material.userData.wasTransparent = material.transparent
          material.userData.wasDepthWrite = material.depthWrite
          material.userData.wasOpacity = material.opacity
        }

        if (value >= 1) {
          material.opacity = material.userData.wasOpacity as number
          material.transparent = material.userData.wasTransparent as boolean
          material.depthWrite = material.userData.wasDepthWrite as boolean
        } else {
          material.opacity = opacity * (material.userData.wasOpacity as number)
          material.transparent = true
          // Off while faded, for the same reason the buildings do it: depth
          // writing on a faded surface rejects whatever is behind it rather
          // than letting it show through.
          material.depthWrite = false
        }
      }
    },
    [floor],
  )

  useEffect(() => {
    const found: THREE.Material[] = []
    group.current?.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (!mesh.isMesh || !mesh.material) return
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const material of list) found.push(material)
    })
    materials.current = found
    apply(found, fade.current)
  }, [active, apply, children])

  useFrame((_, delta) => {
    const target = active ? 0 : 1
    const moving = fade.current !== target
    if (moving) {
      fade.current =
        Math.abs(fade.current - target) < 0.004
          ? target
          : fade.current + (target - fade.current) * Math.min(1, delta * 8)
    }
    // Written every frame while receded, not only while the value is moving:
    // the same staleness that bit the buildings applies here, and traffic and
    // pedestrians rebuild their meshes far more often than a building does.
    if (moving || fade.current !== 1) apply(materials.current, fade.current)
  })

  return <group ref={group}>{children}</group>
}

/**
 * Keeps the camera inside the valley.
 *
 * Nothing stopped it flying into a mountain, and the peaks are cones lit from
 * outside -- so once you were inside one, backface culling hid the near wall
 * and you were left staring at the far interior wall: a flat grey screen with
 * the city somewhere behind it. Orbiting round the back of the range was the
 * same story with the mountain in the way.
 *
 * Each peak is treated as a cone that narrows with height, and the camera is
 * pushed back out along the shortest horizontal line if it gets inside one.
 * `PEAK_SPREAD` is the fudge factor: a peak's drawn silhouette is wider than
 * its nominal radius because the ridged displacement pushes vertices outward,
 * by up to about 1.9x at the base, so the collision volume has to be wider
 * than the cylinder the geometry started from or you can still clip a ridge.
 *
 * The floor clamp is the same problem from below -- dropping under the
 * snowfield puts you inside the world looking up at its underside.
 */
const PEAK_SPREAD = 1.55
const PEAK_MARGIN = 2.5

function ValleyGuard({ peaks }: { peaks: Peak[] }) {
  const camera = useThree((state) => state.camera)
  const controls = useThree((state) => state.controls) as any

  useFrame(() => {
    let moved = false

    const floor = LAYERS.snow + 4
    if (camera.position.y < floor) {
      camera.position.y = floor
      moved = true
    }

    /** True while the camera is inside any peak's collision cone. */
    const buried = () => {
      for (const peak of peaks) {
        const rise = (camera.position.y - PEAK_BASE_Y) / peak.height
        if (rise >= 1) continue
        const keep =
          peak.radius * PEAK_SPREAD * (1 - Math.max(0, rise)) + PEAK_MARGIN
        const dx = camera.position.x - peak.x
        const dz = camera.position.z - peak.z
        if (dx * dx + dz * dz < keep * keep) return true
      }
      return false
    }

    // Resolved over a few passes. Peaks overlap where a ridge runs into its
    // neighbour, and pushing clear of one can push you straight into the next
    // -- a single sweep leaves you inside the second one.
    for (let pass = 0; pass < 6; pass++) {
      let hit = false
      for (const peak of peaks) {
        const dx = camera.position.x - peak.x
        const dz = camera.position.z - peak.z
        const distance = Math.hypot(dx, dz)

        // How wide the cone still is at the height the camera is flying at.
        const rise = (camera.position.y - PEAK_BASE_Y) / peak.height
        if (rise >= 1) continue // above the summit; nothing to hit
        const keep =
          peak.radius * PEAK_SPREAD * (1 - Math.max(0, rise)) + PEAK_MARGIN
        if (distance >= keep) continue

        // Push straight out. Dead centre has no outward direction, so pick one.
        const nx = distance > 1e-3 ? dx / distance : 1
        const nz = distance > 1e-3 ? dz / distance : 0
        camera.position.x = peak.x + nx * keep
        camera.position.z = peak.z + nz * keep
        hit = true
        moved = true
      }
      if (!hit) break
    }

    // A crevice where three ridges meet can bounce the camera between them
    // forever, so there is a fallback with a guaranteed answer: walk back
    // toward the middle of the valley, which is the one place no peak stands.
    if (buried()) {
      for (let step = 0; step < 24 && buried(); step++) {
        camera.position.x *= 0.9
        camera.position.z *= 0.9
        moved = true
      }
    }

    if (moved) controls?.update()
  })

  return null
}

/** Reports the camera position for the minimap without re-rendering React. */
function PoseReporter({ pose }: { pose: MutableRefObject<CameraPose> }) {
  const camera = useThree((state) => state.camera)
  const controls = useThree((state) => state.controls) as any

  useFrame(() => {
    pose.current.x = camera.position.x
    pose.current.z = camera.position.z
    const target = controls?.target
    pose.current.angle = target
      ? Math.atan2(target.x - camera.position.x, target.z - camera.position.z)
      : 0
  })
  return null
}

export function CityScene({
  data,
  hovered,
  selected,
  pointedId,
  activeDistrict,
  matchIds,
  focus,
  zoom,
  hoverAnchor,
  cameraPose,
  bearingDrag,
  briefingOpen,
  timeMode,
  touring,
  onHover,
  onSelect,
  onDistrictFocus,
  onOpenBriefing,
  onBackgroundClick,
  onLeaveSelected,
}: Props) {
  const span = Math.max(data.bounds.width, data.bounds.depth, 60)

  // The visitor's real clock drives the scene. Re-read it every 20 seconds;
  // DaylightRig eases between the values so nothing snaps.
  const [sky, setSky] = useState<Daylight>(() => daylight(hoursForMode(timeMode)))
  useEffect(() => {
    setSky(daylight(hoursForMode(timeMode)))
    if (timeMode !== 'auto') return
    const timer = window.setInterval(() => setSky(daylight(hoursForMode('auto'))), 20000)
    return () => window.clearInterval(timer)
  }, [timeMode])
  const night = sky.night

  // Shared with the landscape, so the guard blocks the peaks that were drawn.
  const peaks = useMemo(
    () => mountainPlacements(span, data.entrance.z),
    [span, data.entrance.z],
  )

  const sunRef = useRef<THREE.DirectionalLight>(null)
  const hemiRef = useRef<THREE.HemisphereLight>(null)

  // Big cities drop the small trimmings so the frame rate holds.
  const detail = data.buildings.length <= 170
  // District plates are read from much closer in a small city.
  const labelScale = Math.max(16, Math.min(52, span / 4))

  return (
    <>
      <color attach="background" args={[sky.skyColor.getHex()]} />
      {/* Fog is tuned to swallow the edge of the valley floor, so the city
          sits among mountains instead of on a visible white tabletop. It has
          to finish inside the camera's far plane (span * 5.6) or the furthest
          peaks reach full clip while still half visible. */}
      <fog attach="fog" args={[sky.fogColor.getHex(), span * 1.7, span * 4.6]} />

      <hemisphereLight
        ref={hemiRef}
        args={[sky.hemiSky.getHex(), sky.hemiGround.getHex(), sky.hemiIntensity]}
      />
      {/* The key light: the sun by day, the moon after dark. `sky.key` already
          carries the blend, and unlike the raw sun vector it never dips toward
          the horizon -- which is what used to leave night faces unlit. */}
      <directionalLight
        ref={sunRef}
        position={[
          sky.key.x * span * 0.9,
          Math.max(span * 0.3, sky.key.y * span * 0.9),
          sky.key.z * span * 0.9,
        ]}
        intensity={sky.sunIntensity}
        color={sky.sunColor.getHex()}
        castShadow
        // The shadow map is a second full pass over every caster in the city,
        // and its cost is the map's area. A large repo already has three times
        // the geometry to push through it, so it takes the smaller map: the
        // shadow camera covers the whole valley either way, which means even
        // 2048 was only ever giving a large city about half a metre per texel.
        // Dropping to 1024 softens an edge nobody was reading as sharp.
        shadow-mapSize-width={detail ? 2048 : 1024}
        shadow-mapSize-height={detail ? 2048 : 1024}
        shadow-camera-near={1}
        shadow-camera-far={span * 3.2}
        shadow-camera-left={-span * 0.8}
        shadow-camera-right={span * 0.8}
        shadow-camera-top={span * 0.8}
        shadow-camera-bottom={-span * 0.8}
        shadow-bias={-0.0006}
        shadow-normalBias={0.05}
      />
      {/* A soft counter-fill from the far side. One key light, however high,
          still leaves the faces turned away from it black; at night that read
          as half of every building missing. Intensity is nearly zero by day,
          where the sky already does this job. */}
      <directionalLight
        position={[-sky.key.x * span, span * 0.45, -sky.key.z * span]}
        intensity={0.1 + sky.night * 0.55}
        color={sky.hemiSky.getHex()}
      />
      <Moon sky={sky} span={span} />
      <DaylightRig sky={sky} sun={sunRef} hemi={hemiRef} />

      {/* The glacier valley: snowfield, meltwater river and peaks, all sized
          from the city so a small repo gets a small valley. */}
      <Landscape span={span} night={night} entranceZ={data.entrance.z} />

      {/* Birds turning over the valley by day; the sky empties after dusk. */}
      <Birds span={span} night={night} />

      {/* An invisible catcher so clicking empty ground still dismisses panels. */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.55, 0]}
        onClick={onBackgroundClick}
      >
        <planeGeometry args={[span * 5, span * 5]} />
        <meshBasicMaterial visible={false} />
      </mesh>

      {/* The street network steps back in tone rather than in opacity.
          Fading it meant turning depth writing off, which let the asphalt be
          drawn over its own kerbs and markings -- the streets lost every
          feature they had the moment you selected a building. See `RECEDE` in
          Roads.tsx. Losing the street grid entirely would leave the focused
          building floating in the dark with no city around it anyway. */}
      <Roads roads={data.roads ?? []} night={night} dim={selected !== null} />

      {/* The furniture does still fade: trees, lamps, traffic and people are
          standing objects that can genuinely get between you and the building
          you clicked, which is the one thing transparency is for here. */}
      <Recede active={selected !== null} floor={0.34}>
        <CityProps props={data.props ?? []} night={night} />
        {/* Traffic drives lanes derived from the road network; people live on
            the district plots. Both are decoration, both are instanced. */}
        <Traffic roads={data.roads ?? []} span={span} night={night} />
        <Pedestrians districts={data.districts} span={span} />
      </Recede>

      {data.districts.map((district) => (
        <DistrictPlot
          key={district.id}
          district={district}
          active={activeDistrict === district.path}
          muted={selected !== null && district.path !== selected.district}
          labelScale={labelScale}
          onFocus={onDistrictFocus}
        />
      ))}

      {data.buildings.map((building) => (
        <BuildingMesh
          key={building.id}
          building={building}
          hovered={hovered?.id === building.id}
          selected={selected?.id === building.id}
          pointed={pointedId === building.id}
          detail={detail}
          night={night}
          // Focus mode: clicking a building fades the rest of the city out.
          dimmed={
            (selected !== null && selected.id !== building.id) ||
            (matchIds !== null && !matchIds.has(building.id))
          }
          onHover={onHover}
          onSelect={onSelect}
        />
      ))}

      <Entrance
        repo={data.repo}
        position={data.entrance}
        cityDepth={data.bounds.depth}
        onOpenBriefing={onOpenBriefing}
        briefingOpen={briefingOpen}
      />

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.055}
        rotateSpeed={0.95}
        panSpeed={1.1}
        screenSpacePanning={false}
        enableZoom
        zoomSpeed={1.0}
        zoomToCursor
        minDistance={16}
        maxDistance={span * 1.9}
        maxPolarAngle={Math.PI / 2.15}
        target={[0, 4, 0]}
      />
      <ValleyGuard peaks={peaks} />
      <CameraRig focus={focus} />
      <BearingDriver bearing={bearingDrag} />
      <ZoomController zoom={zoom} />
      <ProximityWatcher
        selected={selected}
        enabled={!touring}
        span={span}
        onLeave={onLeaveSelected}
      />
      <HoverProjector building={hovered} anchor={hoverAnchor} />
      <PoseReporter pose={cameraPose} />
    </>
  )
}
