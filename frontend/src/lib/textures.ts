import * as THREE from 'three'

/**
 * Procedural facades.
 *
 * Two maps are generated per variant: a greyscale colour map (concrete bands,
 * mullions, recessed glass) that the material tints with the language colour,
 * and an emissive map that is black except for lit windows. Together they read
 * as a real building at night instead of a coloured box.
 *
 * A handful of variants are shared by the whole city and tiled through the
 * geometry's UVs, so 300+ buildings still only cost a few textures.
 */

export interface Facade {
  color: THREE.CanvasTexture
  emissive: THREE.CanvasTexture
}

// One texture tile covers this much of the world, which fixes the apparent
// floor height no matter how tall or wide a building is.
export const TILE_WIDTH = 2.0
export const TILE_HEIGHT = 2.2

const TEX_W = 128
const TEX_H = 144
const COLS = 4
const ROWS = 5

function makeVariant(seed: number): Facade {
  const random = mulberry(seed)

  const colorCanvas = document.createElement('canvas')
  colorCanvas.width = TEX_W
  colorCanvas.height = TEX_H
  const cctx = colorCanvas.getContext('2d')!

  const lightCanvas = document.createElement('canvas')
  lightCanvas.width = TEX_W
  lightCanvas.height = TEX_H
  const lctx = lightCanvas.getContext('2d')!

  // Concrete base with a subtle vertical gradient so floors do not look flat.
  const gradient = cctx.createLinearGradient(0, 0, 0, TEX_H)
  gradient.addColorStop(0, '#aeb6c8')
  gradient.addColorStop(1, '#767f94')
  cctx.fillStyle = gradient
  cctx.fillRect(0, 0, TEX_W, TEX_H)

  lctx.fillStyle = '#000000'
  lctx.fillRect(0, 0, TEX_W, TEX_H)

  const marginX = 3
  const marginY = 4
  const cellW = (TEX_W - marginX * (COLS + 1)) / COLS
  const cellH = (TEX_H - marginY * (ROWS + 1)) / ROWS

  for (let row = 0; row < ROWS; row++) {
    // Spandrel band between floors — the strongest "real building" cue.
    cctx.fillStyle = 'rgba(30, 36, 48, 0.55)'
    cctx.fillRect(0, marginY + row * (cellH + marginY) - marginY * 0.6, TEX_W, marginY * 0.6)

    for (let col = 0; col < COLS; col++) {
      const x = marginX + col * (cellW + marginX)
      const y = marginY + row * (cellH + marginY)

      // Recessed glass
      cctx.fillStyle = '#151b28'
      cctx.fillRect(x, y, cellW, cellH)
      // Reflection highlight across the top of the pane
      cctx.fillStyle = 'rgba(150, 175, 220, 0.22)'
      cctx.fillRect(x, y, cellW, cellH * 0.32)
      // Mullion splitting the pane
      cctx.fillStyle = 'rgba(20, 25, 36, 0.9)'
      cctx.fillRect(x + cellW / 2 - 0.5, y, 1, cellH)

      // Lights: warm office glow, some floors dark, some panes half lit.
      const lit = random() > 0.36
      if (lit) {
        const warmth = 200 + Math.floor(random() * 55)
        const alpha = 0.45 + random() * 0.55
        lctx.fillStyle = `rgba(255, ${warmth}, ${140 + Math.floor(random() * 70)}, ${alpha})`
        const halfPane = random() > 0.7
        lctx.fillRect(x, y, halfPane ? cellW / 2 : cellW, cellH)
      }
    }
  }

  const color = new THREE.CanvasTexture(colorCanvas)
  const emissive = new THREE.CanvasTexture(lightCanvas)
  for (const texture of [color, emissive]) {
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 4
    texture.needsUpdate = true
  }
  return { color, emissive }
}

/** Small deterministic PRNG so a given building always looks the same. */
function mulberry(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

let variants: Facade[] | null = null

export function facadeVariants(): Facade[] {
  if (!variants) {
    variants = [makeVariant(11), makeVariant(97), makeVariant(523), makeVariant(2749)]
  }
  return variants
}

export function hashString(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/**
 * A box whose side UVs tile the facade at a constant world scale, and whose
 * faces are grouped so the walls and the roof can use different materials.
 *
 * BoxGeometry lays vertices out face by face: +X, -X, +Y, -Y, +Z, -Z.
 */
export function buildingGeometry(
  width: number,
  height: number,
  depth: number,
): THREE.BoxGeometry {
  const geometry = new THREE.BoxGeometry(width, height, depth)
  const uv = geometry.attributes.uv as THREE.BufferAttribute

  const vRepeat = Math.max(1, Math.round(height / TILE_HEIGHT))
  const uSideX = Math.max(1, Math.round(depth / TILE_WIDTH))
  const uSideZ = Math.max(1, Math.round(width / TILE_WIDTH))

  const scaleFace = (face: number, uScale: number, vScale: number) => {
    for (let i = face * 4; i < face * 4 + 4; i++) {
      uv.setXY(i, uv.getX(i) * uScale, uv.getY(i) * vScale)
    }
  }

  scaleFace(0, uSideX, vRepeat) // +X
  scaleFace(1, uSideX, vRepeat) // -X
  scaleFace(4, uSideZ, vRepeat) // +Z
  scaleFace(5, uSideZ, vRepeat) // -Z
  uv.needsUpdate = true

  // Walls -> material 0, roof and underside -> material 1.
  geometry.clearGroups()
  geometry.addGroup(0, 12, 0) // +X, -X
  geometry.addGroup(12, 12, 1) // +Y, -Y
  geometry.addGroup(24, 12, 0) // +Z, -Z

  return geometry
}
