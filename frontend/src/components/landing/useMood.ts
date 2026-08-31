import { useRef, useState } from 'react'

import { gsap } from '../../lib/gsapSetup'
import type { Mood } from './toonKit'

const MOOD_KEY = 'repocity-landing-mood'

function readStoredMood(): Mood {
  try {
    const stored = localStorage.getItem(MOOD_KEY)
    return stored === 'night' || stored === 'day' ? stored : 'day'
  } catch {
    return 'day'
  }
}

/** Day/night state shared by every "Night City" page (landing, GitHub
 * profile), plus the flash transition played through the returned ref. */
export function useMood() {
  const [mood, setMood] = useState<Mood>(readStoredMood)
  const flashRef = useRef<HTMLDivElement>(null)

  const toggleMood = () => {
    const next: Mood = mood === 'day' ? 'night' : 'day'
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const commit = () => {
      setMood(next)
      try {
        localStorage.setItem(MOOD_KEY, next)
      } catch {
        /* private browsing or storage disabled — the toggle still works this session */
      }
    }

    // Backgrounded tabs suspend requestAnimationFrame, so a gsap timeline
    // never ticks and never reaches .call(commit) — skip straight to the
    // instant commit whenever the flash can't actually play.
    if (reduced || document.hidden || !flashRef.current) {
      commit()
      return
    }

    gsap
      .timeline()
      .set(flashRef.current, { display: 'block' })
      .to(flashRef.current, { opacity: 1, duration: 0.22, ease: 'power2.in' })
      .call(commit)
      .to(flashRef.current, { opacity: 0, duration: 0.45, ease: 'power2.out' })
      .set(flashRef.current, { display: 'none' })
  }

  return { mood, toggleMood, flashRef }
}
