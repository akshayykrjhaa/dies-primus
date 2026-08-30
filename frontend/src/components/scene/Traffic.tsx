import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

import { lampsOn } from '../../lib/daylight'
import {
  buildFleet,
  buildGraph,
  SHAPES,
  stepFleet,
  trafficScratch,
  WHEEL_RADIUS,
  type Vehicle,
} from '../../lib/traffic'
import type { Road } from '../../types'

/**
 * Traffic, drawn.
 *
 * Everything about how the vehicles behave -- the road graph, car-following,
 * giving way at junctions -- lives in `lib/traffic.ts`, which knows nothing
 * about three.js and can therefore be run and checked without a canvas. This
 * file is only the part that puts what it decided on screen.
 *
 * Instanced by part: bodies (per-instance paint), cabins, wheels, head and
 * tail lamps. Five draw calls for a whole city's traffic.
 */

interface Props {
  roads: Road[]
  span: number
  /** 0 = day, 1 = full dark. Turns the head and tail lamps on. */
  night: number
}

export function Traffic({ roads, span, night }: Props) {
  const bodies = useRef<THREE.InstancedMesh>(null)
  const cabins = useRef<THREE.InstancedMesh>(null)
  const wheels = useRef<THREE.InstancedMesh>(null)
  const heads = useRef<THREE.InstancedMesh>(null)
  const tails = useRef<THREE.InstancedMesh>(null)
  const headMat = useRef<THREE.MeshBasicMaterial>(null)
  const tailMat = useRef<THREE.MeshBasicMaterial>(null)
  const lit = useRef(0)

  const edges = useMemo(() => buildGraph(roads), [roads])
  const fleet = useMemo<Vehicle[]>(() => buildFleet(edges, span), [edges, span])

  const geometry = useMemo(
    () => ({
      box: new THREE.BoxGeometry(1, 1, 1),
      wheel: (() => {
        const g = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.26, 10)
        g.rotateX(Math.PI / 2)
        return g
      })(),
      lamp: new THREE.PlaneGeometry(1, 1),
    }),
    [],
  )

  const scratch = useMemo(
    () => ({
      matrix: new THREE.Matrix4(),
      position: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      scale: new THREE.Vector3(),
      euler: new THREE.Euler(),
    }),
    [],
  )

  /** The simulation's own working set, allocated once. */
  const sim = useMemo(() => trafficScratch(), [])

  // The lamps drive their own opacity every frame; claim them so the
  // focus-mode sweep in CityScene leaves them alone rather than fighting it.
  useEffect(() => {
    for (const m of [headMat.current, tailMat.current]) {
      if (m) m.userData.selfLit = true
    }
  }, [])

  // Paint never changes, so it is written once -- in an effect, because a memo
  // runs before React has attached the ref and the fleet would come out white.
  useEffect(() => {
    const mesh = bodies.current
    if (!mesh) return
    fleet.forEach((vehicle, i) => mesh.setColorAt(i, vehicle.colour))
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [fleet])

  useFrame((state, delta) => {
    const body = bodies.current
    if (!body || fleet.length === 0) return

    const target = lampsOn(night)
    lit.current += (target - lit.current) * Math.min(1, delta * 2.4)
    if (headMat.current) headMat.current.opacity = 0.12 + lit.current * 0.88
    if (tailMat.current) tailMat.current.opacity = 0.22 + lit.current * 0.78

    // Decide where everything is, then draw it. The two used to be a single
    // interleaved loop, which is why none of the traffic rules could be
    // exercised without a renderer attached.
    stepFleet(edges, fleet, delta, state.clock.elapsedTime, sim)

    const { matrix, position, quaternion, scale, euler } = scratch

    fleet.forEach((vehicle, i) => {
      const shape = SHAPES[vehicle.kind]
      const facing = vehicle.facing
      const fx = Math.cos(facing)
      const fz = -Math.sin(facing)
      const x = vehicle.renderX
      const z = vehicle.renderZ
      const lean = (vehicle.throttle - 0.5) * 0.025
      const bodyY = shape.height / 2 + WHEEL_RADIUS

      euler.set(0, facing, lean)
      quaternion.setFromEuler(euler)

      position.set(x, bodyY, z)
      scale.set(shape.length, shape.height, shape.width)
      body.setMatrixAt(i, matrix.compose(position, quaternion, scale))

      const cabOffset = shape.length * shape.cabAt
      position.set(
        x + fx * cabOffset,
        bodyY + shape.height / 2 + (shape.height * shape.cab) / 2,
        z + fz * cabOffset,
      )
      scale.set(shape.length * 0.52, Math.max(0.32, shape.height * shape.cab), shape.width * 0.88)
      cabins.current?.setMatrixAt(i, matrix.compose(position, quaternion, scale))

      let w = 0
      for (const forward of [-shape.length * 0.31, shape.length * 0.31]) {
        for (const side of [-shape.width * 0.52, shape.width * 0.52]) {
          position.set(x + fx * forward - fz * side, WHEEL_RADIUS, z + fz * forward + fx * side)
          scale.set(1, 1, 1)
          wheels.current?.setMatrixAt(i * 4 + w, matrix.compose(position, quaternion, scale))
          w++
        }
      }

      // Lamps face the way they shine: a plane's normal is +Z, so pointing it
      // along the travel direction is a quarter turn from the body's heading.
      const nose = shape.length * 0.5 + 0.03
      let lamp = 0
      for (const side of [-shape.width * 0.34, shape.width * 0.34]) {
        position.set(x + fx * nose - fz * side, bodyY + shape.height * 0.06, z + fz * nose + fx * side)
        euler.set(0, facing + Math.PI / 2, 0)
        quaternion.setFromEuler(euler)
        scale.set(0.42, 0.26, 1)
        heads.current?.setMatrixAt(i * 2 + lamp, matrix.compose(position, quaternion, scale))

        position.set(x - fx * nose - fz * side, bodyY + shape.height * 0.1, z - fz * nose + fx * side)
        euler.set(0, facing - Math.PI / 2, 0)
        quaternion.setFromEuler(euler)
        scale.set(0.4, 0.22, 1)
        tails.current?.setMatrixAt(i * 2 + lamp, matrix.compose(position, quaternion, scale))
        lamp++
      }

      euler.set(0, facing, lean)
      quaternion.setFromEuler(euler)
    })

    body.instanceMatrix.needsUpdate = true
    if (cabins.current) cabins.current.instanceMatrix.needsUpdate = true
    if (wheels.current) wheels.current.instanceMatrix.needsUpdate = true
    if (heads.current) heads.current.instanceMatrix.needsUpdate = true
    if (tails.current) tails.current.instanceMatrix.needsUpdate = true
  })

  if (fleet.length === 0) return null

  return (
    <group>
      <instancedMesh ref={bodies} args={[geometry.box, undefined, fleet.length]} castShadow frustumCulled={false}>
        <meshLambertMaterial />
      </instancedMesh>
      <instancedMesh ref={cabins} args={[geometry.box, undefined, fleet.length]} castShadow frustumCulled={false}>
        <meshLambertMaterial color="#D3E1EC" />
      </instancedMesh>
      <instancedMesh ref={wheels} args={[geometry.wheel, undefined, fleet.length * 4]} frustumCulled={false}>
        <meshLambertMaterial color="#1E2228" />
      </instancedMesh>
      <instancedMesh ref={heads} args={[geometry.lamp, undefined, fleet.length * 2]} frustumCulled={false}>
        <meshBasicMaterial
          ref={headMat} color="#FFF3D0" transparent opacity={0.12}
          side={THREE.DoubleSide} depthWrite={false} toneMapped={false}
        />
      </instancedMesh>
      <instancedMesh ref={tails} args={[geometry.lamp, undefined, fleet.length * 2]} frustumCulled={false}>
        <meshBasicMaterial
          ref={tailMat} color="#FF4636" transparent opacity={0.22}
          side={THREE.DoubleSide} depthWrite={false} toneMapped={false}
        />
      </instancedMesh>
    </group>
  )
}
