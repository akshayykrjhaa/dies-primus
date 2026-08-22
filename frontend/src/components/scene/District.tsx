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

/** Thickness of the active district's outline, in world units. */
const OUTLINE_WIDTH = 1.1

/** The four sides of the outline: [signX, signZ, spansWidth, spansDepth]. */
const OUTLINE: Array<[number, number, boolean, boolean]> = [
  [0, -1, true, false],
  [0, 1, true, false],
  [-1, 0, false, true],
  [1, 0, false, true],
]

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

      {/* The active district is outlined, not repainted.
          
          It used to be marked by washing the whole plot with the district's
          language colour, and every *other* plot with a dark overlay -- so
          clicking one building silently restaged the ground colour of the
          entire city. The zone colour is information (grass for residential,
          pavement for downtown); it has to mean the same thing whatever is
          selected. A border says "this one" without touching it. */}
      {active &&
        OUTLINE.map(([sx, sz, fw, fd]) => (
          <mesh
            key={`${sx}:${sz}`}
            position={[
              sx * (width / 2 - OUTLINE_WIDTH / 2),
              LAYERS.districtHighlight,
              sz * (depth / 2 - OUTLINE_WIDTH / 2),
            ]}
            rotation={[-Math.PI / 2, 0, 0]}
          >
            <planeGeometry args={[fw ? width : OUTLINE_WIDTH, fd ? depth : OUTLINE_WIDTH]} />
            <meshBasicMaterial color={color} transparent opacity={0.85} toneMapped={false} />
          </mesh>
        ))}

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
