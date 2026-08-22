import { useEffect, useMemo } from 'react'
import * as THREE from 'three'

import { LAYERS } from '../../lib/layers'
import type { Road } from '../../types'
import { useLightRamp } from './useLightRamp'

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

  // Asphalt lightens slightly at night so the street grid still reads, and the
  // paint picks up a glow as though catching the lamps. Both used to flip at a
  // hard `night > 0.15`, which snapped the whole road network to its night
  // colours a frame before the lamps themselves came on; each mesh now eases
  // on the same ramp as every other light in the city.
  return (
    <group>
      <Instanced
        matrices={surfaces}
        color={ASPHALT}
        nightColor="#3A4354"
        night={night}
        plane
        receiveShadow
      />
      <Instanced matrices={kerbs} color={KERB} nightColor="#9EA9BC" night={night} />
      <Instanced
        matrices={dashes}
        color={PAINT}
        night={night}
        plane
        offset
        emissive="#FFE9A8"
        emissiveIntensity={0.9}
      />
    </group>
  )
}

/**
 * A tiny instanced-mesh helper: one draw call per colour.
 *
 * The mesh is built from geometry inputs only. Colour and glow are pushed into
 * the existing material afterwards, so the time of day never rebuilds the road
 * network -- rebuilding a few thousand instances every time the clock ticked
 * was a visible hitch, and it reset the buffers mid-fade.
 */
function Instanced({
  matrices,
  color,
  nightColor,
  night,
  plane = false,
  receiveShadow = false,
  offset = false,
  emissive,
  emissiveIntensity = 0,
}: {
  matrices: THREE.Matrix4[]
  color: THREE.ColorRepresentation
  /** Colour at full dark; the ramp eases between the two. */
  nightColor?: THREE.ColorRepresentation
  night: number
  plane?: boolean
  receiveShadow?: boolean
  /** Nudges the depth test for markings painted onto the asphalt. */
  offset?: boolean
  emissive?: THREE.ColorRepresentation
  /** Glow at full dark. Scaled by the ramp, so it is zero in daylight. */
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
    })
    const instanced = new THREE.InstancedMesh(geometry, material, Math.max(1, matrices.length))
    matrices.forEach((matrix, index) => instanced.setMatrixAt(index, matrix))
    instanced.count = matrices.length
    instanced.instanceMatrix.needsUpdate = true
    instanced.receiveShadow = receiveShadow
    instanced.frustumCulled = false
    return instanced
  }, [matrices, plane, receiveShadow, offset, color])

  const day = useMemo(() => new THREE.Color(color), [color])
  const dark = useMemo(
    () => new THREE.Color(nightColor ?? color),
    [nightColor, color],
  )

  useLightRamp(night, (lit) => {
    const material = mesh.material as THREE.MeshLambertMaterial
    material.color.copy(day).lerp(dark, lit)
    material.emissive.set(emissive ?? '#000000')
    material.emissiveIntensity = emissiveIntensity * lit
  }, mesh)

  useEffect(
    () => () => {
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
    },
    [mesh],
  )

  return <primitive object={mesh} />
}
