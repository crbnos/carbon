import { IconButton } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { useReactFlow } from "@xyflow/react";
import { LuX } from "react-icons/lu";
import { useBuilderStore, useBuilderStoreShallow } from "./context";
import { selectAllIssues } from "./selectors";

export function IssuesPanel({ onDismiss }: { onDismiss: () => void }) {
  const { setCenter } = useReactFlow();
  const issues = useBuilderStoreShallow(selectAllIssues);
  const nodes = useBuilderStore((state) => state.nodes);
  const setSelected = useBuilderStore((state) => state.setSelected);

  if (!issues.length) return null;

  return (
    <div className="absolute inset-x-0 bottom-0 z-10 max-h-[40%] overflow-auto border-t bg-card shadow-lg">
      <div className="flex items-center justify-between border-b bg-destructive/5 px-3 py-2">
        <span className="text-[11.5px] font-semibold text-destructive">
          {issues.length === 1 ? (
            <Trans>1 problem — not published</Trans>
          ) : (
            <Trans>{issues.length} problems — not published</Trans>
          )}
        </span>
        <IconButton
          aria-label="Dismiss"
          variant="ghost"
          size="sm"
          icon={<LuX />}
          onClick={onDismiss}
        />
      </div>
      <ul>
        {issues.map((issue, index) => {
          const node = nodes.find((candidate) => candidate.id === issue.nodeId);

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
                  {issue.message}
                  {node && (
                    <span className="block text-[10px] text-muted-foreground">
                      {node.type}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
