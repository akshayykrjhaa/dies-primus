import { Canvas, useFrame } from '@react-three/fiber'
import { Suspense, useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'

/**
 * A decorative, self-contained mini skyline behind the hero — a preview of
 * the real product, not the product. Deliberately does not touch
 * components/scene/* (the real city renderer): no building-data model, no
 * devicon texture fetches, no layers table. Just enough to say "this is the
 * same world" behind the form.
 */

const PALETTE = ['#5b7cfa', '#7ef9c8', '#b48bff', '#7a8fd9']
const TOWER_COUNT = 34

function windowTexture(litColor: string): THREE.CanvasTexture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#080b16'
  ctx.fillRect(0, 0, size, size)

  const cols = 6
  const rows = 11
  const cellW = size / cols
  const cellH = size / rows
  let seed = litColor.charCodeAt(1) * 7919
  const rand = () => {
    seed = (seed * 48271) % 0x7fffffff
    return seed / 0x7fffffff
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (rand() > 0.4) continue
      ctx.globalAlpha = 0.32 + rand() * 0.5
      ctx.fillStyle = litColor
      const padX = cellW * 0.24
      const padY = cellH * 0.3
      ctx.fillRect(c * cellW + padX, r * cellH + padY, cellW - padX * 2, cellH - padY * 2)
    }
  }
  ctx.globalAlpha = 1
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

interface Tower {
  x: number
  z: number
  w: number
  d: number
  h: number
  colorIdx: number
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
    const radius = 26 + rand() * 16
    towers.push({
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius * 0.55 - 10,
      w: 1.5 + rand() * 2.1,
      d: 1.5 + rand() * 2.1,
      h: 3 + rand() * 14,
      colorIdx: Math.floor(rand() * PALETTE.length),
    })
  }
  return towers
}

function Skyline() {
  const towers = useMemo(() => generateTowers(TOWER_COUNT), [])

  const materialSets = useMemo(() => {
    return PALETTE.map((color) => {
      const side = new THREE.MeshBasicMaterial({ map: windowTexture(color) })
      const cap = new THREE.MeshBasicMaterial({ color: '#05070f' })
      return [side, side, cap, cap, side, side]
    })
  }, [])

  return (
    <group position={[0, -5, 0]}>
      {towers.map((t, i) => (
        <mesh
          key={i}
          position={[t.x, t.h / 2, t.z]}
          material={materialSets[t.colorIdx]}
        >
          <boxGeometry args={[t.w, t.h, t.d]} />
        </mesh>
      ))}
    </group>
  )
}

function CameraRig() {
  useFrame((state) => {
    if (document.hidden) return
    const t = state.clock.elapsedTime
    state.camera.position.x = Math.sin(t * 0.045) * 9
    state.camera.position.y = 3.4 + Math.sin(t * 0.07) * 1.1
    state.camera.position.z = 22 + Math.cos(t * 0.035) * 3.5
    state.camera.lookAt(0, 1.5, -8)
  })
  return null
}

function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))
    )
  } catch {
    return false
  }
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
        camera={{ position: [0, 3.4, 22], fov: 42, near: 1, far: 120 }}
      >
        <color attach="background" args={['#05070f']} />
        <fog attach="fog" args={['#05070f', 16, 52]} />
        <ambientLight intensity={0.4} color="#3d4d8f" />
        <pointLight position={[16, 11, 6]} intensity={55} color="#5b7cfa" distance={70} />
        <pointLight position={[-18, 7, -12]} intensity={34} color="#7ef9c8" distance={70} />
        <Suspense fallback={null}>
          <Skyline />
        </Suspense>
        <CameraRig />
      </Canvas>
    </div>
  )
}
