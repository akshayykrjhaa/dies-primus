import { Billboard, Sparkles } from '@react-three/drei'
import { Canvas, useFrame } from '@react-three/fiber'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'

import { BODY_SHADES, PALETTE, RoofTopper, supportsWebGL, toonRamp, windowTexture } from './toonKit'

/**
 * A decorative, self-contained cartoon night skyline behind the hero — a
 * toon-shaded preview of the real product, not the product. Deliberately
 * does not touch components/scene/* (the real city renderer): no
 * building-data model, no devicon texture fetches, no layers table.
 */

const TOWER_COUNT = 20

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

function skyTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 2
  canvas.height = 160
  const ctx = canvas.getContext('2d')!
  const grad = ctx.createLinearGradient(0, 0, 0, 160)
  grad.addColorStop(0, '#120f2c')
  grad.addColorStop(0.5, '#291a52')
  grad.addColorStop(0.82, '#5c2566')
  grad.addColorStop(1, '#8a3566')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 2, 160)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function SkyDome() {
  const texture = useMemo(() => skyTexture(), [])
  return (
    <mesh renderOrder={-10}>
      <sphereGeometry args={[190, 24, 16]} />
      <meshBasicMaterial map={texture} side={THREE.BackSide} depthWrite={false} fog={false} />
    </mesh>
  )
}

function Moon() {
  const texture = useMemo(() => moonTexture(), [])
  return (
    <Billboard position={[-34, 42, -70]}>
      <mesh>
        <circleGeometry args={[16, 32]} />
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

function Cloud({ x, y, z, scale, speed }: CloudPuff) {
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
        <meshBasicMaterial color="#e7defd" toneMapped={false} />
      </mesh>
      <mesh position={[3.4, -0.4, 0]}>
        <sphereGeometry args={[2.4, 8, 6]} />
        <meshBasicMaterial color="#e7defd" toneMapped={false} />
      </mesh>
      <mesh position={[-3.2, -0.3, 0.2]}>
        <sphereGeometry args={[2.2, 8, 6]} />
        <meshBasicMaterial color="#e7defd" toneMapped={false} />
      </mesh>
    </group>
  )
}

function DriftingClouds() {
  const puffs = useMemo<CloudPuff[]>(
    () => [
      { x: -50, y: 30, z: -55, scale: 1.6, speed: 0.7 },
      { x: 10, y: 38, z: -68, scale: 1.1, speed: 0.5 },
      { x: 55, y: 26, z: -50, scale: 1.9, speed: 0.4 },
      { x: -20, y: 22, z: -40, scale: 0.9, speed: 0.9 },
    ],
    [],
  )

  return (
    <group>
      {puffs.map((puff, i) => (
        <Cloud key={i} {...puff} />
      ))}
    </group>
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

function TowerMesh({ tower, ramp }: { tower: Tower; ramp: THREE.Texture }) {
  const sideTexture = useMemo(
    () => windowTexture(PALETTE[tower.colorIdx], BODY_SHADES[tower.colorIdx]),
    [tower.colorIdx],
  )
  const capColor = useMemo(() => new THREE.Color(PALETTE[tower.colorIdx]).lerp(new THREE.Color('#fff8ef'), 0.35), [tower.colorIdx])

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

function Skyline() {
  const towers = useMemo(() => generateTowers(TOWER_COUNT), [])
  const ramp = useMemo(() => toonRamp(), [])

  return (
    <group position={[0, -5, 0]}>
      {towers.map((tower, i) => (
        <TowerMesh key={i} tower={tower} ramp={ramp} />
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

/**
 * Renders nothing (letting the CSS skyline fallback in .landing__hero show
 * through) when motion is reduced or WebGL is unavailable.
 */
export function LandingScene() {
  const [enabled, setEnabled] = useState(false)

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
        <color attach="background" args={['#120f2c']} />
        <fog attach="fog" args={['#291a52', 26, 90]} />
        <ambientLight intensity={0.85} color="#4a3d80" />
        <directionalLight position={[-24, 30, -30]} intensity={1.8} color="#fff3d6" />
        <pointLight position={[16, 11, 6]} intensity={30} color="#ff8fd8" distance={70} />
        <Suspense fallback={null}>
          <SkyDome />
          <Moon />
          <DriftingClouds />
          <Sparkles count={90} scale={[140, 60, 60]} position={[0, 30, -40]} size={2.2} speed={0.2} color="#fff8ef" />
          <Skyline />
        </Suspense>
        <CameraRig />
      </Canvas>
    </div>
  )
}
