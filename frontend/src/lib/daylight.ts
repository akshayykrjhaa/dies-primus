import * as THREE from 'three'

/**
 * Time of day, driven by the visitor's real clock.
 *
 * A table of keyframes from midnight to midnight, linearly blended, gives the
 * whole scene one source of truth: sun angle and colour, sky and fog, ambient
 * fill, and how lit the windows should be. Everything that needs to know
 * whether it is night reads `night` from here rather than deciding for itself.
 */

export interface Daylight {
  /** Normalised sun direction; y goes negative once it has set. */
  sun: THREE.Vector3
  /**
   * Where the key light actually comes from: the sun by day, easing to the
   * moon after dark. The sun's own vector drops below the horizon at night,
   * and the scene used to clamp it to a token height, which raked the city
   * from almost ground level and left every north face black. The moon sits
   * genuinely high, so night lighting comes from above like moonlight does.
   */
  key: THREE.Vector3
  /** Where to draw the moon itself. Normalised. */
  moon: THREE.Vector3
  /** 0 while the moon is invisible, 1 when it is fully out. */
  moonUp: number
  sunColor: THREE.Color
  sunIntensity: number
  skyColor: THREE.Color
  fogColor: THREE.Color
  hemiSky: THREE.Color
  hemiGround: THREE.Color
  hemiIntensity: number
  /** 0 in full daylight, 1 in the dead of night. Drives window lights. */
  night: number
  label: string
}

interface Keyframe {
  hour: number
  sky: string
  fog: string
  sun: string
  sunIntensity: number
  hemiSky: string
  hemiGround: string
  hemiIntensity: number
  night: number
  label: string
}

// Tuned against the glacier references: cold blue shadows, warm low sun.
//
// The night rows carry far more light than a literal night would. A city lit
// only by its own windows is technically correct and unreadable -- the walls
// go black, the mountains vanish and the whole scene reads as a bug. These
// values are a "cinematic moonlit night". The balance that matters is not
// absolute brightness but *contrast*: surfaces stay genuinely dark and cold so
// that the warm windows, lamps and lane paint are the brightest things in the
// frame. Pushing the ambient up until the walls were legible on their own
// washed the whole city to flat lavender and put the lights out.
const KEYFRAMES: Keyframe[] = [
  {
    hour: 0, sky: '#101A3E', fog: '#1A2652', sun: '#BFD0FF', sunIntensity: 0.95,
    hemiSky: '#5E73B4', hemiGround: '#2B3555', hemiIntensity: 1.22, night: 1, label: 'Night',
  },
  {
    hour: 5, sky: '#182A58', fog: '#233566', sun: '#C4D3FF', sunIntensity: 1.0,
    hemiSky: '#6075B6', hemiGround: '#2C3757', hemiIntensity: 1.24, night: 0.94, label: 'Before dawn',
  },
  {
    hour: 7, sky: '#7E9BC8', fog: '#A9BBD8', sun: '#FFB27A', sunIntensity: 1.1,
    hemiSky: '#BBD0EA', hemiGround: '#5A6472', hemiIntensity: 0.75, night: 0.42, label: 'Sunrise',
  },
  {
    hour: 9, sky: '#9FD4F0', fog: '#B4DEF2', sun: '#FFF3DC', sunIntensity: 1.8,
    hemiSky: '#DCEEFF', hemiGround: '#7E8A80', hemiIntensity: 1.0, night: 0.05, label: 'Morning',
  },
  {
    hour: 13, sky: '#8FCFF2', fog: '#AEDCF4', sun: '#FFFDF4', sunIntensity: 2.1,
    hemiSky: '#E4F2FF', hemiGround: '#88938A', hemiIntensity: 1.1, night: 0, label: 'Midday',
  },
  {
    hour: 17, sky: '#9AD0EC', fog: '#C0DDEE', sun: '#FFE7C0', sunIntensity: 1.7,
    hemiSky: '#DBECFC', hemiGround: '#7C867C', hemiIntensity: 0.95, night: 0.06, label: 'Afternoon',
  },
  {
    hour: 19, sky: '#D2916A', fog: '#D8A488', sun: '#FF9A52', sunIntensity: 1.15,
    hemiSky: '#E7B590', hemiGround: '#4E4A55', hemiIntensity: 0.7, night: 0.4, label: 'Sunset',
  },
  {
    hour: 21, sky: '#1D2E5E', fog: '#293A70', sun: '#B5C6F8', sunIntensity: 0.92,
    hemiSky: '#5C71B2', hemiGround: '#2A3453', hemiIntensity: 1.2, night: 0.92, label: 'Dusk',
  },
  {
    hour: 24, sky: '#101A3E', fog: '#1A2652', sun: '#BFD0FF', sunIntensity: 0.95,
    hemiSky: '#5E73B4', hemiGround: '#2B3555', hemiIntensity: 1.22, night: 1, label: 'Night',
  },
]

function mixColor(a: string, b: string, t: number): THREE.Color {
  return new THREE.Color(a).lerp(new THREE.Color(b), t)
}

/** Hours past midnight, as a float, in the visitor's own timezone. */
export function localHours(date: Date = new Date()): number {
  const pinned = pinnedHour()
  if (pinned !== null) return pinned
  return date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600
}

/**
 * How the scene decides what time it is. `auto` follows the visitor's clock;
 * the other two pin it, for demos and for people who just want night.
 */
export type TimeMode = 'auto' | 'day' | 'night'

export const PINNED_HOURS: Record<Exclude<TimeMode, 'auto'>, number> = {
  day: 13,
  night: 1,
}

/** The window of the day during which "Day" simply means "now". */
const DAYLIGHT_FROM = 8
const DAYLIGHT_TO = 17

/**
 * Resolves the hour a mode should render at.
 *
 * `day` used to pin a flat 13:00, so switching to Day at half past three
 * visibly *changed* the lighting even though it was already broad daylight --
 * the sun jumped back across the sky. Day now keeps the visitor's own hour
 * whenever that hour is genuinely daylit, and only falls back to midday when
 * it would otherwise have nothing to show.
 */
export function hoursForMode(mode: TimeMode, date: Date = new Date()): number {
  if (mode === 'auto') return localHours(date)
  if (mode === 'day') {
    const now = localHours(date)
    return now >= DAYLIGHT_FROM && now <= DAYLIGHT_TO ? now : PINNED_HOURS.day
  }
  return PINNED_HOURS.night
}

/** `?hour=21` pins the time of day, for demos and for checking the lighting. */
export function pinnedHour(): number | null {
  if (typeof window === 'undefined') return null
  const raw = new URLSearchParams(window.location.search).get('hour')
  if (raw === null) return null
  const value = Number(raw)
  return Number.isFinite(value) ? ((value % 24) + 24) % 24 : null
}

export function daylight(hours: number = localHours()): Daylight {
  const h = ((hours % 24) + 24) % 24

  let index = 0
  while (index < KEYFRAMES.length - 2 && KEYFRAMES[index + 1].hour <= h) index++
  const from = KEYFRAMES[index]
  const to = KEYFRAMES[index + 1]
  const t = (h - from.hour) / Math.max(0.0001, to.hour - from.hour)

  // Sun arc: up at 06:00, highest at 13:00, down at 20:00. Below the horizon
  // the vector keeps going so moonlight arrives from the opposite side.
  const dayAngle = ((h - 6) / 14) * Math.PI
  const elevation = Math.sin(dayAngle)
  const sun = new THREE.Vector3(
    Math.cos(dayAngle) * 0.85,
    Math.max(-0.55, elevation),
    0.42 + Math.cos(dayAngle) * 0.25,
  ).normalize()

  // The moon rides the opposite half of the arc from the sun and never sits
  // low: a high key light is what stops a night city from being a silhouette.
  const moonAngle = dayAngle + Math.PI
  // Negative Z is north, which is the way the establishing shot faces: put the
  // moon over the range behind the city so it is actually in frame when you
  // arrive at night, rather than hanging behind the camera where only its
  // light ever reached the scene.
  const moon = new THREE.Vector3(
    Math.cos(moonAngle) * 0.5,
    Math.max(0.58, Math.sin(moonAngle)),
    -0.6 + Math.cos(moonAngle) * 0.15,
  ).normalize()

  const night = THREE.MathUtils.lerp(from.night, to.night, t)
  const moonUp = THREE.MathUtils.smoothstep(night, 0.2, 0.62)
  const key = sun.clone().lerp(moon, moonUp).normalize()

  return {
    sun,
    key,
    moon,
    moonUp,
    sunColor: mixColor(from.sun, to.sun, t),
    sunIntensity: THREE.MathUtils.lerp(from.sunIntensity, to.sunIntensity, t),
    skyColor: mixColor(from.sky, to.sky, t),
    fogColor: mixColor(from.fog, to.fog, t),
    hemiSky: mixColor(from.hemiSky, to.hemiSky, t),
    hemiGround: mixColor(from.hemiGround, to.hemiGround, t),
    hemiIntensity: THREE.MathUtils.lerp(from.hemiIntensity, to.hemiIntensity, t),
    night,
    label: t < 0.5 ? from.label : to.label,
  }
}

/**
 * How lit the city's own lights are, 0..1, from the scene's `night` value.
 *
 * Every artificial light in the scene rides this one ramp -- window panes and
 * street lamps -- so they come on together instead of at separately-tuned
 * thresholds. It is flat zero through the day, so switching to night mode is a
 * visible event rather than something already half-applied at noon, and it
 * eases rather than snapping so the change reads as dusk falling.
 *
 * `night` is 0 at midday, ~0.06 mid-afternoon, 0.4 at sunset and 1 in the dead
 * of night, so the shoulder sits between afternoon and sunset.
 */
export function lampsOn(night: number): number {
  return THREE.MathUtils.smoothstep(night, 0.14, 0.55)
}

/** "14:32 · Afternoon" for the HUD clock. */
export function clockLabel(date: Date = new Date()): string {
  // Report the hour the scene is actually lit at, so a pinned `?hour=` does
  // not show the wall clock next to a contradicting phase name.
  const hours = localHours(date)
  const hh = String(Math.floor(hours) % 24).padStart(2, '0')
  const mm = String(Math.floor((hours % 1) * 60)).padStart(2, '0')
  return `${hh}:${mm} · ${daylight(hours).label}`
}
