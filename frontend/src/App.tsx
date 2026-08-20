import { useCallback, useState } from 'react'

import { CityView } from './components/CityView'
import { Landing } from './components/Landing'
import { LoadingScreen } from './components/LoadingScreen'
import { api } from './lib/api'
import type { CityData, JobSnapshot } from './types'

type View =
  | { name: 'landing' }
  | { name: 'building'; repoUrl: string }
  | { name: 'city' }

export default function App() {
  const [view, setView] = useState<View>({ name: 'landing' })
  const [job, setJob] = useState<JobSnapshot | null>(null)
  const [city, setCity] = useState<CityData | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [cacheKey, setCacheKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

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
      setView({ name: 'landing' })
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
      setView({ name: 'landing' })
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
          setView({ name: 'landing' })
        }}
      />
    )
  }

  if (view.name === 'building') {
    return (
      <LoadingScreen
        repoUrl={view.repoUrl}
        job={job}
        onCancel={() => setView({ name: 'landing' })}
      />
    )
  }

  return <Landing onAnalyze={analyze} onOpenCached={openCached} error={error} />
}
