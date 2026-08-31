import { ArrowLeft, GitCommit, GitFork, GitPullRequest, GithubIcon, Lock, MessageCircleWarning, Star, Users } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api, GITHUB_LOGIN_URL } from '../lib/api'
import type { AuthUser, ProfileData } from '../types'
import { Mascot } from './landing/Mascot'
import { MoodToggle } from './landing/MoodToggle'
import { useMood } from './landing/useMood'

interface Props {
  onAnalyze: (repoUrl: string, force: boolean) => void
  onBack: () => void
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

export function GithubProfile({ onAnalyze, onBack }: Props) {
  const { mood, toggleMood, flashRef } = useMood()
  const [user, setUser] = useState<AuthUser | null>(null)
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api.me().then((data) => {
      if (!cancelled) setUser(data)
    }).catch(() => {
      if (!cancelled) setUser({ authenticated: false })
    })
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

  const logout = () => {
    api
      .logout()
      .then(() => {
        setUser({ authenticated: false })
        onBack()
      })
      .catch(() => {})
  }

  return (
    <div className="landing github-page" data-mood={mood}>
      <MoodToggle mood={mood} onToggle={toggleMood} />
      <div className="landing__flash" ref={flashRef} aria-hidden="true" />

      <header className="github-page__topbar">
        <div className="github-page__topbar-inner">
          <button className="github-page__back" onClick={onBack}>
            <ArrowLeft size={16} strokeWidth={2.6} />
            Repo City
          </button>

          {user?.authenticated && (
            <div className="github-connect__user github-page__topbar-user">
              {user.avatarUrl && <img className="github-connect__avatar" src={user.avatarUrl} alt="" />}
              <span className="github-connect__login">{user.login}</span>
              <button className="github-connect__signout" onClick={logout}>
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      {user && !user.authenticated && (
        <section className="github-page__empty">
          <Mascot size={96} pose="point" />
          <p className="section-eyebrow">Your GitHub</p>
          <h1 className="section-title">Connect your account to see it here.</h1>
          <p className="github-page__empty-copy">
            Sign in with GitHub to pull in your profile, contribution activity, and
            repositories — then jump straight into building a city from any of them.
          </p>
          <a className="github-connect__button" href={GITHUB_LOGIN_URL}>
            <GithubIcon size={15} strokeWidth={2.4} />
            Connect GitHub
          </a>
        </section>
      )}

      {error && (
        <section className="github-page__empty">
          <Mascot size={96} pose="idle" />
          <p className="section-eyebrow">Your GitHub</p>
          <div className="notice notice--error">{error}</div>
        </section>
      )}

      {!user?.authenticated ? null : !profile && !error ? (
        <section className="github-page__loading">
          <p className="section-eyebrow">Your GitHub</p>
          <p className="profile-loading">Loading your repos and contributions…</p>
        </section>
      ) : profile ? (
        <ProfileContent profile={profile} onAnalyze={onAnalyze} />
      ) : null}
    </div>
  )
}

function ProfileContent({ profile, onAnalyze }: { profile: ProfileData; onAnalyze: Props['onAnalyze'] }) {
  const { user, repos, stats } = profile
  const maxDay = Math.max(1, ...stats.calendar.map((d) => d.count))
  const weeks = toWeeks(stats.calendar)

  return (
    <>
      <section className="github-page__hero">
        <div className="profile-summary">
          {user.avatarUrl && <img className="profile-summary__avatar" src={user.avatarUrl} alt="" />}
          <div>
            <p className="section-eyebrow">Your GitHub</p>
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
            <GitPullRequest size={15} strokeWidth={2.4} />
            <strong>{stats.totalPullRequests}</strong> pull requests
          </div>
          <div className="profile-stat">
            <MessageCircleWarning size={15} strokeWidth={2.4} />
            <strong>{stats.totalIssues}</strong> issues
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
      </section>

      <section className="github-page__repos">
        <p className="section-eyebrow">Repositories</p>
        <h2 className="section-title">Pick one, walk right in.</h2>

        {repos.length === 0 ? (
          <p className="profile-loading">No repositories to show yet.</p>
        ) : (
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
        )}
      </section>
    </>
  )
}
