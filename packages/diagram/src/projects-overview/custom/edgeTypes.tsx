import { getSmoothStepPath } from '@xyflow/system'
import {
  EdgeContainer,
  EdgeLabel,
  EdgeLabelContainer,
  EdgePath,
  memoEdge,
} from '../../base-primitives'
import { useEnabledFeatures } from '../../context/DiagramFeatures'
import { stripDegenerateCurves } from '../../utils/orthogonalEdgePath'
import { bezierPath } from '../../utils/xyflow'
import type { ProjectsOverviewTypes } from '../_types'

export const RelationshipEdge = memoEdge<ProjectsOverviewTypes.EdgeProps>((edgeProps) => {
  const { enableOrthogonalEdges } = useEnabledFeatures()
  const path = enableOrthogonalEdges
    ? stripDegenerateCurves(getSmoothStepPath({ ...edgeProps, borderRadius: 0 })[0])
    : bezierPath(edgeProps.data.points)

  return (
    <EdgeContainer {...edgeProps}>
      <EdgePath
        edgeProps={edgeProps}
        svgPath={path}
      />
      <EdgeLabelContainer edgeProps={edgeProps}>
        <EdgeLabel edgeProps={edgeProps} />
      </EdgeLabelContainer>
    </EdgeContainer>
  )
})
