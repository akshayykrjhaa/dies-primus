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
  const road = useRef<SVGPathElement>(null)

  useGSAP(
    () => {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (reduced) return

      // Plain DOM query, not a gsap selector string — see the note in
      // LandingCompare.tsx / the fix from the previous pass: inside a
      // useGSAP({ scope }) context, string selectors are rewritten to
      // search only *within* the scope element, and .landing is this
      // section's ancestor, not a descendant, so it would never resolve.
      const scroller = document.querySelector<HTMLElement>('.landing') ?? undefined

      gsap.from('.step-stop', {
        y: 46,
        opacity: 0,
        stagger: 0.16,
        duration: 0.7,
        ease: 'power3.out',
        scrollTrigger: {
          trigger: scope.current,
          scroller,
          start: 'top 75%',
        },
      })

      if (road.current) {
        const length = road.current.getTotalLength()
        gsap.set(road.current, { strokeDasharray: length, strokeDashoffset: length })
        gsap.to(road.current, {
          strokeDashoffset: 0,
          ease: 'none',
          scrollTrigger: {
            trigger: scope.current,
            scroller,
            start: 'top 70%',
            end: 'bottom 65%',
            scrub: 0.6,
          },
        })
      }
    },
    { scope },
  )

  return (
    <section className="steps-section" ref={scope}>
      <p className="section-eyebrow">How it works</p>
      <h2 className="section-title">One URL, five stages, one city.</h2>

      <div className="steps__road">
        <svg className="steps__path" viewBox="0 0 200 620" preserveAspectRatio="none" aria-hidden="true">
          <path
            ref={road}
            d="M150 10 C 60 60, 60 120, 150 170 S 240 260, 150 320 S 60 410, 150 470 S 240 550, 150 610"
            stroke="#fff2e0"
            strokeWidth="6"
            strokeLinecap="round"
            fill="none"
          />
        </svg>

        <div className="steps__stops">
          {STEPS.map(({ icon: Icon, label, detail }, i) => (
            <article className={`step-stop step-stop--${i % 2 === 0 ? 'left' : 'right'}`} key={label}>
              <div className="step-stop__sign">
                <span className="step-stop__num">{i + 1}</span>
                <div className="step-stop__icon">
                  <Icon size={20} strokeWidth={2.4} />
                </div>
                <h3 className="step-stop__label">{label}</h3>
                <p className="step-stop__detail">{detail}</p>
              </div>
              <span className="step-stop__post" aria-hidden="true" />
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
