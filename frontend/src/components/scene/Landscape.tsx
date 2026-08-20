import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'

/**
 * The glacier valley the city sits in.
 *
 * Built procedurally from the reference photographs rather than imported: the
 * Unity glacier pack is a paid Store asset that cannot be fetched at runtime,
 * so the shapes are generated here.
 *
 * Each peak is a tapered cone displaced by coherent ridged noise (see
 * `lib/terrain-noise.ts`) rather than a smooth primitive, which is what stops
 * the range reading as a cluster of traffic cones -- the displacement is a
 * *field*, so neighbouring vertices agree on where a ridge or a gully runs.
 * Everything is sized from `span` (the city's larger dimension), so a
 * nine-file town gets a small valley and a 300-file metropolis a wide one,
 * and every peak is merged into one buffer so the whole range costs a single
 * draw call.
 */

import { LAYERS } from '../../lib/layers'
import { ridgedFbm, smoothFbm, valueNoise3 } from '../../lib/terrain-noise'

export interface LandscapeProps {
  span: number
  /** 0 = day, 1 = night. Snow goes moonlit blue and the water dims. */
  night: number
  /** Where the gate stands; the view to it is kept clear of peaks. */
  entranceZ: number
}

/** Deterministic PRNG so a given city always gets the same valley. */
function mulberry(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Paints one geometry a flat colour, ready for merging. */
function colorize(geometry: THREE.BufferGeometry, color: THREE.Color): THREE.BufferGeometry {
  const count = geometry.attributes.position.count
  const colors = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r
    colors[i * 3 + 1] = color.g
    colors[i * 3 + 2] = color.b
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geometry
}

/**
 * Concatenates geometries that share an attribute layout.
 *
 * Every part must be non-indexed: this copies raw vertex runs and does not
 * rebuild an index buffer, so an indexed input would come out as noise.
 */
function mergeGeometries(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = new THREE.BufferGeometry()
  let vertexCount = 0
  for (const part of parts) vertexCount += part.attributes.position.count

  const position = new Float32Array(vertexCount * 3)
  const color = new Float32Array(vertexCount * 3)

  let offset = 0
  for (const part of parts) {
    position.set(part.attributes.position.array as Float32Array, offset)
    color.set(part.attributes.color.array as Float32Array, offset)
    offset += (part.attributes.position.array as Float32Array).length
  }

  merged.setAttribute('position', new THREE.BufferAttribute(position, 3))
  merged.setAttribute('color', new THREE.BufferAttribute(color, 3))
  merged.computeVertexNormals()
  return merged
}

/**
 * The river's path, shared by the water itself and by the mountain placer.
 *
 * The peaks used to be positioned purely by ring radius, and the near ring at
 * span * 1.15 sat right on top of the channel -- which is why the river could
 * not be seen. The mountains now carve themselves away from this curve, so the
 * valley it runs through is guaranteed open however the rings are tuned.
 */
export function riverCurve(span: number): THREE.CatmullRomCurve3 {
  // Out of a saddle in the western range, down past the city, into a lake.
  return new THREE.CatmullRomCurve3([
    new THREE.Vector3(-span * 1.9, 0, -span * 1.5),
    new THREE.Vector3(-span * 1.35, 0, -span * 0.85),
    new THREE.Vector3(-span * 1.0, 0, -span * 0.25),
    new THREE.Vector3(-span * 0.92, 0, span * 0.35),
    new THREE.Vector3(-span * 1.05, 0, span * 0.95),
    new THREE.Vector3(-span * 1.25, 0, span * 1.5),
  ])
}

const ROCK_A = new THREE.Color('#767E8C')
const ROCK_B = new THREE.Color('#565F6C')
const SNOW_A = new THREE.Color('#FFFFFF')
const SNOW_B = new THREE.Color('#DCE8F5')

/**
 * One peak: a tapered cone displaced by ridged noise along its own outward
 * direction, so cliffs, gullies and ridgelines emerge from a coherent field
 * instead of from stacked, perfectly-circular drums. Colour follows height
 * and a slower noise field, so the snow line is ragged rather than a clean
 * ring, and rock still pokes through it in patches near the ridges -- as in
 * the reference photos.
 */
function mountainPeak(baseRadius: number, height: number, random: () => number): THREE.BufferGeometry {
  const radialSegments = 10
  const heightSegments = 11
  const geometry = new THREE.CylinderGeometry(
    baseRadius * 0.02, baseRadius, height, radialSegments, heightSegments, false,
  ).toNonIndexed()
  const position = geometry.attributes.position as THREE.BufferAttribute
  const seed = Math.floor(random() * 100000)
  const freq = 1.7 / Math.max(6, baseRadius)
  const snowLine = 0.42 + random() * 0.14
  const colors = new Float32Array(position.count * 3)
  const c = new THREE.Color()

  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i)
    const y = position.getY(i)
    const z = position.getZ(i)
    const t = (y + height / 2) / height // 0 base .. 1 tip

    if (t < 0.96) {
      const radiusHere = Math.hypot(x, z)
      const dirX = radiusHere > 1e-4 ? x / radiusHere : Math.cos(i * 2.4)
      const dirZ = radiusHere > 1e-4 ? z / radiusHere : Math.sin(i * 2.4)

      const ridge = ridgedFbm(x * freq, y * freq * 1.3, z * freq, seed)
      const grain = valueNoise3(x * freq * 3.4, y * freq * 3.4, z * freq * 3.4, seed + 900)
      // Displacement fades out near the summit (keeps a defined tip) and
      // scales with the radius still available at this height.
      const amount = baseRadius * (0.2 + ridge * 0.55) * Math.pow(1 - t, 0.5) * (0.65 + grain * 0.6)
      position.setX(i, x + dirX * amount)
      position.setZ(i, z + dirZ * amount)
      position.setY(i, y + (valueNoise3(x * freq, y * freq, z * freq, seed + 500) - 0.5) * height * 0.025)
    }

    // The snow line rises with height but is bent by a slow-varying field,
    // so it reads as a ragged boundary rather than a ring, and a second,
    // finer field pokes rock through the snow near ridgelines and leaves
    // snow clinging to gullies below the line -- the patchiness in the
    // reference photos.
    const bend = (smoothFbm(x * freq * 0.6, y * freq * 0.6, z * freq * 0.6, seed + 200) - 0.5) * 0.24
    const grain2 = valueNoise3(x * freq * 2.6, y * freq * 2.6, z * freq * 2.6, seed + 700)
    let snowy = t + bend > snowLine
    if (snowy && grain2 < 0.1) snowy = false
    if (!snowy && grain2 > 0.88) snowy = true

    c.copy(snowy ? SNOW_A : ROCK_A).lerp(snowy ? SNOW_B : ROCK_B, grain2)
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  // CylinderGeometry is centred on its own origin, so lift the peak by half
  // its height to stand it on the ground. Without this every mountain sat
  // buried to the waist and the range read as low rounded lumps.
  geometry.translate(0, height / 2, 0)
  return geometry
}

/** The ranges enclosing the valley, with a clear corridor at the gate. */
function Mountains({ span, night, entranceZ }: LandscapeProps) {
  const geometry = useMemo(() => {
    const random = mulberry(Math.round(span * 1000))
    const parts: THREE.BufferGeometry[] = []

    // The gate sits at +Z. Peaks are kept out of that arc so the approach
    // stays open and nothing crowds the portal.
    const gateAngle = Math.atan2(entranceZ, 0) // +PI/2
    const clearArc = 0.62

    // Pushed further out than before: the first ridge used to start at
    // span * 1.15, close enough to sit on the river and to crowd the city.
    const rings = [
      { radius: span * 1.7, count: 18, height: span * 0.36, spread: span * 0.16 },
      { radius: span * 2.3, count: 22, height: span * 0.56, spread: span * 0.22 },
      { radius: span * 3.0, count: 24, height: span * 0.76, spread: span * 0.3 },
    ]

    // Sample the river once; any peak that would stand in the water (or on
    // its banks) is dropped, so the channel stays visible from every angle.
    const riverPoints = riverCurve(span).getPoints(140)
    const riverClearance = span * 0.3
    const clearsRiver = (x: number, z: number, radius: number) => {
      for (const point of riverPoints) {
        const dx = point.x - x
        const dz = point.z - z
        if (dx * dx + dz * dz < (riverClearance + radius) ** 2) return false
      }
      return true
    }

    for (const ring of rings) {
      for (let i = 0; i < ring.count; i++) {
        const angle = (i / ring.count) * Math.PI * 2 + random() * 0.2

        // Angular distance to the gate direction, wrapped to [-PI, PI].
        let delta = angle - gateAngle
        while (delta > Math.PI) delta -= Math.PI * 2
        while (delta < -Math.PI) delta += Math.PI * 2
        if (Math.abs(delta) < clearArc) continue

        const distance = ring.radius + (random() - 0.5) * ring.spread
        const height = ring.height * (0.5 + random() * 0.85)
        const radius = height * (0.55 + random() * 0.4)

        const px = Math.cos(angle) * distance
        const pz = Math.sin(angle) * distance
        if (!clearsRiver(px, pz, radius)) continue

        const peak = mountainPeak(radius, height, random)
        peak.rotateY(random() * Math.PI * 2)
        peak.translate(px, -0.6, pz)
        parts.push(peak)
      }
    }

    const merged = mergeGeometries(parts)
    parts.forEach((part) => part.dispose())
    return merged
  }, [span, entranceZ])

  // Snow reflects the sky, so it goes blue at night rather than merely dark.
  const tint = useMemo(
    () => new THREE.Color('#FFFFFF').lerp(new THREE.Color('#8FA8D8'), night * 0.6),
    [night],
  )

  return (
    <mesh geometry={geometry} receiveShadow castShadow>
      <meshLambertMaterial vertexColors color={tint} />
    </mesh>
  )
}

/** Spruce: three stacked cones on a short trunk, as in the reference. */
function Conifers({ span, night, entranceZ }: LandscapeProps) {
  const { trees, trunks } = useMemo(() => {
    const random = mulberry(Math.round(span * 31))
    const treeMatrices: THREE.Matrix4[] = []
    const trunkMatrices: THREE.Matrix4[] = []
    const gateAngle = Math.atan2(entranceZ, 0)

    // Clustered stands on the snowfield between the city and the first ridge.
    const clusters = 14
    for (let c = 0; c < clusters; c++) {
      const angle = random() * Math.PI * 2
      let delta = angle - gateAngle
      while (delta > Math.PI) delta -= Math.PI * 2
      while (delta < -Math.PI) delta += Math.PI * 2
      if (Math.abs(delta) < 0.5) continue

      const distance = span * (0.78 + random() * 0.3)
      const cx = Math.cos(angle) * distance
      const cz = Math.sin(angle) * distance

      const inCluster = 4 + Math.floor(random() * 7)
      for (let i = 0; i < inCluster; i++) {
        const x = cx + (random() - 0.5) * span * 0.16
        const z = cz + (random() - 0.5) * span * 0.16
        const scale = span * 0.006 * (0.7 + random() * 0.8)
        const matrix = new THREE.Matrix4()
        matrix.compose(
          new THREE.Vector3(x, -0.6, z),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, random() * Math.PI, 0)),
          new THREE.Vector3(scale, scale * (0.85 + random() * 0.5), scale),
        )
        treeMatrices.push(matrix)

        const trunk = new THREE.Matrix4()
        trunk.compose(
          new THREE.Vector3(x, -0.6 + scale * 0.9, z),
          new THREE.Quaternion(),
          new THREE.Vector3(scale * 0.16, scale * 1.8, scale * 0.16),
        )
        trunkMatrices.push(trunk)
      }
    }
    return { trees: treeMatrices, trunks: trunkMatrices }
  }, [span, entranceZ])

  // One tree = three cones merged, so a whole forest is a single instanced mesh.
  const foliage = useMemo(() => {
    const parts: THREE.BufferGeometry[] = []
    const tiers = [
      { r: 3.4, h: 5.2, y: 2.6 },
      { r: 2.5, h: 4.6, y: 5.4 },
      { r: 1.6, h: 4.0, y: 8.0 },
    ]
    for (const tier of tiers) {
      const cone = new THREE.ConeGeometry(tier.r, tier.h, 6).toNonIndexed()
      cone.translate(0, tier.y, 0)
      parts.push(colorize(cone, new THREE.Color('#1E4630')))
    }
    return mergeGeometries(parts)
  }, [])

  const trunkGeometry = useMemo(() => new THREE.CylinderGeometry(1, 1.2, 1, 5), [])

  const foliageMesh = useMemo(() => {
    const material = new THREE.MeshLambertMaterial({
      vertexColors: true,
      color: new THREE.Color('#FFFFFF').lerp(new THREE.Color('#6E87C0'), night * 0.55),
    })
    const mesh = new THREE.InstancedMesh(foliage, material, Math.max(1, trees.length))
    trees.forEach((matrix, index) => mesh.setMatrixAt(index, matrix))
    mesh.count = trees.length
    mesh.instanceMatrix.needsUpdate = true
    mesh.castShadow = true
    mesh.frustumCulled = false
    return mesh
  }, [foliage, trees, night])

  const trunkMesh = useMemo(() => {
    const material = new THREE.MeshLambertMaterial({ color: '#4A3527' })
    const mesh = new THREE.InstancedMesh(trunkGeometry, material, Math.max(1, trunks.length))
    trunks.forEach((matrix, index) => mesh.setMatrixAt(index, matrix))
    mesh.count = trunks.length
    mesh.instanceMatrix.needsUpdate = true
    mesh.frustumCulled = false
    return mesh
  }, [trunkGeometry, trunks])

  return (
    <group>
      <primitive object={trunkMesh} />
      <primitive object={foliageMesh} />
    </group>
  )
}

/**
 * Meltwater: a river that runs out of a gap in the range, past the city, and
 * pools into a glacial lake. The surface scrolls, so it reads as flowing
 * rather than as a painted ribbon.
 */
function River({ span, night }: LandscapeProps) {
  const water = useRef<THREE.MeshLambertMaterial>(null)
  const foam = useRef<THREE.MeshBasicMaterial>(null)

  const flowTexture = useMemo(() => {
    // Soft lengthwise streaks: scrolled along the channel this reads as
    // current without needing a shader.
    const canvas = document.createElement('canvas')
    canvas.width = 128
    canvas.height = 256
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#2FB5C4'
    ctx.fillRect(0, 0, 128, 256)
    for (let i = 0; i < 90; i++) {
      const x = Math.random() * 128
      const y = Math.random() * 256
      const length = 20 + Math.random() * 70
      ctx.strokeStyle = `rgba(${190 + Math.random() * 60}, 250, 255, ${0.05 + Math.random() * 0.2})`
      ctx.lineWidth = 1 + Math.random() * 3
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x + (Math.random() - 0.5) * 8, y + length)
      ctx.stroke()
    }
    const texture = new THREE.CanvasTexture(canvas)
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set(1, 6)
    texture.colorSpace = THREE.SRGBColorSpace
    return texture
  }, [])

  // Foam: sparser, brighter, scrolled faster than the base current.
  const foamTexture = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 128
    canvas.height = 256
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, 128, 256)
    for (let i = 0; i < 46; i++) {
      const x = Math.random() * 128
      const y = Math.random() * 256
      const length = 8 + Math.random() * 30
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.1 + Math.random() * 0.35})`
      ctx.lineWidth = 1 + Math.random() * 2.4
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x + (Math.random() - 0.5) * 5, y + length)
      ctx.stroke()
    }
    const texture = new THREE.CanvasTexture(canvas)
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set(1, 9)
    texture.colorSpace = THREE.SRGBColorSpace
    return texture
  }, [])

  const { channel, banks, lake } = useMemo(() => {
    const random = mulberry(Math.round(span * 77))

    const curve = riverCurve(span)

    const ribbon = (halfWidth: number, y: number, widen: number) => {
      const steps = 110
      const positions = new Float32Array((steps + 1) * 2 * 3)
      const uvs = new Float32Array((steps + 1) * 2 * 2)
      const indices: number[] = []
      const up = new THREE.Vector3(0, 1, 0)

      for (let i = 0; i <= steps; i++) {
        const t = i / steps
        const point = curve.getPointAt(t)
        const tangent = curve.getTangentAt(t)
        const side = new THREE.Vector3().crossVectors(tangent, up).normalize()
        // Narrow in the gorge, broad where it reaches the flats.
        const w = halfWidth * (0.5 + t * widen + Math.sin(t * 6.5) * 0.16 + random() * 0.06)

        const left = point.clone().addScaledVector(side, -w)
        const right = point.clone().addScaledVector(side, w)
        positions.set([left.x, y, left.z], i * 6)
        positions.set([right.x, y, right.z], i * 6 + 3)
        // v runs along the channel: this is the axis the flow scrolls on.
        uvs.set([0, t * 4], i * 4)
        uvs.set([1, t * 4], i * 4 + 2)

        if (i < steps) {
          const a = i * 2
          indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
        }
      }

      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
      geometry.setIndex(indices)
      geometry.computeVertexNormals()
      return geometry
    }

    return {
      channel: ribbon(span * 0.1, LAYERS.riverChannel, 1.5),
      banks: ribbon(span * 0.15, LAYERS.riverBank, 1.6),
      lakeCentre: curve.getPointAt(1),
      lake: curve.getPointAt(0.97),
    }
  }, [span])

  const waterColor = useMemo(
    () => new THREE.Color('#2FB5C4').lerp(new THREE.Color('#15406E'), night * 0.72),
    [night],
  )
  const bankColor = useMemo(
    () => new THREE.Color('#D6EEF6').lerp(new THREE.Color('#5E76A8'), night * 0.6),
    [night],
  )

  useFrame((state, delta) => {
    // Downstream scroll. Slow enough to read as a glacier-fed river, with the
    // foam running faster so the two layers shear against each other.
    flowTexture.offset.y -= delta * 0.075
    foamTexture.offset.y -= delta * 0.19
    // A slow lateral drift stops the streaks from marching in lockstep.
    flowTexture.offset.x = Math.sin(state.clock.elapsedTime * 0.12) * 0.02
    if (water.current) water.current.emissiveIntensity = 0.18 + night * 0.3
    if (foam.current) {
      foam.current.opacity = 0.3 + Math.sin(state.clock.elapsedTime * 0.9) * 0.08
    }
  })

  return (
    <group>
      <mesh geometry={banks} receiveShadow>
        <meshLambertMaterial color={bankColor} />
      </mesh>
      <mesh geometry={channel}>
        <meshLambertMaterial
          ref={water}
          map={flowTexture}
          color={waterColor}
          emissive={waterColor}
          emissiveIntensity={0.2}
        />
      </mesh>
      {/* Foam rides just above the current, scrolling faster. */}
      <mesh geometry={channel} position={[0, 0.03, 0]}>
        <meshBasicMaterial
          ref={foam}
          map={foamTexture}
          transparent
          opacity={0.3}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      {/* The lake it pools into. */}
      <mesh position={[lake.x, LAYERS.lake, lake.z]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[span * 0.34, 40]} />
        <meshLambertMaterial
          map={flowTexture}
          color={waterColor}
          emissive={waterColor}
          emissiveIntensity={0.2}
        />
      </mesh>
    </group>
  )
}

export function Landscape({ span, night, entranceZ }: LandscapeProps) {
  const snow = useMemo(
    () => new THREE.Color('#F0F6FC').lerp(new THREE.Color('#6B84BC'), night * 0.62),
    [night],
  )

  return (
    <group>
      {/* The valley floor, well below the city plots. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, LAYERS.snow, 0]} receiveShadow>
        <circleGeometry args={[span * 4.4, 84]} />
        <meshLambertMaterial color={snow} />
      </mesh>

      <River span={span} night={night} entranceZ={entranceZ} />
      <Mountains span={span} night={night} entranceZ={entranceZ} />
      <Conifers span={span} night={night} entranceZ={entranceZ} />
    </group>
  )
}
