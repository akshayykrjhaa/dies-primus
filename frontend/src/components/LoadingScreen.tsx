import { Canvas } from '@react-three/fiber'
import { useEffect, useMemo, useState } from 'react'

import { supportsWebGL } from './landing/toonKit'
import { PortalForge } from './scene/PortalForge'
import type { JobSnapshot } from '../types'

/**
 * Waiting for the analysis, spent inside the antechamber rather than in front
 * of a progress card.
 *
 * It is the same place the visitor is handed to when the job lands — same
 * gate, same void, same typography — caught while the gate is still being
 * built: the arc round the aperture is the progress bar, and the skyline
 * behind it rises as the backend reports work done.
 *
 * The scene is decoration over the same three facts the card showed: stage,
 * percentage and the last few log lines. If WebGL is missing or the visitor
 * has asked for less motion, those facts are all that render.
 */

interface Props {
  repoUrl: string
  job: JobSnapshot | null
  onCancel: () => void
}

/**
 * `owner/repo` where the input is a clone URL, and the readable half of a
 * cache key otherwise — cache keys are a slug plus a content digest, and the
 * digest is noise to the person reading it.
 */
function repoLabel(input: string): string {
  const trimmed = input.trim()
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) || trimmed.includes('/')) {
    const parts = trimmed
      .replace(/\.git$/i, '')
      .replace(/\/+$/, '')
      .split('/')
      .filter(Boolean)
    if (parts.length >= 2) return parts.slice(-2).join('/')
    return parts[parts.length - 1] ?? trimmed
  }
  return trimmed.replace(/\.json$/i, '').replace(/-[0-9a-f]{10}$/i, '')
}

export function LoadingScreen({ repoUrl, job, onCancel }: Props) {
  const percent = Math.round((job?.progress ?? 0.02) * 100)
  const label = useMemo(() => repoLabel(repoUrl), [repoUrl])
  const stage = job?.stage ?? 'Contacting the site office…'
  const log = (job?.log ?? []).slice(-4)

  // The scene is the one thing here that is purely decorative, so it is also
  // the one thing dropped when the machine or the visitor cannot take it.
  const [scene, setScene] = useState(false)
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    setScene(!reduced && supportsWebGL())
  }, [])

  // Escape backs out, matching the portal screen this becomes.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="forge">
      {scene && (
        <Canvas
          dpr={[1, 1.5]}
          gl={{ antialias: true, powerPreference: 'high-performance' }}
          camera={{ position: [0, 15, 62], fov: 46, near: 1, far: 400 }}
        >
          <PortalForge progress={job?.progress ?? 0.02} />
        </Canvas>
      )}

      <div className="portal-ui forge__ui">
        <button className="portal-ui__back" onClick={onCancel}>
          ← Cancel
        </button>

        <div className="portal-ui__center forge__center">
          <p className="portal-ui__eyebrow">A gateway is opening to</p>
          <h1 className="portal-ui__name">{label}</h1>

          <div
            className="forge__meter"
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Analysis progress"
          >
            <span style={{ width: `${Math.max(2, percent)}%` }} />
          </div>

          <p className="forge__stage" aria-live="polite">
            {stage}
            <span className="forge__percent">{percent}%</span>
          </p>

          <ul className="forge__log">
            {/* Keyed by the entry itself, not its slot: the window slides as
                lines arrive, and index keys would re-animate all four. */}
            {log.map((entry) => (
              <li key={`${entry.t}-${entry.stage}`}>
                <span className="forge__t">{entry.t.toFixed(1)}s</span>
                {entry.stage}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
