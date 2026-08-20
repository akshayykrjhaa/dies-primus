import { useEffect, useState } from 'react'

import { api, type Health } from '../lib/api'
import type { RecentCity } from '../types'

interface Props {
  onAnalyze: (repoUrl: string, force: boolean) => void
  onOpenCached: (cacheKey: string) => void
  error: string | null
}

const EXAMPLES = [
  { slug: 'pallets/flask', note: 'a classic Python web framework' },
  { slug: 'tiangolo/fastapi', note: 'async API framework' },
  { slug: 'vercel/swr', note: 'small, sharp TypeScript library' },
  { slug: 'anthropics/anthropic-sdk-python', note: 'the SDK this app runs on' },
]

export function Landing({ onAnalyze, onOpenCached, error }: Props) {
  const [url, setUrl] = useState('')
  const [health, setHealth] = useState<Health | null>(null)
  const [recent, setRecent] = useState<RecentCity[]>([])

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth(null))
    api.recent().then(setRecent).catch(() => setRecent([]))
  }, [])

  return (
    <div className="landing">
      <div className="landing__skyline" aria-hidden="true">
        {Array.from({ length: 26 }).map((_, index) => (
          <span
            key={index}
            style={{
              height: `${18 + ((index * 37) % 62)}%`,
              animationDelay: `${index * 0.06}s`,
            }}
          />
        ))}
      </div>

      <main className="landing__content">
        <p className="landing__eyebrow">Repo City</p>
        <h1 className="landing__title">
          Walk through any codebase
          <span> as a city.</span>
        </h1>
        <p className="landing__lede">
          Paste a GitHub URL. An agent reads the repository, writes a briefing for the
          city gate, then builds a district for every folder and a building for every
          file — hover one to hear what it does.
        </p>

        <form
          className="landing__form"
          onSubmit={(event) => {
            event.preventDefault()
            onAnalyze(url, false)
          }}
        >
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://github.com/owner/repo"
            spellCheck={false}
            autoFocus
          />
          <button className="button button--primary" type="submit" disabled={!url.trim()}>
            Build the city
          </button>
        </form>

        {error && <div className="notice notice--error">{error}</div>}

        <div className="landing__examples">
          <span>Try:</span>
          {EXAMPLES.map((example) => (
            <button
              key={example.slug}
              className="pill"
              onClick={() => {
                setUrl(`https://github.com/${example.slug}`)
                onAnalyze(example.slug, false)
              }}
              title={example.note}
            >
              {example.slug}
            </button>
          ))}
        </div>

        {recent.length > 0 && (
          <div className="landing__recent">
            <h2>Already built</h2>
            <div className="landing__recent-grid">
              {recent.map((item) => (
                <button
                  key={item.cacheKey}
                  className="recent-card"
                  onClick={() => onOpenCached(item.cacheKey)}
                >
                  <span className="recent-card__slug">{item.slug}</span>
                  <span className="recent-card__desc">
                    {item.description || 'No description'}
                  </span>
                  <span className="recent-card__meta">{item.buildings} buildings · cached</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {health && (
          <footer className="landing__status">
            <span className={health.aiEnabled ? 'dot dot--ok' : 'dot dot--warn'} />
            {health.aiEnabled
              ? `Claude narrator online (${health.model})`
              : 'No ANTHROPIC_API_KEY — cities will render with structural descriptions only'}
            <span className="landing__status-sep">·</span>
            <span className={health.githubToken ? 'dot dot--ok' : 'dot dot--warn'} />
            {health.githubToken ? 'GitHub token set' : 'No GITHUB_TOKEN (60 requests/hour)'}
          </footer>
        )}
      </main>
    </div>
  )
}
