import { cn } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { LuChevronsUpDown } from "react-icons/lu";

/**
 * The control for a field that can only ever hold a variable. Shaped like a select
 * because that is what it is — one choice, made from the same variable menu every
 * other field uses. Nothing to type into, so there is no brace and no browse button.
 *
 * The box stays put once a value is chosen: the chip sits inside it, the way a
 * selected option sits inside a select.
 */
export function VariablePickControl({
  placeholder,
  hasIssue,
  onOpen,
  chip,
  isReadOnly = false
}: {
  placeholder?: string;
  hasIssue?: boolean;
  onOpen: () => void;
  /** The chosen variable, drawn inside the box. Absent means nothing is chosen yet. */
  chip?: ReactNode;
  /** The version is published: show the value, refuse every edit. */
  isReadOnly?: boolean;
}) {
  const { t } = useLingui();

  return (
    // The whole box opens the menu, chip or not — clicking a select's own text is how
    // anyone expects to reopen it. The chip's clear button stops the click itself.
    <div
      onClick={isReadOnly ? undefined : onOpen}
      className={cn(
        "flex h-10 w-full min-w-0 flex-1 cursor-pointer items-center justify-between gap-2 whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
        hasIssue && "border-destructive"
      )}
    >
      {chip ?? (
        <button
          type="button"
          onClick={onOpen}
          disabled={isReadOnly}
          className="min-w-0 flex-1 truncate text-left text-muted-foreground outline-none"
        >
          {placeholder ?? t`Pick a variable…`}
        </button>
      )}
      <LuChevronsUpDown className="size-4 shrink-0 opacity-50" />
    </div>
  );
}
