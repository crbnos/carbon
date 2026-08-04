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
  /** Why this value no longer works — the step it came from was deleted, renamed its
   * outputs, or is no longer upstream. Turns the pill red and becomes its tooltip. */
  invalid?: string;
  onRemove: () => void;
  onReopen: () => void;
};

const BROKEN_CHIP_CLASS =
  "rounded-full bg-destructive px-1.5 py-0 text-[0.8125rem] font-medium leading-5 text-destructive-foreground";

/** Deliberately the same pill as a token inside the inline editor — one variable, one look,
 * whether it was typed into a sentence or picked from a select. */
export function VariableChip({
  variable: refVal,
  nodeTitle,
  typeName,
  invalid,
  onRemove,
  onReopen
}: Props) {
  const { t } = useLingui();
  // The step is gone, so there is no name left to show — the chip has to say so itself.
  // Every other kind of breakage still reads as the value it names, just in red.
  const removed = refVal.kind === "ref" && nodeTitle === undefined;
  const broken = removed || invalid !== undefined;

  const label = removed
    ? t`Step removed — pick a new value`
    : `{${refLeafLabel(refVal)}}`;

  const chip = (
    <span
      className={cn(
        "inline-flex min-w-0 max-w-full items-center gap-0.5 align-middle",
        broken ? BROKEN_CHIP_CLASS : VARIABLE_TEXT_CHIP_CLASS
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

  if (removed) return chip;

  // The chip shows the value's own name; the full `Step › output › property` path is the
  // tooltip, because a narrow clause cell cannot fit it.
  const path = typeName
    ? `${refLabel(refVal, nodeTitle)} › ${typeName}`
    : refLabel(refVal, nodeTitle);

  return (
    <Tooltip>
      <TooltipTrigger asChild>{chip}</TooltipTrigger>
      <TooltipContent>{invalid ?? path}</TooltipContent>
    </Tooltip>
  );
}
