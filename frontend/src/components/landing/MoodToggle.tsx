import { Moon, Sun } from 'lucide-react'

import type { Mood } from './toonKit'

interface Props {
  mood: Mood
  onToggle: () => void
}

/** The day/night switch — floats over the whole page, not just the hero. */
export function MoodToggle({ mood, onToggle }: Props) {
  const isDay = mood === 'day'
  return (
    <button
      type="button"
      className="mood-toggle"
      data-mood={mood}
      onClick={onToggle}
      aria-label={isDay ? 'Switch to Night City' : 'Switch to Day Pop'}
      title={isDay ? 'Switch to Night City' : 'Switch to Day Pop'}
    >
      <span className="mood-toggle__icon mood-toggle__icon--sun">
        <Sun size={13} strokeWidth={2.6} />
      </span>
      <span className="mood-toggle__icon mood-toggle__icon--moon">
        <Moon size={13} strokeWidth={2.6} />
      </span>
      <span className="mood-toggle__knob">{isDay ? <Sun size={14} strokeWidth={2.6} /> : <Moon size={14} strokeWidth={2.6} />}</span>
    </button>
  )
}
