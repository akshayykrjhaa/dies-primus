import type {
  AuthUser,
  CityData,
  FileNarration,
  JobSnapshot,
  ProfileData,
  RecentCity,
} from '../types'

const BASE = '/api'

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `Request failed (${response.status})`
    try {
      const body = await response.json()
      if (body?.detail) message = body.detail
    } catch {
      /* keep the generic message */
    }
    throw new Error(message)
  }
  return response.json() as Promise<T>
}

export interface Health {
  ok: boolean
  aiEnabled: boolean
  githubToken: boolean
  githubOAuthEnabled: boolean
  model: string
  limits: { maxBuildings: number; maxFilesReadByAI: number }
  note: string
}

export const GITHUB_LOGIN_URL = `${BASE}/auth/github/login`

export const api = {
  health: () => fetch(`${BASE}/health`).then(json<Health>),

  me: () => fetch(`${BASE}/auth/me`, { cache: 'no-store' }).then(json<AuthUser>),

  logout: () => fetch(`${BASE}/auth/logout`, { method: 'POST' }).then(json<{ ok: boolean }>),

  profile: () => fetch(`${BASE}/profile`, { cache: 'no-store' }).then(json<ProfileData>),

  recent: () =>
    fetch(`${BASE}/recent`)
      .then(json<{ items: RecentCity[] }>)
      .then((data) => data.items),

  cached: (cacheKey: string) => fetch(`${BASE}/cached/${cacheKey}`).then(json<CityData>),

  analyze: (repoUrl: string, force = false) =>
    fetch(`${BASE}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoUrl, force }),
    }).then(json<{ jobId: string; slug: string; cached: boolean }>),

  job: (jobId: string) => fetch(`${BASE}/jobs/${jobId}`).then(json<JobSnapshot>),

  /**
   * Follows a job to completion, polling for its state.
   *
   * This used to watch a Server-Sent Events stream, which is the better fit
   * for the problem and worked perfectly in development. It does not survive
   * a CDN in front of the API: an edge that buffers proxied responses -- and
   * Netlify's does, visibly, since the `Transfer-Encoding: chunked` the
   * backend sends never reaches the browser -- turns an incremental stream
   * into a single response delivered at the end, and then drops the
   * long-lived connection well before an analysis has finished.
   *
   * The failure was worse than losing the progress text. The old code fell
   * back to a *single* poll when the stream died, so a connection dropped at
   * ten seconds into a thirty-second analysis found the job still running,
   * gave up, and sent the visitor back to the landing page reporting a lost
   * connection -- while the backend carried on and finished the city, which
   * then appeared in the cache list as though nothing had happened.
   *
   * Polling has none of that to go wrong: every request is short, ordinary,
   * and cacheable-or-not on its own terms. The signature is unchanged, so
   * `onProgress` still fires as the job moves through its stages -- just on
   * a poll rather than on a push.
   */
  async followJob(
    jobId: string,
    onProgress: (snapshot: JobSnapshot) => void,
  ): Promise<CityData> {
    /** Fast enough to feel live, slow enough to be nothing on the network. */
    const INTERVAL = 1500
    /** A whole analysis, plus room for a sleeping free-tier backend to wake. */
    const TIMEOUT = 10 * 60 * 1000
    /**
     * A poll may fail for reasons the job knows nothing about -- a dropped
     * connection, a cold start, a blip at the edge. One failure is not a
     * failed analysis, so it takes several in a row to give up. This is the
     * exact impatience that made the old fallback report a working analysis
     * as broken.
     */
    const MAX_MISSES = 5

    const started = Date.now()
    let misses = 0
    let last = ''

    for (;;) {
      let snapshot: JobSnapshot
      try {
        snapshot = await api.job(jobId)
        misses = 0
      } catch (error) {
        misses += 1
        if (misses >= MAX_MISSES) {
          throw new Error('Lost the connection to the server.')
        }
        await new Promise((r) => setTimeout(r, INTERVAL))
        continue
      }

      // Only when something actually changed: an unchanged snapshot would
      // re-render the loading screen every poll for no reason.
      const signature = `${snapshot.status}:${snapshot.stage}:${snapshot.progress}`
      if (signature !== last) {
        last = signature
        onProgress(snapshot)
      }

      if (snapshot.status === 'done') {
        if (snapshot.result) return snapshot.result
        throw new Error('The job finished without a city.')
      }
      if (snapshot.status === 'error') {
        throw new Error(snapshot.error || 'Analysis failed.')
      }
      if (Date.now() - started > TIMEOUT) {
        throw new Error('The analysis is taking longer than expected.')
      }

      await new Promise((r) => setTimeout(r, INTERVAL))
    }
  },

  /**
   * Asks the model to explain one file, the first time somebody opens it.
   *
   * Analysis only describes a handful of files up front, so most buildings
   * arrive with a structural placeholder. This fills one in on demand; the
   * server folds the answer back into the cached city, so it is only ever
   * paid for once.
   */
  describe: (payload: { jobId?: string; cacheKey?: string; path: string }) =>
    fetch(`${BASE}/describe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(json<{ path: string; description: FileNarration; cached: boolean }>),

  /** Streams the tour-guide answer token by token. */
  async askGuide(
    payload: { jobId?: string; cacheKey?: string; question: string; focusPath?: string },
    onToken: (text: string) => void,
  ): Promise<void> {
    const response = await fetch(`${BASE}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!response.ok || !response.body) {
      throw new Error(`The guide is unavailable (${response.status}).`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const chunks = buffer.split('\n\n')
      buffer = chunks.pop() ?? ''
      for (const chunk of chunks) {
        const line = chunk.split('\n').find((l) => l.startsWith('data: '))
        if (!line) continue
        const event = JSON.parse(line.slice(6)) as { type: string; text?: string }
        if (event.type === 'text' && event.text) onToken(event.text)
        if (event.type === 'error') throw new Error(event.text || 'Guide error')
      }
    }
  },
}
