import {
  MENTION_CHIP_INVALID_TONE_CLASS,
  MENTION_CHIP_TONE_CLASS
} from "@carbon/tiptap";
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import type { ComponentType } from "react";
import { LuX } from "react-icons/lu";
import { Tooltip, TooltipContent, TooltipTrigger } from "../Tooltip";
import { cn } from "../utils/cn";

/**
 * The chip drawn for a token inside the editor. A node view rather than static markup
 * so the full label can hang off a real tooltip: the chip shows only the leaf name, and
 * a native `title` cannot be styled or given a delay.
 */
export function createVariableChip(
  renderLabel: (label: string) => string
): ComponentType<ReactNodeViewProps> {
  return function VariableChip({
    node,
    editor,
    deleteNode
  }: ReactNodeViewProps) {
    const full = (node.attrs.label as string | null) ?? node.attrs.id ?? "";
    const invalid = node.attrs.invalid === true;
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <NodeViewWrapper
            as="span"
            // The wrapper lays the label and the remove button out side by side, so the
            // ellipsis has to live on the label span — `text-overflow` never applies to a
            // flex container itself.
            className={cn(
              "inline-flex max-w-[14rem] items-center gap-0.5 align-middle",
              invalid
                ? MENTION_CHIP_INVALID_TONE_CLASS
                : MENTION_CHIP_TONE_CLASS
            )}
          >
            <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
              {`{${renderLabel(full)}}`}
            </span>
            {editor.isEditable && (
              <button
                type="button"
                aria-label={`Remove ${full}`}
                contentEditable={false}
                // Without this the editor takes the selection first and the click lands
                // on a button that has already moved.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => deleteNode()}
                className="shrink-0 rounded-full opacity-60 transition-opacity hover:opacity-100"
              >
                <LuX className="size-3" />
              </button>
            )}
          </NodeViewWrapper>
        </TooltipTrigger>
        <TooltipContent>{full}</TooltipContent>
      </Tooltip>
    );
  };
}
