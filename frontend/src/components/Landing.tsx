import { useEffect, useState } from 'react'

import { api, type Health } from '../lib/api'
import type { RecentCity } from '../types'
import { LandingFeatures } from './landing/LandingFeatures'
import { LandingHero } from './landing/LandingHero'
import { LandingRecent } from './landing/LandingRecent'
import { LandingStatus } from './landing/LandingStatus'
import { LandingSteps } from './landing/LandingSteps'

interface Props {
  onAnalyze: (repoUrl: string, force: boolean) => void
  onOpenCached: (cacheKey: string) => void
  error: string | null
}

export function Landing({ onAnalyze, onOpenCached, error }: Props) {
  const [health, setHealth] = useState<Health | null>(null)
  const [recent, setRecent] = useState<RecentCity[]>([])

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth(null))
    api.recent().then(setRecent).catch(() => setRecent([]))
  }, [])

  return (
    <div className="landing">
      <LandingHero onAnalyze={onAnalyze} error={error} />
      <LandingSteps />
      <LandingFeatures />
      <LandingRecent recent={recent} onOpenCached={onOpenCached} />
      <div className="landing__foot">
        <LandingStatus health={health} />
      </div>
    </div>
  )
}
