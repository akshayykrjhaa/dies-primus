import * as THREE from 'three'

/**
 * Coherent 3D value noise plus a ridged-fractal fbm.
 *
 * Random-per-vertex jitter is what made the first version of the mountains
 * look cartoonish: independent per-vertex randomness has no spatial
 * coherence, so it either does nothing visible (small amplitude) or reads as
 * static (large amplitude) -- it can never produce a ridge, because a ridge
 * is a *shape* that has to agree with its neighbours. This is a small
 * hash-based value-noise field (smoothed trilinear interpolation between
 * lattice-corner hashes) combined across a few octaves with a ridged fold
 * (1 - |2n - 1|, the standard trick for carving mountain-like crests instead
 * of rolling hills), which is what actually produces a jagged, self-similar
 * silhouette instead of a smooth cone.
 */

function hash3(x: number, y: number, z: number, seed: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + seed * 269.5) * 43758.5453
  return s - Math.floor(s)
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10)
}

export function valueNoise3(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const zi = Math.floor(z)
  const xf = x - xi
  const yf = y - yi
  const zf = z - zi
  const u = fade(xf)
  const v = fade(yf)
  const w = fade(zf)

  const c000 = hash3(xi, yi, zi, seed)
  const c100 = hash3(xi + 1, yi, zi, seed)
  const c010 = hash3(xi, yi + 1, zi, seed)
  const c110 = hash3(xi + 1, yi + 1, zi, seed)
  const c001 = hash3(xi, yi, zi + 1, seed)
  const c101 = hash3(xi + 1, yi, zi + 1, seed)
  const c011 = hash3(xi, yi + 1, zi + 1, seed)
  const c111 = hash3(xi + 1, yi + 1, zi + 1, seed)

  const x00 = THREE.MathUtils.lerp(c000, c100, u)
  const x10 = THREE.MathUtils.lerp(c010, c110, u)
  const x01 = THREE.MathUtils.lerp(c001, c101, u)
  const x11 = THREE.MathUtils.lerp(c011, c111, u)
  const y0 = THREE.MathUtils.lerp(x00, x10, v)
  const y1 = THREE.MathUtils.lerp(x01, x11, v)
  return THREE.MathUtils.lerp(y0, y1, w) // 0..1
}

/** Ridged fractal noise: sharp crests, the classic trick for mountain silhouettes. */
export function ridgedFbm(
  x: number,
  y: number,
  z: number,
  seed: number,
  octaves = 4,
): number {
  let sum = 0
  let amp = 0.55
  let freq = 1
  let norm = 0
  for (let i = 0; i < octaves; i++) {
    const n = valueNoise3(x * freq, y * freq, z * freq, seed + i * 31)
    const ridge = 1 - Math.abs(n * 2 - 1) // 0..1, peaks where n crosses 0.5
    sum += ridge * ridge * amp
    norm += amp
    amp *= 0.52
    freq *= 2.15
  }
  return sum / norm // 0..1
}

/** Smooth fbm (no ridging) for slower-varying detail like the snow line. */
export function smoothFbm(
  x: number,
  y: number,
  z: number,
  seed: number,
  octaves = 3,
): number {
  let sum = 0
  let amp = 0.5
  let freq = 1
  let norm = 0
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise3(x * freq, y * freq, z * freq, seed + i * 53) * amp
    norm += amp
    amp *= 0.5
    freq *= 2
  }
  return sum / norm // 0..1
}
