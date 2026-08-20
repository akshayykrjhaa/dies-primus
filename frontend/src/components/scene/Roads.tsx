import { useMemo } from 'react'
import * as THREE from 'three'

import { LAYERS } from '../../lib/layers'
import type { Road } from '../../types'

/**
 * The street network.
 *
 * The gaps left by the plot packer are drawn as real roads: asphalt, a kerb on
 * each side, and a dashed centre line. Drawing them explicitly is what turns
 * the layout from "boxes with space between them" into a city block plan.
 *
 * Everything here is merged into a handful of instanced meshes, so a hundred
 * road segments still cost only a few draw calls.
 */

const ASPHALT = '#4A4F58'
const KERB = '#C8CDD4'
const PAINT = '#F2E9C9'

export function Roads({ roads, night = 0 }: { roads: Road[]; night?: number }) {
  const { surfaces, kerbs, dashes } = useMemo(() => {
    const surfaces: THREE.Matrix4[] = []
    const kerbs: THREE.Matrix4[] = []
    const dashes: THREE.Matrix4[] = []
    const matrix = new THREE.Matrix4()
    const quaternion = new THREE.Quaternion()
    const scale = new THREE.Vector3()
    const position = new THREE.Vector3()
    const flat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0))

    for (const road of roads) {
      const alongX = road.axis === 'x'
      const length = road.length
      const width = road.width

      // Asphalt
      position.set(road.x, LAYERS.roadSurface, road.z)
      scale.set(alongX ? length : width, alongX ? width : length, 1)
      matrix.compose(position, flat, scale)
      surfaces.push(matrix.clone())

      // Kerbs down both sides
      for (const side of [-1, 1]) {
        position.set(
          road.x + (alongX ? 0 : (side * width) / 2),
          0.09,
          road.z + (alongX ? (side * width) / 2 : 0),
        )
        scale.set(alongX ? length : 0.55, 0.18, alongX ? 0.55 : length)
        matrix.compose(position, quaternion, scale)
        kerbs.push(matrix.clone())
      }

      // Dashed centre line
      const dashCount = Math.max(2, Math.floor(length / 6))
      for (let i = 0; i < dashCount; i++) {
        const t = -length / 2 + (i + 0.5) * (length / dashCount)
        position.set(road.x + (alongX ? t : 0), LAYERS.roadMarking, road.z + (alongX ? 0 : t))
        scale.set(alongX ? 2.6 : 0.28, alongX ? 0.28 : 2.6, 1)
        matrix.compose(position, flat, scale)
        dashes.push(matrix.clone())
      }
    }
    return { surfaces, kerbs, dashes }
  }, [roads])

  return (
    <group>
      {/* Asphalt lightens slightly at night so the street grid still reads,
          and the paint picks up a glow as though catching the lamps. */}
      <Instanced
        matrices={surfaces}
        color={night > 0.15 ? '#3A4354' : ASPHALT}
        plane
        receiveShadow
      />
      <Instanced matrices={kerbs} color={night > 0.15 ? '#9EA9BC' : KERB} />
      <Instanced
        matrices={dashes}
        color={PAINT}
        plane
        offset
        emissive={night > 0.15 ? '#FFE9A8' : undefined}
        emissiveIntensity={night * 0.9}
      />
    </group>
  )
}

/** A tiny instanced-mesh helper: one draw call per colour. */
function Instanced({
  matrices,
  color,
  plane = false,
  receiveShadow = false,
  offset = false,
  emissive,
  emissiveIntensity = 0,
}: {
  matrices: THREE.Matrix4[]
  color: string
  plane?: boolean
  receiveShadow?: boolean
  /** Nudges the depth test for markings painted onto the asphalt. */
  offset?: boolean
  emissive?: string
  emissiveIntensity?: number
}) {
  const mesh = useMemo(() => {
    const geometry = plane
      ? new THREE.PlaneGeometry(1, 1)
      : new THREE.BoxGeometry(1, 1, 1)
    const material = new THREE.MeshLambertMaterial({
      color,
      polygonOffset: offset,
      polygonOffsetFactor: offset ? -2 : 0,
      polygonOffsetUnits: offset ? -2 : 0,
      emissive: new THREE.Color(emissive ?? '#000000'),
      emissiveIntensity,
    })
    const instanced = new THREE.InstancedMesh(geometry, material, Math.max(1, matrices.length))
    matrices.forEach((matrix, index) => instanced.setMatrixAt(index, matrix))
    instanced.count = matrices.length
    instanced.instanceMatrix.needsUpdate = true
    instanced.receiveShadow = receiveShadow
    instanced.frustumCulled = false
    return instanced
  }, [matrices, color, plane, receiveShadow, offset, emissive, emissiveIntensity])

  return <primitive object={mesh} />
}
