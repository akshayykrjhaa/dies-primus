import { useEffect, useState } from 'react'

import { api, type Health } from '../lib/api'
import type { AuthUser, RecentCity } from '../types'
import { LandingCompare } from './landing/LandingCompare'
import { LandingFeatures } from './landing/LandingFeatures'
import { LandingHero } from './landing/LandingHero'
import { LandingMascotIntro } from './landing/LandingMascotIntro'
import { LandingRecent } from './landing/LandingRecent'
import { LandingStatus } from './landing/LandingStatus'
import { LandingSteps } from './landing/LandingSteps'
import { MoodToggle } from './landing/MoodToggle'
import { useMood } from './landing/useMood'

interface Props {
  onAnalyze: (repoUrl: string, force: boolean) => void
  onOpenCached: (cacheKey: string) => void
  onViewGithub: () => void
  error: string | null
}

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  state_mismatch: 'The GitHub sign-in link expired — try connecting again.',
  github_oauth_failed: 'GitHub sign-in failed — try connecting again.',
  github_oauth_not_configured: 'GitHub sign-in is not configured on this server.',
}

export function Landing({ onAnalyze, onOpenCached, onViewGithub, error }: Props) {
  const [health, setHealth] = useState<Health | null>(null)
  const [recent, setRecent] = useState<RecentCity[]>([])
  const { mood, toggleMood, flashRef } = useMood()
  const [user, setUser] = useState<AuthUser | null>(null)
  const [authNotice, setAuthNotice] = useState<{ text: string; kind: 'success' | 'error' } | null>(null)

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth(null))
    api.recent().then(setRecent).catch(() => setRecent([]))
    api.me().then(setUser).catch(() => setUser(null))

    const params = new URLSearchParams(window.location.search)
    const authError = params.get('auth_error')
    const connected = params.get('connected')
    if (authError || connected) {
      if (authError) {
        setAuthNotice({ text: AUTH_ERROR_MESSAGES[authError] ?? 'GitHub sign-in failed.', kind: 'error' })
      } else {
        setAuthNotice({ text: 'GitHub connected.', kind: 'success' })
      }
      params.delete('auth_error')
      params.delete('connected')
      const rest = params.toString()
      window.history.replaceState({}, '', window.location.pathname + (rest ? `?${rest}` : ''))
      const timer = setTimeout(() => setAuthNotice(null), 6000)
      return () => clearTimeout(timer)
    }
  }, [])

  const logout = () => {
    api
      .logout()
      .then(() => setUser({ authenticated: false }))
      .catch(() => {})
  }

  return (
    <div className="landing" data-mood={mood}>
      <MoodToggle mood={mood} onToggle={toggleMood} />
      <div className="landing__flash" ref={flashRef} aria-hidden="true" />

      <LandingHero
        onAnalyze={onAnalyze}
        error={error}
        mood={mood}
        user={user}
        onLogout={logout}
        onViewGithub={onViewGithub}
        authNotice={authNotice}
      />
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
