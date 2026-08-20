import type { Building } from '../types'
import { TechIcon } from './TechIcon'

interface Props {
  building: Building | null
  onClose: () => void
  onAskGuide: (question: string, focusPath: string) => void
  onFocusPath: (path: string) => void
}

/** Everything Claude worked out about one file, opened by clicking a building. */
export function DetailDrawer({ building, onClose, onAskGuide, onFocusPath }: Props) {
  return (
    <aside className="panel panel--right" data-open={building ? 'true' : 'false'}>
      {building && (
        <>
          <header className="panel__header">
            <div className="drawer__identity">
              <TechIcon
                slug={building.iconSlug}
                label={building.language}
                size={40}
                color={building.color}
              />
              <div>
                <h2 className="panel__title">{building.name}</h2>
                <p className="drawer__path">{building.path}</p>
              </div>
            </div>
            <button className="icon-button" onClick={onClose} aria-label="Close file details">
              ✕
            </button>
          </header>

          <div className="panel__body">
            <p className="drawer__headline">{building.headline}</p>

            <div className="stat-row">
              <span className="stat">{building.language}</span>
              <span className="stat">{building.loc.toLocaleString()} lines</span>
              <span className="stat">{(building.bytes / 1024).toFixed(1)} KB</span>
              <span className="stat">importance {building.importance}/10</span>
            </div>

            {building.summary && (
              <section>
                <h3 className="panel__section">In one line</h3>
                <p className="panel__text">{building.summary}</p>
              </section>
            )}

            {building.detail && (
              <section>
                <h3 className="panel__section">What it does</h3>
                <p className="panel__text">{building.detail}</p>
              </section>
            )}

            {building.keySymbols.length > 0 && (
              <section>
                <h3 className="panel__section">Key symbols</h3>
                <div className="pill-row">
                  {building.keySymbols.map((symbol) => (
                    <span key={symbol} className="pill pill--static">
                      {symbol}
                    </span>
                  ))}
                </div>
              </section>
            )}

            {building.connectsTo.length > 0 && (
              <section>
                <h3 className="panel__section">Talks to</h3>
                <div className="pill-row">
                  {building.connectsTo.map((path) => (
                    <button key={path} className="pill" onClick={() => onFocusPath(path)}>
                      {path}
                    </button>
                  ))}
                </div>
              </section>
            )}

            {building.tags.length > 0 && (
              <div className="hover-card__tags">
                {building.tags.map((tag) => (
                  <span key={tag} className="tag">
                    {tag}
                  </span>
                ))}
              </div>
            )}

            <footer className="panel__footer">
              <a
                className="button button--ghost"
                href={building.githubUrl}
                target="_blank"
                rel="noreferrer"
              >
                View source ↗
              </a>
              <button
                className="button"
                onClick={() =>
                  onAskGuide(
                    `Explain ${building.path} in more depth: what it does, what calls it, and what it depends on.`,
                    building.path,
                  )
                }
              >
                Ask the guide
              </button>
            </footer>
          </div>
        </>
      )}
    </aside>
  )
}
