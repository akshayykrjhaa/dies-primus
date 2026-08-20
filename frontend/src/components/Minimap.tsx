import { MutableRefObject, useEffect, useRef } from 'react'

import type { Building, CityData } from '../types'
import type { CameraPose } from './scene/CityScene'

interface Props {
  data: CityData
  pose: MutableRefObject<CameraPose>
  selected: Building | null
  onJump: (x: number, z: number) => void
}

const SIZE = 190

/** Top-down map of the city with a live camera cursor. */
export function Minimap({ data, pose, selected, onJump }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Padding proportional to the city: a flat +80 swallowed small towns.
  const extent = Math.max(data.bounds.width, data.bounds.depth)
  const span = extent + Math.max(24, extent * 0.35)
  const scale = SIZE / span

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = SIZE * dpr
    canvas.height = SIZE * dpr
    ctx.scale(dpr, dpr)

    let frame = 0
    const toScreen = (x: number, z: number) => [
      SIZE / 2 + x * scale,
      SIZE / 2 + z * scale,
    ]

    const draw = () => {
      ctx.clearRect(0, 0, SIZE, SIZE)
      ctx.fillStyle = '#12321f'
      ctx.fillRect(0, 0, SIZE, SIZE)

      // roads first, so plots sit on top of them
      ctx.fillStyle = '#3A4049'
      for (const road of data.roads ?? []) {
        const w = road.axis === 'x' ? road.length : road.width
        const d = road.axis === 'x' ? road.width : road.length
        const [rx, rz] = toScreen(road.x - w / 2, road.z - d / 2)
        ctx.fillRect(rx, rz, w * scale, d * scale)
      }

      for (const district of data.districts) {
        const [x, z] = toScreen(district.x - district.width / 2, district.z - district.depth / 2)
        ctx.fillStyle = district.grass ? '#4F8F3A88' : '#8D949E88'
        ctx.strokeStyle = `${district.color}CC`
        ctx.lineWidth = 0.6
        ctx.fillRect(x, z, district.width * scale, district.depth * scale)
        ctx.strokeRect(x, z, district.width * scale, district.depth * scale)
      }

      for (const building of data.buildings) {
        const [x, z] = toScreen(building.x, building.z)
        ctx.fillStyle = building.isLandmark ? '#FFC93C' : `${building.color}dd`
        const dot = building.isLandmark ? 1.9 : 1.1
        ctx.fillRect(x - dot / 2, z - dot / 2, dot, dot)
      }

      if (selected) {
        const [x, z] = toScreen(selected.x, selected.z)
        ctx.strokeStyle = '#7ef9c8'
        ctx.lineWidth = 1.4
        ctx.beginPath()
        ctx.arc(x, z, 5, 0, Math.PI * 2)
        ctx.stroke()
      }

      // Entrance marker
      const [ex, ez] = toScreen(data.entrance.x, data.entrance.z)
      ctx.fillStyle = '#5b7cfa'
      ctx.beginPath()
      ctx.arc(ex, ez, 3, 0, Math.PI * 2)
      ctx.fill()

      // Camera cone
      const [cx, cz] = toScreen(pose.current.x, pose.current.z)
      const angle = pose.current.angle
      ctx.fillStyle = 'rgba(126, 249, 200, 0.22)'
      ctx.beginPath()
      ctx.moveTo(cx, cz)
      ctx.arc(cx, cz, 26, angle - Math.PI / 2 - 0.45, angle - Math.PI / 2 + 0.45)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = '#7ef9c8'
      ctx.beginPath()
      ctx.arc(cx, cz, 2.6, 0, Math.PI * 2)
      ctx.fill()

      frame = requestAnimationFrame(draw)
    }

    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [data, pose, scale, selected])

  return (
    <div className="minimap">
      <canvas
        ref={canvasRef}
        style={{ width: SIZE, height: SIZE }}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          const x = (event.clientX - rect.left - SIZE / 2) / scale
          const z = (event.clientY - rect.top - SIZE / 2) / scale
          onJump(x, z)
        }}
      />
      <span className="minimap__hint">click to travel</span>
    </div>
  )
}
