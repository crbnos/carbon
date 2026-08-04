import { MENTION_CHIP_CLASS } from "@carbon/tiptap";
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import type { ComponentType } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "../Tooltip";

/**
 * The chip drawn for a token inside the editor. A node view rather than static markup
 * so the full label can hang off a real tooltip: the chip shows only the leaf name, and
 * a native `title` cannot be styled or given a delay.
 */
export function createVariableChip(
  renderLabel: (label: string) => string
): ComponentType<ReactNodeViewProps> {
  return function VariableChip({ node }: ReactNodeViewProps) {
    const full = (node.attrs.label as string | null) ?? node.attrs.id ?? "";
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <NodeViewWrapper as="span" className={MENTION_CHIP_CLASS}>
            {`{${renderLabel(full)}}`}
          </NodeViewWrapper>
        </TooltipTrigger>
        <TooltipContent>{full}</TooltipContent>
      </Tooltip>
    );
  };
}
