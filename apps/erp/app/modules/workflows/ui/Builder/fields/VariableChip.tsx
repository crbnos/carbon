import {
  Badge,
  BadgeCloseButton,
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@carbon/react";
import type { ItemRef, VariableRef } from "@carbon/workflows";
import { refLabel } from "./tokenId";

type Props = {
  variable: VariableRef | ItemRef;
  nodeTitle?: string;
  typeName?: string;
  onRemove: () => void;
  onReopen: () => void;
};

export function VariableChip({
  variable: refVal,
  nodeTitle,
  typeName,
  onRemove,
  onReopen
}: Props) {
  const missing = refVal.kind === "ref" && nodeTitle === undefined;

  if (missing) {
    return (
      <div className="flex items-center gap-1">
        <Badge
          variant="destructive"
          className="flex-1 cursor-pointer truncate"
          onClick={onReopen}
        >
          Step removed — pick a new value
        </Badge>
        <BadgeCloseButton onClick={onRemove} aria-label="Clear value" />
      </div>
    );
  }

  // Same builder the inline tokens use, so one reference reads identically everywhere.
  const label = typeName
    ? `${refLabel(refVal, nodeTitle)} › ${typeName}`
    : refLabel(refVal, nodeTitle);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex w-full items-center gap-1">
          <Badge
            variant="secondary"
            className="flex-1 cursor-pointer truncate"
            onClick={onReopen}
          >
            {label}
          </Badge>
          <BadgeCloseButton onClick={onRemove} aria-label="Clear value" />
        </div>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
