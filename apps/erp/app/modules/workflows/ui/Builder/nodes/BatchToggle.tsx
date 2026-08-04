import {
  cn,
  IconButton,
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { LuLayers } from "react-icons/lu";
import { useBuilderStore } from "../context";

/**
 * Repeat mode, on the card header rather than under the inputs it governs: it decides
 * whether a list may be wired in at all, so it has to be visible before the fields are.
 */
export function BatchToggle({
  nodeId,
  isBatch,
  isReadOnly,
  hasIssue
}: {
  nodeId: string;
  isBatch: boolean;
  isReadOnly: boolean;
  hasIssue: boolean;
}) {
  const { t } = useLingui();
  const updateNodeData = useBuilderStore((s) => s.updateNodeData);

  const label = isBatch
    ? t`Repeats for each item in the list`
    : t`Runs once — lists are not accepted`;

  // Nothing to say about a published step that does not repeat.
  if (isReadOnly && !isBatch) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <IconButton
          aria-label={label}
          icon={<LuLayers />}
          variant="ghost"
          size="sm"
          aria-pressed={isBatch}
          isDisabled={isReadOnly}
          className={cn(
            isBatch && "bg-primary/10 text-primary hover:text-primary",
            hasIssue && "text-destructive hover:text-destructive",
            // A disabled button still reads as the mode it is in.
            isReadOnly && "disabled:opacity-100"
          )}
          onClick={(e) => {
            e.stopPropagation();
            updateNodeData(nodeId, { batch: !isBatch });
          }}
        />
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}
