"use client";
import { DatePicker as DatePickerInput } from "@carbon/react";
import { parseDate } from "@internationalized/date";
import { useSubmit } from "react-router";
import { useDateFormatter } from "~/hooks";
import { path } from "~/utils/path";

type OperationDueDatePickerProps = {
  operationId: string;
  dueDate: string | null;
  onChange?: (dueDate: string | null) => void;
};

export function OperationDueDatePicker({
  operationId,
  dueDate,
  onChange
}: OperationDueDatePickerProps) {
  const submit = useSubmit();
  const { formatDate } = useDateFormatter();

  return (
    <DatePickerInput
      value={dueDate ? parseDate(dueDate) : null}
      isPreviewInline
      inline={
        dueDate ? (
          <span className="flex flex-grow line-clamp-1 items-center text-xs text-muted-foreground">
            {formatDate(dueDate)}
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
  );
}
