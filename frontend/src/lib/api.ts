import type { CityData, JobSnapshot, RecentCity } from '../types'

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
  model: string
  limits: { maxBuildings: number; maxFilesReadByAI: number }
  note: string
}

export const api = {
  health: () => fetch(`${BASE}/health`).then(json<Health>),

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
   * Follows a job over Server-Sent Events. Resolves with the finished city;
   * `onProgress` fires for every stage change along the way.
   */
  followJob(jobId: string, onProgress: (snapshot: JobSnapshot) => void): Promise<CityData> {
    return new Promise((resolve, reject) => {
      const source = new EventSource(`${BASE}/jobs/${jobId}/events`)

      source.onmessage = (event) => {
        const snapshot = JSON.parse(event.data) as JobSnapshot
        onProgress(snapshot)
        if (snapshot.status === 'done') {
          source.close()
          api
            .job(jobId)
            .then((full) => {
              if (full.result) resolve(full.result)
              else reject(new Error('The job finished without a city.'))
            })
            .catch(reject)
        } else if (snapshot.status === 'error') {
          source.close()
          reject(new Error(snapshot.error || 'Analysis failed.'))
        }
      }

      source.onerror = () => {
        // The stream dropped: fall back to a one-shot poll before giving up.
        source.close()
        api
          .job(jobId)
          .then((full) => {
            if (full.status === 'done' && full.result) resolve(full.result)
            else reject(new Error(full.error || 'Lost the connection to the server.'))
          })
          .catch(() => reject(new Error('Lost the connection to the server.')))
      }
    })
  },

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
