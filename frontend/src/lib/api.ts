import type {
  AuthUser,
  CityData,
  FileNarration,
  JobSnapshot,
  ProfileData,
  RecentCity,
} from '../types'

const BASE = '/api'

/** A failed request, carrying the status so callers can tell *how* it failed. */
export class ApiError extends Error {
  /** 0 when the request never reached the server at all. */
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `Request failed (${response.status})`
    try {
      const body = await response.json()
      if (body?.detail) message = body.detail
    } catch {
      /* keep the generic message */
    }
    throw new ApiError(message, response.status)
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
   * into a single response delivered at the end, then drops the long-lived
   * connection well before a large analysis has finished.
   *
   * Everything here is about not giving up too early, because the cost of
   * doing so is severe and silent: the analysis carries on to completion on
   * the server whatever the browser decides, so an impatient client throws
   * away a city that was about to arrive, and the visitor is told the
   * connection died while the work quietly finishes without them.
   *
   *  - A failed poll is not a failed analysis. It takes a *continuous* run of
   *    failures lasting `PATIENCE` to count as lost -- long enough to sit out
   *    a free-tier backend restarting, a sleeping laptop, or a tunnel.
   *  - The gap between polls grows once it is clear this is a long job, so a
   *    four-minute analysis costs a few dozen requests rather than hundreds,
   *    and a rate limit has room to recover.
   *  - A 404 means the job record itself is gone, which on a server that
   *    keeps jobs in memory means it restarted. The city may still have been
   *    finished and written to the cache before that, so it looks there
   *    before admitting defeat.
   */
  async followJob(
    jobId: string,
    onProgress: (snapshot: JobSnapshot) => void,
    /** The repo this job is for, so a lost job can be looked up in the cache. */
    slug?: string,
  ): Promise<CityData> {
    /** While the early stages move quickly and the viewer is watching. */
    const POLL_FAST = 1000
    /** Once it is clearly a long analysis; stages then change every ~20s. */
    const POLL_SLOW = 2500
    const EASE_OFF_AFTER = 20_000
    /** Continuous failure, not total failure, before the job is called lost. */
    const PATIENCE = 120_000
    /** A very large repository on a throttled free tier is genuinely slow. */
    const TIMEOUT = 20 * 60 * 1000

    const started = Date.now()
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
    let failingSince: number | null = null
    let last = ''

    for (;;) {
      let snapshot: JobSnapshot | null = null
      try {
        snapshot = await api.job(jobId)
        failingSince = null
      } catch (error) {
        const status = error instanceof ApiError ? error.status : 0

        // The job record is gone: this server no longer knows about it, and
        // no amount of asking again will change that. If the analysis had
        // already finished, the city is in the cache -- fetch it from there
        // rather than reporting a failure for work that succeeded.
        if (status === 404) {
          const rescued = slug ? await api.findCached(slug).catch(() => null) : null
          if (rescued) return rescued
          throw new Error(
            'The server restarted while building this city. Please try again.',
          )
        }

        if (failingSince === null) failingSince = Date.now()
        if (Date.now() - failingSince > PATIENCE) {
          throw new Error('Lost the connection to the server.')
        }
        await sleep(POLL_SLOW)
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

      await sleep(Date.now() - started > EASE_OFF_AFTER ? POLL_SLOW : POLL_FAST)
    }
  },

  /**
   * The finished city for a repo, if some earlier run cached it.
   *
   * Used to rescue an analysis whose job record was lost -- see `followJob`.
   */
  async findCached(slug: string): Promise<CityData | null> {
    const items = await api.recent()
    const match = items.find((item) => item.slug === slug)
    return match ? api.cached(match.cacheKey) : null
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
