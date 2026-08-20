import * as THREE from 'three'

const CDN = 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons'
const VARIANTS = ['original', 'plain', 'original-wordmark', 'plain-wordmark']
const SIZE = 160

/**
 * Devicon logos as three.js textures, cached per slug.
 *
 * The SVG is fetched as text and given explicit width/height before being
 * rasterised — devicon ships viewBox-only files, and a data URI with real
 * dimensions is the one form every browser draws to a canvas reliably.
 */
const cache = new Map<string, Promise<THREE.Texture | null>>()

function withExplicitSize(svg: string): string {
  if (/<svg[^>]*\swidth=/.test(svg)) return svg
  return svg.replace(/<svg\b/, `<svg width="${SIZE}" height="${SIZE}"`)
}

function rasterise(svg: string): Promise<THREE.Texture | null> {
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = SIZE
        canvas.height = SIZE
        const ctx = canvas.getContext('2d')!
        // A soft plate behind the mark keeps dark logos readable at night.
        ctx.fillStyle = 'rgba(246, 249, 255, 0.94)'
        ctx.beginPath()
        const r = 22
        ctx.roundRect(0, 0, SIZE, SIZE, r)
        ctx.fill()
        const pad = SIZE * 0.14
        ctx.drawImage(image, pad, pad, SIZE - pad * 2, SIZE - pad * 2)

        const texture = new THREE.CanvasTexture(canvas)
        texture.colorSpace = THREE.SRGBColorSpace
        texture.anisotropy = 4
        texture.needsUpdate = true
        resolve(texture)
      } catch {
        resolve(null)
      }
    }
    image.onerror = () => resolve(null)
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  })
}

async function load(slug: string): Promise<THREE.Texture | null> {
  for (const variant of VARIANTS) {
    try {
      const response = await fetch(`${CDN}/${slug}/${slug}-${variant}.svg`)
      if (!response.ok) continue
      const svg = await response.text()
      if (!svg.includes('<svg')) continue
      const texture = await rasterise(withExplicitSize(svg))
      if (texture) return texture
    } catch {
      // network blocked or offline: fall through to the next variant
    }
  }
  return null
}

export function logoTexture(slug: string): Promise<THREE.Texture | null> {
  if (!slug) return Promise.resolve(null)
  let pending = cache.get(slug)
  if (!pending) {
    pending = load(slug)
    cache.set(slug, pending)
  }
  return pending
}

/**
 * Fallback badge for files whose tech has no devicon entry: the extension,
 * drawn onto a plate in the language colour.
 */
const letterCache = new Map<string, THREE.Texture>()

export function letterTexture(label: string, color: string): THREE.Texture {
  const key = `${label}|${color}`
  const existing = letterCache.get(key)
  if (existing) return existing

  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.roundRect(0, 0, SIZE, SIZE, 22)
  ctx.fill()
  ctx.fillStyle = '#080c16'
  ctx.font = `bold ${SIZE * 0.44}px Inter, Segoe UI, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label.slice(0, 3).toUpperCase(), SIZE / 2, SIZE / 2 + 4)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  letterCache.set(key, texture)
  return texture
}
