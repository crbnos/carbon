import { cn } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { LuChevronsUpDown } from "react-icons/lu";

/**
 * The control for a field that can only ever hold a variable. Shaped like a select
 * because that is what it is — one choice, made from the same variable menu every
 * other field uses. Nothing to type into, so there is no brace and no browse button.
 */
export function VariablePickControl({
  placeholder,
  hasIssue,
  onOpen
}: {
  placeholder?: string;
  hasIssue?: boolean;
  onOpen: () => void;
}) {
  const { t } = useLingui();

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex h-10 w-full min-w-0 flex-1 items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] focus:border-ring focus:ring-[3px] focus:ring-ring/50",
        hasIssue && "border-destructive"
      )}
    >
      <span className="truncate text-muted-foreground">
        {placeholder ?? t`Pick a variable…`}
      </span>
      <LuChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
    </button>
  );
}
