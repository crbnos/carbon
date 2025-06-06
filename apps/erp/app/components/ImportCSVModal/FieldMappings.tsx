"use client";

import { useCarbon } from "@carbon/auth";
import type { Database } from "@carbon/database";
import { Combobox, useFormContext } from "@carbon/form";
import {
  Button,
  ModalDescription,
  ModalHeader,
  ModalTitle,
  toast,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { useFetcher } from "@remix-run/react";
import type { PostgrestResponse, SupabaseClient } from "@supabase/supabase-js";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { LuInfo, LuMoveRight } from "react-icons/lu";
import { Submit } from "~/components/Form";
import { useCurrencyFormatter, useUser } from "~/hooks";
import type { importSchemas } from "~/modules/shared";
import { fieldMappings } from "~/modules/shared";
import type { action } from "~/routes/api+/ai+/csv+/$table.columns";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";
import { capitalize } from "~/utils/string";
import { useCsvContext } from "./useCsvContext";

type EnumData =
  | {
      default: string;
      description: string;
      options: readonly string[];
    }
  | {
      default: string;
      description: string;
      fetcher: (
        client: SupabaseClient<Database>,
        companyId: string
      ) => Promise<PostgrestResponse<ListItem>>;
    };

export function FieldMapping({
  formId,
  table,
  onReset,
}: {
  formId: string;
  table: keyof typeof importSchemas;
  onReset: () => void;
}) {
  const initialized = useRef(false);
  const { validate } = useFormContext(formId);
  const { fileColumns, filePath, firstRows } = useCsvContext();
  const fetcher = useFetcher<typeof action>();
  const mappableFields = fieldMappings[table];
  const [currentStep, setCurrentStep] = useState(0);
  const [columnMappings, setColumnMappings] = useState<Record<string, string>>(
    {}
  );
  const [enumMappings, setEnumMappings] = useState<
    Record<string, Record<string, string>>
  >(() =>
    Object.entries(mappableFields).reduce<
      Record<string, Record<string, string>>
    >((acc, [name, { type, enumData }]) => {
      if (type === "enum") {
        acc[name] = { Default: enumData.default };
      }
      return acc;
    }, {})
  );

  useEffect(() => {
    if (!fileColumns || !firstRows) return;

    fetcher.submit(
      {
        fileColumns,
      },
      {
        method: "POST",
        action: path.to.api.generateCsvColumns(table),
        encType: "application/json",
      }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileColumns, firstRows]);

  useEffect(() => {
    if (
      fetcher.data &&
      Object.keys(fetcher.data).length > 0 &&
      !initialized.current
    ) {
      initialized.current = true;
      setColumnMappings((prevMappings) => {
        if (!fetcher.data || !fileColumns) return prevMappings;

        return Object.entries(fetcher.data).reduce((acc, [key, value]) => {
          if (fileColumns.includes(value)) {
            acc[key] = value;
          }
          return acc;
        }, {} as Record<string, string>);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data]);

  const enumFields: [
    string,
    {
      label: string;
      enumData: EnumData;
    }
  ][] = Object.entries(mappableFields).filter(
    ([_, { type }]) => type === "enum"
  );

  const steps = enumFields.length > 0 ? enumFields.length + 1 : 1;

  const onNext = () => {
    if (currentStep < steps - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const onPrevious = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const onColumnMappingChange = (name: string, value: string) => {
    setColumnMappings((prev) => ({ ...prev, [name]: value }));
  };

  const onEnumMappingChange = (
    enumerable: string,
    name: string,
    value: string
  ) => {
    setEnumMappings((prev) => ({
      ...prev,
      [enumerable]: { ...prev[enumerable], [name]: value },
    }));
  };

  return (
    <>
      <ModalHeader>
        <div className="flex space-x-4 items-center mb-4">
          <ModalTitle className="m-0 p-0">
            {currentStep === 0
              ? "Field Mapping"
              : enumFields[currentStep - 1][1].label}
          </ModalTitle>
        </div>

        <ModalDescription>
          {currentStep === 0
            ? "We've mapped each column to what we believe is correct, but please review the data below to confirm it's accurate."
            : enumFields[currentStep - 1][1].enumData.description}
        </ModalDescription>
      </ModalHeader>
      <div className="mt-6">
        {currentStep === 0 ? (
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            <div className="text-sm">CSV column</div>
            <div className="text-sm">Carbon column</div>
            {Object.entries(mappableFields).map(
              ([name, { label, required, type }]) => (
                <FieldRow
                  key={name}
                  label={label}
                  type={type}
                  required={required}
                  name={name}
                  mappedColumn={columnMappings[name]}
                  isLoading={fetcher.state !== "idle"}
                  onColumnMappingChange={onColumnMappingChange}
                />
              )
            )}
          </div>
        ) : (
          <>
            {Object.entries(columnMappings).map(([name, value]) => (
              <input type="hidden" key={name} name={name} value={value} />
            ))}
            <input
              type="hidden"
              name="enumMappings"
              value={JSON.stringify(enumMappings)}
            />
          </>
        )}
        {enumFields.map(
          ([name, { enumData }], index) =>
            currentStep === index + 1 && (
              <EnumMappingStep
                key={name}
                name={name}
                enumData={enumData}
                mappedColumn={columnMappings[name]}
                firstRows={firstRows}
                mappings={enumMappings[name]}
                onEnumMappingChange={onEnumMappingChange}
              />
            )
        )}
      </div>
      <div className="flex flex-col w-full gap-2 pb-4">
        {currentStep === steps - 1 && (
          <Submit
            isDisabled={!filePath || fetcher.state !== "idle"}
            type="submit"
          >
            Confirm Import
          </Submit>
        )}
        {currentStep < steps - 1 && (
          <Button
            variant="secondary"
            type="button"
            onClick={async () => {
              if (currentStep === 0) {
                const result = await validate();

                if (!result.error) {
                  onNext();
                }
              } else {
                onNext();
              }
            }}
          >
            Next
          </Button>
        )}
        {currentStep === 0 && (
          <Button variant="link" type="button" onClick={onReset}>
            Choose another file
          </Button>
        )}

        {currentStep > 0 && (
          <Button variant="link" type="button" onClick={onPrevious}>
            Previous
          </Button>
        )}
      </div>
    </>
  );
}

function FieldRow({
  name,
  label,
  type,
  required,
  mappedColumn,
  isLoading,
  onColumnMappingChange,
}: {
  name: string;
  label: string;
  type: "string" | "number" | "date" | "boolean" | "currency" | "enum";
  required: boolean;
  mappedColumn: string | undefined;
  isLoading: boolean;
  onColumnMappingChange: (name: string, value: string) => void;
}) {
  const formatter = useCurrencyFormatter();
  const { fileColumns, firstRows } = useCsvContext();

  const firstRow = firstRows?.at(0);
  const description = firstRow?.[mappedColumn as keyof typeof firstRow];

  const formatDescription = (description?: string) => {
    if (!description) return;

    switch (type) {
      case "date":
        return formatDate(description);
      case "currency":
        return formatter.format(parseFloat(description));
      case "boolean":
        return description.toLowerCase() === "true" ? "Yes" : "No";
      default:
        return description;
    }
  };

  return (
    <>
      <div className="relative flex min-w-0 items-center gap-2">
        <Combobox
          name={name}
          onChange={(value) => {
            if (value?.value) {
              onColumnMappingChange(name, value.value);
            }
          }}
          isLoading={isLoading}
          value={mappedColumn}
          options={[
            ...(fileColumns?.filter((column) => column !== "") || []),
            ...(mappedColumn && !required ? ["None"] : []),
          ]?.map((column) => ({ value: column, label: column }))}
        />

        <div className="flex items-center justify-end">
          <LuMoveRight className="text-muted-foreground" />
        </div>
      </div>

      <span className="flex h-10 w-full items-center justify-between whitespace-nowrap border border-border bg-transparent px-3 py-2 rounded-md text-sm space-x-3">
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

function EnumMappingStep({
  name,
  enumData,
  mappedColumn,
  firstRows,
  mappings,
  onEnumMappingChange,
}: {
  name: string;
  enumData: EnumData;
  mappedColumn: string | undefined;
  firstRows: Record<string, string>[] | null;
  mappings: Record<string, string>;
  onEnumMappingChange: (
    enumerable: string,
    name: string,
    value: string
  ) => void;
}) {
  const { carbon } = useCarbon();
  const { company } = useUser();
  const [options, setOptions] = useState<{ label: string; value: string }[]>(
    () => {
      if ("options" in enumData) {
        return (
          enumData.options.map((option) => ({
            label: option,
            value: option,
          })) || []
        );
      } else {
        return [];
      }
    }
  );

  const uniqueValues = Array.from(
    new Set(
      firstRows
        ?.map((row) => row[mappedColumn || ""])
        .filter((value) => !!value)
    )
  );

  const fetchOptions = useCallback(async () => {
    if ("fetcher" in enumData) {
      const { data, error } = await enumData.fetcher(carbon!, company.id);
      if (error) {
        toast.error(error.message);
      } else {
        setOptions(data.map((item) => ({ label: item.name, value: item.id })));
      }
    }
  }, [enumData, carbon, company.id]);

  useEffect(() => {
    if ("fetcher" in enumData && carbon) {
      fetchOptions();
    }
  }, [enumData, carbon, company.id, fetchOptions]);

  return (
    <div>
      <div className="grid grid-cols-2 gap-4">
        <div className="font-medium ">
          {`${capitalize(mappedColumn ?? "CSV")} Value`}
        </div>
        <div className="font-medium">Carbon Value</div>

        {[...new Set([...uniqueValues, "Default"])].map((csvValue) => {
          return (
            <Fragment key={csvValue}>
              <div className="relative flex min-w-0 items-center gap-2">
                <div>{csvValue}</div>
                <div className="flex items-center justify-end">
                  <LuMoveRight className="text-muted-foreground" />
                </div>
              </div>
              <Combobox
                name={`${name}-${csvValue}`}
                onChange={(value) => {
                  if (value?.value) {
                    onEnumMappingChange(name, csvValue, value.value);
                  }
                }}
                value={mappings[csvValue]}
                options={options}
              />
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
