import { cn, Tooltip, TooltipContent, TooltipTrigger } from "@carbon/react";
import { VARIABLE_TEXT_CHIP_CLASS } from "@carbon/react/VariableText";
import type { ItemRef, VariableRef } from "@carbon/workflows";
import { useLingui } from "@lingui/react/macro";
import { LuX } from "react-icons/lu";
import { refLabel, refLeafLabel } from "./tokenId";

type Props = {
  variable: VariableRef | ItemRef;
  nodeTitle?: string;
  typeName?: string;
  onRemove: () => void;
  onReopen: () => void;
};

/** Deliberately the same pill as a token inside the inline editor — one variable, one look,
 * whether it was typed into a sentence or picked from a select. */
export function VariableChip({
  variable: refVal,
  nodeTitle,
  typeName,
  onRemove,
  onReopen
}: Props) {
  const { t } = useLingui();
  const missing = refVal.kind === "ref" && nodeTitle === undefined;

  const label = missing
    ? t`Step removed — pick a new value`
    : `{${refLeafLabel(refVal)}}`;

  const chip = (
    <span
      className={cn(
        "inline-flex min-w-0 max-w-full items-center gap-0.5 align-middle",
        missing
          ? "rounded-full bg-destructive px-1.5 py-0 text-[0.8125rem] font-medium leading-5 text-destructive-foreground"
          : VARIABLE_TEXT_CHIP_CLASS
      )}
    >
      <button
        type="button"
        onClick={onReopen}
        className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap"
      >
        {label}
      </button>
      <button
        type="button"
        aria-label={t`Clear value`}
        // The box around a chip opens the menu; clearing must not also reopen it.
        onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}
        className="shrink-0 rounded-full opacity-60 transition-opacity hover:opacity-100"
      >
        <LuX className="size-3" />
      </button>
    </span>
  );

  if (missing) return chip;

  // The chip shows the value's own name; the full `Step › output › property` path is the
  // tooltip, because a narrow clause cell cannot fit it.
  const full = typeName
    ? `${refLabel(refVal, nodeTitle)} › ${typeName}`
    : refLabel(refVal, nodeTitle);

  return (
    <Tooltip>
      <TooltipTrigger asChild>{chip}</TooltipTrigger>
      <TooltipContent>{full}</TooltipContent>
    </Tooltip>
  );
}
