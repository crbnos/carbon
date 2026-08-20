import { Tooltip, TooltipContent, TooltipTrigger } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { LuLayers } from "react-icons/lu";
import { useWorkflowLabel } from "../catalog";
import { actionInputLabelKey } from "../labelKeys";

/**
 * Not a control: whether a step repeats is decided by what is wired into it. This is
 * how that reads on the canvas, without opening the step.
 */
export function BatchBadge({
  action,
  input
}: {
  action: string;
  input: string;
}) {
  const { t } = useLingui();
  const labelFor = useWorkflowLabel();
  // The field's own label, so the badge and the step's form name the same input.
  const inputLabel = labelFor(actionInputLabelKey(action, input), input);
  const label = t`Repeats once for each item in ${inputLabel}`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* A span, not a button — nothing to press. `role="img"` is what carries
            the label to a screen reader. */}
        <span
          role="img"
          aria-label={label}
          className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"
        >
          <LuLayers className="size-3.5" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}
