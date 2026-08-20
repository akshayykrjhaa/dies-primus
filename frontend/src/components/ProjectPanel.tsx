import type { CityData, District } from '../types'
import { TechIcon } from './TechIcon'

interface Props {
  data: CityData
  open: boolean
  onClose: () => void
  onFocusDistrict: (district: District) => void
  onFocusPath: (path: string) => void
}

/**
 * The briefing that greets you at the city gate: what the project is, how it
 * is put together, and shortcuts into the districts that matter.
 */
export function ProjectPanel({ data, open, onClose, onFocusDistrict, onFocusPath }: Props) {
  const { repo, project, stats } = data
  const stack = (project.tech_stack ?? []).filter((entry) => entry.name)

  return (
    <aside className="panel panel--left" data-open={open ? 'true' : 'false'}>
      <header className="panel__header">
        <div>
          <p className="panel__eyebrow">City briefing</p>
          <h2 className="panel__title">{repo.slug}</h2>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close briefing">
          ✕
        </button>
      </header>

      <div className="panel__body">
        {project.tagline && <p className="panel__tagline">{project.tagline}</p>}

        <div className="stat-row">
          <span className="stat">★ {repo.stars.toLocaleString()}</span>
          <span className="stat">⑂ {repo.forks.toLocaleString()}</span>
          <span className="stat">{stats.buildings} buildings</span>
          <span className="stat">{stats.districts} districts</span>
          <span className="stat">{stats.totalLoc.toLocaleString()} lines</span>
        </div>

        {!stats.aiEnabled && (
          <div className="notice notice--warn">
            Structural preview: no <code>ANTHROPIC_API_KEY</code> is configured, so
            descriptions come from file names and layout only.
          </div>
        )}
        {stats.warnings?.length > 0 && (
          <div className="notice notice--warn">{stats.warnings[0]}</div>
        )}

        <section>
          <h3 className="panel__section">What this project is</h3>
          <p className="panel__text">{project.overview}</p>
        </section>

        {stack.length > 0 && (
          <section>
            <h3 className="panel__section">Tech stack</h3>
            <div className="stack-grid">
              {stack.map((entry) => (
                <div className="stack-item" key={entry.name} title={entry.role}>
                  <TechIcon slug={entry.slug} label={entry.name} size={30} />
                  <div>
                    <span className="stack-item__name">{entry.name}</span>
                    {entry.role && <span className="stack-item__role">{entry.role}</span>}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {project.architecture && (
          <section>
            <h3 className="panel__section">How it is put together</h3>
            <p className="panel__text">{project.architecture}</p>
          </section>
        )}

        {project.how_it_works?.length > 0 && (
          <section>
            <h3 className="panel__section">The main path through the code</h3>
            <ol className="steps">
              {project.how_it_works.map((step, index) => (
                <li key={index}>
                  <span className="steps__label">{step.step}</span>
                  <span className="steps__detail">{step.detail}</span>
                </li>
              ))}
            </ol>
          </section>
        )}

        {project.entry_points?.length > 0 && (
          <section>
            <h3 className="panel__section">Start reading here</h3>
            <div className="pill-row">
              {project.entry_points.map((path) => (
                <button key={path} className="pill" onClick={() => onFocusPath(path)}>
                  {path}
                </button>
              ))}
            </div>
          </section>
        )}

        <section>
          <h3 className="panel__section">Districts</h3>
          <ul className="district-list">
            {data.districts.map((district) => (
              <li key={district.id}>
                <button className="district-list__item" onClick={() => onFocusDistrict(district)}>
                  <span className="district-list__dot" style={{ background: district.color }} />
                  <span className="district-list__name">{district.name}</span>
                  <span className="district-list__path">{district.path}</span>
                  <span className="district-list__count">{district.fileCount}</span>
                </button>
                {district.purpose && (
                  <p className="district-list__purpose">{district.purpose}</p>
                )}
              </li>
            ))}
          </ul>
        </section>

        {project.highlights?.length > 0 && (
          <section>
            <h3 className="panel__section">Worth knowing</h3>
            <ul className="bullets">
              {project.highlights.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          </section>
        )}

        {project.getting_started && (
          <section>
            <h3 className="panel__section">Getting started</h3>
            <p className="panel__text panel__text--mono">{project.getting_started}</p>
          </section>
        )}

        <footer className="panel__footer">
          <a className="button button--ghost" href={repo.url} target="_blank" rel="noreferrer">
            Open on GitHub ↗
          </a>
          <span className="panel__meta">
            {stats.filesReadByAI > 0
              ? `${stats.filesReadByAI} files read by Claude · ${stats.llmCalls} calls`
              : `${stats.filesConsidered} files mapped`}
          </span>
        </footer>
      </div>
    </aside>
  )
}
