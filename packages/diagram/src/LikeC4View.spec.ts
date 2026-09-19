import { describe, expect, it } from 'vitest'
import type { LikeC4ViewProps } from './LikeC4View'

describe('LikeC4ViewProps', () => {
  it('exposes the orthogonal edge override', () => {
    const props: Partial<LikeC4ViewProps> = {
      enableOrthogonalEdges: true,
    }

    expect(props.enableOrthogonalEdges).toBe(true)
  })
})
