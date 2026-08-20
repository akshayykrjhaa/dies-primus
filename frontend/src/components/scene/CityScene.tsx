import { OrbitControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import {
  MutableRefObject,
  RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import * as THREE from 'three'

import { daylight, hoursForMode, type Daylight, type TimeMode } from '../../lib/daylight'
import type { Building, CityData, District } from '../../types'
import { Landscape } from './Landscape'
import { BuildingMesh } from './Building'
import { DistrictPlot } from './District'
import { Entrance } from './Entrance'
import { CityProps } from './Props'
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

    goal.current = {
      target,
      position: target.clone().add(direction.multiplyScalar(focus.distance)),
    }
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
 * Closes the file panel once you pull away from the building it belongs to.
 * Hysteresis stops a nudge near the edge from flickering it.
 */
function ProximityWatcher({
  selected,
  enabled,
  onLeave,
}: {
  selected: Building | null
  /** Off while the guided tour is driving; it moves you on purpose. */
  enabled: boolean
  onLeave: () => void
}) {
  const camera = useThree((state) => state.camera)
  const armed = useRef(false)
  const position = useMemo(() => new THREE.Vector3(), [])

  useEffect(() => {
    armed.current = false
  }, [selected, enabled])

  useFrame(() => {
    if (!selected || !enabled) return
    position.set(selected.x, selected.height * 0.5, selected.z)
    const distance = camera.position.distanceTo(position)
    const keepRadius = selected.height * 2.4 + 70

    if (!armed.current) {
      if (distance < keepRadius * 0.72) armed.current = true
      return
    }
    if (distance > keepRadius) {
      armed.current = false
      onLeave()
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
          sits among mountains instead of on a visible white tabletop. */}
      <fog attach="fog" args={[sky.fogColor.getHex(), span * 1.5, span * 4.2]} />

      <hemisphereLight
        ref={hemiRef}
        args={[sky.hemiSky.getHex(), sky.hemiGround.getHex(), sky.hemiIntensity]}
      />
      <directionalLight
        ref={sunRef}
        position={[
          sky.sun.x * span * 0.9,
          Math.max(span * 0.12, sky.sun.y * span * 0.9),
          sky.sun.z * span * 0.9,
        ]}
        intensity={sky.sunIntensity}
        color={sky.sunColor.getHex()}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={1}
        shadow-camera-far={span * 3.2}
        shadow-camera-left={-span * 0.8}
        shadow-camera-right={span * 0.8}
        shadow-camera-top={span * 0.8}
        shadow-camera-bottom={-span * 0.8}
        shadow-bias={-0.0006}
        shadow-normalBias={0.05}
      />
      <DaylightRig sky={sky} sun={sunRef} hemi={hemiRef} />

      {/* The glacier valley: snowfield, meltwater river and peaks, all sized
          from the city so a small repo gets a small valley. */}
      <Landscape span={span} night={night} entranceZ={data.entrance.z} />

      {/* An invisible catcher so clicking empty ground still dismisses panels. */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.55, 0]}
        onClick={onBackgroundClick}
      >
        <planeGeometry args={[span * 5, span * 5]} />
        <meshBasicMaterial visible={false} />
      </mesh>

      <Roads roads={data.roads ?? []} night={night} />
      <CityProps props={data.props ?? []} night={night} />

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
      <CameraRig focus={focus} />
      <ZoomController zoom={zoom} />
      <ProximityWatcher selected={selected} enabled={!touring} onLeave={onLeaveSelected} />
      <HoverProjector building={hovered} anchor={hoverAnchor} />
      <PoseReporter pose={cameraPose} />
    </>
  )
}
