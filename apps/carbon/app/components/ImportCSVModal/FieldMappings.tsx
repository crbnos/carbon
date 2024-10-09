"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { useFetcher } from "@remix-run/react";
import { useEffect, useState } from "react";
import { LuInfo, LuMoveRight } from "react-icons/lu";
import { SelectControlled } from "~/components/Form";
import { useCurrencyFormatter } from "~/hooks";
import type { importSchemas } from "~/modules/shared";
import { fieldMappings } from "~/modules/shared";
import type { action } from "~/routes/api+/ai+/csv+/$table.columns";
import { path } from "~/utils/path";
import { useCsvContext } from "./useCsvContext";

export function FieldMapping({ table }: { table: keyof typeof importSchemas }) {
  const { fileColumns, firstRows } = useCsvContext();
  const fetcher = useFetcher<typeof action>();
  const mappableFields = fieldMappings[table];

  useEffect(() => {
    if (!fileColumns || !firstRows) return;

    fetcher.submit(
      {
        fileColumns,
        firstRows,
      },
      {
        method: "POST",
        action: path.to.api.generateCsvColumns(table),
        encType: "application/json",
      }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileColumns, firstRows]);

  return (
    <div className="mt-6">
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        <div className="text-sm">CSV Data column</div>
        <div className="text-sm">Carbon data column</div>
        {Object.entries(mappableFields).map(
          ([name, { label, required, type }]) => (
            <FieldRow
              key={name}
              label={label}
              type={type}
              required={required}
              name={name}
              mappedColumn={fetcher.data?.[name]}
              isLoading={fetcher.state !== "idle"}
            />
          )
        )}
      </div>
    </div>
  );
}

function FieldRow({
  name,
  label,
  type,
  required,
  mappedColumn,
  isLoading,
}: {
  name: string;
  label: string;
  type: "string" | "number" | "date" | "boolean" | "currency";
  required: boolean;
  mappedColumn: string | undefined;
  isLoading: boolean;
}) {
  const formatter = useCurrencyFormatter();
  const { fileColumns, firstRows } = useCsvContext();
  const [value, setValue] = useState<string | undefined>(mappedColumn);

  useEffect(() => {
    setValue(mappedColumn);
  }, [mappedColumn]);

  const firstRow = firstRows?.at(0);
  const description = firstRow?.[value as keyof typeof firstRow];

  const formatDescription = (description?: string) => {
    if (!description) return;

    if (type === "date") {
      return formatDate(description);
    }

    if (type === "currency") {
      return formatter.format(parseFloat(description));
    }

    if (type === "boolean") {
      return description.toLowerCase() === "true" ? "Yes" : "No";
    }

    return description;
  };

  return (
    <>
      <div className="relative flex min-w-0 items-center gap-2">
        <SelectControlled
          name={name}
          onChange={(value) => setValue(value?.value)}
          isLoading={isLoading}
          value={value}
          options={[
            // Filter out empty columns
            ...(fileColumns?.filter((column) => column !== "") || []),
            ...(value && !required ? ["None"] : []),
          ]?.map((column) => ({ value: column, label: column }))}
        />

        <div className="flex items-center justify-end">
          <LuMoveRight className="text-muted-foreground" />
        </div>
      </div>

      <span className="flex h-10 w-full items-center justify-between whitespace-nowrap border border-border bg-transparent px-3 py-2 rounded-md text-base space-x-3">
        <div className="grow whitespace-nowrap font-normal text-muted-foreground justify-between flex">
          <span>{label}</span>

          {description && (
            <TooltipProvider delayDuration={50}>
              <Tooltip>
                <TooltipTrigger>
                  <LuInfo />
                </TooltipTrigger>
                <TooltipContent className="p-2 text-sm">
                  {formatDescription(description)}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </span>
    </>
  );
}
