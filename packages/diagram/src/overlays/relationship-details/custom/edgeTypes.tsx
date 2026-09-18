import { getBezierPath, getSmoothStepPath } from '@xyflow/system'
import {
  EdgeActionButton,
  EdgeContainer,
  EdgeLabel,
  EdgeLabelContainer,
  EdgePath,
  memoEdge,
} from '../../../base-primitives'
import { useEnabledFeatures } from '../../../context'
import { useDiagram } from '../../../hooks/useDiagram'
import { stripDegenerateCurves } from '../../../utils/orthogonalEdgePath'
import type { RelationshipDetailsTypes } from '../_types'

export const RelationshipEdge = memoEdge<RelationshipDetailsTypes.EdgeProps>((props) => {
  const { enableNavigateTo, enableOrthogonalEdges } = useEnabledFeatures()
  const {
    data: { navigateTo },
  } = props
  const [bezierOrStep, labelX, labelY] = enableOrthogonalEdges
    ? getSmoothStepPath({ ...props, borderRadius: 0 })
    : getBezierPath(props)
  const svgPath = enableOrthogonalEdges ? stripDegenerateCurves(bezierOrStep) : bezierOrStep
  const diagram = useDiagram()
  return (
    <EdgeContainer {...props}>
      <EdgePath edgeProps={props} svgPath={svgPath} />
      <EdgeLabelContainer
        edgeProps={props}
        labelPosition={{
          x: labelX,
          y: labelY,
          translate: 'translate(-50%, 0)',
        }}
        style={{
          maxWidth: Math.abs(props.targetX - props.sourceX - 100),
        }}>
        <EdgeLabel edgeProps={props}>
          {enableNavigateTo && navigateTo && (
            <EdgeActionButton
              {...props}
              onClick={e => {
                e.stopPropagation()
                diagram.navigateTo(navigateTo)
              }} />
          )}
        </EdgeLabel>
      </EdgeLabelContainer>
    </EdgeContainer>
  )
})
