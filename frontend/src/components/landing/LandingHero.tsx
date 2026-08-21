import { ArrowRight } from 'lucide-react'
import { useRef, useState } from 'react'

import { gsap, useGSAP } from '../../lib/gsapSetup'
import { LandingScene } from './LandingScene'

interface Props {
  onAnalyze: (repoUrl: string, force: boolean) => void
  error: string | null
}

const EXAMPLES = [
  { slug: 'pallets/flask', note: 'a classic Python web framework' },
  { slug: 'tiangolo/fastapi', note: 'async API framework' },
  { slug: 'vercel/swr', note: 'small, sharp TypeScript library' },
  { slug: 'anthropics/anthropic-sdk-python', note: 'the SDK this app runs on' },
]

export function LandingHero({ onAnalyze, error }: Props) {
  const [url, setUrl] = useState('')
  const scope = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const tl = gsap.timeline({
        defaults: { ease: 'power3.out', duration: reduced ? 0 : 0.9 },
      })
      tl.from('.landing__eyebrow', { y: 14, opacity: 0 })
        .from('.landing__title-line', { y: 34, opacity: 0, stagger: 0.09 }, '-=0.65')
        .from('.landing__lede', { y: 18, opacity: 0 }, '-=0.55')
        .from('.landing__form', { y: 18, opacity: 0 }, '-=0.5')
        .from('.landing__examples .pill', { y: 10, opacity: 0, stagger: 0.05 }, '-=0.4')
    },
    { scope },
  )

  return (
    <section className="landing__hero" ref={scope}>
      <LandingScene />
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

      <div className="landing__hero-content">
        <p className="landing__eyebrow">Repo City</p>
        <h1 className="landing__title">
          <span className="landing__title-line">Walk through any codebase</span>
          <span className="landing__title-line landing__title-line--accent">as a city.</span>
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
            <ArrowRight size={16} strokeWidth={2.4} />
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
      </div>

      <div className="landing__scroll-cue" aria-hidden="true">
        <span />
      </div>
    </section>
  )
}
