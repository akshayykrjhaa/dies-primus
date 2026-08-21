import type { Health } from '../../lib/api'

interface Props {
  health: Health | null
}

export function LandingStatus({ health }: Props) {
  if (!health) return null

  return (
    <footer className="landing__status">
      <span className={health.aiEnabled ? 'dot dot--ok' : 'dot dot--warn'} />
      {health.aiEnabled
        ? `Claude narrator online (${health.model})`
        : 'No ANTHROPIC_API_KEY — cities will render with structural descriptions only'}
      <span className="landing__status-sep">·</span>
      <span className={health.githubToken ? 'dot dot--ok' : 'dot dot--warn'} />
      {health.githubToken ? 'GitHub token set' : 'No GITHUB_TOKEN (60 requests/hour)'}
    </footer>
  )
}
