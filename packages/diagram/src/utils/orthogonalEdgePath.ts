// SPDX-License-Identifier: MIT
//
// Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

import type { XYPosition } from '@xyflow/react'

/**
 * Bounds of a node the route attaches to (absolute coordinates).
 */
export interface NodeBounds {
  x: number
  y: number
  width: number
  height: number
}

type Axis = 'x' | 'y'
type Side = 'left' | 'right' | 'top' | 'bottom'

/**
 * Length of the straight segment leaving/entering a node border. It guarantees
 * the first and last segments are perpendicular to the border, which is what
 * orients the arrow tail/head markers (`orient="auto-start-reverse"`).
 */
const DEFAULT_STUB = 16

/**
 * Max distance (px) a waypoint may sit from the line between its neighbours
 * before it is considered a real detour rather than curve-smoothing noise.
 */
const DEFAULT_TOLERANCE = 24

/**
 * Distance between neighbouring lanes, used to keep parallel edges (A->B
 * alongside B->A) from drawing on top of each other.
 */
const DEFAULT_LANE_SPACING = 20

/**
 * Fraction of a node side, measured from its middle, that anchors are biased
 * into. Attaching near the middle of a side reads far better than drifting out
 * to the corners, while still leaving room to spread lanes apart.
 */
const ANCHOR_BAND = 0.15

/**
 * Longest sideways step (px) that gets straightened away. Layout waypoints trace
 * a smooth curve; orthogonalized, the gentle ones turn into a staircase of small
 * steps that each cost two corners for a barely visible offset.
 */
const DEFAULT_MAX_JOG = 48

export interface OrthogonalRouteOptions {
  /**
   * Route waypoints as produced by layout, including both endpoints, in the
   * order they are drawn.
   */
  points: ReadonlyArray<XYPosition>
  /**
   * Bounds of the node the route *starts* at, i.e. the one `points[0]` sits on.
   * For `dir: back` edges the layout emits the spline target-first, so the
   * caller is responsible for passing these the right way round.
   */
  start: NodeBounds
  /**
   * Bounds of the node the route *ends* at, i.e. the one the last point sits on.
   */
  end: NodeBounds
  /**
   * Offset of this edge among the edges sharing the same pair of nodes.
   * `0` centres the route; +/-1 shifts it a lane either way.
   */
  lane?: number
  laneSpacing?: number
  /**
   * Keep every intermediate waypoint. Set for user-placed control points, which
   * are explicit intent and must never be filtered or simplified away.
   */
  preserveWaypoints?: boolean
  stub?: number
  tolerance?: number
  /**
   * Longest sideways step that is straightened away. `0` keeps every step.
   */
  maxJog?: number
}

/**
 * Routes an edge between two nodes as an orthogonal (Manhattan) polyline:
 * every segment is strictly horizontal or vertical.
 *
 * The ends are derived from the node bounds rather than from the incoming
 * waypoints: each end is anchored on a node border, biased towards the middle
 * of that border, and preceded by a perpendicular stub. So the path always
 * terminates *on* the node it points at, and the final segment always has real
 * length and the correct direction for the arrow marker.
 *
 * Intermediate waypoints are preserved (they encode the layout's detours around
 * other nodes), minus points swallowed by either node and minus near-collinear
 * points that only existed to smooth a curve - unless `preserveWaypoints` is
 * set. When no meaningful waypoint remains, the two stubs are joined with a
 * classic Z (facing sides) or L (perpendicular sides) route.
 */
export function orthogonalRoute({
  points,
  start,
  end,
  lane = 0,
  laneSpacing = DEFAULT_LANE_SPACING,
  preserveWaypoints = false,
  stub = DEFAULT_STUB,
  tolerance = DEFAULT_TOLERANCE,
  maxJog = DEFAULT_MAX_JOG,
}: OrthogonalRouteOptions): XYPosition[] {
  if (isSameBounds(start, end)) {
    return selfLoop(start, stub, lane * laneSpacing)
  }

  const waypoints = dedupe(points)
  const laneOffset = lane * laneSpacing

  const interior = preserveWaypoints
    ? waypoints.slice(1, -1)
    // Simplify against the full route, endpoints included, so a waypoint counts
    // as noise only when it barely deviates from the actual end-to-end line.
    : simplify(waypoints, tolerance)
      .slice(1, -1)
      .filter(p => !isInside(p, start, stub) && !isInside(p, end, stub))

  const startRef = interior[0] ?? centerOf(end)
  const endRef = interior[interior.length - 1] ?? centerOf(start)

  const startSide = pickSide(start, startRef)
  const endSide = pickSide(end, endRef)

  let startAnchor = anchorOn(start, startSide, startRef, laneOffset)
  let endAnchor = anchorOn(end, endSide, endRef, laneOffset)
  if (interior.length === 0 && axisOf(startSide) === axisOf(endSide)) {
    // Both ends face along the same axis, so put them on one line whenever the
    // borders overlap enough to allow it - a simple relationship should draw as
    // a single straight run, not a Z with two needless corners.
    ;[startAnchor, endAnchor] = alignAnchors(
      { anchor: startAnchor, bounds: start },
      { anchor: endAnchor, bounds: end },
      axisOf(startSide),
    )
  }
  const startStub = stubFrom(startAnchor, startSide, stub)
  const endStub = stubFrom(endAnchor, endSide, stub)

  const middle = interior.length > 0
    ? interior
    : joinStubs(startStub, axisOf(startSide), endStub, axisOf(endSide), laneOffset)

  const route = dedupe(
    collapseCollinear(
      straightenSmallJogs(
        dedupe(collapseCollinear(dedupe(orthogonalize([startAnchor, startStub, ...middle, endStub, endAnchor])))),
        maxJog,
      ),
    ),
  )

  // Never hand back something the arrow markers cannot be oriented from
  return route.length >= 2 ? route : selfLoop(start, stub, laneOffset)
}

/**
 * {@link orthogonalRoute}, rendered as an SVG path `d` attribute.
 * Uses straight line segments only (`M`/`L`) - no curve commands.
 */
export function orthogonalRouteSvgPath(options: OrthogonalRouteOptions): string {
  return toSvgPath(orthogonalRoute(options))
}

/**
 * Converts a route into an orthogonal (Manhattan) one where every consecutive
 * pair of points is purely horizontal or vertical.
 *
 * The first and last points are preserved exactly. Diagonal segments are
 * replaced with a single elbow, turning away from the axis the route arrived on
 * so it never doubles back on itself. Consecutive duplicate points and runs of
 * collinear points continuing the same way are collapsed, so the result never
 * contains a zero-length or redundant segment.
 *
 * Prefer {@link orthogonalRoute} when node bounds are known - it additionally
 * anchors the ends on the node borders.
 */
export function orthogonalizePoints(input: ReadonlyArray<XYPosition>): XYPosition[] {
  return dedupe(collapseCollinear(dedupe(orthogonalize(dedupe(input)))))
}

/**
 * Builds an SVG path `d` attribute from a route, orthogonalizing it first.
 */
export function orthogonalSvgPath(points: ReadonlyArray<XYPosition>): string {
  return toSvgPath(orthogonalizePoints(points))
}

/**
 * Rewrites zero-length quadratic segments as the straight lines they already
 * are.
 *
 * XYFlow's `getSmoothStepPath` emits a `Q` for every corner even at
 * `borderRadius: 0`, where it degenerates to `Q x,y x,y` - the control point
 * and the endpoint coincide, so the curve is exactly the line to that point.
 * Only such provably degenerate quadratics are touched; a real curve is left
 * alone.
 */
export function stripDegenerateCurves(path: string): string {
  return path.replace(
    /Q\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s+(-?[\d.]+)\s*,\s*(-?[\d.]+)/g,
    (match, cx: string, cy: string, x: string, y: string) => cx === x && cy === y ? `L ${x},${y}` : match,
  )
}

/**
 * A rectangular loop out of one side of a node and back into it, for edges
 * whose source and target are the same node (dynamic views allow these).
 */
function selfLoop(bounds: NodeBounds, stub: number, laneOffset: number): XYPosition[] {
  const right = Math.round(bounds.x + bounds.width)
  const center = Math.round(bounds.y + bounds.height / 2)
  const spread = Math.max(8, Math.min(bounds.height / 4, 20))
  const reach = right + stub + Math.abs(laneOffset)
  return [
    { x: right, y: center - spread },
    { x: reach, y: center - spread },
    { x: reach, y: center + spread },
    { x: right, y: center + spread },
  ]
}

function toSvgPath(route: ReadonlyArray<XYPosition>): string {
  if (route.length === 0) {
    return ''
  }
  const [start, ...rest] = route as [XYPosition, ...XYPosition[]]
  let d = `M ${formatPoint(start)}`
  for (const point of rest) {
    d += ` L ${formatPoint(point)}`
  }
  return d
}

function orthogonalize(waypoints: ReadonlyArray<XYPosition>): XYPosition[] {
  if (waypoints.length <= 1) {
    return waypoints.slice()
  }

  const first = waypoints[0]!
  const last = waypoints[waypoints.length - 1]!
  // Seed from the overall direction, then follow the travel direction below
  let horizontalFirst = Math.abs(last.x - first.x) >= Math.abs(last.y - first.y)
  let lastAxis: Axis | null = null

  const result: XYPosition[] = [first]
  for (let i = 1; i < waypoints.length; i++) {
    const from = result[result.length - 1]!
    const to = waypoints[i]!

    if (from.x === to.x || from.y === to.y) {
      result.push(to)
      if (from.x !== to.x) {
        lastAxis = 'x'
      } else if (from.y !== to.y) {
        lastAxis = 'y'
      }
      continue
    }

    // Turn away from the axis we arrived on. Leaving along the incoming axis
    // would retrace the previous segment whenever the route doubles back.
    if (lastAxis !== null) {
      horizontalFirst = lastAxis === 'y'
    }

    const elbow = horizontalFirst ? { x: to.x, y: from.y } : { x: from.x, y: to.y }
    result.push(elbow, to)
    lastAxis = horizontalFirst ? 'y' : 'x'
    horizontalFirst = !horizontalFirst
  }

  return result
}

/**
 * Connects two stub endpoints: a single corner when the stubs run along
 * different axes, otherwise a Z with the cross-over halfway between them.
 */
function joinStubs(
  from: XYPosition,
  fromAxis: Axis,
  to: XYPosition,
  toAxis: Axis,
  laneOffset: number,
): XYPosition[] {
  if (fromAxis !== toAxis) {
    return fromAxis === 'x' ? [{ x: to.x, y: from.y }] : [{ x: from.x, y: to.y }]
  }
  if (fromAxis === 'x') {
    const midX = Math.round((from.x + to.x) / 2 + laneOffset)
    return [{ x: midX, y: from.y }, { x: midX, y: to.y }]
  }
  const midY = Math.round((from.y + to.y) / 2 + laneOffset)
  return [{ x: from.x, y: midY }, { x: to.x, y: midY }]
}

function pickSide(bounds: NodeBounds, ref: XYPosition): Side {
  const center = centerOf(bounds)
  // Normalize by the half-extents, so a wide node prefers top/bottom for a
  // reference point that is far off vertically but still within its width.
  const dx = (ref.x - center.x) / Math.max(bounds.width / 2, 1)
  const dy = (ref.y - center.y) / Math.max(bounds.height / 2, 1)
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? 'right' : 'left'
  }
  return dy >= 0 ? 'bottom' : 'top'
}

/**
 * Places the anchor on `side`, biased to the middle of that side, then shifted
 * by the lane offset and kept clear of the corners.
 */
function anchorOn(bounds: NodeBounds, side: Side, ref: XYPosition, laneOffset: number): XYPosition {
  if (axisOf(side) === 'x') {
    const y = anchorCoord(bounds.y, bounds.height, ref.y, laneOffset)
    return { x: Math.round(side === 'left' ? bounds.x : bounds.x + bounds.width), y }
  }
  const x = anchorCoord(bounds.x, bounds.width, ref.x, laneOffset)
  return { x, y: Math.round(side === 'top' ? bounds.y : bounds.y + bounds.height) }
}

function anchorCoord(origin: number, length: number, ref: number, laneOffset: number): number {
  const center = origin + length / 2
  const margin = Math.min(12, length / 4)
  const limit = Math.max(0, length / 2 - margin)
  const band = Math.min(limit, length * ANCHOR_BAND)
  const biased = clamp(ref, center - band, center + band)
  return Math.round(clamp(biased + laneOffset, center - limit, center + limit))
}

/**
 * The range along a node border that an anchor may occupy, measured on the axis
 * the border runs along (perpendicular to the side it faces).
 */
function borderSpan(bounds: NodeBounds, facing: Axis): { lo: number; hi: number } {
  if (facing === 'x') {
    const margin = Math.min(12, bounds.height / 4)
    return { lo: bounds.y + margin, hi: bounds.y + bounds.height - margin }
  }
  const margin = Math.min(12, bounds.width / 4)
  return { lo: bounds.x + margin, hi: bounds.x + bounds.width - margin }
}

/**
 * Puts both anchors of a route on a single line when their borders overlap, so
 * two facing nodes are joined by one straight segment instead of a Z. Falls
 * back to the untouched anchors when the borders do not overlap, since no
 * straight line exists in that case.
 *
 * Lane offsets survive: both anchors move together, so parallel edges keep
 * their separation.
 */
function alignAnchors(
  from: { anchor: XYPosition; bounds: NodeBounds },
  to: { anchor: XYPosition; bounds: NodeBounds },
  facing: Axis,
): [XYPosition, XYPosition] {
  const fromSpan = borderSpan(from.bounds, facing)
  const toSpan = borderSpan(to.bounds, facing)
  const lo = Math.max(fromSpan.lo, toSpan.lo)
  const hi = Math.min(fromSpan.hi, toSpan.hi)
  if (lo > hi) {
    return [from.anchor, to.anchor]
  }

  const along: Axis = facing === 'x' ? 'y' : 'x'
  const common = Math.round(clamp((from.anchor[along] + to.anchor[along]) / 2, lo, hi))
  return [
    { ...from.anchor, [along]: common },
    { ...to.anchor, [along]: common },
  ]
}

function stubFrom(anchor: XYPosition, side: Side, stub: number): XYPosition {
  switch (side) {
    case 'left':
      return { x: anchor.x - stub, y: anchor.y }
    case 'right':
      return { x: anchor.x + stub, y: anchor.y }
    case 'top':
      return { x: anchor.x, y: anchor.y - stub }
    case 'bottom':
      return { x: anchor.x, y: anchor.y + stub }
  }
}

function axisOf(side: Side): Axis {
  return side === 'left' || side === 'right' ? 'x' : 'y'
}

function centerOf(bounds: NodeBounds): XYPosition {
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
}

function isSameBounds(a: NodeBounds, b: NodeBounds): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

function isInside(point: XYPosition, bounds: NodeBounds, padding: number): boolean {
  return point.x >= bounds.x - padding
    && point.x <= bounds.x + bounds.width + padding
    && point.y >= bounds.y - padding
    && point.y <= bounds.y + bounds.height + padding
}

/**
 * Ramer-Douglas-Peucker: keeps only the waypoints that make the route deviate
 * from a straight line by more than `tolerance`.
 */
function simplify(points: ReadonlyArray<XYPosition>, tolerance: number): XYPosition[] {
  if (points.length <= 2) {
    return points.slice()
  }

  const first = points[0]!
  const last = points[points.length - 1]!

  let maxDistance = -1
  let maxIndex = 0
  for (let i = 1; i < points.length - 1; i++) {
    const distance = distanceToSegment(points[i]!, first, last)
    if (distance > maxDistance) {
      maxDistance = distance
      maxIndex = i
    }
  }

  if (maxDistance <= tolerance) {
    return [first, last]
  }

  const head = simplify(points.slice(0, maxIndex + 1), tolerance)
  const tail = simplify(points.slice(maxIndex), tolerance)
  return [...head.slice(0, -1), ...tail]
}

function distanceToSegment(point: XYPosition, from: XYPosition, to: XYPosition): number {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const lengthSq = dx * dx + dy * dy
  if (lengthSq === 0) {
    return Math.hypot(point.x - from.x, point.y - from.y)
  }
  const t = clamp(((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSq, 0, 1)
  return Math.hypot(point.x - (from.x + t * dx), point.y - (from.y + t * dy))
}

function clamp(value: number, min: number, max: number): number {
  if (min > max) {
    return (min + max) / 2
  }
  return Math.min(Math.max(value, min), max)
}

function formatPoint(point: XYPosition): string {
  return `${Math.trunc(point.x)},${Math.trunc(point.y)}`
}

function dedupe(points: ReadonlyArray<XYPosition>): XYPosition[] {
  const result: XYPosition[] = []
  for (const point of points) {
    const prev = result[result.length - 1]
    if (!prev || prev.x !== point.x || prev.y !== point.y) {
      result.push(point)
    }
  }
  return result
}

/**
 * Straightens small sideways steps: a short segment between two parallel runs
 * makes the route step aside by a few pixels at the cost of two corners. Pulls
 * the two runs onto one line instead, turning a staircase into a plain L.
 *
 * The first and last two points are pinned - they are the border anchors and
 * their perpendicular stubs, which is what keeps the arrow markers oriented and
 * attached to the node.
 *
 * A step is only straightened when it is also short relative to the runs it
 * separates, so a genuine offset between two long runs is left alone.
 */
function straightenSmallJogs(points: ReadonlyArray<XYPosition>, maxJog: number): XYPosition[] {
  if (maxJog <= 0 || points.length < 6) {
    return points.slice()
  }

  const result = points.map(p => ({ ...p }))
  const last = result.length - 1

  // Bounded sweeps, so the pass cannot spin: straightening one step can open a
  // new one further along, and each sweep carries those forward.
  for (let pass = 0; pass < result.length; pass++) {
    let changed = false
    for (let i = 1; i < last - 1; i++) {
      const a = result[i - 1]!, b = result[i]!, c = result[i + 1]!, d = result[i + 2]!
      const jogIsVertical = b.x === c.x && a.y === b.y && c.y === d.y
      const jogIsHorizontal = b.y === c.y && a.x === b.x && c.x === d.x
      if (!jogIsVertical && !jogIsHorizontal) {
        continue
      }

      const axis: Axis = jogIsVertical ? 'y' : 'x'
      const jog = Math.abs(b[axis] - c[axis])
      const runBefore = Math.abs(jogIsVertical ? b.x - a.x : b.y - a.y)
      const runAfter = Math.abs(jogIsVertical ? d.x - c.x : d.y - c.y)
      if (jog === 0 || jog > maxJog || jog >= Math.min(runBefore, runAfter)) {
        continue
      }

      // Only ever pull the *following* run back onto the current line. Moving
      // the preceding run instead would let two steps undo each other forever.
      if (i + 2 > last - 1) {
        continue
      }
      // The end anchor never moves. Its stub may slide *along* the final
      // segment - that only makes the approach longer - but never across it,
      // which would tear the path off the border and spin the arrow.
      if (i + 2 === last - 1) {
        const anchor = result[last]!, endStub = result[last - 1]!
        const finalAxis: Axis = endStub.x === anchor.x ? 'x' : 'y'
        if (axis === finalAxis) {
          continue
        }
      }

      const line = b[axis]
      c[axis] = line
      d[axis] = line
      changed = true
    }
    if (!changed) {
      break
    }
  }
  return result
}

/**
 * Merges runs of 3+ consecutive points that continue in the same axis-aligned
 * direction into a single segment, so a straight run never carries redundant
 * intermediate points.
 *
 * A 180-degree reversal is *not* collinear for this purpose: merging one would
 * silently delete the point the route doubles back from - including an end stub,
 * which would leave the arrow marker pointing the wrong way.
 */
function collapseCollinear(points: ReadonlyArray<XYPosition>): XYPosition[] {
  if (points.length <= 2) {
    return points.slice()
  }

  const result: XYPosition[] = [points[0]!]
  for (let i = 1; i < points.length; i++) {
    const next = points[i]!
    if (result.length >= 2) {
      const prev = result[result.length - 2]!
      const last = result[result.length - 1]!
      const continuesVertical = prev.x === last.x && last.x === next.x
        && Math.sign(last.y - prev.y) === Math.sign(next.y - last.y)
      const continuesHorizontal = prev.y === last.y && last.y === next.y
        && Math.sign(last.x - prev.x) === Math.sign(next.x - last.x)
      if (continuesVertical || continuesHorizontal) {
        result[result.length - 1] = next
        continue
      }
    }
    result.push(next)
  }
  return result
}
