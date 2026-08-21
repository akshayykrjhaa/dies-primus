import { BookOpen, Compass, Layers, MessageCircle, Mountain, SunMoon } from 'lucide-react'
import { useRef, type MouseEvent } from 'react'

import { gsap, useGSAP } from '../../lib/gsapSetup'

const FEATURES = [
  {
    icon: BookOpen,
    title: 'A briefing at the gate',
    detail:
      'Click the sign above the portal for what the project is, its architecture, and its tech stack with logos.',
    span: 'wide',
  },
  {
    icon: Layers,
    title: 'A building per file',
    detail:
      'Height is lines of code, colour is language, the rooftop shape encodes the role — spire for an entry point, dome for a data model.',
  },
  {
    icon: SunMoon,
    title: 'Real time of day',
    detail:
      'The scene follows your clock. After dark every window lights up warm and street lamps cast pools on the pavement.',
  },
  {
    icon: Mountain,
    title: 'A glacier valley',
    detail:
      'The city sits in a snowfield ringed by peaks, sized from the repo itself — a nine-file town gets a small valley.',
  },
  {
    icon: Compass,
    title: 'Guided tour',
    detail: 'Auto-flies between the most important building in each district, sweeping around the city.',
  },
  {
    icon: MessageCircle,
    title: 'Ask the guide',
    detail: 'A grounded Q&A panel that answers from the analyzed city index and cites real file paths.',
    span: 'wide',
  },
]

export function LandingFeatures() {
  const scope = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (reduced) return

      // Plain DOM query, not a gsap selector string — see LandingSteps.tsx.
      const scroller = document.querySelector<HTMLElement>('.landing') ?? undefined

      gsap.from('.bento-card', {
        y: 36,
        opacity: 0,
        scale: 0.97,
        stagger: 0.08,
        duration: 0.65,
        ease: 'power3.out',
        scrollTrigger: {
          trigger: scope.current,
          scroller,
          start: 'top 75%',
        },
      })
    },
    { scope },
  )

  const handleMove = (event: MouseEvent<HTMLElement>) => {
    const card = event.currentTarget
    const rect = card.getBoundingClientRect()
    gsap.to(card, {
      '--mx': `${event.clientX - rect.left}px`,
      '--my': `${event.clientY - rect.top}px`,
      duration: 0.4,
      ease: 'power2.out',
      overwrite: 'auto',
    })
  }

  return (
    <section className="features-section" ref={scope}>
      <p className="section-eyebrow">Inside the city</p>
      <h2 className="section-title">Every corner of the codebase, made walkable.</h2>

      <div className="bento-grid">
        {FEATURES.map(({ icon: Icon, title, detail, span }) => (
          <article
            key={title}
            className={`bento-card${span === 'wide' ? ' bento-card--wide' : ''}`}
            onMouseMove={handleMove}
          >
            <div className="bento-card__glow" aria-hidden="true" />
            <div className="bento-card__icon">
              <Icon size={20} strokeWidth={2} />
            </div>
            <h3 className="bento-card__title">{title}</h3>
            <p className="bento-card__detail">{detail}</p>
          </article>
        ))}
      </div>
    </section>
  )
}
