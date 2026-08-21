import { Billboard } from '@react-three/drei'
import { Canvas, useFrame } from '@react-three/fiber'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'

import { BODY_SHADES, type Mood, PALETTE, RoofTopper, supportsWebGL, toonRamp, windowTexture } from './toonKit'

/**
 * A decorative, self-contained cartoon skyline behind the hero — a
 * toon-shaded preview of the real product, not the product. Deliberately
 * does not touch components/scene/* (the real city renderer): no
 * building-data model, no devicon texture fetches, no layers table.
 *
 * Reads `mood` to swap between the Night City and Day Pop atmospheres —
 * sky, sun/moon, lighting and how the building windows are lit all flip,
 * but it's the same building kit and camera rig either way.
 */

const TOWER_COUNT = 20
// Buildings read as bright candy blocks with pale glassy window panes in
// daylight — the inverse of a night skyline's dark body + lit windows.
const GLASS_TINT = 'rgba(255, 255, 255, 0.55)'

function moonTexture(): THREE.CanvasTexture {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const grad = ctx.createRadialGradient(size / 2, size / 2, size * 0.14, size / 2, size / 2, size * 0.5)
  grad.addColorStop(0, 'rgba(255,249,230,1)')
  grad.addColorStop(0.55, 'rgba(255,240,200,0.9)')
  grad.addColorStop(1, 'rgba(255,240,200,0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)
  ctx.fillStyle = 'rgba(230, 210, 170, 0.55)'
  ;[
    [size * 0.38, size * 0.4, size * 0.07],
    [size * 0.6, size * 0.55, size * 0.05],
    [size * 0.46, size * 0.62, size * 0.035],
  ].forEach(([x, y, r]) => {
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  })
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function sunTexture(): THREE.CanvasTexture {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const cx = size / 2
  const cy = size / 2

  ctx.strokeStyle = 'rgba(255, 201, 60, 0.55)'
  ctx.lineWidth = 7
  ctx.lineCap = 'round'
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2
    const r1 = size * 0.28
    const r2 = size * 0.46
    ctx.beginPath()
    ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1)
    ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2)
    ctx.stroke()
  }

  const grad = ctx.createRadialGradient(cx, cy, size * 0.02, cx, cy, size * 0.27)
  grad.addColorStop(0, 'rgba(255,252,235,1)')
  grad.addColorStop(0.7, 'rgba(255,224,140,1)')
  grad.addColorStop(1, 'rgba(255,201,60,0.9)')
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.arc(cx, cy, size * 0.24, 0, Math.PI * 2)
  ctx.fill()

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function skyTexture(mood: Mood): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 2
  canvas.height = 160
  const ctx = canvas.getContext('2d')!
  const grad = ctx.createLinearGradient(0, 0, 0, 160)
  if (mood === 'day') {
    grad.addColorStop(0, '#3a9bf0')
    grad.addColorStop(0.45, '#7ec8f5')
    grad.addColorStop(0.78, '#bfe6ff')
    grad.addColorStop(1, '#ffd9c2')
  } else {
    grad.addColorStop(0, '#120f2c')
    grad.addColorStop(0.5, '#291a52')
    grad.addColorStop(0.82, '#5c2566')
    grad.addColorStop(1, '#8a3566')
  }
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 2, 160)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function SkyDome({ mood }: { mood: Mood }) {
  const texture = useMemo(() => skyTexture(mood), [mood])
  return (
    <mesh renderOrder={-10}>
      <sphereGeometry args={[190, 24, 16]} />
      <meshBasicMaterial map={texture} side={THREE.BackSide} depthWrite={false} fog={false} />
    </mesh>
  )
}

/** The sky's one big light source — a sun by day, a moon by night. */
function Skybody({ mood }: { mood: Mood }) {
  const texture = useMemo(() => (mood === 'day' ? sunTexture() : moonTexture()), [mood])
  const position: [number, number, number] = mood === 'day' ? [30, 46, -70] : [-34, 42, -70]
  return (
    <Billboard position={position}>
      <mesh>
        <circleGeometry args={[mood === 'day' ? 17 : 16, 32]} />
        <meshBasicMaterial map={texture} transparent depthWrite={false} fog={false} toneMapped={false} />
      </mesh>
    </Billboard>
  )
}

interface CloudPuff {
  x: number
  y: number
  z: number
  scale: number
  speed: number
}

function Cloud({ x, y, z, scale, speed, color }: CloudPuff & { color: string }) {
  const group = useRef<THREE.Group>(null)

  useFrame((_, delta) => {
    const node = group.current
    if (!node) return
    node.position.x += delta * speed
    if (node.position.x > 90) node.position.x = -90
  })

  return (
    <group ref={group} position={[x, y, z]} scale={scale}>
      <mesh position={[0, 0, 0]}>
        <sphereGeometry args={[3.2, 8, 6]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      <mesh position={[3.4, -0.4, 0]}>
        <sphereGeometry args={[2.4, 8, 6]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      <mesh position={[-3.2, -0.3, 0.2]}>
        <sphereGeometry args={[2.2, 8, 6]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
    </group>
  )
}

function DriftingClouds({ mood }: { mood: Mood }) {
  const puffs = useMemo<CloudPuff[]>(
    () => [
      { x: -50, y: 30, z: -55, scale: 1.6, speed: 0.7 },
      { x: 10, y: 38, z: -68, scale: 1.1, speed: 0.5 },
      { x: 55, y: 26, z: -50, scale: 1.9, speed: 0.4 },
      { x: -20, y: 22, z: -40, scale: 0.9, speed: 0.9 },
    ],
    [],
  )
  const color = mood === 'day' ? '#ffffff' : '#e7defd'

  return (
    <group>
      {puffs.map((puff, i) => (
        <Cloud key={i} {...puff} color={color} />
      ))}
    </group>
  )
}

interface Bird {
  x: number
  y: number
  z: number
  speed: number
  phase: number
}

/** A few flying-bird silhouettes, daytime only. */
function Birds() {
  const group = useRef<THREE.Group>(null)
  const birds = useMemo<Bird[]>(
    () => [
      { x: -30, y: 20, z: -30, speed: 3.2, phase: 0 },
      { x: -22, y: 23, z: -32, speed: 3.2, phase: 0.6 },
      { x: 18, y: 27, z: -36, speed: 2.4, phase: 1.4 },
    ],
    [],
  )

  useFrame((state, delta) => {
    const node = group.current
    if (!node) return
    node.children.forEach((child, i) => {
      const b = birds[i]
      child.position.x += delta * b.speed
      if (child.position.x > 70) child.position.x = -70
      child.position.y = b.y + Math.sin(state.clock.elapsedTime * 3 + b.phase) * 0.6
    })
  })

  return (
    <group ref={group}>
      {birds.map((b, i) => (
        <mesh key={i} position={[b.x, b.y, b.z]}>
          <coneGeometry args={[0.5, 1.1, 3]} />
          <meshBasicMaterial color="#12101f" toneMapped={false} />
        </mesh>
      ))}
    </group>
  )
}

/** A scattering of small twinkling stars, night only. */
function Stars() {
  const positions = useMemo(() => {
    let seed = 5150
    const rand = () => {
      seed = (seed * 48271) % 2147483647
      return seed / 2147483647
    }
    const arr = new Float32Array(70 * 3)
    for (let i = 0; i < 70; i++) {
      arr[i * 3] = (rand() - 0.5) * 160
      arr[i * 3 + 1] = 14 + rand() * 46
      arr[i * 3 + 2] = -20 - rand() * 60
    }
    return arr
  }, [])

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color="#fff8ef" size={1.1} sizeAttenuation transparent opacity={0.85} toneMapped={false} />
    </points>
  )
}

interface Tower {
  x: number
  z: number
  w: number
  d: number
  h: number
  colorIdx: number
  seed: number
}

function generateTowers(count: number): Tower[] {
  let seed = 90210
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return (seed % 10000) / 10000
  }
  const towers: Tower[] = []
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + rand() * 0.3
    const radius = 30 + rand() * 20
    towers.push({
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius * 0.55 - 10,
      w: 1.9 + rand() * 2.3,
      d: 1.9 + rand() * 2.3,
      h: 2.6 + rand() * 8,
      colorIdx: Math.floor(rand() * PALETTE.length),
      seed: Math.floor(rand() * 1000),
    })
  }
  return towers
}

function TowerMesh({ tower, ramp, mood }: { tower: Tower; ramp: THREE.Texture; mood: Mood }) {
  const sideTexture = useMemo(
    () =>
      mood === 'day'
        ? windowTexture(GLASS_TINT, PALETTE[tower.colorIdx])
        : windowTexture(PALETTE[tower.colorIdx], BODY_SHADES[tower.colorIdx]),
    [tower.colorIdx, mood],
  )
  const capColor = useMemo(
    () => new THREE.Color(PALETTE[tower.colorIdx]).lerp(new THREE.Color('#fff8ef'), mood === 'day' ? 0.2 : 0.35),
    [tower.colorIdx, mood],
  )

  const sideMaterial = useMemo(() => new THREE.MeshBasicMaterial({ map: sideTexture }), [sideTexture])
  const capMaterial = useMemo(
    () => new THREE.MeshToonMaterial({ color: capColor, gradientMap: ramp }),
    [capColor, ramp],
  )
  const materials = useMemo(
    () => [sideMaterial, sideMaterial, capMaterial, capMaterial, sideMaterial, sideMaterial],
    [sideMaterial, capMaterial],
  )

  return (
    <group position={[tower.x, 0, tower.z]}>
      {/* ink outline: a scaled-up backface-only black shell */}
      <mesh position={[0, tower.h / 2, 0]} scale={[1.06, 1.03, 1.06]}>
        <boxGeometry args={[tower.w, tower.h, tower.d]} />
        <meshBasicMaterial color="#12101f" side={THREE.BackSide} />
      </mesh>

      <mesh position={[0, tower.h / 2, 0]} material={materials}>
        <boxGeometry args={[tower.w, tower.h, tower.d]} />
      </mesh>

      <group position={[0, tower.h, 0]}>
        <RoofTopper seed={tower.seed} width={tower.w} color={PALETTE[(tower.colorIdx + 2) % PALETTE.length]} />
      </group>
    </group>
  )
}

function Skyline({ mood }: { mood: Mood }) {
  const towers = useMemo(() => generateTowers(TOWER_COUNT), [])
  const ramp = useMemo(() => toonRamp(), [])

  return (
    <group position={[0, -5, 0]}>
      {towers.map((tower, i) => (
        <TowerMesh key={i} tower={tower} ramp={ramp} mood={mood} />
      ))}
    </group>
  )
}

function CameraRig() {
  useFrame((state) => {
    if (document.hidden) return
    const t = state.clock.elapsedTime
    // Pulled back and angled down from the towers so the skyline reads as a
    // horizon under the hero copy rather than looming over it.
    state.camera.position.x = Math.sin(t * 0.045) * 11
    state.camera.position.y = 9.5 + Math.sin(t * 0.07) * 1.1
    state.camera.position.z = 42 + Math.cos(t * 0.035) * 3.5
    state.camera.lookAt(0, -4, -10)
  })
  return null
}

const LIGHTING = {
  day: {
    background: '#7ec8f5',
    fog: ['#bfe6ff', 30, 100] as [string, number, number],
    ambient: { intensity: 1.05, color: '#eaf6ff' },
    sun: { position: [24, 34, -20] as [number, number, number], intensity: 2, color: '#fff4d6' },
    rim: { position: [-16, 10, 6] as [number, number, number], intensity: 16, color: '#ffc93c' },
  },
  night: {
    background: '#120f2c',
    fog: ['#291a52', 26, 90] as [string, number, number],
    ambient: { intensity: 0.85, color: '#4a3d80' },
    sun: { position: [-24, 30, -30] as [number, number, number], intensity: 1.8, color: '#fff3d6' },
    rim: { position: [16, 11, 6] as [number, number, number], intensity: 30, color: '#ff8fd8' },
  },
}

interface Props {
  mood: Mood
}

/**
 * Renders nothing (letting the CSS skyline fallback in .landing__hero show
 * through) when motion is reduced or WebGL is unavailable.
 */
export function LandingScene({ mood }: Props) {
  const [enabled, setEnabled] = useState(false)
  const lighting = LIGHTING[mood]

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    setEnabled(!reduced && supportsWebGL())
  }, [])

  if (!enabled) return null

  return (
    <div className="landing-scene" aria-hidden="true">
      <Canvas
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
        camera={{ position: [0, 9.5, 42], fov: 38, near: 1, far: 240 }}
      >
        <color attach="background" args={[lighting.background]} />
        <fog attach="fog" args={lighting.fog} />
        <ambientLight intensity={lighting.ambient.intensity} color={lighting.ambient.color} />
        <directionalLight position={lighting.sun.position} intensity={lighting.sun.intensity} color={lighting.sun.color} />
        <pointLight position={lighting.rim.position} intensity={lighting.rim.intensity} color={lighting.rim.color} distance={70} />
        <Suspense fallback={null}>
          <SkyDome mood={mood} />
          <Skybody mood={mood} />
          <DriftingClouds mood={mood} />
          {mood === 'day' ? <Birds /> : <Stars />}
          <Skyline mood={mood} />
        </Suspense>
        <CameraRig />
      </Canvas>
    </div>
  )
}
