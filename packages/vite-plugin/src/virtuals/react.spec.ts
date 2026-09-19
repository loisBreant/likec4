import { describe, it } from 'vitest'
import { projectReactModule } from './react'

async function generateProjectReactCode(orthogonalEdges: boolean) {
  const result = await projectReactModule.load.call({} as any, {
    project: {
      id: 'architecture',
      config: {
        webapp: {
          orthogonalEdges,
        },
      },
    },
  } as any)

  return typeof result === 'string' ? result : result.code
}

describe('projectReactModule', () => {
  it('uses the project orthogonal-edge setting as the generated view default', async ({ expect }) => {
    const code = await generateProjectReactCode(true)

    expect(code).toContain('enableOrthogonalEdges: props.enableOrthogonalEdges ?? true')
  })

  it('keeps orthogonal edges disabled when the project does not enable them', async ({ expect }) => {
    const code = await generateProjectReactCode(false)

    expect(code).toContain('enableOrthogonalEdges: props.enableOrthogonalEdges ?? false')
  })

  it('uses the project orthogonal-edge setting for the generated React integration', async ({ expect }) => {
    const code = await generateProjectReactCode(true)

    expect(code).toContain(
      'GenericReactLikeC4, { renderIcon: IconRenderer, ...props, enableOrthogonalEdges: props.enableOrthogonalEdges ?? true',
    )
  })
})
