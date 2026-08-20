import { useMemo } from 'react'
import * as THREE from 'three'

import { LAYERS } from '../../lib/layers'
import type { Prop } from '../../types'

/**
 * Street furniture: trees, palms, lamps, parked vehicles, park lawns and the
 * stadium.
 *
 * A city of several hundred buildings can easily carry a thousand props, so
 * everything here is instanced by type — each kind costs one or two draw calls
 * no matter how many appear.
 */

function useInstanced(
  matrices: THREE.Matrix4[],
  geometry: THREE.BufferGeometry,
  color: string,
  castShadow = true,
) {
  return useMemo(() => {
    const material = new THREE.MeshLambertMaterial({ color })
    const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, matrices.length))
    matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix))
    mesh.count = matrices.length
    mesh.instanceMatrix.needsUpdate = true
    mesh.castShadow = castShadow
    mesh.receiveShadow = true
    mesh.frustumCulled = false
    return mesh
  }, [matrices, geometry, color, castShadow])
}

function compose(x: number, y: number, z: number, rotY: number, sx: number, sy: number, sz: number) {
  const matrix = new THREE.Matrix4()
  matrix.compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0)),
    new THREE.Vector3(sx, sy, sz),
  )
  return matrix
}

/** Trunks + canopies, drawn as two instanced sets. */
function Trees({ items }: { items: Prop[] }) {
  const trunks = useMemo(
    () => items.map((p) => compose(p.x, 1.1 * p.scale, p.z, p.rotation, p.scale, p.scale, p.scale)),
    [items],
  )
  const canopies = useMemo(
    () => items.map((p) => compose(p.x, 2.9 * p.scale, p.z, p.rotation, p.scale, p.scale, p.scale)),
    [items],
  )

  const trunkGeo = useMemo(() => new THREE.CylinderGeometry(0.16, 0.22, 2.2, 6), [])
  const canopyGeo = useMemo(() => new THREE.IcosahedronGeometry(1.5, 0), [])

  const trunkMesh = useInstanced(trunks, trunkGeo, '#7A5A3A')
  const canopyMesh = useInstanced(canopies, canopyGeo, '#4F8F3A')

  return (
    <group>
      <primitive object={trunkMesh} />
      <primitive object={canopyMesh} />
    </group>
  )
}

function Palms({ items }: { items: Prop[] }) {
  const trunks = useMemo(
    () => items.map((p) => compose(p.x, 2.2 * p.scale, p.z, p.rotation, p.scale, p.scale, p.scale)),
    [items],
  )
  const fronds = useMemo(
    () => items.map((p) => compose(p.x, 4.4 * p.scale, p.z, p.rotation, p.scale, p.scale, p.scale)),
    [items],
  )
  const trunkGeo = useMemo(() => new THREE.CylinderGeometry(0.13, 0.2, 4.4, 6), [])
  const frondGeo = useMemo(() => new THREE.ConeGeometry(1.7, 1.0, 6), [])

  const trunkMesh = useInstanced(trunks, trunkGeo, '#8A6A44')
  const frondMesh = useInstanced(fronds, frondGeo, '#3F9B52')

  return (
    <group>
      <primitive object={trunkMesh} />
      <primitive object={frondMesh} />
    </group>
  )
}

function Lamps({ items, night = 0 }: { items: Prop[]; night?: number }) {
  const posts = useMemo(
    () => items.map((p) => compose(p.x, 2.4, p.z, p.rotation, 1, 1, 1)),
    [items],
  )
  const heads = useMemo(
    () => items.map((p) => compose(p.x, 4.9, p.z, p.rotation, 1, 1, 1)),
    [items],
  )
  const postGeo = useMemo(() => new THREE.CylinderGeometry(0.09, 0.12, 4.8, 6), [])
  const headGeo = useMemo(() => new THREE.BoxGeometry(0.9, 0.22, 0.34), [])

  const postMesh = useInstanced(posts, postGeo, '#9AA3AE', false)
  // The head is a dull fitting by day and a lit lamp after dark.
  const headMesh = useInstanced(heads, headGeo, night > 0.15 ? '#FFF0B8' : '#C9CEd6', false)
  useMemo(() => {
    const material = headMesh.material as THREE.MeshLambertMaterial
    material.emissive = new THREE.Color(night > 0.15 ? '#FFD98A' : '#000000')
    material.emissiveIntensity = night * 2.2
    material.needsUpdate = true
    return null
  }, [headMesh, night])

  // A pool of light on the pavement under each lamp. Real point lights would
  // be dozens of extra shadow-casting sources; an additive disc costs one
  // instanced mesh and reads the same from the air.
  const pools = useMemo(
    () => items.map((p) => {
      const matrix = new THREE.Matrix4()
      matrix.compose(
        new THREE.Vector3(p.x, LAYERS.lampPool, p.z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)),
        new THREE.Vector3(7, 7, 1),
      )
      return matrix
    }),
    [items],
  )
  const poolGeo = useMemo(() => new THREE.CircleGeometry(1, 20), [])
  const poolMesh = useMemo(() => {
    const material = new THREE.MeshBasicMaterial({
      color: '#FFD98A',
      transparent: true,
      opacity: Math.max(0, night - 0.12) * 0.3,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    })
    const mesh = new THREE.InstancedMesh(poolGeo, material, Math.max(1, pools.length))
    pools.forEach((matrix, index) => mesh.setMatrixAt(index, matrix))
    mesh.count = pools.length
    mesh.instanceMatrix.needsUpdate = true
    mesh.frustumCulled = false
    return mesh
  }, [poolGeo, pools, night])

  return (
    <group>
      <primitive object={postMesh} />
      <primitive object={headMesh} />
      {night > 0.12 && <primitive object={poolMesh} />}
    </group>
  )
}

/** Cars, vans, buses and trucks: a body, a cabin and four wheels. */
function Vehicles({ items }: { items: Prop[] }) {
  const spec: Record<string, { l: number; w: number; h: number; cab: number }> = {
    car: { l: 4.0, w: 1.8, h: 0.75, cab: 0.62 },
    van: { l: 4.8, w: 2.0, h: 1.1, cab: 0.5 },
    bus: { l: 8.4, w: 2.4, h: 1.9, cab: 0.2 },
    truck: { l: 7.4, w: 2.3, h: 1.6, cab: 0.34 },
  }

  const groups = useMemo(() => {
    const byColor = new Map<string, { bodies: THREE.Matrix4[]; cabins: THREE.Matrix4[] }>()
    const wheels: THREE.Matrix4[] = []

    for (const prop of items) {
      const size = spec[prop.type] ?? spec.car
      const entry = byColor.get(prop.color) ?? { bodies: [], cabins: [] }
      entry.bodies.push(
        compose(prop.x, size.h / 2 + 0.34, prop.z, prop.rotation, size.l, size.h, size.w),
      )
      entry.cabins.push(
        compose(
          prop.x - Math.sin(prop.rotation) * size.l * 0.1,
          size.h + 0.34 + size.h * size.cab * 0.5,
          prop.z - Math.cos(prop.rotation) * size.l * 0.1,
          prop.rotation,
          size.l * 0.55,
          Math.max(0.3, size.h * size.cab),
          size.w * 0.9,
        ),
      )
      byColor.set(prop.color, entry)

      for (const dx of [-size.l * 0.32, size.l * 0.32]) {
        for (const dz of [-size.w * 0.5, size.w * 0.5]) {
          const cos = Math.cos(prop.rotation)
          const sin = Math.sin(prop.rotation)
          wheels.push(
            compose(
              prop.x + dx * cos - dz * sin,
              0.34,
              prop.z + dx * sin + dz * cos,
              prop.rotation,
              1,
              1,
              1,
            ),
          )
        }
      }
    }
    return { byColor, wheels }
  }, [items])

  const bodyGeo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), [])
  const wheelGeo = useMemo(() => {
    const geometry = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 8)
    geometry.rotateX(Math.PI / 2)
    return geometry
  }, [])
  const wheelMesh = useInstanced(groups.wheels, wheelGeo, '#22262C', false)

  return (
    <group>
      {[...groups.byColor.entries()].map(([color, entry]) => (
        <ColouredVehicles key={color} color={color} bodies={entry.bodies} cabins={entry.cabins} geo={bodyGeo} />
      ))}
      <primitive object={wheelMesh} />
    </group>
  )
}

function ColouredVehicles({
  color,
  bodies,
  cabins,
  geo,
}: {
  color: string
  bodies: THREE.Matrix4[]
  cabins: THREE.Matrix4[]
  geo: THREE.BufferGeometry
}) {
  const bodyMesh = useInstanced(bodies, geo, color)
  const cabinMesh = useInstanced(cabins, geo, '#D8E4EE')
  return (
    <group>
      <primitive object={bodyMesh} />
      <primitive object={cabinMesh} />
    </group>
  )
}

/** Park lawns: a grass pad with a path and a bench-sized block. */
function Parks({ items }: { items: Prop[] }) {
  const lawns = useMemo(
    () =>
      items.map((p) => {
        const matrix = new THREE.Matrix4()
        matrix.compose(
          new THREE.Vector3(p.x, LAYERS.parkLawn, p.z),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, p.rotation)),
          new THREE.Vector3(8.4 * p.scale, 8.4 * p.scale, 1),
        )
        return matrix
      }),
    [items],
  )
  const bushes = useMemo(
    () => items.map((p) => compose(p.x + 1.6, 0.6, p.z + 1.2, p.rotation, 1, 1, 1)),
    [items],
  )
  const lawnGeo = useMemo(() => new THREE.CircleGeometry(0.5, 16), [])
  const bushGeo = useMemo(() => new THREE.IcosahedronGeometry(0.85, 0), [])

  const lawnMesh = useInstanced(lawns, lawnGeo, '#6FAF57', false)
  const bushMesh = useInstanced(bushes, bushGeo, '#4F8F3A')

  return (
    <group>
      <primitive object={lawnMesh} />
      <primitive object={bushMesh} />
    </group>
  )
}

/** The stadium: a banked oval bowl with a pitch inside. */
function Stadium({ prop }: { prop: Prop }) {
  return (
    <group position={[prop.x, 0, prop.z]} rotation={[0, prop.rotation, 0]}>
      {/* pitch */}
      <mesh position={[0, 0.3, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[22, 15]} />
        <meshLambertMaterial color="#4E9B3F" />
      </mesh>
      <mesh position={[0, 0.36, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[2.4, 2.6, 28]} />
        <meshBasicMaterial color="#EAF3E4" />
      </mesh>
      {/* stands */}
      <mesh position={[0, 3.2, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[17.5, 15.5, 6.4, 28, 1, true]} />
        <meshLambertMaterial color="#D8DCE2" side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 5.6, 0]} castShadow>
        <torusGeometry args={[16.6, 0.7, 8, 32]} />
        <meshLambertMaterial color={prop.color} />
      </mesh>
      {/* floodlights */}
      {[0, 1, 2, 3].map((i) => {
        const angle = (i / 4) * Math.PI * 2 + Math.PI / 4
        return (
          <group key={i} position={[Math.cos(angle) * 17, 0, Math.sin(angle) * 17]}>
            <mesh position={[0, 5, 0]}>
              <cylinderGeometry args={[0.2, 0.28, 10, 6]} />
              <meshLambertMaterial color="#B4BCC6" />
            </mesh>
            <mesh position={[0, 10.4, 0]}>
              <boxGeometry args={[2.4, 1.1, 0.5]} />
              <meshBasicMaterial color="#FFF3C4" />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}

export function CityProps({ props: items, night = 0 }: { props: Prop[]; night?: number }) {
  const grouped = useMemo(() => {
    const bag: Record<string, Prop[]> = {}
    for (const prop of items) (bag[prop.type] ??= []).push(prop)
    return bag
  }, [items])

  const vehicles = useMemo(
    () => [
      ...(grouped.car ?? []),
      ...(grouped.van ?? []),
      ...(grouped.bus ?? []),
      ...(grouped.truck ?? []),
    ],
    [grouped],
  )

  return (
    <group>
      {grouped.tree?.length ? <Trees items={grouped.tree} /> : null}
      {grouped.palm?.length ? <Palms items={grouped.palm} /> : null}
      {grouped.lamp?.length ? <Lamps items={grouped.lamp} night={night} /> : null}
      {grouped.park?.length ? <Parks items={grouped.park} /> : null}
      {vehicles.length ? <Vehicles items={vehicles} /> : null}
      {grouped.stadium?.map((prop, index) => (
        <Stadium key={index} prop={prop} />
      ))}
    </group>
  )
}
