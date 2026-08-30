import { useEffect, useMemo } from 'react'
import * as THREE from 'three'

import { LAYERS } from '../../lib/layers'
import type { Prop } from '../../types'
import { useLightRamp } from './useLightRamp'

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

/** The colour a lamp head takes when it is lit. */
const LAMP_LIT = new THREE.Color('#FFF0B8')

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
  // The head is a dull fitting by day and a lit lamp after dark. The colour
  // is held constant so the mesh is not rebuilt as the light changes; only
  // the emissive is animated, and it ramps continuously rather than snapping
  // at a threshold, so dusk fades the lamps up instead of flicking them on.
  const headMesh = useInstanced(heads, headGeo, '#E4E2DA', false)
  useLightRamp(night, (glow) => {
    const material = headMesh.material as THREE.MeshLambertMaterial
    material.emissive.set('#FFD98A')
    material.emissiveIntensity = glow * 1.9
    material.color.set('#C9CED6').lerp(LAMP_LIT, glow)
    // The pool of light under the lamp rides the very same value, so the bulb
    // and its pool can never be seen to come on at different moments.
    ;(poolMesh.material as THREE.MeshBasicMaterial).opacity = glow * 0.5
  }, headMesh)

  // A pool of light on the pavement under each lamp. Real point lights would
  // be dozens of extra shadow-casting sources; an additive disc costs one
  // instanced mesh and reads the same from the air.
  const pools = useMemo(
    () => items.map((p) => {
      const matrix = new THREE.Matrix4()
      matrix.compose(
        new THREE.Vector3(p.x, LAYERS.lampPool, p.z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)),
        new THREE.Vector3(6.4, 6.4, 1),
      )
      return matrix
    }),
    [items],
  )
  const poolGeo = useMemo(() => new THREE.CircleGeometry(1, 44), [])

  // A flat disc of colour reads as a plate lying on the road, however faint --
  // which is exactly what these looked like. The falloff texture makes the
  // pool bright under the lamp and nothing at its edge, so it reads as light
  // landing on the ground.
  const poolTexture = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    const ctx = canvas.getContext('2d')!
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
    gradient.addColorStop(0, 'rgba(255, 226, 168, 1)')
    gradient.addColorStop(0.45, 'rgba(255, 214, 140, 0.42)')
    gradient.addColorStop(1, 'rgba(255, 205, 120, 0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 64, 64)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    return texture
  }, [])

  const poolMesh = useMemo(() => {
    const material = new THREE.MeshBasicMaterial({
      map: poolTexture,
      color: '#FFD98A',
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      // Biased toward the camera in screen space.
      //
      // The pool is a flat disc a few tenths of a unit above ground that is
      // itself made of several stacked planes -- asphalt, kerb, apron, plot,
      // lawn. Viewed along the ground those separations collapse in the depth
      // buffer, and the disc lost the comparison in patches, which is what
      // tore it into the angular fragments it was rendering as. Nudging its
      // depth toward the viewer wins against surfaces it is lying on while
      // still losing, correctly, to anything genuinely in front of it.
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -12,
      toneMapped: false,
    })
    const mesh = new THREE.InstancedMesh(poolGeo, material, Math.max(1, pools.length))
    pools.forEach((matrix, index) => mesh.setMatrixAt(index, matrix))
    mesh.count = pools.length
    mesh.instanceMatrix.needsUpdate = true
    mesh.frustumCulled = false
    return mesh
  }, [poolGeo, poolTexture, pools])

  // The pool drives its own opacity; keep the focus-mode sweep off it.
  useEffect(() => {
    ;(poolMesh.material as THREE.Material).userData.selfLit = true
  }, [poolMesh])

  return (
    <group>
      <primitive object={postMesh} />
      <primitive object={headMesh} />
      {/* Always mounted: the ramp writes its opacity, and unmounting it at a
          threshold was itself a pop. At zero opacity it costs one culled
          draw. */}
      <primitive object={poolMesh} />
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

  return (
    <group>
      {grouped.tree?.length ? <Trees items={grouped.tree} /> : null}
      {grouped.palm?.length ? <Palms items={grouped.palm} /> : null}
      {grouped.lamp?.length ? <Lamps items={grouped.lamp} night={night} /> : null}
      {grouped.park?.length ? <Parks items={grouped.park} /> : null}
      {/* Vehicles now live in Traffic.tsx, which drives them along lanes it
          derives from the road network and lights them after dark. The
          generator still emits the props; they are simply no longer the
          thing that draws the traffic. */}
      {grouped.stadium?.map((prop, index) => (
        <Stadium key={index} prop={prop} />
      ))}
    </group>
  )
}
