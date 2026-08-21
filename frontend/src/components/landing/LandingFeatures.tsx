import { BookOpen, Compass, Layers, MessageCircle, Mountain, SunMoon } from 'lucide-react'
import { useRef, type CSSProperties } from 'react'

import { gsap, useGSAP } from '../../lib/gsapSetup'

const ROTATIONS = [-3, 2, -2, 3, -4, 2.5]
const SEALS = ['#ff5d73', '#ffc93c', '#3fe0c5', '#8c6bff', '#ff8fd8', '#ffc93c']

const FEATURES = [
  {
    icon: BookOpen,
    title: 'A briefing at the gate',
    detail: 'Click the sign above the portal for what the project is, its architecture, and its tech stack with logos.',
  },
  {
    icon: Layers,
    title: 'A building per file',
    detail: 'Height is lines of code, colour is language, the rooftop shape encodes the role — spire, dome, or a crane for build tooling.',
  },
  {
    icon: SunMoon,
    title: 'Real time of day',
    detail: 'The scene follows your clock. After dark every window lights up warm and street lamps cast pools on the pavement.',
  },
  {
    icon: Mountain,
    title: 'A glacier valley',
    detail: 'The city sits in a snowfield ringed by peaks, sized from the repo itself — a nine-file town gets a small valley.',
  },
  {
    icon: Compass,
    title: 'Guided tour',
    detail: 'Auto-flies between the most important building in each district, sweeping around the city rather than lurching.',
  },
  {
    icon: MessageCircle,
    title: 'Ask the guide',
    detail: 'A grounded Q&A panel that answers from the analyzed city index and cites real file paths.',
  },
]

export function LandingFeatures() {
  const scope = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (reduced) return

      gsap.from('.sticker', {
        y: 40,
        opacity: 0,
        scale: 0.8,
        rotate: 0,
        stagger: 0.09,
        duration: 0.6,
        ease: 'back.out(1.8)',
        scrollTrigger: {
          trigger: scope.current,
          scroller: document.querySelector<HTMLElement>('.landing') ?? undefined,
          start: 'top 75%',
        },
      })
    },
    { scope },
  )

  return (
    <section className="features-section" ref={scope}>
      <p className="section-eyebrow">Inside the city</p>
      <h2 className="section-title">Every corner of the codebase, made walkable.</h2>

      <div className="sticker-wall">
        {FEATURES.map(({ icon: Icon, title, detail }, i) => (
          <article
            key={title}
            className="sticker"
            style={{ '--rot': `${ROTATIONS[i % ROTATIONS.length]}deg` } as CSSProperties}
          >
            <span className="sticker__tape" aria-hidden="true" />
            <span className="sticker__seal" style={{ background: SEALS[i % SEALS.length] }}>
              <Icon size={18} strokeWidth={2.6} color="#fff8ef" />
            </span>
            <h3 className="sticker__title">{title}</h3>
            <p className="sticker__detail">{detail}</p>
          </article>
        ))}
      </div>
    </section>
  )
}
