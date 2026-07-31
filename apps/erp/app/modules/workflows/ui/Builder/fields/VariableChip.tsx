import {
  Badge,
  BadgeCloseButton,
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@carbon/react";
import type { ItemRef, VariableRef } from "@carbon/workflows";

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

  const label = buildLabel(refVal, nodeTitle, typeName);

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

function buildLabel(
  ref: VariableRef | ItemRef,
  nodeTitle?: string,
  typeName?: string
): string {
  const parts: string[] = [];
  if (ref.kind === "ref") {
    if (nodeTitle) parts.push(nodeTitle);
    if (ref.output) parts.push(ref.output);
    if (ref.path.length > 0) parts.push(ref.path.join("."));
  } else {
    parts.push("current item");
    if (ref.path.length > 0) parts.push(ref.path.join("."));
  }
  if (typeName) parts.push(typeName);
  return parts.join(" › ");
}
