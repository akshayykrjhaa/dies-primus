import { MutableRefObject, useEffect, useRef } from 'react'

import type { CameraPose } from './scene/CityScene'

interface Props {
  pose: MutableRefObject<CameraPose>
  /** Snap the camera to a compass bearing, keeping what it is looking at. */
  onBearing: (azimuth: number, pitch?: number) => void
  /** Pull back to see the whole city from above. */
  onOverview: () => void
}

const SIZE = 104

/**
 * A navigation globe: a compass rose that shows which way you are facing and
 * snaps you to a bearing when you click one.
 *
 * Orbiting by hand from one side of a city to the other is a long drag; being
 * able to say "put me on the north side" in one click is the difference
 * between exploring and wrestling. The needle is redrawn from the live camera
 * pose on its own animation frame, the same way the minimap is, so tracking
 * the camera costs no React renders.
 */
export function NavGlobe({ pose, onBearing, onOverview }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = SIZE * dpr
    canvas.height = SIZE * dpr
    ctx.scale(dpr, dpr)

    const centre = SIZE / 2
    const radius = SIZE * 0.38
    let frame = 0

    const draw = () => {
      ctx.clearRect(0, 0, SIZE, SIZE)

      // The globe body, shaded so it reads as a sphere rather than a disc.
      const sphere = ctx.createRadialGradient(
        centre - radius * 0.35, centre - radius * 0.4, radius * 0.1,
        centre, centre, radius,
      )
      sphere.addColorStop(0, '#3C4A6B')
      sphere.addColorStop(0.65, '#222C44')
      sphere.addColorStop(1, '#141B2C')
      ctx.fillStyle = sphere
      ctx.beginPath()
      ctx.arc(centre, centre, radius, 0, Math.PI * 2)
      ctx.fill()

      ctx.strokeStyle = 'rgba(122, 162, 255, 0.45)'
      ctx.lineWidth = 1
      ctx.stroke()

      // Latitude/longitude hints, so it reads as a globe.
      ctx.strokeStyle = 'rgba(122, 162, 255, 0.18)'
      ctx.beginPath()
      ctx.ellipse(centre, centre, radius * 0.55, radius, 0, 0, Math.PI * 2)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(centre - radius, centre)
      ctx.lineTo(centre + radius, centre)
      ctx.stroke()

      // The heading the camera is actually looking along.
      const angle = pose.current.angle
      const nose = angle - Math.PI / 2 // screen space: -Y is up/north

      // Cone of view.
      ctx.fillStyle = 'rgba(126, 249, 200, 0.22)'
      ctx.beginPath()
      ctx.moveTo(centre, centre)
      ctx.arc(centre, centre, radius * 0.92, nose - 0.42, nose + 0.42)
      ctx.closePath()
      ctx.fill()

      // Needle.
      ctx.strokeStyle = '#7EF9C8'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(centre, centre)
      ctx.lineTo(centre + Math.cos(nose) * radius * 0.8, centre + Math.sin(nose) * radius * 0.8)
      ctx.stroke()

      ctx.fillStyle = '#7EF9C8'
      ctx.beginPath()
      ctx.arc(centre, centre, 2.6, 0, Math.PI * 2)
      ctx.fill()

      frame = requestAnimationFrame(draw)
    }

    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [pose])

  // Azimuth is the spherical theta the camera sits at, so "look from the
  // south" means standing at +Z, which is theta = 0 in three's convention.
  const points: { label: string; azimuth: number; className: string }[] = [
    { label: 'N', azimuth: Math.PI, className: 'nav-globe__n' },
    { label: 'E', azimuth: Math.PI / 2, className: 'nav-globe__e' },
    { label: 'S', azimuth: 0, className: 'nav-globe__s' },
    { label: 'W', azimuth: -Math.PI / 2, className: 'nav-globe__w' },
  ]

  return (
    <div className="nav-globe">
      <canvas ref={canvasRef} style={{ width: SIZE, height: SIZE }} />
      {points.map((point) => (
        <button
          key={point.label}
          className={`nav-globe__point ${point.className}`}
          onClick={() => onBearing(point.azimuth)}
          title={`Look from the ${
            { N: 'north', E: 'east', S: 'south', W: 'west' }[point.label]
          }`}
        >
          {point.label}
        </button>
      ))}
      <button
        className="nav-globe__top"
        onClick={onOverview}
        title="Look straight down at the whole city"
      >
        ⌖
      </button>
    </div>
  )
}
