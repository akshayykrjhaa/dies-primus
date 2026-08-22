import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'

import { lampsOn } from '../../lib/daylight'

/**
 * Eases the city's artificial lights toward the level the current time of day
 * calls for, and applies it.
 *
 * Everything else about the time of day already eases per frame -- `DaylightRig`
 * lerps the sun, sky and fog toward their targets. The lights did not: they
 * read `night` straight out of React state, so hitting the day/night toggle
 * snapped every window and lamp in the city on in a single frame while the sky
 * behind them took about a second to follow. This closes that gap.
 *
 * `apply` runs only while the ramp is actually moving, plus once when it
 * settles, so a static scene costs one comparison per component per frame. On
 * the very first frame it jumps straight to the target rather than animating
 * up from zero, so arriving in a night city does not play a sunrise.
 */
export function useLightRamp(
  night: number,
  apply: (lit: number) => void,
  /**
   * The object `apply` writes into. When it changes, the ramp forgets where it
   * was and re-applies on the next frame.
   *
   * Without this the hook could go permanently silent: it skips work once the
   * eased value has reached its target, so a mesh rebuilt while the time of
   * day happened to be steady was never written to at all, and its materials
   * kept their constructor defaults -- white roads and unlit windows in the
   * middle of the night.
   */
  target_?: unknown,
): void {
  const current = useRef<number | null>(null)
  const target = lampsOn(night)

  useEffect(() => {
    current.current = null
  }, [target_])

  useFrame((_, delta) => {
    if (current.current === target) return

    if (current.current === null) {
      current.current = target
    } else {
      const k = Math.min(1, delta * 2.4)
      current.current =
        Math.abs(current.current - target) < 0.002
          ? target
          : current.current + (target - current.current) * k
    }
    apply(current.current)
  })
}
