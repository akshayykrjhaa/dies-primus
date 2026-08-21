import { useEffect, useRef, useState } from 'react'

import { api, type Health } from '../lib/api'
import type { RecentCity } from '../types'
import { gsap } from '../lib/gsapSetup'
import { LandingCompare } from './landing/LandingCompare'
import { LandingFeatures } from './landing/LandingFeatures'
import { LandingHero } from './landing/LandingHero'
import { LandingMascotIntro } from './landing/LandingMascotIntro'
import { LandingRecent } from './landing/LandingRecent'
import { LandingStatus } from './landing/LandingStatus'
import { LandingSteps } from './landing/LandingSteps'
import { MoodToggle } from './landing/MoodToggle'
import type { Mood } from './landing/toonKit'

interface Props {
  onAnalyze: (repoUrl: string, force: boolean) => void
  onOpenCached: (cacheKey: string) => void
  error: string | null
}

const MOOD_KEY = 'repocity-landing-mood'

function readStoredMood(): Mood {
  try {
    const stored = localStorage.getItem(MOOD_KEY)
    return stored === 'night' || stored === 'day' ? stored : 'day'
  } catch {
    return 'day'
  }
}

export function Landing({ onAnalyze, onOpenCached, error }: Props) {
  const [health, setHealth] = useState<Health | null>(null)
  const [recent, setRecent] = useState<RecentCity[]>([])
  const [mood, setMood] = useState<Mood>(readStoredMood)
  const flash = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth(null))
    api.recent().then(setRecent).catch(() => setRecent([]))
  }, [])

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
    if (reduced || document.hidden || !flash.current) {
      commit()
      return
    }

    gsap
      .timeline()
      .set(flash.current, { display: 'block' })
      .to(flash.current, { opacity: 1, duration: 0.22, ease: 'power2.in' })
      .call(commit)
      .to(flash.current, { opacity: 0, duration: 0.45, ease: 'power2.out' })
      .set(flash.current, { display: 'none' })
  }

  return (
    <div className="landing" data-mood={mood}>
      <MoodToggle mood={mood} onToggle={toggleMood} />
      <div className="landing__flash" ref={flash} aria-hidden="true" />

      <LandingHero onAnalyze={onAnalyze} error={error} mood={mood} />
      <LandingMascotIntro />
      <LandingSteps />
      <LandingCompare mood={mood} />
      <LandingFeatures />
      <LandingRecent recent={recent} onOpenCached={onOpenCached} />
      <div className="landing__foot">
        <LandingStatus health={health} />
      </div>
    </div>
  )
}
