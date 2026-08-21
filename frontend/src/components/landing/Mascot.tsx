import { useEffect, useRef } from 'react'

import { gsap, useGSAP } from '../../lib/gsapSetup'

interface Props {
  size?: number
  pose?: 'wave' | 'point' | 'idle'
  className?: string
  /** Pupils drift slightly toward the pointer — off by default; the hero/intro turn it on. */
  followCursor?: boolean
}

/**
 * "The Surveyor" — the landing page's recurring mascot. Built from plain
 * shapes so it stays a small, self-contained illustration rather than a
 * dependency on an external asset.
 */
export function Mascot({ size = 120, pose = 'idle', className, followCursor = false }: Props) {
  const root = useRef<SVGSVGElement>(null)
  const leftPupil = useRef<SVGCircleElement>(null)
  const rightPupil = useRef<SVGCircleElement>(null)

  useGSAP(
    () => {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (reduced || !root.current) return

      gsap.to(root.current, {
        y: -8,
        duration: 1.7,
        ease: 'sine.inOut',
        yoyo: true,
        repeat: -1,
      })

      gsap.to('.mascot__light', {
        opacity: 0.35,
        duration: 0.8,
        ease: 'sine.inOut',
        yoyo: true,
        repeat: -1,
      })
    },
    { scope: root },
  )

  useEffect(() => {
    if (!followCursor) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) return

    const moveLeft = gsap.quickTo(leftPupil.current, 'x', { duration: 0.35, ease: 'power2.out' })
    const moveLeftY = gsap.quickTo(leftPupil.current, 'y', { duration: 0.35, ease: 'power2.out' })
    const moveRight = gsap.quickTo(rightPupil.current, 'x', { duration: 0.35, ease: 'power2.out' })
    const moveRightY = gsap.quickTo(rightPupil.current, 'y', { duration: 0.35, ease: 'power2.out' })

    const handle = (event: PointerEvent) => {
      const rect = root.current?.getBoundingClientRect()
      if (!rect) return
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2
      const dx = Math.max(-1, Math.min(1, (event.clientX - cx) / 320))
      const dy = Math.max(-1, Math.min(1, (event.clientY - cy) / 320))
      moveLeft(dx * 2.4)
      moveLeftY(dy * 2.4)
      moveRight(dx * 2.4)
      moveRightY(dy * 2.4)
    }

    window.addEventListener('pointermove', handle)
    return () => window.removeEventListener('pointermove', handle)
  }, [followCursor])

  const armRight =
    pose === 'wave' ? (
      <path
        d="M78 62 Q96 46 90 26"
        stroke="#12101f"
        strokeWidth="7"
        strokeLinecap="round"
        fill="none"
        className="mascot__arm-wave"
      />
    ) : pose === 'point' ? (
      <path d="M78 62 Q102 58 116 50" stroke="#12101f" strokeWidth="7" strokeLinecap="round" fill="none" />
    ) : (
      <path d="M78 62 Q90 78 82 92" stroke="#12101f" strokeWidth="7" strokeLinecap="round" fill="none" />
    )

  return (
    <svg
      ref={root}
      className={`mascot${className ? ` ${className}` : ''}`}
      width={size}
      height={size}
      viewBox="0 0 140 140"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="The Surveyor, Repo City's mascot"
    >
      {/* crane hook + cable */}
      <path d="M42 8 V22" stroke="#12101f" strokeWidth="4" strokeLinecap="round" />
      <path
        d="M36 22 h12 a6 6 0 0 1 6 6 v2 a6 6 0 0 1 -6 6 h-12 a6 6 0 0 1 -6 -6 v-2 a6 6 0 0 1 6 -6 z"
        fill="#ffc93c"
        stroke="#12101f"
        strokeWidth="4"
      />

      {/* left arm */}
      <path d="M40 62 Q22 78 30 96" stroke="#12101f" strokeWidth="7" strokeLinecap="round" fill="none" />
      {armRight}

      {/* body */}
      <rect x="34" y="54" width="72" height="58" rx="20" fill="#3fe0c5" stroke="#12101f" strokeWidth="5" />
      <rect x="50" y="96" width="16" height="14" rx="5" fill="#12101f" opacity="0.12" />
      <rect x="74" y="96" width="16" height="14" rx="5" fill="#12101f" opacity="0.12" />

      {/* head */}
      <rect x="30" y="14" width="80" height="56" rx="22" fill="#ffc93c" stroke="#12101f" strokeWidth="5" />
      <circle className="mascot__light" cx="70" cy="18" r="4" fill="#ff5d73" stroke="#12101f" strokeWidth="2" />

      {/* eyes */}
      <circle cx="54" cy="42" r="13" fill="#fff8ef" stroke="#12101f" strokeWidth="4" />
      <circle cx="86" cy="42" r="13" fill="#fff8ef" stroke="#12101f" strokeWidth="4" />
      <circle ref={leftPupil} cx="54" cy="42" r="5.5" fill="#12101f" />
      <circle ref={rightPupil} cx="86" cy="42" r="5.5" fill="#12101f" />

      {/* smile */}
      <path d="M58 56 Q70 64 82 56" stroke="#12101f" strokeWidth="4" strokeLinecap="round" fill="none" />
    </svg>
  )
}
