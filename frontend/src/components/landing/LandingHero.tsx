import { ArrowRight, Github } from 'lucide-react'
import { useRef, useState } from 'react'

import { GITHUB_LOGIN_URL } from '../../lib/api'
import { gsap, useGSAP } from '../../lib/gsapSetup'
import type { AuthUser } from '../../types'
import { Mascot } from './Mascot'
import { LandingScene } from './LandingScene'
import type { Mood } from './toonKit'

interface Props {
  onAnalyze: (repoUrl: string, force: boolean) => void
  error: string | null
  mood: Mood
  user: AuthUser | null
  onLogout: () => void
  authNotice: { text: string; kind: 'success' | 'error' } | null
}

const EXAMPLES = [
  { slug: 'pallets/flask', note: 'a classic Python web framework' },
  { slug: 'tiangolo/fastapi', note: 'async API framework' },
  { slug: 'vercel/swr', note: 'small, sharp TypeScript library' },
  { slug: 'anthropics/anthropic-sdk-python', note: 'the SDK this app runs on' },
]

const SPARKS = ['landing__cta-spark--1', 'landing__cta-spark--2', 'landing__cta-spark--3', 'landing__cta-spark--4']

export function LandingHero({ onAnalyze, error, mood, user, onLogout, authNotice }: Props) {
  const [url, setUrl] = useState('')
  const scope = useRef<HTMLDivElement>(null)
  const squiggle = useRef<SVGPathElement>(null)

  useGSAP(
    () => {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const tl = gsap.timeline({
        defaults: { ease: 'power3.out', duration: reduced ? 0 : 0.9 },
      })
      tl.from('.landing__eyebrow', { y: 14, opacity: 0 })
        .from('.landing__title-line', { y: 34, opacity: 0, stagger: 0.09 }, '-=0.65')
        .from('.mascot--hero', { scale: 0, rotate: -20, opacity: 0, ease: 'back.out(2.4)' }, '-=0.5')
        .from('.landing__lede', { y: 18, opacity: 0 }, '-=0.55')
        .from('.landing__form', { y: 18, opacity: 0 }, '-=0.5')
        .from('.landing__examples .pill', { y: 10, opacity: 0, stagger: 0.05 }, '-=0.4')

      // No DrawSVG plugin (that's a paid GSAP Club add-on) — the "hand-drawn"
      // reveal is done the plain way: measure the path, animate its offset.
      if (squiggle.current) {
        const length = squiggle.current.getTotalLength()
        gsap.set(squiggle.current, { strokeDasharray: length, strokeDashoffset: reduced ? 0 : length })
        if (!reduced) {
          tl.to(squiggle.current, { strokeDashoffset: 0, duration: 0.7, ease: 'power2.out' }, '-=0.35')
        }
      }
    },
    { scope },
  )

  const sparkBurst = () => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) return
    gsap.fromTo(
      '.landing__cta-spark',
      { opacity: 0, scale: 0, rotate: 0 },
      {
        opacity: 1,
        scale: 1,
        rotate: 20,
        duration: 0.32,
        stagger: 0.05,
        ease: 'back.out(3)',
        yoyo: true,
        repeat: 1,
        repeatDelay: 0.2,
      },
    )
  }

  return (
    <section className="landing__hero" ref={scope}>
      <LandingScene mood={mood} />

      <div className="github-connect">
        {user?.authenticated ? (
          <div className="github-connect__user">
            {user.avatarUrl && <img className="github-connect__avatar" src={user.avatarUrl} alt="" />}
            <span className="github-connect__login">{user.login}</span>
            <button className="github-connect__signout" onClick={onLogout}>
              Sign out
            </button>
          </div>
        ) : (
          <a className="github-connect__button" href={GITHUB_LOGIN_URL}>
            <Github size={15} strokeWidth={2.4} />
            Connect GitHub
          </a>
        )}
      </div>

      <div className="landing__hero-content">
        <p className="landing__eyebrow">Repo City</p>
        <h1 className="landing__title">
          <span className="landing__title-line">Walk through any codebase</span>
          <span className="landing__title-line landing__title-line--accent">
            as a city.
            <Mascot size={64} pose="wave" followCursor className="mascot--hero" />
            <svg className="landing__squiggle" viewBox="0 0 260 24" aria-hidden="true">
              <path
                ref={squiggle}
                d="M4 14 Q 30 2, 56 13 T 108 13 T 160 13 T 212 11 T 256 15"
                fill="none"
                stroke="#ffc93c"
                strokeWidth="7"
                strokeLinecap="round"
              />
            </svg>
          </span>
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
          <span className="landing__cta-wrap" onMouseEnter={sparkBurst}>
            {SPARKS.map((cls) => (
              <svg key={cls} className={`landing__cta-spark ${cls}`} viewBox="0 0 20 20" aria-hidden="true">
                <path d="M10 0 L12 8 L20 10 L12 12 L10 20 L8 12 L0 10 L8 8 Z" fill="#ffc93c" />
              </svg>
            ))}
            <button className="button button--primary landing__cta" type="submit" disabled={!url.trim()}>
              Build the city
              <ArrowRight size={16} strokeWidth={2.4} />
            </button>
          </span>
        </form>

        {error && <div className="notice notice--error">{error}</div>}
        {authNotice && (
          <div className={`notice notice--${authNotice.kind}`}>{authNotice.text}</div>
        )}

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
