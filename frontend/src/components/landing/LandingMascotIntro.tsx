import { Mascot } from './Mascot'

const TICKER_ITEMS = [
  'React', 'Three.js', 'FastAPI', 'Claude', 'GSAP', 'Groq', 'TypeScript', 'Vite',
  'Server-Sent Events', 'Structured Outputs',
]

export function LandingMascotIntro() {
  return (
    <section className="mascot-intro">
      <div className="mascot-intro__panel">
        <Mascot size={128} pose="point" followCursor />
        <div className="speech-bubble">
          <p>
            Hi, I'm the Surveyor. Give me a GitHub URL and I'll turn every folder into a
            district and every file into a building — then I'll show you around myself.
          </p>
        </div>
      </div>

      <div className="ticker" aria-hidden="true">
        <div className="ticker__track">
          {[...TICKER_ITEMS, ...TICKER_ITEMS].map((item, i) => (
            <span className="ticker__item" key={i}>
              {item}
              <span className="ticker__dot">★</span>
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}
