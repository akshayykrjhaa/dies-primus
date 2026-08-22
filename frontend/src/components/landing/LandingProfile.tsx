import { GitCommit, GitFork, Lock, Star, Users } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api } from '../../lib/api'
import type { ProfileData } from '../../types'

interface Props {
  onAnalyze: (repoUrl: string, force: boolean) => void
}

function formatDate(iso: string): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

/** GitHub's own calendar weeks, each padded to 7 days — chunking the flat,
 * chronologically-ordered list back into columns reproduces them exactly. */
function toWeeks<T>(days: T[]): T[][] {
  const weeks: T[][] = []
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7))
  return weeks
}

function heatColor(count: number, max: number): string {
  if (count === 0) return 'rgba(255, 255, 255, 0.06)'
  const t = Math.min(1, count / Math.max(1, max))
  const alpha = 0.25 + t * 0.75
  return `rgba(63, 224, 197, ${alpha.toFixed(2)})`
}

export function LandingProfile({ onAnalyze }: Props) {
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .profile()
      .then((data) => {
        if (!cancelled) setProfile(data)
      })
      .catch((caught) => {
        if (!cancelled) setError((caught as Error).message)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (error) {
    return (
      <section className="landing__profile">
        <p className="section-eyebrow">Your GitHub</p>
        <div className="notice notice--error">{error}</div>
      </section>
    )
  }

  if (!profile) {
    return (
      <section className="landing__profile">
        <p className="section-eyebrow">Your GitHub</p>
        <p className="profile-loading">Loading your repos and contributions…</p>
      </section>
    )
  }

  const { user, repos, stats } = profile
  const maxDay = Math.max(1, ...stats.calendar.map((d) => d.count))
  const weeks = toWeeks(stats.calendar)

  return (
    <section className="landing__profile">
      <p className="section-eyebrow">Your GitHub</p>
      <h2 className="section-title">{user.name}, at a glance.</h2>

      <div className="profile-summary">
        {user.avatarUrl && <img className="profile-summary__avatar" src={user.avatarUrl} alt="" />}
        <div>
          <div className="profile-summary__name">{user.name}</div>
          {user.bio && <div className="profile-summary__bio">{user.bio}</div>}
        </div>
      </div>

      <div className="profile-stats">
        <div className="profile-stat">
          <Users size={15} strokeWidth={2.4} />
          <strong>{stats.followers}</strong> followers
        </div>
        <div className="profile-stat">
          <GitCommit size={15} strokeWidth={2.4} />
          <strong>{stats.totalCommits}</strong> commits this year
        </div>
        <div className="profile-stat">
          <Star size={15} strokeWidth={2.4} />
          <strong>{stats.totalStars}</strong> stars earned
        </div>
        <div className="profile-stat">
          <GitFork size={15} strokeWidth={2.4} />
          <strong>{user.publicRepos ?? repos.length}</strong> public repos
        </div>
      </div>

      {stats.calendar.length > 0 && (
        <div className="profile-heatmap" title={`${stats.totalContributionsLastYear} contributions in the last year`}>
          {weeks.map((week, wi) => (
            <div className="profile-heatmap__week" key={wi}>
              {week.map((day) => (
                <div
                  key={day.date}
                  className="profile-heatmap__day"
                  style={{ background: heatColor(day.count, maxDay) }}
                  title={`${day.count} contributions on ${day.date}`}
                />
              ))}
            </div>
          ))}
        </div>
      )}

      <div className="landing__recent-grid">
        {repos.map((repo) => (
          <button
            key={repo.fullName}
            className="recent-card"
            onClick={() => onAnalyze(repo.fullName, false)}
            title={`Build the city for ${repo.fullName}`}
          >
            <span className="recent-card__slug">
              {repo.private && <Lock size={11} strokeWidth={2.6} />} {repo.fullName}
            </span>
            <span className="recent-card__desc">{repo.description || 'No description'}</span>
            <span className="recent-card__meta">
              <Star size={12} strokeWidth={2.2} />
              {repo.stars}
              {repo.language && ` · ${repo.language}`}
              {repo.pushedAt && ` · pushed ${formatDate(repo.pushedAt)}`}
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}
