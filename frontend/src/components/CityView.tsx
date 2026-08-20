import { Canvas } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { clockLabel, daylight, hoursForMode, type TimeMode } from '../lib/daylight'
import type { Building, CityData, District } from '../types'
import { DetailDrawer } from './DetailDrawer'
import { GuideChat } from './GuideChat'
import { HoverCard } from './HoverCard'
import { Minimap } from './Minimap'
import { NavGlobe } from './NavGlobe'
import { ProjectPanel } from './ProjectPanel'
import { PortalChamber } from './scene/PortalChamber'
import {
  CityScene,
  type CameraPose,
  type FocusRequest,
  type ZoomRequest,
} from './scene/CityScene'

interface Props {
  data: CityData
  jobId: string | null
  cacheKey: string | null
  onExit: () => void
}

const TOUR_INTERVAL = 7000

/**
 * Arrival is a three-beat sequence. The city is not mounted during the first
 * two, so there is genuinely nothing behind the gate until you step through
 * it — and mounting several hundred buildings happens under the white flash,
 * where the hitch cannot be seen.
 */
type Phase = 'portal' | 'warp' | 'city'

const WARP_TO_WHITE = 1500 // camera dive before the flash peaks
const WARP_TO_CITY = 1850 // city mounts behind the white

export function CityView({ data, jobId, cacheKey, onExit }: Props) {
  const [hovered, setHovered] = useState<Building | null>(null)
  const [selected, setSelected] = useState<Building | null>(null)
  const [pointed, setPointed] = useState<Building | null>(null)
  // The briefing is opt-in: it opens from the sign above the portal, never
  // on arrival. Having it slide over every new city was the first thing you
  // had to dismiss each time.
  const [briefingOpen, setBriefingOpen] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)
  const [showLegend, setShowLegend] = useState(false)
  const [showMinimap, setShowMinimap] = useState(false)
  const [pendingQuestion, setPendingQuestion] = useState<
    { question: string; focusPath?: string } | null
  >(null)
  const [query, setQuery] = useState('')
  const [touring, setTouring] = useState(false)
  const [tourStep, setTourStep] = useState(0)
  const [focus, setFocus] = useState<FocusRequest | null>(null)
  const [zoom, setZoom] = useState<ZoomRequest | null>(null)
  const [phase, setPhase] = useState<Phase>('portal')
  const [flash, setFlash] = useState(false)

  // The scene follows the visitor's real clock, so show them what it thinks.
  // Auto follows the real clock; day/night pin it. The automatic behaviour is
  // never lost -- cycling back to Auto resumes it.
  const [timeMode, setTimeMode] = useState<TimeMode>('auto')
  const [clock, setClock] = useState(() => clockLabel())
  useEffect(() => {
    const timer = window.setInterval(() => setClock(clockLabel()), 20000)
    return () => window.clearInterval(timer)
  }, [])

  const hoverAnchor = useRef<HTMLDivElement>(null)
  const cameraPose = useRef<CameraPose>({ x: 0, z: 0, angle: 0 })
  const focusKey = useRef(0)
  const zoomKey = useRef(0)
  const clearTimer = useRef<number | null>(null)

  const span = Math.max(data.bounds.width, data.bounds.depth, 60)

  const requestFocus = useCallback(
    (
      x: number,
      y: number,
      z: number,
      distance: number,
      preserveBearing = false,
      angles?: { azimuth?: number; pitch?: number },
    ) => {
      focusKey.current += 1
      setFocus({
        x,
        y,
        z,
        distance,
        key: focusKey.current,
        preserveBearing,
        azimuth: angles?.azimuth,
        pitch: angles?.pitch,
      })
    },
    [],
  )

  const requestZoom = useCallback((factor: number) => {
    zoomKey.current += 1
    setZoom({ factor, key: zoomKey.current })
  }, [])

  const travelTo = useCallback(
    (building: Building) => {
      requestFocus(
        building.x,
        building.height * 0.55 + 2,
        building.z,
        Math.max(34, building.height * 1.15 + building.width * 4),
        // Approach from wherever the viewer already is, not a fixed front.
        true,
      )
    },
    [requestFocus],
  )

  const focusDistrict = useCallback(
    (district: District) => {
      requestFocus(
        district.x,
        6,
        district.z,
        Math.max(district.width, district.depth) * 0.95 + 34,
        true,
      )
    },
    [requestFocus],
  )

  const findBuilding = useCallback(
    (path: string) =>
      data.buildings.find((building) => building.path === path) ??
      data.buildings.find((building) => building.path.endsWith(path)) ??
      data.buildings.find((building) => building.name === path) ??
      null,
    [data.buildings],
  )

  // Used by the briefing and the drawer: travel there AND open the file, since
  // the user asked for it by name rather than by pointing at it.
  const focusPath = useCallback(
    (path: string) => {
      const match = findBuilding(path)
      if (!match) return
      setSelected(match)
      setPointed(match)
      travelTo(match)
    },
    [findBuilding, travelTo],
  )

  const goToEntrance = useCallback(() => {
    // The gate scales with the city, so the shot framing it has to as well.
    // Aim at the ring's own height rather than ground level, so the portal is
    // centred in view instead of sitting at the bottom of the frame.
    const gate = data.entrance.scale ?? 1
    requestFocus(
      data.entrance.x,
      11 * gate,
      data.entrance.z + 2 * gate,
      30 + 26 * gate,
    )
  }, [data.entrance, requestFocus])

  const lookFrom = useCallback(
    (azimuth: number) => {
      const subject = selected ?? pointed
      const target = subject
        ? { x: subject.x, y: subject.height * 0.55 + 2, z: subject.z }
        : { x: 0, y: 6, z: 0 }
      const distance = subject
        ? Math.max(34, subject.height * 1.15 + subject.width * 4)
        : span * 0.92
      requestFocus(target.x, target.y, target.z, distance, false, {
        azimuth,
        pitch: 1.02,
      })
      setTouring(false)
    },
    [requestFocus, selected, pointed, span],
  )

  const lookDown = useCallback(() => {
    // Not fully vertical: OrbitControls clamps the polar angle just short of
    // the pole, and asking for exactly straight down fights that clamp.
    requestFocus(0, 6, 0, span * 0.95, false, { azimuth: 0, pitch: 0.3 })
    setTouring(false)
  }, [requestFocus, span])

  const resetView = useCallback(() => {
    requestFocus(0, 4, 0, span * 0.92)
  }, [requestFocus, span])

  // Step through the portal: dive, flash, then the city exists behind it.
  const enterCity = useCallback(() => {
    setPhase((current) => {
      if (current !== 'portal') return current
      window.setTimeout(() => setFlash(true), WARP_TO_WHITE)
      window.setTimeout(() => {
        setPhase('city')
        // Let the city paint one frame under the white before revealing it.
        window.setTimeout(() => setFlash(false), 260)
      }, WARP_TO_CITY)
      return 'warp'
    })
  }, [])

  // Enter (or the button) is the only way in.
  useEffect(() => {
    if (phase !== 'portal') return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        enterCity()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, enterCity])

  // Arrive at the gate, exactly like walking into a real city.
  useEffect(() => {
    if (phase !== 'city') return
    const timer = window.setTimeout(goToEntrance, 120)
    return () => window.clearTimeout(timer)
  }, [phase, goToEntrance])

  // Hovering off a building briefly keeps the label alive so moving between
  // two neighbouring buildings does not flicker.
  const handleHover = useCallback((building: Building | null) => {
    if (clearTimer.current) {
      window.clearTimeout(clearTimer.current)
      clearTimer.current = null
    }
    if (building) {
      setHovered(building)
    } else {
      clearTimer.current = window.setTimeout(() => setHovered(null), 100)
    }
  }, [])

  // Clicking a building is the only thing that opens its contents.
  const handleSelect = useCallback(
    (building: Building) => {
      setSelected(building)
      setPointed(null)
      setBriefingOpen(false)
      travelTo(building)
      setTouring(false)
    },
    [travelTo],
  )

  // --- guided tour -----------------------------------------------------
  const tourStops = useMemo(() => {
    const ranked = [...data.buildings].sort((a, b) => b.importance - a.importance)
    const seen = new Set<string>()
    const stops: Building[] = []
    for (const building of ranked) {
      if (seen.has(building.district)) continue
      seen.add(building.district)
      stops.push(building)
      if (stops.length >= 12) break
    }
    return stops.length > 0 ? stops : ranked.slice(0, 8)
  }, [data.buildings])

  useEffect(() => {
    if (phase !== 'city' || !touring || tourStops.length === 0) return
    let index = 0

    const visit = () => {
      const stop = tourStops[index % tourStops.length]
      setSelected(stop)
      setTourStep(index % tourStops.length)

      // The tour picks its own angle rather than inheriting the live camera
      // bearing. Reading the camera mid-flight -- which is what the previous
      // version did via preserveBearing -- meant every hop started from a
      // half-completed transit and arrived facing somewhere arbitrary. Walking
      // the bearing round by a fixed step instead gives the sequence a
      // deliberate, repeatable sweep around the city.
      const azimuth = (index * 2.4) % (Math.PI * 2)
      const pitch = 0.95 + Math.sin(index * 1.7) * 0.16
      requestFocus(
        stop.x,
        stop.height * 0.55 + 2,
        stop.z,
        Math.max(34, stop.height * 1.15 + stop.width * 4),
        false,
        { azimuth, pitch },
      )
      index += 1
    }

    visit()
    const timer = window.setInterval(visit, TOUR_INTERVAL)
    return () => window.clearInterval(timer)
  }, [phase, touring, tourStops, requestFocus])

  // --- search ----------------------------------------------------------
  const results = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return null
    const scored = data.buildings
      .map((building) => {
        const path = building.path.toLowerCase()
        const name = building.name.toLowerCase()
        let score = -1
        if (name === needle) score = 0
        else if (name.startsWith(needle)) score = 1
        else if (name.includes(needle)) score = 2
        else if (path.includes(needle)) score = 3
        else if (
          [building.language, building.role, building.archetypeLabel, ...building.tags]
            .join(' ')
            .toLowerCase()
            .includes(needle)
        )
          score = 4
        return { building, score }
      })
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => a.score - b.score || b.building.importance - a.building.importance)
    return scored.map((entry) => entry.building)
  }, [query, data.buildings])

  const matchIds = useMemo(
    () => (results ? new Set(results.map((building) => building.id)) : null),
    [results],
  )

  /** Enter in the search box flies you to the best match and points at it. */
  const gotoResult = useCallback(
    (building: Building | undefined) => {
      if (!building) return
      setPointed(building)
      setSelected(null)
      setBriefingOpen(false)
      setTouring(false)
      travelTo(building)
      setQuery('')
      ;(document.getElementById('city-search') as HTMLInputElement | null)?.blur()
    },
    [travelTo],
  )

  useEffect(() => {
    if (phase !== 'city') return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelected(null)
        setPointed(null)
        setBriefingOpen(false)
        setQuery('')
      }
      if (event.key === '/' && document.activeElement?.tagName !== 'INPUT') {
        event.preventDefault()
        document.getElementById('city-search')?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase])

  // The legend lists building types, because that is what the city now shows.
  // Language is still searchable; it is just no longer the thing you see.
  const typeLegend = useMemo(() => {
    const swatch = new Map<string, string>()
    for (const building of data.buildings) {
      if (!swatch.has(building.archetypeLabel)) {
        swatch.set(building.archetypeLabel, building.color)
      }
    }
    return Object.entries(data.stats.buildingTypes ?? {})
      .slice(0, 9)
      .map(([label, count]) => ({
        label,
        count,
        color: swatch.get(label) ?? '#9AA3AE',
      }))
  }, [data])

  return (
    <div className="city">
      <Canvas
        shadows
        dpr={[1, 1.8]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        // A near plane of 1 rather than the 0.1 default: the far plane is
        // hundreds of units out, and that ratio is what starved the depth
        // buffer and set the roads and grass flickering against each other.
        camera={{ position: [0, 3.4, 38], fov: 50, near: 4, far: span * 3 }}
        onPointerMissed={() => phase === 'city' && setHovered(null)}
      >
        {phase !== 'city' ? (
          <PortalChamber warping={phase === 'warp'} title={data.repo.name} />
        ) : (
        <CityScene
          data={data}
          hovered={hovered}
          selected={selected}
          pointedId={pointed?.id ?? null}
          activeDistrict={selected?.district ?? pointed?.district ?? null}
          matchIds={matchIds}
          focus={focus}
          zoom={zoom}
          hoverAnchor={hoverAnchor}
          cameraPose={cameraPose}
          briefingOpen={briefingOpen}
          timeMode={timeMode}
          touring={touring}
          onHover={handleHover}
          onSelect={handleSelect}
          onDistrictFocus={focusDistrict}
          onOpenBriefing={() => setBriefingOpen((open) => !open)}
          onBackgroundClick={() => {
            setSelected(null)
            setPointed(null)
          }}
          onLeaveSelected={() => setSelected(null)}
        />
        )}
      </Canvas>

      {/* The threshold: nothing behind it until you step through. */}
      {phase !== 'city' && (
        <div className="portal-ui" data-warping={phase === 'warp' ? 'true' : 'false'}>
          <button className="portal-ui__back" onClick={onExit}>
            ← Choose another repository
          </button>
          <div className="portal-ui__center">
            <p className="portal-ui__eyebrow">A gateway has opened to</p>
            <h1 className="portal-ui__name">{data.repo.slug}</h1>
            <p className="portal-ui__lede">
              {data.stats.buildings} buildings · {data.stats.districts} districts ·{' '}
              {data.stats.totalLoc.toLocaleString()} lines
            </p>
            <button className="portal-ui__enter" onClick={enterCity} autoFocus>
              <span className="portal-ui__key">Enter</span>
              step through the portal
            </button>
          </div>
        </div>
      )}

      {/* The warp itself: streaks, then a white-out that hides the handover. */}
      {phase === 'warp' && <div className="warp-streaks" />}
      <div className="warp-flash" data-on={flash ? 'true' : 'false'} />

      {phase === 'city' && <HoverCard ref={hoverAnchor} building={hovered} />}

      {phase === 'city' && (
      <>
      <header className="hud hud--top">
        <button className="hud__brand" onClick={onExit} title="Analyze another repository">
          ← Repo City
        </button>

        <form
          className="hud__search"
          onSubmit={(event) => {
            event.preventDefault()
            gotoResult(results?.[0])
          }}
        >
          <input
            id="city-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search a file, then press Enter to fly there  ( / )"
            spellCheck={false}
            autoComplete="off"
          />
          {results && results.length > 0 && (
            <div className="hud__results">
              <span className="hud__results-count">
                {results.length} matches · Enter goes to the first
              </span>
              {results.slice(0, 12).map((building) => (
                <button key={building.id} type="button" onClick={() => gotoResult(building)}>
                  <span style={{ color: building.color }}>●</span> {building.path}
                </button>
              ))}
            </div>
          )}
          {results && results.length === 0 && (
            <div className="hud__results">
              <span className="hud__results-count">Nothing matches “{query}”</span>
            </div>
          )}
        </form>

        <div className="hud__actions">
          <button
            className={`button button--ghost hud__time${
              timeMode !== 'auto' ? ' button--on' : ''
            }`}
            onClick={() =>
              setTimeMode((mode) =>
                mode === 'auto' ? 'day' : mode === 'day' ? 'night' : 'auto',
              )
            }
            title="Auto follows your local clock; click to pin day or night"
          >
            {timeMode === 'auto' ? '◐ Auto' : timeMode === 'day' ? '☀ Day' : '☾ Night'}
            <span className="hud__time-clock">
              {timeMode === 'auto'
                ? clock
                : daylight(hoursForMode(timeMode)).label}
            </span>
          </button>
          <button
            className={`button button--ghost${showLegend ? ' button--on' : ''}`}
            onClick={() => setShowLegend((value) => !value)}
            title="Show the language legend"
          >
            Languages
          </button>
          <button
            className={`button button--ghost${showMinimap ? ' button--on' : ''}`}
            onClick={() => setShowMinimap((value) => !value)}
            title="Show the travel map"
          >
            Map
          </button>
          <button
            className="button button--ghost"
            onClick={goToEntrance}
            title="Fly back to the portal at the city gate"
          >
            ◎ Portal
          </button>
          <button className="button button--ghost" onClick={resetView}>
            Overview
          </button>
          <button
            className={`button${touring ? ' button--primary' : ' button--ghost'}`}
            onClick={() => setTouring((value) => !value)}
          >
            {touring
              ? `■ Stop tour ${tourStep + 1}/${tourStops.length}`
              : '▶ Guided tour'}
          </button>
        </div>
      </header>

      <ProjectPanel
        data={data}
        open={briefingOpen}
        onClose={() => setBriefingOpen(false)}
        onFocusDistrict={(district) => {
          focusDistrict(district)
          setTouring(false)
        }}
        onFocusPath={focusPath}
      />

      <DetailDrawer
        building={selected}
        onClose={() => setSelected(null)}
        onAskGuide={(question, path) => {
          setGuideOpen(true)
          setPendingQuestion({ question, focusPath: path })
        }}
        onFocusPath={focusPath}
      />

      <div className="zoom-controls">
        <button onClick={() => requestZoom(0.7)} title="Zoom in" aria-label="Zoom in">
          +
        </button>
        <button onClick={() => requestZoom(1.42)} title="Zoom out" aria-label="Zoom out">
          −
        </button>
      </div>

      <div className="hud hud--bottom">
        <NavGlobe pose={cameraPose} onBearing={lookFrom} onOverview={lookDown} />

        {showMinimap && (
          <Minimap
            data={data}
            pose={cameraPose}
            selected={selected ?? pointed}
            onJump={(x, z) => requestFocus(x, 6, z, 60, true)}
          />
        )}

        {showLegend && (
          <div className="legend">
            <span className="legend__title">Building types</span>
            {typeLegend.map((entry) => (
              <button
                key={entry.label}
                className="legend__row"
                onClick={() => setQuery(entry.label)}
              >
                <span className="legend__swatch" style={{ background: entry.color }} />
                {entry.label}
                <span className="legend__count">{entry.count}</span>
              </button>
            ))}
            <span className="legend__hint">
              Shape = what the file does · height = how much code
            </span>
          </div>
        )}
      </div>

      <GuideChat
        data={data}
        jobId={jobId}
        cacheKey={cacheKey}
        open={guideOpen}
        pending={pendingQuestion}
        onPendingHandled={() => setPendingQuestion(null)}
        onToggle={() => setGuideOpen((open) => !open)}
      />
      </>
      )}
    </div>
  )
}
