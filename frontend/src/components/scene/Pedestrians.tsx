import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

import type { District } from '../../types'

/**
 * People.
 *
 * Each one is a jointed figure -- torso, head, two arms, two legs -- and the
 * limbs are animated separately: legs swing opposite each other, arms
 * counter-swing against the legs, and the body rises on each push-off.
 *
 * The mechanism worth explaining is the pivot. Instancing gives every limb its
 * own transform, but they all share one geometry, so an arm cannot bend at the
 * elbow. It can, however, rotate as a whole *about its top*, which is what a
 * shoulder does -- so the limb geometry is built with its origin at the top
 * rather than the centre. Rotating it then swings it from the joint instead of
 * spinning it about its middle.
 *
 * They live on the district plots: walking the verge, standing about, or
 * talking in pairs. Four instanced meshes for the whole population, and the
 * crowd is deliberately small -- a street has a handful of people on it, not a
 * demonstration.
 */

interface Props {
  districts: District[]
  /** The city's larger dimension; the crowd is sized from it. */
  span: number
}

const CLOTHES = [
  '#3D5A80', '#C1554E', '#2A9D8F', '#8E7DBE', '#E0B33C',
  '#4A6E4F', '#B5654A', '#5C6B8A', '#A8506B', '#347C98',
]
const SKIN = ['#E8C39E', '#C68B65', '#8D5A3C', '#F0D0B0', '#6B4430']
const LEGWEAR = ['#2E3440', '#3B4252', '#4C566A', '#553C2E', '#31465C']

// A figure about 1.7 units tall, against a 2.6-unit storey.
const LEG_LENGTH = 0.74
const TORSO_HEIGHT = 0.6
const ARM_LENGTH = 0.56
const HEAD_RADIUS = 0.17

/** A street holds a few people, not a crowd. */
const CROWD_CAP = 30

type Doing = 'walk' | 'stand' | 'talk'

interface Person {
  doing: Doing
  loop: { x: number; z: number }[]
  loopLength: number
  at: number
  speed: number
  x: number
  z: number
  heading: number
  shirt: THREE.Color
  trousers: THREE.Color
  skin: THREE.Color
  phase: number
  /** Stride rate. */
  rate: number
  /** Talkers alternate: one gestures while the other listens. */
  lead: boolean
  build: number
}

function mulberry(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** The rectangle a walker follows, inset from the plot edge onto the verge. */
function perimeter(district: District, inset: number) {
  const hw = Math.max(1.5, district.width / 2 - inset)
  const hd = Math.max(1.5, district.depth / 2 - inset)
  return {
    loop: [
      { x: district.x - hw, z: district.z - hd },
      { x: district.x + hw, z: district.z - hd },
      { x: district.x + hw, z: district.z + hd },
      { x: district.x - hw, z: district.z + hd },
    ],
    loopLength: (hw + hd) * 4,
  }
}

/**
 * Position and facing at a distance along a closed rectangular loop.
 *
 * A figure's *front* is its local +Z, so the facing that points it along a
 * direction is `atan2(dx, dz)` -- not the same convention as a vehicle, which
 * is oriented by its length along local +X.
 */
function alongLoop(loop: { x: number; z: number }[], distance: number) {
  let left = distance
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i]
    const b = loop[(i + 1) % loop.length]
    const dx = b.x - a.x
    const dz = b.z - a.z
    const side = Math.hypot(dx, dz)
    if (left <= side) {
      const t = side > 0 ? left / side : 0
      return { x: a.x + dx * t, z: a.z + dz * t, heading: Math.atan2(dx, dz) }
    }
    left -= side
  }
  return { x: loop[0].x, z: loop[0].z, heading: 0 }
}

export function Pedestrians({ districts, span }: Props) {
  const torsos = useRef<THREE.InstancedMesh>(null)
  const headsRef = useRef<THREE.InstancedMesh>(null)
  const armsRef = useRef<THREE.InstancedMesh>(null)
  const legsRef = useRef<THREE.InstancedMesh>(null)

  const crowd = useMemo<Person[]>(() => {
    const plots = districts.filter((d) => d.path !== '__stadium__' && d.width > 12)
    if (plots.length === 0) return []
    const random = mulberry(Math.round(span * 331) + plots.length)
    const people: Person[] = []

    for (const district of plots) {
      if (people.length >= CROWD_CAP) break
      const { loop, loopLength } = perimeter(district, 2.2)
      const many = Math.max(1, Math.min(3, Math.round(district.fileCount * 0.2)))

      for (let i = 0; i < many && people.length < CROWD_CAP; i++) {
        const roll = random()
        const dress = () => ({
          loop,
          loopLength,
          shirt: new THREE.Color(CLOTHES[Math.floor(random() * CLOTHES.length)]),
          trousers: new THREE.Color(LEGWEAR[Math.floor(random() * LEGWEAR.length)]),
          skin: new THREE.Color(SKIN[Math.floor(random() * SKIN.length)]),
          phase: random() * Math.PI * 2,
          rate: 1.5 + random() * 0.7,
          build: 0.9 + random() * 0.22,
        })

        if (roll < 0.6) {
          people.push({
            ...dress(), doing: 'walk', lead: false,
            at: random() * loopLength,
            speed: 1.0 + random() * 0.8,
            x: 0, z: 0, heading: 0,
          })
        } else if (roll < 0.78) {
          const spot = alongLoop(loop, random() * loopLength)
          people.push({
            ...dress(), doing: 'stand', lead: false,
            at: 0, speed: 0, x: spot.x, z: spot.z,
            heading: random() * Math.PI * 2,
          })
        } else {
          // A pair, facing each other across a conversational gap.
          const spot = alongLoop(loop, random() * loopLength)
          const facing = random() * Math.PI * 2
          const gap = 0.55
          const ox = Math.sin(facing) * gap
          const oz = Math.cos(facing) * gap
          people.push({
            ...dress(), doing: 'talk', lead: true,
            at: 0, speed: 0, x: spot.x + ox, z: spot.z + oz,
            heading: facing + Math.PI,
          })
          people.push({
            ...dress(), doing: 'talk', lead: false,
            at: 0, speed: 0, x: spot.x - ox, z: spot.z - oz,
            heading: facing,
          })
          i++ // the pair counts as two
        }
      }
    }
    return people
  }, [districts, span])

  /**
   * Limb geometry hangs from its origin, so a rotation swings it from the
   * joint. A centred box would pivot about its own middle, which reads as a
   * propeller rather than a leg.
   */
  const geometry = useMemo(() => {
    const limb = new THREE.BoxGeometry(1, 1, 1)
    limb.translate(0, -0.5, 0)
    return {
      torso: new THREE.BoxGeometry(1, 1, 1),
      head: new THREE.SphereGeometry(0.5, 8, 6),
      limb,
    }
  }, [])

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

  // Colours, in an effect so the refs exist. Arms take skin, legs trousers --
  // two instances each per person.
  useEffect(() => {
    const torso = torsos.current
    const head = headsRef.current
    const arms = armsRef.current
    const legs = legsRef.current
    if (!torso || !head || !arms || !legs) return
    crowd.forEach((person, i) => {
      torso.setColorAt(i, person.shirt)
      head.setColorAt(i, person.skin)
      arms.setColorAt(i * 2, person.skin)
      arms.setColorAt(i * 2 + 1, person.skin)
      legs.setColorAt(i * 2, person.trousers)
      legs.setColorAt(i * 2 + 1, person.trousers)
    })
    for (const mesh of [torso, head, arms, legs]) {
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  }, [crowd])

  useFrame((state, delta) => {
    const torso = torsos.current
    const head = headsRef.current
    const arms = armsRef.current
    const legs = legsRef.current
    if (!torso || !head || !arms || !legs || crowd.length === 0) return

    const time = state.clock.elapsedTime
    const step = Math.min(delta, 0.05)
    const { matrix, position, quaternion, scale, euler } = scratch

    crowd.forEach((person, i) => {
      let x = person.x
      let z = person.z
      let heading = person.heading
      let lift = 0
      let legSwing = 0
      let armSwing = 0
      let lean = 0

      if (person.doing === 'walk') {
        person.at += person.speed * step
        if (person.at > person.loopLength) person.at -= person.loopLength
        const spot = alongLoop(person.loop, person.at)
        x = spot.x
        z = spot.z
        heading = spot.heading
        const cycle = time * person.rate * 2.6 + person.phase
        legSwing = Math.sin(cycle) * 0.6
        armSwing = -legSwing * 0.7
        // The body rises twice per stride, at each push-off.
        lift = Math.abs(Math.cos(cycle)) * 0.035
      } else if (person.doing === 'stand') {
        const idle = time * 0.8 + person.phase
        legSwing = Math.sin(idle) * 0.035
        armSwing = Math.sin(idle * 0.8) * 0.05
        lean = Math.sin(idle * 0.6) * 0.03
        heading += Math.sin(time * 0.22 + person.phase) * 0.6
        lift = Math.sin(idle) * 0.008
      } else {
        // Talking: whoever has the floor gestures, the other keeps still.
        // They trade on a shared slow wave with opposite sign.
        const turn = Math.sin(time * 0.42 + person.phase) * (person.lead ? 1 : -1)
        const talking = Math.max(0, turn)
        armSwing = Math.sin(time * 2.4 + person.phase) * 0.38 * talking
        legSwing = Math.sin(time * 0.9 + person.phase) * 0.03
        lean = turn * 0.06
        heading += Math.sin(time * 1.1 + person.phase) * 0.1
        lift = talking * 0.012
      }

      const build = person.build
      const legLength = LEG_LENGTH * build
      const hipY = legLength + lift
      const torsoHeight = TORSO_HEIGHT * build

      euler.set(0, heading, lean)
      quaternion.setFromEuler(euler)

      position.set(x, hipY + torsoHeight / 2, z)
      scale.set(0.36 * build, torsoHeight, 0.22 * build)
      torso.setMatrixAt(i, matrix.compose(position, quaternion, scale))

      position.set(x, hipY + torsoHeight + HEAD_RADIUS * build, z)
      scale.setScalar(HEAD_RADIUS * 2 * build)
      head.setMatrixAt(i, matrix.compose(position, quaternion, scale))

      // Arms and legs swing about their own joint. `YXZ` order applies the
      // body's facing first and the swing in the body's own frame, so a limb
      // always swings forward and back rather than out to the side.
      const shoulderY = hipY + torsoHeight * 0.92
      // The body's own "across" axis, for placing left and right.
      const acrossX = Math.cos(heading)
      const acrossZ = -Math.sin(heading)

      for (const side of [-1, 1]) {
        const slot = i * 2 + (side > 0 ? 1 : 0)

        const armOut = 0.23 * build * side
        euler.set(armSwing * side, heading, 0, 'YXZ')
        quaternion.setFromEuler(euler)
        position.set(x + acrossX * armOut, shoulderY, z + acrossZ * armOut)
        scale.set(0.1 * build, ARM_LENGTH * build, 0.1 * build)
        arms.setMatrixAt(slot, matrix.compose(position, quaternion, scale))

        const legOut = 0.1 * build * side
        euler.set(legSwing * side, heading, 0, 'YXZ')
        quaternion.setFromEuler(euler)
        position.set(x + acrossX * legOut, hipY, z + acrossZ * legOut)
        scale.set(0.13 * build, legLength, 0.13 * build)
        legs.setMatrixAt(slot, matrix.compose(position, quaternion, scale))
      }
    })

    for (const mesh of [torso, head, arms, legs]) mesh.instanceMatrix.needsUpdate = true
  })

  if (crowd.length === 0) return null

  return (
    <group>
      <instancedMesh ref={torsos} args={[geometry.torso, undefined, crowd.length]} castShadow frustumCulled={false}>
        <meshLambertMaterial />
      </instancedMesh>
      <instancedMesh ref={headsRef} args={[geometry.head, undefined, crowd.length]} castShadow frustumCulled={false}>
        <meshLambertMaterial />
      </instancedMesh>
      <instancedMesh ref={armsRef} args={[geometry.limb, undefined, crowd.length * 2]} castShadow frustumCulled={false}>
        <meshLambertMaterial />
      </instancedMesh>
      <instancedMesh ref={legsRef} args={[geometry.limb, undefined, crowd.length * 2]} castShadow frustumCulled={false}>
        <meshLambertMaterial />
      </instancedMesh>
    </group>
  )
}
