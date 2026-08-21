import { useRef } from 'react'

import { gsap, useGSAP } from '../../lib/gsapSetup'

const TREE_LINES = [
  { text: 'src/', depth: 0 },
  { text: 'index.ts', depth: 1 },
  { text: 'components/', depth: 1 },
  { text: 'App.tsx', depth: 2 },
  { text: 'Button.tsx', depth: 2 },
  { text: 'Modal.tsx', depth: 2 },
  { text: 'utils/', depth: 1 },
  { text: 'helpers.ts', depth: 2 },
  { text: 'format.ts', depth: 2 },
  { text: 'README.md', depth: 0 },
  { text: 'package.json', depth: 0 },
]

const CITY_BUILDINGS = [
  { x: 10, w: 26, h: 60, color: '#ff5d73' },
  { x: 40, w: 32, h: 92, color: '#ffc93c' },
  { x: 76, w: 24, h: 46, color: '#3fe0c5' },
  { x: 104, w: 30, h: 78, color: '#8c6bff' },
  { x: 138, w: 26, h: 56, color: '#ff8fd8' },
]

export function LandingCompare() {
  const scope = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (reduced) return

      gsap.from('.compare__panel', {
        opacity: 0,
        y: 30,
        stagger: 0.15,
        duration: 0.7,
        ease: 'power3.out',
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
    <section className="compare" ref={scope}>
      <p className="section-eyebrow">The difference</p>
      <h2 className="section-title">A file tree tells you nothing. A city tells you everything.</h2>

      <div className="compare__grid">
        <div className="compare__panel compare__panel--dull">
          <p className="compare__label">What you get from every other tool</p>
          <pre className="compare__tree">
            {TREE_LINES.map((line, i) => (
              <span key={i} className="compare__tree-line" style={{ paddingLeft: `${line.depth * 16}px` }}>
                {line.depth > 0 ? '└─ ' : ''}
                {line.text}
                {'\n'}
              </span>
            ))}
          </pre>
        </div>

        <div className="compare__arrow" aria-hidden="true">
          <svg viewBox="0 0 120 40" fill="none">
            <path
              d="M4 20 Q 40 4, 76 20"
              stroke="#ffc93c"
              strokeWidth="5"
              strokeLinecap="round"
              fill="none"
            />
            <path d="M64 8 L80 20 L64 30" stroke="#ffc93c" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </svg>
        </div>

        <div className="compare__panel compare__panel--city">
          <p className="compare__label compare__label--bright">What Repo City gives you</p>
          <svg className="compare__city" viewBox="0 0 190 110" aria-hidden="true">
            <circle cx="160" cy="24" r="14" fill="#fff2e0" stroke="#12101f" strokeWidth="3" />
            {CITY_BUILDINGS.map((b, i) => (
              <g key={i}>
                <rect
                  x={b.x}
                  y={100 - b.h}
                  width={b.w}
                  height={b.h}
                  rx="4"
                  fill={b.color}
                  stroke="#12101f"
                  strokeWidth="3"
                />
                <rect x={b.x} y={96} width={b.w} height="4" fill="#12101f" opacity="0.15" />
              </g>
            ))}
            <rect x="0" y="100" width="190" height="6" fill="#12101f" opacity="0.2" />
          </svg>
        </div>
      </div>
    </section>
  )
}
