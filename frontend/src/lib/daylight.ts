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
const KEYFRAMES: Keyframe[] = [
  {
    hour: 0, sky: '#0D1738', fog: '#16214A', sun: '#8FA6E8', sunIntensity: 0.62,
    hemiSky: '#41558F', hemiGround: '#1A2440', hemiIntensity: 0.95, night: 1, label: 'Night',
  },
  {
    hour: 5, sky: '#1A2A58', fog: '#243566', sun: '#9AABE0', sunIntensity: 0.7,
    hemiSky: '#4C5F9B', hemiGround: '#1E2846', hemiIntensity: 1.0, night: 0.94, label: 'Before dawn',
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
    hour: 21, sky: '#22305C', fog: '#2C3B6E', sun: '#8296D8', sunIntensity: 0.66,
    hemiSky: '#465893', hemiGround: '#1B2440', hemiIntensity: 0.98, night: 0.92, label: 'Dusk',
  },
  {
    hour: 24, sky: '#0D1738', fog: '#16214A', sun: '#8FA6E8', sunIntensity: 0.62,
    hemiSky: '#41558F', hemiGround: '#1A2440', hemiIntensity: 0.95, night: 1, label: 'Night',
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

/** Resolves the hour a mode should render at. */
export function hoursForMode(mode: TimeMode, date: Date = new Date()): number {
  if (mode === 'auto') return localHours(date)
  return PINNED_HOURS[mode]
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

  return {
    sun,
    sunColor: mixColor(from.sun, to.sun, t),
    sunIntensity: THREE.MathUtils.lerp(from.sunIntensity, to.sunIntensity, t),
    skyColor: mixColor(from.sky, to.sky, t),
    fogColor: mixColor(from.fog, to.fog, t),
    hemiSky: mixColor(from.hemiSky, to.hemiSky, t),
    hemiGround: mixColor(from.hemiGround, to.hemiGround, t),
    hemiIntensity: THREE.MathUtils.lerp(from.hemiIntensity, to.hemiIntensity, t),
    night: THREE.MathUtils.lerp(from.night, to.night, t),
    label: t < 0.5 ? from.label : to.label,
  }
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
