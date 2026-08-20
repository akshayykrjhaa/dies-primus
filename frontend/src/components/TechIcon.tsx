import { useEffect, useState } from 'react'

const CDN = 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons'

// devicon is inconsistent about which variant a logo ships with, so we walk
// the variants in order and fall back to a coloured letter tile.
const VARIANTS = ['original', 'plain', 'original-wordmark', 'plain-wordmark']

interface Props {
  slug: string
  label: string
  size?: number
  color?: string
}

export function TechIcon({ slug, label, size = 28, color = '#5b7cfa' }: Props) {
  const [variant, setVariant] = useState(0)

  useEffect(() => {
    setVariant(0)
  }, [slug])

  const failed = !slug || variant >= VARIANTS.length

  if (failed) {
    return (
      <span
        className="tech-icon tech-icon--fallback"
        style={{ width: size, height: size, background: color, fontSize: size * 0.5 }}
        title={label}
        aria-label={label}
      >
        {label.slice(0, 1).toUpperCase()}
      </span>
    )
  }

  return (
    <img
      className="tech-icon"
      style={{ width: size, height: size }}
      src={`${CDN}/${slug}/${slug}-${VARIANTS[variant]}.svg`}
      alt={label}
      title={label}
      loading="lazy"
      onError={() => setVariant((v) => v + 1)}
    />
  )
}
