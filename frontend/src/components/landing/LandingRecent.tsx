import { Building2 } from 'lucide-react'
import { useRef } from 'react'

import { gsap, useGSAP } from '../../lib/gsapSetup'
import type { RecentCity } from '../../types'

interface Props {
  recent: RecentCity[]
  onOpenCached: (cacheKey: string) => void
}

export function LandingRecent({ recent, onOpenCached }: Props) {
  const scope = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      if (recent.length === 0) return
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (reduced) return

      // Plain DOM query, not a gsap selector string — see LandingSteps.tsx.
      const scroller = document.querySelector<HTMLElement>('.landing') ?? undefined

      gsap.from('.recent-card', {
        y: 24,
        opacity: 0,
        stagger: 0.06,
        duration: 0.55,
        ease: 'power3.out',
        scrollTrigger: {
          trigger: scope.current,
          scroller,
          start: 'top 80%',
        },
      })
    },
    { scope, dependencies: [recent.length] },
  )

  if (recent.length === 0) return null

  return (
    <section className="landing__recent" ref={scope}>
      <p className="section-eyebrow">Already built</p>
      <h2 className="section-title">Skip the wait, walk in.</h2>

      <div className="landing__recent-grid">
        {recent.map((item) => (
          <button key={item.cacheKey} className="recent-card" onClick={() => onOpenCached(item.cacheKey)}>
            <span className="recent-card__slug">{item.slug}</span>
            <span className="recent-card__desc">{item.description || 'No description'}</span>
            <span className="recent-card__meta">
              <Building2 size={12} strokeWidth={2.2} />
              {item.buildings} buildings · cached
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}
