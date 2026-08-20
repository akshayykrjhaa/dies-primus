import * as THREE from 'three'

/**
 * The swirling surface inside the portal ring.
 *
 * Painted once into a canvas as a logarithmic spiral of soft magenta arms on a
 * deep violet field, then rotated and scrolled at runtime. A texture beats a
 * shader here because it stays readable at every zoom level and costs nothing
 * to animate — the whole effect is one spinning quad.
 */
export function vortexTexture(size = 512): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const centre = size / 2

  // Deep violet base with a darker eye, so the middle reads as depth.
  const base = ctx.createRadialGradient(centre, centre, 0, centre, centre, centre)
  base.addColorStop(0, '#150C24')
  base.addColorStop(0.45, '#33194A')
  base.addColorStop(0.82, '#5B2360')
  base.addColorStop(1, '#8E2C6B')
  ctx.fillStyle = base
  ctx.fillRect(0, 0, size, size)

  // Spiral arms.
  const arms = 5
  ctx.lineCap = 'round'
  for (let arm = 0; arm < arms; arm++) {
    const offset = (arm / arms) * Math.PI * 2
    for (let pass = 0; pass < 3; pass++) {
      ctx.beginPath()
      const width = [16, 9, 4][pass]
      const alpha = [0.16, 0.3, 0.55][pass]
      ctx.strokeStyle = `rgba(${240 - pass * 20}, ${90 + pass * 40}, ${190 + pass * 20}, ${alpha})`
      ctx.lineWidth = width
      for (let t = 0.06; t < 1; t += 0.012) {
        // Logarithmic spiral: radius grows as the angle winds.
        const angle = offset + t * 5.6
        const radius = centre * Math.pow(t, 0.72) * 0.94
        const x = centre + Math.cos(angle) * radius
        const y = centre + Math.sin(angle) * radius
        if (t === 0.06) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
  }

  // Bright core and a soft outer bloom.
  const core = ctx.createRadialGradient(centre, centre, 0, centre, centre, centre * 0.34)
  core.addColorStop(0, 'rgba(255, 214, 245, 0.85)')
  core.addColorStop(0.5, 'rgba(214, 66, 160, 0.35)')
  core.addColorStop(1, 'rgba(120, 30, 110, 0)')
  ctx.fillStyle = core
  ctx.beginPath()
  ctx.arc(centre, centre, centre * 0.34, 0, Math.PI * 2)
  ctx.fill()

  // Fade the rim to transparent so the disc melts into the ring.
  const feather = ctx.createRadialGradient(
    centre, centre, centre * 0.82, centre, centre, centre,
  )
  feather.addColorStop(0, 'rgba(0,0,0,0)')
  feather.addColorStop(1, 'rgba(0,0,0,1)')
  ctx.globalCompositeOperation = 'destination-out'
  ctx.fillStyle = feather
  ctx.fillRect(0, 0, size, size)
  ctx.globalCompositeOperation = 'source-over'

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.center.set(0.5, 0.5)
  texture.needsUpdate = true
  return texture
}
