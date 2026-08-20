import type { JobSnapshot } from '../types'

interface Props {
  repoUrl: string
  job: JobSnapshot | null
  onCancel: () => void
}

export function LoadingScreen({ repoUrl, job, onCancel }: Props) {
  const percent = Math.round((job?.progress ?? 0.02) * 100)

  return (
    <div className="loading">
      <div className="loading__card">
        <p className="landing__eyebrow">Under construction</p>
        <h2>{repoUrl}</h2>

        <div className="loading__bar">
          <span style={{ width: `${Math.max(4, percent)}%` }} />
        </div>
        <p className="loading__stage">
          {job?.stage ?? 'Contacting the site office…'} <span>{percent}%</span>
        </p>

        <ul className="loading__log">
          {(job?.log ?? []).slice(-6).map((entry, index) => (
            <li key={`${entry.t}-${index}`}>
              <span className="loading__t">{entry.t.toFixed(1)}s</span>
              {entry.stage}
            </li>
          ))}
        </ul>

        <div className="loading__crane" aria-hidden="true">
          {Array.from({ length: 14 }).map((_, index) => (
            <span key={index} style={{ animationDelay: `${index * 0.11}s` }} />
          ))}
        </div>

        <button className="button button--ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}
