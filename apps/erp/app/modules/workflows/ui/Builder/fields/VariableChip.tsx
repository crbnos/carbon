import {
  Badge,
  BadgeCloseButton,
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@carbon/react";
import type { ItemRef, VariableRef } from "@carbon/workflows";
import { useLingui } from "@lingui/react/macro";
import { refLabel, refLeafLabel } from "./tokenId";

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
  const { t } = useLingui();
  const missing = refVal.kind === "ref" && nodeTitle === undefined;

  if (missing) {
    return (
      <div className="flex min-w-0 items-center gap-1">
        <Badge
          variant="destructive"
          className="min-w-0 max-w-full flex-1 cursor-pointer truncate"
          onClick={onReopen}
        >
          {t`Step removed — pick a new value`}
        </Badge>
        <BadgeCloseButton onClick={onRemove} aria-label={t`Clear value`} />
      </div>
    );
  }

  // The chip shows the value's own name; the full `Step › output › property` path is the
  // tooltip, because a narrow clause cell cannot fit it.
  const full = typeName
    ? `${refLabel(refVal, nodeTitle)} › ${typeName}`
    : refLabel(refVal, nodeTitle);
  const short = refLeafLabel(refVal);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex w-full min-w-0 items-center gap-1">
          <Badge
            variant="secondary"
            className="min-w-0 max-w-full flex-1 cursor-pointer truncate"
            onClick={onReopen}
          >
            {short}
          </Badge>
          <BadgeCloseButton onClick={onRemove} aria-label={t`Clear value`} />
        </div>
      </TooltipTrigger>
      <TooltipContent>{full}</TooltipContent>
    </Tooltip>
  );
}
