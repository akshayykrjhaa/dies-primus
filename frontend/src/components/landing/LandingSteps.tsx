import { Building2, Download, Filter, Sparkles } from 'lucide-react'
import { useRef } from 'react'

import { gsap, useGSAP } from '../../lib/gsapSetup'

const STEPS = [
  {
    icon: Download,
    label: 'Fetch',
    detail: 'Repo metadata, the recursive file tree, language bytes and the README, pulled straight from GitHub.',
  },
  {
    icon: Filter,
    label: 'Triage',
    detail: 'A repo can hold 30,000 files; a readable city holds a few hundred. Vendored and generated paths get dropped, every directory stays represented.',
  },
  {
    icon: Sparkles,
    label: 'Explain',
    detail: 'The top-ranked files are read and sent to an LLM with structured outputs — a project briefing and a description per file, as data, not prose.',
  },
  {
    icon: Building2,
    label: 'Build the city',
    detail: 'Files group into districts, plots get shelf-packed, and the most important files land nearest each plot’s centre — so every district gets a skyline.',
  },
]

export function LandingSteps() {
  const scope = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (reduced) return

      // Resolved via a plain DOM query, not a gsap selector string: inside a
      // useGSAP({ scope }) context, string selectors are rewritten to search
      // only *within* the scope element, and .landing is this section's
      // ancestor, not a descendant, so it would never resolve.
      const scroller = document.querySelector<HTMLElement>('.landing') ?? undefined

      gsap.from('.step-card', {
        y: 40,
        opacity: 0,
        stagger: 0.14,
        duration: 0.7,
        ease: 'power3.out',
        scrollTrigger: {
          trigger: scope.current,
          scroller,
          start: 'top 75%',
        },
      })

      gsap.to('.steps__fill', {
        scaleX: 1,
        ease: 'none',
        scrollTrigger: {
          trigger: scope.current,
          scroller,
          start: 'top 70%',
          end: 'bottom 60%',
          scrub: 0.6,
        },
      })
    },
    { scope },
  )

  return (
    <section className="steps-section" ref={scope}>
      <p className="section-eyebrow">How it works</p>
      <h2 className="section-title">One URL, five stages, one city.</h2>

      <div className="steps__track" aria-hidden="true">
        <div className="steps__fill" />
      </div>

      <div className="steps__grid">
        {STEPS.map(({ icon: Icon, label, detail }) => (
          <article className="step-card" key={label}>
            <div className="step-card__icon">
              <Icon size={20} strokeWidth={2} />
            </div>
            <h3 className="step-card__label">{label}</h3>
            <p className="step-card__detail">{detail}</p>
          </article>
        ))}
      </div>
    </section>
  )
}
