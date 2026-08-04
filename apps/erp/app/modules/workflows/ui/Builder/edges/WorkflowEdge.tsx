import { cn, IconButton } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { EdgeProps } from "@xyflow/react";
import { EdgeLabelRenderer, getSmoothStepPath, useStore } from "@xyflow/react";
import { memo, useEffect, useState } from "react";
import { LuX } from "react-icons/lu";
import { useBuilderStore } from "../context";

function WorkflowEdgeImpl({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  source,
  target
}: EdgeProps) {
  const { t } = useLingui();
  const isNodeSelected = useStore((s) =>
    s.nodes.some((n) => n.selected && (n.id === source || n.id === target))
  );
  const anySelected = useStore((s) => s.nodes.some((n) => n.selected));
  const highlighted = selected || isNodeSelected;

  const isReadOnly = useBuilderStore((s) => s.isReadOnly);
  const onEdgesChange = useBuilderStore((s) => s.onEdgesChange);
  const [armed, setArmed] = useState(false);

  // Two-click disconnect, same as the node delete button. Disarms itself so a
  // stray click never lingers.
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(timer);
  }, [armed]);

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 12
  });

  return (
    <>
      <path
        id={id}
        d={edgePath}
        fill="none"
        stroke="hsl(var(--primary))"
        strokeWidth={highlighted ? 2.5 : 1.75}
        strokeLinecap="round"
        strokeDasharray="8 4"
        strokeOpacity={anySelected ? (highlighted ? 1 : 0.28) : 0.85}
        className="workflow-edge-animated"
      />
      {!isReadOnly && (
        <EdgeLabelRenderer>
          {/* The renderer's container is pointer-events:none, so the button opts back in. */}
          <div
            className="nodrag nopan pointer-events-auto absolute"
            style={{
              transform: `translate(-50%, -60%) translate(${labelX}px, ${labelY}px)`
            }}
          >
            <IconButton
              aria-label={armed ? t`Confirm disconnect` : t`Disconnect`}
              title={armed ? t`Click again to disconnect` : t`Disconnect`}
              icon={<LuX />}
              variant="secondary"
              size="sm"
              isRound
              // Opaque, because the edge runs underneath. `after:` widens the hit
              // box without growing the dot on the canvas.
              className={cn(
                "!bg-card after:absolute after:-inset-2 after:content-['']",
                armed && "border-destructive text-destructive"
              )}
              onClick={(e) => {
                e.stopPropagation();
                if (armed) onEdgesChange([{ type: "remove", id }]);
                else setArmed(true);
              }}
              onBlur={() => setArmed(false)}
            />
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const WorkflowEdge = memo(WorkflowEdgeImpl);

export const edgeTypes = { workflow: WorkflowEdge };
