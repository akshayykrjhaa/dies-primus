import * as THREE from 'three'

/**
 * Shared building blocks for the landing page's toon-shaded Three.js scenes
 * (the hero skyline and the interactive compare-panel city) — one place for
 * the palette, textures and rooftop shapes so both read as the same
 * illustrated world instead of two different one-off scenes.
 */

/** The two atmospheres the landing page can be toggled between. */
export type Mood = 'day' | 'night'

export const PALETTE = ['#ff5d73', '#ffc93c', '#ff8fd8', '#3fe0c5', '#8c6bff']
// A muted, darkened tone per palette color for the flat building "body" —
// deliberately not ink-black, so a black outline shell reads as a border
// around a colored shape instead of blending into it.
export const BODY_SHADES = ['#7a2436', '#7a5a1c', '#7a3b62', '#1f6c60', '#3a2c6e']
export const INK = '#12101f'

export function windowTexture(litColor: string, bodyShade: string): THREE.CanvasTexture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = bodyShade
  ctx.fillRect(0, 0, size, size)

  const cols = 5
  const rows = 9
  const cellW = size / cols
  const cellH = size / rows
  let seed = litColor.charCodeAt(1) * 7919
  const rand = () => {
    seed = (seed * 48271) % 0x7fffffff
    return seed / 0x7fffffff
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (rand() > 0.42) continue
      ctx.globalAlpha = 0.6 + rand() * 0.4
      ctx.fillStyle = litColor
      const padX = cellW * 0.22
      const padY = cellH * 0.28
      ctx.fillRect(c * cellW + padX, r * cellH + padY, cellW - padX * 2, cellH - padY * 2)
    }
  }
  ctx.globalAlpha = 1
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

/** A hard-stepped ramp, warm-tinted, for flat cel shading. */
export function toonRamp(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 4
  canvas.height = 1
  const ctx = canvas.getContext('2d')!
  const steps = ['#241a3d', '#5a4a86', '#b6a4e0', '#fff2e0']
  steps.forEach((c, i) => {
    ctx.fillStyle = c
    ctx.fillRect(i, 0, 1, 1)
  })
  const texture = new THREE.CanvasTexture(canvas)
  texture.minFilter = THREE.NearestFilter
  texture.magFilter = THREE.NearestFilter
  return texture
}

export function supportsWebGL(): boolean {
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

/** Antenna, flag, chimney or pyramid cap — picked per building from its seed. */
export function RoofTopper({ seed, width, color }: { seed: number; width: number; color: string }) {
  const kind = seed % 4
  if (kind === 0) {
    return (
      <group>
        <mesh position={[0, 1.6, 0]}>
          <cylinderGeometry args={[0.06, 0.06, 3.2, 6]} />
          <meshToonMaterial color={INK} />
        </mesh>
        <mesh position={[0, 3.2, 0]}>
          <sphereGeometry args={[0.32, 10, 8]} />
          <meshToonMaterial color="#ff5d73" />
        </mesh>
      </group>
    )
  }
  if (kind === 1) {
    return (
      <group>
        <mesh position={[0, 1.3, 0]}>
          <cylinderGeometry args={[0.05, 0.05, 2.6, 6]} />
          <meshToonMaterial color={INK} />
        </mesh>
        <mesh position={[0.5, 2.2, 0]}>
          <planeGeometry args={[1, 0.6]} />
          <meshToonMaterial color="#ffc93c" side={THREE.DoubleSide} />
        </mesh>
      </group>
    )
  }
  if (kind === 2) {
    return (
      <mesh position={[width * 0.22, 0.9, 0]}>
        <boxGeometry args={[0.5, 1.8, 0.5]} />
        <meshToonMaterial color={color} />
      </mesh>
    )
  }
  return (
    <mesh position={[0, 1, 0]}>
      <coneGeometry args={[width * 0.55, 1.8, 4]} />
      <meshToonMaterial color={color} />
    </mesh>
  )
}
