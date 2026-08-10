import type { WorkflowIssue } from "@carbon/workflows";
import { useReactFlow } from "@xyflow/react";
import { useNodeLabel } from "../Runs/useNodeLabel";
import { useBuilderStore } from "./context";
import { useDefinition } from "./useDefinition";

/** Problems, each named for the step it belongs to and centred on click. Shared by the
 * publish panel and the test-run panel — the same list, read for two reasons. */
export function IssueList({ issues }: { issues: WorkflowIssue[] }) {
  const { setCenter } = useReactFlow();
  const nodes = useBuilderStore((state) => state.nodes);
  const setSelected = useBuilderStore((state) => state.setSelected);
  const definition = useDefinition();
  const nodeLabel = useNodeLabel();

  return (
    <ul>
      {issues.map((issue, index) => {
        const node = nodes.find((candidate) => candidate.id === issue.nodeId);
        // "this step" means nothing without the name the author gave it.
        const named = definition.nodes.find(
          (candidate) => candidate.id === issue.nodeId
        );
        const label = named ? nodeLabel(named) : undefined;

        return (
          <li key={`${issue.code}-${issue.nodeId ?? index}`}>
            <button
              type="button"
              className="flex w-full items-start gap-2 border-b px-3 py-2 text-left text-[11px] hover:bg-accent"
              onClick={() => {
                if (!node) return;
                setSelected(node.id);
                setCenter(node.position.x + 130, node.position.y + 90, {
                  zoom: 1,
                  duration: 300
                });
              }}
            >
              <span className="text-destructive">●</span>
              <span>
                {label && <span className="font-medium">{label.title}: </span>}
                {issue.message}
                {label?.subtitle && (
                  <span className="block text-[10px] text-muted-foreground">
                    {label.kind} · {label.subtitle}
                  </span>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
