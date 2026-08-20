import { useEffect, useRef, useState } from 'react'

import { api } from '../lib/api'
import type { CityData } from '../types'

interface Props {
  data: CityData
  jobId: string | null
  cacheKey: string | null
  open: boolean
  pending: { question: string; focusPath?: string } | null
  onPendingHandled: () => void
  onToggle: () => void
}

interface Turn {
  role: 'you' | 'guide'
  text: string
}

const SUGGESTIONS = [
  'Where does execution start?',
  'How is this project structured?',
  'Which files should I read first?',
  'How does the data flow through it?',
]

/** A grounded Q&A tour guide backed by the analyzed city index. */
export function GuideChat({
  data,
  jobId,
  cacheKey,
  open,
  pending,
  onPendingHandled,
  onToggle,
}: Props) {
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)

  const ask = async (question: string, focusPath?: string) => {
    if (!question.trim() || busy) return
    setTurns((prev) => [...prev, { role: 'you', text: question }, { role: 'guide', text: '' }])
    setInput('')
    setBusy(true)
    try {
      await api.askGuide(
        {
          jobId: jobId ?? undefined,
          cacheKey: cacheKey ?? undefined,
          question,
          focusPath,
        },
        (token) => {
          setTurns((prev) => {
            const next = [...prev]
            next[next.length - 1] = {
              role: 'guide',
              text: next[next.length - 1].text + token,
            }
            return next
          })
        },
      )
    } catch (error) {
      setTurns((prev) => {
        const next = [...prev]
        next[next.length - 1] = {
          role: 'guide',
          text: `The guide could not answer: ${(error as Error).message}`,
        }
        return next
      })
    } finally {
      setBusy(false)
    }
  }

  // A question sent from the file drawer arrives as `pending`.
  useEffect(() => {
    if (!pending) return
    ask(pending.question, pending.focusPath)
    onPendingHandled()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending])

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })
  }, [turns])

  return (
    <div className="guide" data-open={open ? 'true' : 'false'}>
      <button className="guide__tab" onClick={onToggle}>
        {open ? 'Hide guide' : 'Ask the guide'}
      </button>

      <div className="guide__body">
        <div className="guide__scroll" ref={scroller}>
          {turns.length === 0 && (
            <div className="guide__empty">
              <p>
                Ask anything about <strong>{data.repo.name}</strong>. The guide answers from
                the city index, so it cites real file paths.
              </p>
              <div className="pill-row">
                {SUGGESTIONS.map((suggestion) => (
                  <button key={suggestion} className="pill" onClick={() => ask(suggestion)}>
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {turns.map((turn, index) => (
            <div key={index} className={`bubble bubble--${turn.role}`}>
              {turn.text || <span className="bubble__typing">thinking…</span>}
            </div>
          ))}
        </div>

        <form
          className="guide__form"
          onSubmit={(event) => {
            event.preventDefault()
            ask(input)
          }}
        >
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask about a file, a flow, a decision…"
            disabled={busy}
          />
          <button className="button" type="submit" disabled={busy || !input.trim()}>
            {busy ? '…' : 'Ask'}
          </button>
        </form>
      </div>
    </div>
  )
}
