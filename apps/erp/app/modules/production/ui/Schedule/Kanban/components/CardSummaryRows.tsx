import {
  Badge,
  cn,
  HStack,
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@carbon/react";
import {
  convertDateStringToIsoString,
  formatDurationMilliseconds
} from "@carbon/utils";
import { LuCalendarDays, LuTimer } from "react-icons/lu";
import { DateTime } from "~/components";
import { getDeadlineIcon } from "~/modules/production/ui/Jobs/Deadline";

// The presentational duration + due-date rows shared by the operation card
// (ItemCard) and the batch card (BatchItemCard). Both render byte-identical
// markup, differing only in the values fed in (single operation vs rolled-up
// across the batch's members), so the row layout lives here once. Each row's
// visibility is decided by the caller (its own display-setting + validity
// guard) and passed in, so behavior is preserved exactly.
//
// Deliberately NOT shared: the status row (ItemCard uses the interactive
// per-operation JobOperationStatus, BatchItemCard a read-only rolled-up
// OperationStatusIcon) and the customer row (BatchItemCard collapses N distinct
// customers to a count). Those genuinely differ and stay on each card.
export function CardSummaryRows({
  showDuration,
  duration,
  showDueDate,
  deadlineType,
  dueDate,
  isOverdue,
  formatRelativeTime
}: {
  showDuration: boolean;
  duration: number;
  showDueDate: boolean;
  deadlineType: Parameters<typeof getDeadlineIcon>[0] | null | undefined;
  dueDate: string | null | undefined;
  isOverdue: boolean;
  formatRelativeTime: (value: string) => string;
}) {
  return (
    <>
      {showDuration && (
        <HStack className="justify-start space-x-2">
          <LuTimer className="text-muted-foreground" />
          <span className="text-sm">
            {formatDurationMilliseconds(duration)}
          </span>
        </HStack>
      )}
      {showDueDate && deadlineType && (
        <HStack className="justify-start space-x-2">
          {getDeadlineIcon(deadlineType)}
          <Tooltip>
            <TooltipTrigger>
              <span className={cn("text-sm", isOverdue ? "text-red-500" : "")}>
                {["ASAP", "No Deadline"].includes(deadlineType)
                  ? deadlineType
                  : dueDate
                    ? `Due ${formatRelativeTime(
                        convertDateStringToIsoString(dueDate)
                      )}`
                    : "–"}
              </span>
            </TooltipTrigger>
            <TooltipContent side="right">{deadlineType}</TooltipContent>
          </Tooltip>
        </HStack>
      )}
      {showDueDate && dueDate && (
        <HStack className="justify-start space-x-2">
          <LuCalendarDays />
          <span className="text-sm">
            <DateTime value={dueDate} variant="date" />
          </span>
        </HStack>
      )}
    </>
  );
}

// The material-signature chips row — identical markup on both cards, fed the
// operation's own chips on ItemCard and the union across members on
// BatchItemCard. Caller keeps its own display-setting + non-empty guard.
export function CardMaterialChips({ chips }: { chips: string[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {chips.map((chip) => (
        <Badge key={chip} variant="secondary" className="text-xs">
          {chip}
        </Badge>
      ))}
    </div>
  );
}
