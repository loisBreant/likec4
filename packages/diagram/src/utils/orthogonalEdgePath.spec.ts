// SPDX-License-Identifier: MIT
//
// Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

import type { XYPosition } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import type { NodeBounds } from './orthogonalEdgePath'
import {
  orthogonalizePoints,
  orthogonalRoute,
  orthogonalRouteSvgPath,
  orthogonalSvgPath,
  stripDegenerateCurves,
} from './orthogonalEdgePath'

function isAxisAligned(a: XYPosition, b: XYPosition): boolean {
  return a.x === b.x || a.y === b.y
}

function assertOrthogonal(route: XYPosition[]) {
  expect(route.length).toBeGreaterThan(0)
  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i]!
    const b = route[i + 1]!
    expect(isAxisAligned(a, b), `segment ${i} (${a.x},${a.y}) -> (${b.x},${b.y}) is diagonal`).toBe(true)
    expect(a.x === b.x && a.y === b.y, `segment ${i} is zero-length`).toBe(false)
    expect(Number.isNaN(b.x) || Number.isNaN(b.y)).toBe(false)
  }
}

function isOnBorder(point: XYPosition, bounds: NodeBounds): boolean {
  const onVerticalEdge = (point.x === bounds.x || point.x === bounds.x + bounds.width)
    && point.y >= bounds.y && point.y <= bounds.y + bounds.height
  const onHorizontalEdge = (point.y === bounds.y || point.y === bounds.y + bounds.height)
    && point.x >= bounds.x && point.x <= bounds.x + bounds.width
  return onVerticalEdge || onHorizontalEdge
}

/**
 * The arrow marker orients along the final segment, so that segment must point
 * from outside the node straight into the border it terminates on.
 */
function assertPointsInto(route: XYPosition[], bounds: NodeBounds) {
  const end = route[route.length - 1]!
  const before = route[route.length - 2]!

  expect(isOnBorder(end, bounds), `end (${end.x},${end.y}) is not on the node border`).toBe(true)
  expect(isAxisAligned(before, end)).toBe(true)
  expect(
    Math.hypot(end.x - before.x, end.y - before.y),
    'final segment is too short to orient the arrow',
  ).toBeGreaterThanOrEqual(8)

  // The point before the border must sit outside the node, so the arrow travels inward
  const outside = before.x < bounds.x || before.x > bounds.x + bounds.width
    || before.y < bounds.y || before.y > bounds.y + bounds.height
  expect(outside, `point before the border (${before.x},${before.y}) is inside the node`).toBe(true)
}

const nodeA: NodeBounds = { x: 0, y: 0, width: 200, height: 100 }

describe('orthogonalizePoints', () => {
  it('1. horizontal source and target', () => {
    const route = orthogonalizePoints([{ x: 0, y: 100 }, { x: 200, y: 100 }])
    assertOrthogonal(route)
    expect(route[0]).toEqual({ x: 0, y: 100 })
    expect(route.at(-1)).toEqual({ x: 200, y: 100 })
  })

  it('2. vertical source and target', () => {
    const route = orthogonalizePoints([{ x: 50, y: 0 }, { x: 50, y: 300 }])
    assertOrthogonal(route)
    expect(route[0]).toEqual({ x: 50, y: 0 })
    expect(route.at(-1)).toEqual({ x: 50, y: 300 })
  })

  it('3. diagonal source and target produces exactly one elbow', () => {
    const route = orthogonalizePoints([{ x: 0, y: 0 }, { x: 100, y: 50 }])
    assertOrthogonal(route)
    expect(route).toHaveLength(3)
    expect(route[0]).toEqual({ x: 0, y: 0 })
    expect(route.at(-1)).toEqual({ x: 100, y: 50 })
  })

  it('4. multiple control points preserve first/last and stay orthogonal', () => {
    const input = [
      { x: 0, y: 0 },
      { x: 40, y: 30 },
      { x: 120, y: -20 },
      { x: 200, y: 60 },
    ]
    const route = orthogonalizePoints(input)
    assertOrthogonal(route)
    expect(route[0]).toEqual(input[0])
    expect(route.at(-1)).toEqual(input.at(-1))
  })

  it('5. very short relationship (single pixel apart)', () => {
    const route = orthogonalizePoints([{ x: 10, y: 10 }, { x: 11, y: 11 }])
    assertOrthogonal(route)
    expect(route[0]).toEqual({ x: 10, y: 10 })
    expect(route.at(-1)).toEqual({ x: 11, y: 11 })
  })

  it('6. same X coordinate needs no elbow', () => {
    const route = orthogonalizePoints([{ x: 30, y: 0 }, { x: 30, y: 80 }])
    expect(route).toEqual([{ x: 30, y: 0 }, { x: 30, y: 80 }])
  })

  it('7. same Y coordinate needs no elbow', () => {
    const route = orthogonalizePoints([{ x: 0, y: 40 }, { x: 90, y: 40 }])
    expect(route).toEqual([{ x: 0, y: 40 }, { x: 90, y: 40 }])
  })

  it('8. duplicate control points are collapsed', () => {
    const route = orthogonalizePoints([
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 80 },
    ])
    assertOrthogonal(route)
    expect(route[0]).toEqual({ x: 0, y: 0 })
    expect(route.at(-1)).toEqual({ x: 50, y: 80 })
  })

  it('9. bidirectional relationship (order reversed) stays orthogonal both ways', () => {
    const forward = orthogonalizePoints([{ x: 0, y: 0 }, { x: 80, y: 60 }])
    const backward = orthogonalizePoints([{ x: 80, y: 60 }, { x: 0, y: 0 }])
    assertOrthogonal(forward)
    assertOrthogonal(backward)
    expect(forward[0]).toEqual({ x: 0, y: 0 })
    expect(backward[0]).toEqual({ x: 80, y: 60 })
  })

  it('12. relationship between nested/compound elements with several waypoints', () => {
    const input = [
      { x: 20, y: 20 },
      { x: 20, y: 120 },
      { x: 220, y: 120 },
      { x: 220, y: 300 },
    ]
    const route = orthogonalizePoints(input)
    assertOrthogonal(route)
    expect(route[0]).toEqual(input[0])
    expect(route.at(-1)).toEqual(input.at(-1))
  })

  it('14. left -> right', () => {
    const route = orthogonalizePoints([{ x: 0, y: 10 }, { x: 300, y: 200 }])
    assertOrthogonal(route)
    expect(route[0]!.x).toBeLessThan(route.at(-1)!.x)
  })

  it('15. right -> left', () => {
    const route = orthogonalizePoints([{ x: 300, y: 10 }, { x: 0, y: 200 }])
    assertOrthogonal(route)
    expect(route[0]!.x).toBeGreaterThan(route.at(-1)!.x)
  })

  it('16. top -> bottom', () => {
    const route = orthogonalizePoints([{ x: 10, y: 0 }, { x: 200, y: 300 }])
    assertOrthogonal(route)
    expect(route[0]!.y).toBeLessThan(route.at(-1)!.y)
  })

  it('17. bottom -> top', () => {
    const route = orthogonalizePoints([{ x: 10, y: 300 }, { x: 200, y: 0 }])
    assertOrthogonal(route)
    expect(route[0]!.y).toBeGreaterThan(route.at(-1)!.y)
  })

  it('collapses runs of collinear points into a single segment', () => {
    const route = orthogonalizePoints([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 40 },
      { x: 100, y: 80 },
      { x: 150, y: 80 },
    ])
    assertOrthogonal(route)
    expect(route).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 80 },
      { x: 150, y: 80 },
    ])
  })

  it('does not blindly use the same elbow orientation for every segment (staircase, not zigzag)', () => {
    // A route that keeps advancing diagonally in the same direction: if every
    // elbow used the same orientation, the path would look identical to a
    // naive "always horizontal-first" router. Assert it alternates instead.
    const input = [
      { x: 0, y: 0 },
      { x: 50, y: 50 },
      { x: 100, y: 100 },
      { x: 150, y: 150 },
    ]
    const route = orthogonalizePoints(input)
    assertOrthogonal(route)

    // Collect the axis of each segment (x = horizontal, y = vertical)
    const axes = route.slice(1).map((p, i) => (route[i]!.x === p.x ? 'v' : 'h'))
    const allSame = axes.every(a => a === axes[0])
    expect(allSame).toBe(false)
  })

  it('handles a single point without throwing', () => {
    const route = orthogonalizePoints([{ x: 5, y: 5 }])
    expect(route).toEqual([{ x: 5, y: 5 }])
  })

  it('handles an empty route without throwing', () => {
    expect(orthogonalizePoints([])).toEqual([])
  })

  it('produces no NaN coordinates for degenerate (identical) input points', () => {
    const route = orthogonalizePoints([{ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 }])
    for (const p of route) {
      expect(Number.isNaN(p.x)).toBe(false)
      expect(Number.isNaN(p.y)).toBe(false)
    }
  })
})

describe('orthogonalSvgPath', () => {
  it('10. relationship with a label: path is still purely orthogonal (label rendering is independent of path string)', () => {
    const d = orthogonalSvgPath([{ x: 0, y: 0 }, { x: 120, y: 40 }, { x: 240, y: 40 }])
    expect(d.startsWith('M ')).toBe(true)
    expect(d).not.toMatch(/[CSQT]/)
  })

  it('11. dashed/dotted relationships are unaffected by path shape (dash pattern is a stroke style, not part of d)', () => {
    const d = orthogonalSvgPath([{ x: 0, y: 0 }, { x: 100, y: 0 }])
    expect(d).toBe('M 0,0 L 100,0')
  })

  it('13. several relationships between nearby nodes each produce valid, distinct single-M paths', () => {
    const routes = [
      [{ x: 0, y: 0 }, { x: 20, y: 0 }],
      [{ x: 0, y: 10 }, { x: 20, y: 10 }],
      [{ x: 0, y: 20 }, { x: 20, y: 20 }],
    ]
    for (const route of routes) {
      const d = orthogonalSvgPath(route)
      expect(d.match(/M /g)).toHaveLength(1)
      expect(d).not.toMatch(/[CSQT]/)
    }
  })

  it('never emits Bezier/quadratic curve commands', () => {
    const d = orthogonalSvgPath([
      { x: 0, y: 0 },
      { x: 40, y: 30 },
      { x: 120, y: -20 },
      { x: 200, y: 60 },
    ])
    expect(d).not.toMatch(/[CSQT]/)
  })

  it('returns an empty string for an empty route rather than a malformed path', () => {
    expect(orthogonalSvgPath([])).toBe('')
  })

  it('start of generated path matches the original route start', () => {
    const start = { x: 12, y: 34 }
    const d = orthogonalSvgPath([start, { x: 56, y: 78 }])
    expect(d.startsWith(`M ${start.x},${start.y}`)).toBe(true)
  })

  it('end of generated path matches the original route end', () => {
    const end = { x: 56, y: 78 }
    const d = orthogonalSvgPath([{ x: 12, y: 34 }, end])
    expect(d.endsWith(`L ${end.x},${end.y}`)).toBe(true)
  })

  it('final segment has a derivable, non-zero direction for arrowhead orientation', () => {
    const d = orthogonalSvgPath([{ x: 0, y: 0 }, { x: 80, y: 30 }])
    const commands = d.split(' L ').map(part => {
      const [x, y] = part.replace('M ', '').split(',').map(Number)
      return { x: x!, y: y! }
    })
    const secondLast = commands.at(-2)!
    const lastPoint = commands.at(-1)!
    expect(secondLast.x === lastPoint.x && secondLast.y === lastPoint.y).toBe(false)
    expect(secondLast.x === lastPoint.x || secondLast.y === lastPoint.y).toBe(true)
  })
})

describe('orthogonalRoute', () => {
  const placements: Array<[name: string, target: NodeBounds]> = [
    ['target to the right', { x: 500, y: 20, width: 200, height: 100 }],
    ['target to the left', { x: -500, y: 20, width: 200, height: 100 }],
    ['target below', { x: 20, y: 400, width: 200, height: 100 }],
    ['target above', { x: 20, y: -400, width: 200, height: 100 }],
    ['target down-right (diagonal)', { x: 500, y: 400, width: 200, height: 100 }],
    ['target up-left (diagonal)', { x: -500, y: -400, width: 200, height: 100 }],
    ['target barely offset (very short relationship)', { x: 230, y: 10, width: 200, height: 100 }],
    ['target of a different size', { x: 600, y: 300, width: 60, height: 300 }],
  ]

  for (const [name, nodeB] of placements) {
    it(`${name}: every segment is axis-aligned and both ends land on a border`, () => {
      const route = orthogonalRoute({
        points: [{ x: 100, y: 50 }, { x: nodeB.x + nodeB.width / 2, y: nodeB.y + nodeB.height / 2 }],
        start: nodeA,
        end: nodeB,
      })
      assertOrthogonal(route)
      assertPointsInto(route, nodeB)
      // reversed, so the tail end is checked the same way
      assertPointsInto([...route].reverse(), nodeA)
    })
  }

  it('regression: never ends with a 1px segment perpendicular to the real approach', () => {
    // The bug: orthogonalizing raw layout anchors could leave a final segment of
    // 1px pointing sideways, which rotated the arrow marker 90 degrees and made
    // it appear to float next to the node instead of touching it.
    const nodeB: NodeBounds = { x: 600, y: 40, width: 200, height: 100 }
    const route = orthogonalRoute({
      points: [{ x: 200, y: 90 }, { x: 601, y: 91 }, { x: 601, y: 90 }],
      start: nodeA,
      end: nodeB,
    })
    assertOrthogonal(route)
    assertPointsInto(route, nodeB)
  })

  it('attaches correctly when the route runs target -> source (dir: back)', () => {
    // The dot printers swap the endpoints for `dir: back`, so the spline starts
    // at the target node and the caller passes the bounds in that same order.
    const nodeB: NodeBounds = { x: 600, y: 300, width: 200, height: 100 }
    const route = orthogonalRoute({
      points: [{ x: 700, y: 350 }, { x: 100, y: 50 }],
      start: nodeB,
      end: nodeA,
    })
    assertOrthogonal(route)
    assertPointsInto(route, nodeA)
    assertPointsInto([...route].reverse(), nodeB)
  })

  it('regression: a large compound near its target keeps the arrow on the right end', () => {
    // Guessing the ends by nearest node centre put the arrowhead on the source
    // when the source was a big compound and the target sat close to its centre.
    const compound: NodeBounds = { x: 0, y: 0, width: 600, height: 400 }
    const near: NodeBounds = { x: 700, y: 180, width: 120, height: 60 }
    const route = orthogonalRoute({
      points: [{ x: 600, y: 210 }, { x: 700, y: 210 }],
      start: compound,
      end: near,
    })
    assertOrthogonal(route)
    assertPointsInto(route, near)
    assertPointsInto([...route].reverse(), compound)
  })

  it('keeps a genuine detour waypoint', () => {
    const nodeB: NodeBounds = { x: 600, y: 0, width: 200, height: 100 }
    const detour = { x: 350, y: 600 }
    const route = orthogonalRoute({
      points: [{ x: 100, y: 50 }, detour, { x: 700, y: 50 }],
      start: nodeA,
      end: nodeB,
    })
    assertOrthogonal(route)
    assertPointsInto(route, nodeB)
    expect(route.some(p => p.y === detour.y), 'the detour was dropped').toBe(true)
  })

  it('drops near-collinear waypoints that only smoothed a curve', () => {
    const nodeB: NodeBounds = { x: 600, y: 0, width: 200, height: 100 }
    const route = orthogonalRoute({
      points: [
        { x: 200, y: 50 },
        { x: 300, y: 52 },
        { x: 400, y: 49 },
        { x: 500, y: 51 },
        { x: 600, y: 50 },
      ],
      start: nodeA,
      end: nodeB,
    })
    assertOrthogonal(route)
    assertPointsInto(route, nodeB)
    // A straight shot needs no staircase
    expect(route.length).toBeLessThanOrEqual(3)
  })

  it('joins two facing nodes with a single straight segment, with no needless elbow', () => {
    // Two stacked nodes whose borders overlap widely: the only sensible route is
    // one straight vertical line, not a Z with a small sideways step.
    const top: NodeBounds = { x: 35, y: 0, width: 515, height: 300 }
    const bottom: NodeBounds = { x: 8, y: 600, width: 517, height: 290 }
    const route = orthogonalRoute({
      points: [{ x: 292, y: 300 }, { x: 266, y: 600 }],
      start: top,
      end: bottom,
    })
    assertOrthogonal(route)
    assertPointsInto(route, bottom)
    expect(route).toHaveLength(2)
    expect(route[0]!.x).toBe(route[1]!.x)
  })

  it('still uses a Z when the two borders do not overlap at all', () => {
    const left: NodeBounds = { x: 0, y: 0, width: 100, height: 80 }
    const right: NodeBounds = { x: 400, y: 500, width: 100, height: 80 }
    const route = orthogonalRoute({
      points: [{ x: 50, y: 40 }, { x: 450, y: 540 }],
      start: left,
      end: right,
    })
    assertOrthogonal(route)
    assertPointsInto(route, right)
    expect(route.length).toBeGreaterThan(2)
  })

  it('draws one straight run when the two ends are only a hair out of line', () => {
    // Anchors landing 1px apart used to leave a barely visible kink mid-edge
    const nodeB: NodeBounds = { x: 600, y: 1, width: 200, height: 100 }
    const route = orthogonalRoute({
      points: [{ x: 200, y: 50 }, { x: 600, y: 51 }],
      start: nodeA,
      end: nodeB,
    })
    assertOrthogonal(route)
    assertPointsInto(route, nodeB)
    expect(route).toHaveLength(2)
    expect(route[0]!.y).toBe(route[1]!.y)
  })

  it('does not force alignment when the ends are genuinely offset', () => {
    const nodeB: NodeBounds = { x: 600, y: 300, width: 200, height: 100 }
    const route = orthogonalRoute({
      points: [{ x: 200, y: 50 }, { x: 600, y: 350 }],
      start: nodeA,
      end: nodeB,
    })
    assertOrthogonal(route)
    assertPointsInto(route, nodeB)
    expect(route.length).toBeGreaterThan(2)
  })

  it('handles nested/compound bounds where one node contains the other', () => {
    const outer: NodeBounds = { x: 0, y: 0, width: 800, height: 600 }
    const inner: NodeBounds = { x: 300, y: 250, width: 120, height: 60 }
    const route = orthogonalRoute({
      points: [{ x: 360, y: 280 }, { x: 400, y: 600 }],
      start: inner,
      end: outer,
    })
    assertOrthogonal(route)
    // The route leaves the inner node properly, and terminates on the outer
    // border. It necessarily crosses the outer's interior - the outer contains
    // the inner - but it must not double back through the inner node.
    const end = route[route.length - 1]!
    const before = route[route.length - 2]!
    expect(isOnBorder(end, outer), `end (${end.x},${end.y}) is not on the outer border`).toBe(true)
    expect(Math.hypot(end.x - before.x, end.y - before.y)).toBeGreaterThanOrEqual(8)
    assertPointsInto([...route].reverse(), inner)
  })

  it('regression: collapsing a reversal must not delete an end stub', () => {
    // `collapseCollinear` used to treat a 180-degree turn as collinear, which
    // removed the stub and left the arrow entering the border from inside,
    // pointing outward.
    const outer: NodeBounds = { x: 0, y: 200, width: 420, height: 160 }
    const inner: NodeBounds = { x: 150, y: 250, width: 120, height: 60 }
    const route = orthogonalRoute({
      points: [{ x: 270, y: 280 }, { x: 0, y: 280 }],
      start: inner,
      end: outer,
    })
    assertOrthogonal(route)
    assertPointsInto([...route].reverse(), inner)
    const end = route[route.length - 1]!
    const before = route[route.length - 2]!
    expect(isOnBorder(end, outer)).toBe(true)
    expect(Math.hypot(end.x - before.x, end.y - before.y)).toBeGreaterThanOrEqual(8)
  })

  it('draws a self-loop as a real closed path, not a single point', () => {
    // Dynamic views allow an element to relate to itself
    const route = orthogonalRoute({
      points: [{ x: 50, y: 50 }, { x: 50, y: 50 }],
      start: nodeA,
      end: nodeA,
    })
    assertOrthogonal(route)
    expect(route.length).toBeGreaterThanOrEqual(3)
    expect(isOnBorder(route[0]!, nodeA)).toBe(true)
    expect(isOnBorder(route[route.length - 1]!, nodeA)).toBe(true)
    const d = orthogonalRouteSvgPath({ points: [{ x: 50, y: 50 }], start: nodeA, end: nodeA })
    expect(d).toMatch(/ L /)
  })

  it('keeps every user control point, even close to a node or nearly collinear', () => {
    const nodeB: NodeBounds = { x: 600, y: 0, width: 200, height: 100 }
    // First point hugs the source node; the rest barely deviate from a straight line
    const controlPoints = [{ x: 205, y: 55 }, { x: 300, y: 52 }, { x: 400, y: 49 }]
    const route = orthogonalRoute({
      points: [{ x: 100, y: 50 }, ...controlPoints, { x: 700, y: 50 }],
      start: nodeA,
      end: nodeB,
      preserveWaypoints: true,
    })
    assertOrthogonal(route)
    assertPointsInto(route, nodeB)
    for (const cp of controlPoints) {
      expect(
        route.some(p => p.x === cp.x || p.y === cp.y),
        `control point (${cp.x},${cp.y}) was dropped`,
      ).toBe(true)
    }
  })

  it('separates parallel edges into lanes so A->B and B->A do not overlap', () => {
    const nodeB: NodeBounds = { x: 600, y: 0, width: 200, height: 100 }
    const forward = orthogonalRoute({
      points: [{ x: 200, y: 50 }, { x: 600, y: 50 }],
      start: nodeA,
      end: nodeB,
      lane: -0.5,
    })
    const backward = orthogonalRoute({
      points: [{ x: 600, y: 50 }, { x: 200, y: 50 }],
      start: nodeB,
      end: nodeA,
      lane: 0.5,
    })
    assertOrthogonal(forward)
    assertOrthogonal(backward)
    assertPointsInto(forward, nodeB)
    assertPointsInto(backward, nodeA)
    // The two routes must not share a y, or they would draw on top of each other
    const forwardYs = new Set(forward.map(p => p.y))
    expect(backward.every(p => !forwardYs.has(p.y))).toBe(true)
  })

  it('straightens a staircase of small steps into a plain L', () => {
    // Shape observed on real layouts: two long runs separated by ~20px steps,
    // each costing two corners for a barely visible offset.
    const from: NodeBounds = { x: 200, y: 500, width: 190, height: 150 }
    const to: NodeBounds = { x: 940, y: 730, width: 160, height: 130 }
    const route = orthogonalRoute({
      points: [
        { x: 296, y: 575 },
        { x: 463, y: 591 },
        { x: 817, y: 613 },
        { x: 1002, y: 633 },
        { x: 1018, y: 796 },
      ],
      start: from,
      end: to,
    })
    assertOrthogonal(route)
    assertPointsInto(route, to)
    // Was 8 segments before straightening
    expect(route.length - 1).toBeLessThanOrEqual(4)
  })

  it('regression: settles on a route that doubles back behind its own stub', () => {
    // A control point dragged behind the source border makes the route leave the
    // node and immediately come back. Straightening used to push the following
    // run forward and the preceding run back, undoing each other forever.
    const nodeB: NodeBounds = { x: 600, y: 0, width: 200, height: 100 }
    const route = orthogonalRoute({
      points: [{ x: 100, y: 50 }, { x: 205, y: 55 }, { x: 300, y: 52 }, { x: 600, y: 49 }],
      start: nodeA,
      end: nodeB,
      preserveWaypoints: true,
    })
    assertOrthogonal(route)
    assertPointsInto(route, nodeB)
  })

  it('keeps a genuine offset between two long runs', () => {
    const from: NodeBounds = { x: 0, y: 0, width: 100, height: 80 }
    const to: NodeBounds = { x: 900, y: 600, width: 100, height: 80 }
    const bigStep = { x: 500, y: 400 }
    const route = orthogonalRoute({
      points: [{ x: 50, y: 40 }, bigStep, { x: 950, y: 640 }],
      start: from,
      end: to,
    })
    assertOrthogonal(route)
    assertPointsInto(route, to)
    // A 400px detour is real routing intent, not noise
    expect(route.some(p => p.x === bigStep.x || p.y === bigStep.y)).toBe(true)
  })

  it('straightening never moves an anchor off its border', () => {
    const from: NodeBounds = { x: 0, y: 0, width: 120, height: 90 }
    const to: NodeBounds = { x: 700, y: 300, width: 120, height: 90 }
    const route = orthogonalRoute({
      points: [
        { x: 120, y: 45 },
        { x: 220, y: 60 },
        { x: 400, y: 78 },
        { x: 600, y: 96 },
        { x: 700, y: 345 },
      ],
      start: from,
      end: to,
    })
    assertOrthogonal(route)
    assertPointsInto(route, to)
    assertPointsInto([...route].reverse(), from)
  })

  it('anchors near the middle of a side rather than drifting to the corners', () => {
    // Target far off to one side: the anchor should stay near the middle of the
    // source's border instead of sliding out to a corner.
    const far: NodeBounds = { x: 2000, y: 3000, width: 200, height: 100 }
    const route = orthogonalRoute({
      points: [{ x: 100, y: 50 }, { x: 2100, y: 3050 }],
      start: nodeA,
      end: far,
    })
    assertOrthogonal(route)
    const startPoint = route[0]!
    const centerX = nodeA.x + nodeA.width / 2
    // Within the middle third of the 200px-wide side
    expect(Math.abs(startPoint.x - centerX)).toBeLessThanOrEqual(nodeA.width / 6)
  })

  it('emits only M/L commands, never curve commands', () => {
    const nodeB: NodeBounds = { x: 500, y: 400, width: 200, height: 100 }
    const d = orthogonalRouteSvgPath({
      points: [{ x: 100, y: 50 }, { x: 600, y: 450 }],
      start: nodeA,
      end: nodeB,
    })
    expect(d).not.toMatch(/[CSQT]/)
    expect(d.match(/M /g)).toHaveLength(1)
  })
})

describe('stripDegenerateCurves', () => {
  it('rewrites a zero-length quadratic (control == endpoint) as a line', () => {
    // What XYFlow's getSmoothStepPath emits at borderRadius 0
    const input = 'M0 0L20 0L 100,0Q 100,0 100,0L 100,200Q 100,200 100,200L180 200'
    const out = stripDegenerateCurves(input)
    expect(out).not.toMatch(/[QCST]/)
    expect(out).toContain('L 100,0')
    expect(out).toContain('L 100,200')
  })

  it('leaves a real curve untouched', () => {
    const input = 'M0 0 Q 50,50 100,0'
    expect(stripDegenerateCurves(input)).toBe(input)
  })

  it('handles negative coordinates', () => {
    const out = stripDegenerateCurves('M0 0 Q -10,-20 -10,-20 L 5,5')
    expect(out).not.toMatch(/Q/)
    expect(out).toContain('L -10,-20')
  })

  it('is a no-op for paths that contain no curve commands', () => {
    const input = 'M 0,0 L 100,0 L 100,50'
    expect(stripDegenerateCurves(input)).toBe(input)
  })
})
