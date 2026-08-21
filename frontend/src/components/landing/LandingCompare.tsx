import { useRef, type MouseEvent, type PointerEvent } from 'react'

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

const GROUND_Y = 104

type Roof = 'antenna' | 'dome' | 'step' | 'point' | 'flat'

interface CityBuilding {
  x: number
  w: number
  h: number
  color: string
  roof: Roof
  depth: 1 | 2
  files: number
}

const CITY_BUILDINGS: CityBuilding[] = [
  { x: 6, w: 20, h: 38, color: '#ff5d73', roof: 'antenna', depth: 1, files: 12 },
  { x: 30, w: 28, h: 70, color: '#ffc93c', roof: 'flat', depth: 2, files: 47 },
  { x: 62, w: 18, h: 32, color: '#3fe0c5', roof: 'dome', depth: 1, files: 8 },
  { x: 84, w: 24, h: 56, color: '#8c6bff', roof: 'step', depth: 2, files: 31 },
  { x: 112, w: 20, h: 42, color: '#ff8fd8', roof: 'point', depth: 1, files: 19 },
  { x: 136, w: 16, h: 28, color: '#ffc93c', roof: 'flat', depth: 1, files: 6 },
]

function Windows({ building, seed }: { building: CityBuilding; seed: number }) {
  const cols = Math.max(2, Math.round(building.w / 7))
  const rows = Math.max(3, Math.round(building.h / 8))
  const cellW = building.w / cols
  const cellH = building.h / rows
  const topY = GROUND_Y - building.h
  let s = seed
  const rand = () => {
    s = (s * 48271) % 2147483647
    return s / 2147483647
  }

  const rects: { x: number; y: number }[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (rand() > 0.55) continue
      rects.push({ x: building.x + c * cellW + cellW * 0.26, y: topY + r * cellH + cellH * 0.26 })
    }
  }

  return (
    <>
      {rects.map((p, i) => (
        <rect key={i} x={p.x} y={p.y} width={cellW * 0.48} height={cellH * 0.48} rx={0.6} fill="#fff2e0" opacity={0.92} />
      ))}
    </>
  )
}

function Roof({ building }: { building: CityBuilding }) {
  const topY = GROUND_Y - building.h
  const cx = building.x + building.w / 2

  if (building.roof === 'antenna') {
    return (
      <>
        <line x1={cx} y1={topY} x2={cx} y2={topY - 12} stroke="#12101f" strokeWidth={2} strokeLinecap="round" />
        <circle cx={cx} cy={topY - 14} r={2.6} fill="#ff5d73" stroke="#12101f" strokeWidth={1.6} />
      </>
    )
  }
  if (building.roof === 'dome') {
    return (
      <path
        d={`M ${building.x} ${topY} A ${building.w / 2} ${building.h / 5} 0 0 1 ${building.x + building.w} ${topY}`}
        fill={building.color}
        stroke="#12101f"
        strokeWidth={2.4}
      />
    )
  }
  if (building.roof === 'step') {
    return (
      <rect
        x={cx - building.w * 0.28}
        y={topY - 9}
        width={building.w * 0.56}
        height={9}
        rx={2}
        fill={building.color}
        stroke="#12101f"
        strokeWidth={2.4}
      />
    )
  }
  if (building.roof === 'point') {
    return (
      <path
        d={`M ${building.x - 1} ${topY} L ${cx} ${topY - 14} L ${building.x + building.w + 1} ${topY} Z`}
        fill={building.color}
        stroke="#12101f"
        strokeWidth={2.4}
        strokeLinejoin="round"
      />
    )
  }
  return <rect x={cx - 3.5} y={topY - 5} width={7} height={5} fill="#12101f" opacity={0.18} />
}

export function LandingCompare() {
  const scope = useRef<HTMLDivElement>(null)
  const nearLayer = useRef<SVGGElement>(null)
  const farLayer = useRef<SVGGElement>(null)
  const badge = useRef<SVGGElement>(null)
  const badgeText = useRef<SVGTextElement>(null)
  const badgeTween = useRef<gsap.core.Timeline | null>(null)

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

  const handleMove = (event: PointerEvent<SVGSVGElement>) => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const rect = event.currentTarget.getBoundingClientRect()
    const px = ((event.clientX - rect.left) / rect.width) * 2 - 1
    const py = ((event.clientY - rect.top) / rect.height) * 2 - 1
    gsap.to(nearLayer.current, { x: px * 4.5, y: py * 2.2, duration: 0.5, ease: 'power2.out' })
    gsap.to(farLayer.current, { x: px * 1.8, y: py * 0.9, duration: 0.6, ease: 'power2.out' })
  }

  const handleLeave = () => {
    gsap.to([nearLayer.current, farLayer.current], { x: 0, y: 0, duration: 0.6, ease: 'power2.out' })
  }

  const hop = (event: MouseEvent<SVGGElement>, up: boolean) => {
    gsap.to(event.currentTarget, {
      scale: up ? 1.08 : 1,
      y: up ? -3 : 0,
      duration: 0.32,
      ease: up ? 'back.out(2.6)' : 'power2.out',
      transformOrigin: '50% 100%',
    })
  }

  const showBadge = (b: CityBuilding) => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    if (!badge.current || !badgeText.current) return
    badgeText.current.textContent = `${b.files} files`
    const cx = b.x + b.w / 2
    const topY = GROUND_Y - b.h
    badge.current.setAttribute('transform', `translate(${cx}, ${topY - 20})`)
    badgeTween.current?.kill()
    gsap.set(badge.current, { opacity: 0, scale: 0.6, transformOrigin: '50% 100%' })
    badgeTween.current = gsap
      .timeline()
      .to(badge.current, { opacity: 1, scale: 1, duration: 0.22, ease: 'back.out(3)' })
      .to(badge.current, { opacity: 0, y: '-=6', duration: 0.35, ease: 'power1.in', delay: 0.7 })
  }

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
            <path d="M4 20 Q 40 4, 76 20" stroke="#ffc93c" strokeWidth="5" strokeLinecap="round" fill="none" />
            <path
              d="M64 8 L80 20 L64 30"
              stroke="#ffc93c"
              strokeWidth="5"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </svg>
        </div>

        <div className="compare__panel compare__panel--city">
          <p className="compare__label compare__label--bright">What Repo City gives you</p>
          <div className="compare__city-wrap">
            <svg
              className="compare__city"
              viewBox="0 0 200 120"
              onPointerMove={handleMove}
              onPointerLeave={handleLeave}
            >
              <g ref={farLayer}>
                {/* a little construction crane, tying back to the mascot */}
                <g opacity={0.35}>
                  <line x1="182" y1="18" x2="182" y2="96" stroke="#12101f" strokeWidth="2" />
                  <line x1="182" y1="20" x2="150" y2="24" stroke="#12101f" strokeWidth="2" />
                  <line x1="168" y1="22" x2="168" y2="34" stroke="#12101f" strokeWidth="2" />
                </g>
                <circle cx="172" cy="20" r="12" fill="#fff2e0" stroke="#12101f" strokeWidth="2.6" />
                <circle cx="172" cy="20" r="18" fill="#fff2e0" opacity="0.18" />
                <circle cx="176" cy="17" r="1.6" fill="#e6d2aa" opacity="0.7" />
                <circle cx="169" cy="24" r="1.1" fill="#e6d2aa" opacity="0.7" />
              </g>

              <g ref={nearLayer}>
                {CITY_BUILDINGS.map((b, i) => (
                  <g
                    key={i}
                    className="compare__building"
                    onMouseEnter={(event) => {
                      hop(event, true)
                      showBadge(b)
                    }}
                    onMouseLeave={(event) => hop(event, false)}
                    onClick={() => showBadge(b)}
                  >
                    <rect
                      x={b.x}
                      y={GROUND_Y - b.h}
                      width={b.w}
                      height={b.h}
                      rx="3"
                      fill={b.color}
                      stroke="#12101f"
                      strokeWidth="2.6"
                    />
                    <Windows building={b} seed={(i + 1) * 733} />
                    <Roof building={b} />
                  </g>
                ))}
                <rect x="0" y={GROUND_Y} width="200" height="6" fill="#12101f" opacity="0.18" />

                <g ref={badge} opacity={0} className="compare__badge">
                  <rect x="-24" y="-14" width="48" height="18" rx="9" fill="#12101f" />
                  <text ref={badgeText} x="0" y="-1.5" textAnchor="middle" fontSize="9" fill="#fff8ef" fontWeight={700}>
                    0 files
                  </text>
                </g>
              </g>
            </svg>
          </div>
        </div>
      </div>
    </section>
  )
}
