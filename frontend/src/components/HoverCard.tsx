import { forwardRef, useEffect, useState } from 'react'

import type { Building } from '../types'
import { TechIcon } from './TechIcon'

interface Props {
  building: Building | null
}

/**
 * The label that follows a hovered building.
 *
 * Deliberately minimal — just enough to know what you are pointing at. The
 * file's actual contents live in the right-hand panel and only open on click.
 *
 * The outer anchor is repositioned every frame by the scene's projector, and
 * the inner label owns the fade/scale transition; separating the two is what
 * keeps the motion smooth instead of chasing the cursor a frame behind.
 */
export const HoverCard = forwardRef<HTMLDivElement, Props>(function HoverCard(
  { building },
  ref,
) {
  // Hold onto the last building so the label can fade out with its content.
  const [shown, setShown] = useState<Building | null>(building)

  useEffect(() => {
    if (building) {
      setShown(building)
      return
    }
    const timer = window.setTimeout(() => setShown(null), 220)
    return () => window.clearTimeout(timer)
  }, [building])

  const content = building ?? shown
  if (!content) return <div ref={ref} className="hover-anchor" />

  return (
    <div ref={ref} className="hover-anchor">
      <div className="hover-tip" data-visible={building ? 'true' : 'false'}>
        <TechIcon
          slug={content.iconSlug}
          label={content.language}
          size={22}
          color={content.color}
        />
        <span className="hover-tip__name">{content.name}</span>
        <span className="hover-tip__lang" style={{ color: content.color }}>
          {content.language}
        </span>
        <span className="hover-tip__cta">click to open</span>
      </div>
    </div>
  )
})
