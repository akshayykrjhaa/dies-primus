import { useCallback, useEffect, useState } from 'react'

import { CityView } from './components/CityView'
import { GithubProfile } from './components/GithubProfile'
import { Landing } from './components/Landing'
import { LoadingScreen } from './components/LoadingScreen'
import { api } from './lib/api'
import type { CityData, JobSnapshot } from './types'

type View =
  | { name: 'landing' }
  | { name: 'github' }
  | { name: 'building'; repoUrl: string }
  | { name: 'city' }

const GITHUB_PATH = '/github'

function viewFromPath(pathname: string): View {
  return pathname === GITHUB_PATH ? { name: 'github' } : { name: 'landing' }
}

export default function App() {
  const [view, setView] = useState<View>(() => viewFromPath(window.location.pathname))
  const [job, setJob] = useState<JobSnapshot | null>(null)
  const [city, setCity] = useState<CityData | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [cacheKey, setCacheKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Keeps browser back/forward in sync with the landing <-> GitHub profile
  // pages. The transient "building"/"city" views are never pushed to
  // history, so a back-navigation out of them simply lands on whichever of
  // those two the URL says — same as a fresh load.
  useEffect(() => {
    const onPopState = () => setView(viewFromPath(window.location.pathname))
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const goToLanding = useCallback(() => {
    window.history.pushState(null, '', '/')
    setView({ name: 'landing' })
  }, [])

  const goToGithub = useCallback(() => {
    window.history.pushState(null, '', GITHUB_PATH)
    setView({ name: 'github' })
  }, [])

  const analyze = useCallback(async (repoUrl: string, force: boolean) => {
    setError(null)
    setJob(null)
    setCacheKey(null)
    setView({ name: 'building', repoUrl })
    try {
      const { jobId: id } = await api.analyze(repoUrl, force)
      setJobId(id)
      const result = await api.followJob(id, setJob)
      setCity(result)
      setView({ name: 'city' })
    } catch (caught) {
      setError((caught as Error).message)
      setView(viewFromPath(window.location.pathname))
    }
  }, [])

  const openCached = useCallback(async (key: string) => {
    setError(null)
    setView({ name: 'building', repoUrl: key })
    try {
      const result = await api.cached(key)
      setCity(result)
      setJobId(null)
      setCacheKey(key)
      setView({ name: 'city' })
    } catch (caught) {
      setError((caught as Error).message)
      setView(viewFromPath(window.location.pathname))
    }
  }, [])

  if (view.name === 'city' && city) {
    return (
      <CityView
        data={city}
        jobId={jobId}
        cacheKey={cacheKey}
        onExit={() => {
          setCity(null)
          setView(viewFromPath(window.location.pathname))
        }}
      />
    )
  }

  if (view.name === 'building') {
    return (
      <LoadingScreen
        repoUrl={view.repoUrl}
        job={job}
        onCancel={() => setView(viewFromPath(window.location.pathname))}
      />
    )
  }

  if (view.name === 'github') {
    return <GithubProfile onAnalyze={analyze} onBack={goToLanding} />
  }

  return <Landing onAnalyze={analyze} onOpenCached={openCached} onViewGithub={goToGithub} error={error} />
}
