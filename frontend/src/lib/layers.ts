/**
 * Every horizontal surface in the city, in one ordered table.
 *
 * Ground planes stacked at similar heights are what cause z-fighting, and
 * chasing it surface by surface just moves the problem around: two files that
 * each picked "0.02" will always find each other eventually. Declaring the
 * whole stack here makes the ordering reviewable and the gaps deliberate.
 *
 * Two rules hold this together:
 *
 *  - Neighbouring layers stay at least `MIN_GAP` apart. With the camera's near
 *    plane at 4 and a far plane of a few hundred units, depth resolution at the
 *    back of a large city is about 0.004 units, so 0.06 leaves an order of
 *    magnitude of headroom from every angle — including looking straight down,
 *    which is where the old 0.02 gaps broke down.
 *  - Everything sits below y = 0, the height a building's base is drawn at, so
 *    raising a plot can never clip the podium standing on it.
 */

export const MIN_GAP = 0.06

export const LAYERS = {
  /** The valley floor and the water on it. */
  snow: -0.66,
  riverBank: -0.58,
  riverChannel: -0.5,
  lake: -0.44,

  /** Streets, then the paint on them. */
  roadSurface: 0.02,
  approachRoad: 0.08,
  roadMarking: 0.14,
  approachMarking: 0.2,

  /** District plots: pavement apron, then the plot surface. The gate's plaza
   *  never overlaps a plot, so it may share the plot's height. */
  districtApron: 0.26,
  districtPlot: 0.32,
  plaza: 0.32,

  /** Dressing on top of the plots. `parkLawn` and `plazaRing` are likewise in
   *  different places and can share. */
  parkLawn: 0.38,
  plazaRing: 0.38,
  districtHighlight: 0.44,
  districtRing: 0.5,

  /** Light and selection, which must sit above everything they fall on. */
  lampPool: 0.56,
  focusHalo: 0.62,
} as const

export type LayerName = keyof typeof LAYERS
