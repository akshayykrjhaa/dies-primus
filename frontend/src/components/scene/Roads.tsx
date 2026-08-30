import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

import { lampsOn } from '../../lib/daylight'
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

/**
 * The colour the network is pulled toward while a building holds the focus.
 *
 * Focus mode used to fade the streets out with *opacity*, and that is what
 * made the roads look as though they had stopped rendering. Fading a material
 * means turning depth writing off with it -- otherwise a translucent surface
 * rejects whatever is behind it -- and the road network is three meshes
 * stacked within a tenth of a unit of each other: asphalt, kerbs, then the
 * painted dashes. With none of them writing depth, the order they are drawn in
 * is decided by a distance sort that sees all three as sitting at the world
 * origin, so it is effectively arbitrary; whenever the asphalt landed last it
 * painted straight over its own kerbs and markings. The street lost every
 * feature it had and read as a bare dark strip.
 *
 * Nothing was gained by making the ground see-through in the first place. A
 * road is flat: it can never stand between the camera and the building you
 * selected, which is the only thing transparency is for here. So the network
 * now stays fully opaque and steps back in *tone* instead, which recedes just
 * as well and cannot destroy the stack.
 */
const RECEDE = new THREE.Color('#2A3140')
/** How far toward `RECEDE` the streets go at full focus. */
const RECEDE_MIX = 0.34

export function Roads({
  roads,
  night = 0,
  dim = false,
}: {
  roads: Road[]
  night?: number
  /** True while a building holds the focus. */
  dim?: boolean
}) {
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
        dim={dim}
        plane
        receiveShadow
      />
      <Instanced
        matrices={kerbs}
        color={KERB}
        nightColor="#9EA9BC"
        night={night}
        dim={dim}
      />
      <Instanced
        matrices={dashes}
        color={PAINT}
        night={night}
        dim={dim}
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
 * the existing material afterwards, so neither the time of day nor the focus
 * state ever rebuilds the road network -- rebuilding a few thousand instances
 * every time the clock ticked was a visible hitch, and it reset the buffers
 * mid-fade.
 */
function Instanced({
  matrices,
  color,
  nightColor,
  night,
  dim = false,
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
  /** True while a building holds the focus; the street steps back in tone. */
  dim?: boolean
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
    // Claimed, so that any material sweep walking a parent group leaves the
    // street network alone. Its recession is a colour, not an opacity.
    material.userData.selfLit = true
    const instanced = new THREE.InstancedMesh(geometry, material, Math.max(1, matrices.length))
    matrices.forEach((matrix, index) => instanced.setMatrixAt(index, matrix))
    instanced.count = matrices.length
    instanced.instanceMatrix.needsUpdate = true
    instanced.receiveShadow = receiveShadow
    // A fixed order within the stack, so the asphalt is always laid down
    // before the kerbs and markings that lie on top of it.
    instanced.renderOrder = offset ? -8 : -9
    instanced.frustumCulled = false
    return instanced
  }, [matrices, plane, receiveShadow, offset, color])

  const day = useMemo(() => new THREE.Color(color), [color])
  const dark = useMemo(() => new THREE.Color(nightColor ?? color), [nightColor, color])
  const glow = useMemo(() => new THREE.Color(emissive ?? '#000000'), [emissive])
  const tone = useMemo(() => new THREE.Color(), [])

  /** Eased lamps-on level; null until the first frame, which lands on target. */
  const lit = useRef<number | null>(null)
  /** Eased focus recession, 0 = full city, 1 = a building has the focus. */
  const back = useRef(0)

  // A rebuilt mesh forgets where the ramp was, so the next frame writes into
  // the fresh material rather than leaving it on its constructor defaults.
  useEffect(() => {
    lit.current = null
  }, [mesh])

  useFrame((_, delta) => {
    const litTarget = lampsOn(night)
    const backTarget = dim ? 1 : 0
    const first = lit.current === null
    const litMoving = first || lit.current !== litTarget
    const backMoving = back.current !== backTarget

    // Both ramps at rest: a static scene costs two comparisons per frame.
    if (!litMoving && !backMoving) return

    if (first) {
      lit.current = litTarget
    } else if (litMoving) {
      const current = lit.current as number
      const k = Math.min(1, delta * 2.4)
      lit.current =
        Math.abs(current - litTarget) < 0.002
          ? litTarget
          : current + (litTarget - current) * k
    }

    if (backMoving) {
      const k = Math.min(1, delta * 6)
      back.current =
        Math.abs(back.current - backTarget) < 0.004
          ? backTarget
          : back.current + (backTarget - back.current) * k
    }

    const material = mesh.material as THREE.MeshLambertMaterial
    tone.copy(day).lerp(dark, lit.current as number)
    if (back.current > 0) tone.lerp(RECEDE, back.current * RECEDE_MIX)
    material.color.copy(tone)
    material.emissive.copy(glow)
    // The paint stops catching the light along with everything else, but it
    // never goes out: the centre line is most of what makes a dark street
    // legible as a street.
    material.emissiveIntensity =
      emissiveIntensity * (lit.current as number) * (1 - back.current * 0.35)
  })

  useEffect(
    () => () => {
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
    },
    [mesh],
  )

  return <primitive object={mesh} />
}
