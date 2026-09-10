"use client";
import {
  DatePicker as DatePickerInput,
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@carbon/react";
import { parseDate } from "@internationalized/date";
import { useLingui } from "@lingui/react/macro";
import { LuPin } from "react-icons/lu";
import { useSubmit } from "react-router";
import { DateTime } from "~/components";
import { path } from "~/utils/path";

type OperationDueDatePickerProps = {
  operationId: string;
  dueDate: string | null;
  manuallyScheduled?: boolean;
  onChange?: (dueDate: string | null) => void;
};

export function OperationDueDatePicker({
  operationId,
  dueDate,
  manuallyScheduled,
  onChange
}: OperationDueDatePickerProps) {
  const { t } = useLingui();
  const submit = useSubmit();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex">
          <DatePickerInput
            value={dueDate ? parseDate(dueDate) : null}
            isPreviewInline
            inline={
              dueDate ? (
                <span className="flex flex-grow line-clamp-1 items-center gap-1 text-xs text-muted-foreground">
                  {manuallyScheduled && <LuPin className="h-3 w-3 shrink-0" />}
                  <DateTime value={dueDate} variant="date" />
                </span>
              ) : (
                true
              )
            }
            onChange={(value) => {
              const dateStr = value?.toString() ?? null;
              onChange?.(dateStr);
              submit(
                { id: operationId, dueDate: dateStr ?? "" },
                {
                  method: "post",
                  action: path.to.jobOperationDueDate,
                  navigate: false,
                  fetcherKey: `jobOperationDueDate:${operationId}`
                }
              );
            }}
          />
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <span>
          {t`The date this operation must finish to keep the job on schedule. Pinning it overrides the calculated target.`}
        </span>
      </TooltipContent>
    </Tooltip>
  );
}
