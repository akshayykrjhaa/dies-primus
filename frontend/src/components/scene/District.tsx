import { Html } from '@react-three/drei'
import { memo } from 'react'

import { LAYERS } from '../../lib/layers'
import type { District } from '../../types'

interface Props {
  district: District
  active: boolean
  /** Apparent label size, scaled to the city so towns are not shouted at. */
  labelScale?: number
  /** True while another district holds the focus, so this one steps back. */
  muted?: boolean
  onFocus: (district: District) => void
}

/**
 * A district is the plot a directory sits on. Its surface comes from the zone
 * the backend assigned — grass for residential and campus, pavement for
 * downtown and industrial — which is what gives the map its patchwork.
 */
function DistrictImpl({ district, active, muted = false, labelScale = 52, onFocus }: Props) {
  const { x, z, width, depth, ground, grass, color } = district

  return (
    <group position={[x, 0, z]}>
      {/* Sidewalk apron, slightly larger than the plot */}
      <mesh position={[0, LAYERS.districtApron, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[width + 2.6, depth + 2.6]} />
        <meshLambertMaterial color="#C6CBD2" />
      </mesh>

      {/* The plot surface itself */}
      <mesh position={[0, LAYERS.districtPlot, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[width, depth]} />
        <meshLambertMaterial color={ground} />
      </mesh>

      {/* A highlight ring while this district is the active one */}
      {(active || muted) && (
        <mesh position={[0, LAYERS.districtHighlight, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[width, depth]} />
          <meshBasicMaterial
            color={active ? color : '#0B1020'}
            transparent
            opacity={active ? 0.18 : 0.34}
          />
        </mesh>
      )}

      {grass && (
        <mesh position={[0, LAYERS.districtRing, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[Math.min(width, depth) * 0.06, Math.min(width, depth) * 0.09, 24]} />
          <meshBasicMaterial color="#EAF3E4" transparent opacity={0.5} />
        </mesh>
      )}

      <Html
        position={[0, 7, 0]}
        center
        distanceFactor={labelScale}
        zIndexRange={[20, 10]}
        style={{ pointerEvents: 'auto' }}
      >
        <button
          className={`district-label${active ? ' district-label--active' : ''}${
            muted ? ' district-label--muted' : ''
          }`}
          style={{ borderColor: color }}
          onClick={(event) => {
            event.stopPropagation()
            onFocus(district)
          }}
          title={district.purpose || district.path}
        >
          <span className="district-label__dot" style={{ background: color }} />
          {district.name}
          {district.fileCount > 0 && (
            <span className="district-label__count">{district.fileCount}</span>
          )}
        </button>
      </Html>
    </group>
  )
}

export const DistrictPlot = memo(DistrictImpl)
