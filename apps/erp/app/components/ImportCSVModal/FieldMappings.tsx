"use client";

import { useCarbon } from "@carbon/auth";
import type { Database } from "@carbon/database";
import { Combobox, CreatableCombobox, useFormContext } from "@carbon/form";
import {
  Button,
  ModalBody,
  ModalDescription,
  ModalHeader,
  ModalTitle,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  toast,
  useDisclosure
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { PostgrestResponse, SupabaseClient } from "@supabase/supabase-js";
import {
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";
import { LuInfo, LuListPlus, LuMoveRight, LuPlus } from "react-icons/lu";
import { useFetcher } from "react-router";
import { Submit } from "~/components/Form";
import {
  useCompanySettings,
  useCurrencyFormatter,
  useDateFormatter,
  usePermissions,
  useUser
} from "~/hooks";
import PaymentTermForm from "~/modules/accounting/ui/PaymentTerms/PaymentTermForm";
import { ShippingMethodForm } from "~/modules/inventory";
import type {
  CreatableForm,
  CreatableLookup,
  importSchemas
} from "~/modules/shared";
import { creatableFormPermissions, fieldMappings } from "~/modules/shared";
import type { action } from "~/routes/api+/ai+/csv+/$table.columns";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";
import { capitalize } from "~/utils/string";
import {
  buildOptionLookup,
  type MatchableOption,
  matchCsvValue,
  toMatchableOption
} from "./enumMatch";
import { useCreateLookup } from "./useCreateLookup";
import { useCsvContext } from "./useCsvContext";

type EnumData =
  | {
      default: string;
      description: string;
      creatableLookup?: CreatableLookup;
      creatableForm?: CreatableForm;
      options: readonly string[];
    }
  | {
      default: string;
      description: string;
      creatableLookup?: CreatableLookup;
      creatableForm?: CreatableForm;
      fetcher: (
        client: SupabaseClient<Database>,
        companyId: string
      ) => Promise<PostgrestResponse<ListItem>>;
    };

export function FieldMapping({
  formId,
  table,
  onReset
}: {
  formId: string;
  table: keyof typeof importSchemas;
  onReset: () => void;
}) {
  const { t } = useLingui();
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    if (!fileColumns || !firstRows || initialized.current) return;

    // Try exact matching by label and field name before calling the LLM
    const fileColumnsLower = fileColumns.map((c) => c.toLowerCase().trim());
    const exactMatches: Record<string, string> = {};

    for (const [fieldName, fieldDef] of Object.entries(mappableFields)) {
      // Match by label (e.g., "Process Type" === "Process Type")
      const labelIdx = fileColumnsLower.indexOf(fieldDef.label.toLowerCase());
      if (labelIdx !== -1) {
        exactMatches[fieldName] = fileColumns[labelIdx];
        continue;
      }
      // Match by field name (e.g., "processType" === "processtype")
      const nameIdx = fileColumnsLower.indexOf(fieldName.toLowerCase());
      if (nameIdx !== -1) {
        exactMatches[fieldName] = fileColumns[nameIdx];
      }
    }

    // If all fields matched exactly, skip the LLM call
    if (
      Object.keys(exactMatches).length === Object.keys(mappableFields).length
    ) {
      initialized.current = true;
      setColumnMappings(exactMatches);
      return;
    }

    fetcher.submit(
      {
        fileColumns
      },
      {
        method: "POST",
        action: path.to.api.generateCsvColumns(table),
        encType: "application/json"
      }
    );
  }, [fileColumns, firstRows]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    if (
      fetcher.data &&
      Object.keys(fetcher.data).length > 0 &&
      !initialized.current
    ) {
      initialized.current = true;
      setColumnMappings((prevMappings) => {
        if (!fetcher.data || !fileColumns) return prevMappings;

        return Object.entries(fetcher.data).reduce(
          (acc, [key, value]) => {
            if (fileColumns.includes(value)) {
              acc[key] = value;
            }
            return acc;
          },
          {} as Record<string, string>
        );
      });
    }
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
      [enumerable]: { ...prev[enumerable], [name]: value }
    }));
  };

  return (
    <>
      <ModalHeader>
        <div className="flex space-x-4 items-center mb-4">
          <ModalTitle className="m-0 p-0">
            {currentStep === 0
              ? t`Field Mapping`
              : enumFields[currentStep - 1][1].label}
          </ModalTitle>
          {steps > 1 && (
            <span className="ml-auto text-sm text-muted-foreground whitespace-nowrap">
              {t`Step`} {currentStep + 1} {t`of`} {steps}
            </span>
          )}
        </div>

        <ModalDescription>
          {currentStep === 0
            ? t`We auto-matched each column. Review the values below before continuing.`
            : enumFields[currentStep - 1][1].enumData.description}
        </ModalDescription>
      </ModalHeader>
      <ModalBody>
        <div className="mt-6">
          {currentStep === 0 ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              <div className="text-sm">
                <Trans>CSV column</Trans>
              </div>
              <div className="text-sm">
                <Trans>Carbon column</Trans>
              </div>
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

        <div className="flex flex-col w-full gap-2 mt-4">
          {currentStep === steps - 1 && (
            <Submit
              isDisabled={!filePath || fetcher.state !== "idle"}
              type="submit"
            >
              <Trans>Confirm Import</Trans>
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
              <Trans>Next</Trans>
            </Button>
          )}
          {currentStep === 0 && (
            <Button variant="link" type="button" onClick={onReset}>
              <Trans>Choose another file</Trans>
            </Button>
          )}

          {currentStep > 0 && (
            <Button variant="link" type="button" onClick={onPrevious}>
              <Trans>Previous</Trans>
            </Button>
          )}
        </div>
      </ModalBody>
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
  onColumnMappingChange
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
  const { formatDate } = useDateFormatter();
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
            ...(mappedColumn && !required ? ["None"] : [])
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
  onEnumMappingChange
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
  const showReadableId = useCompanySettings()?.showSupplierReadableId ?? false;
  const [options, setOptions] = useState<MatchableOption[]>(() => {
    if ("options" in enumData) {
      return (
        enumData.options.map((option) => ({
          label: option,
          value: option
        })) || []
      );
    } else {
      return [];
    }
  });

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
        setOptions(data.map((item) => toMatchableOption(item, showReadableId)));
      }
    }
  }, [enumData, carbon, company.id, showReadableId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    if ("fetcher" in enumData && carbon) {
      fetchOptions();
    }
  }, [enumData, carbon, company.id, fetchOptions]);

  // Auto-match CSV values to options once when options become available.
  // Ref guard prevents clobbering user edits on re-render.
  const autoMatchedRef = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: one-shot effect
  useEffect(() => {
    if (autoMatchedRef.current) return;
    if (options.length === 0 || uniqueValues.length === 0) return;

    const lookup = buildOptionLookup(options);
    for (const csvValue of uniqueValues) {
      if (mappings[csvValue]) continue;
      const matched = matchCsvValue(lookup, csvValue);
      if (matched) onEnumMappingChange(name, csvValue, matched);
    }
    autoMatchedRef.current = true;
  }, [options, mappedColumn]);

  // Inline create-and-link for name-only lookups (e.g. supplier type). Created
  // ids flow through onEnumMappingChange into enumMappings, so the import
  // payload is unchanged — the edge function only ever sees real ids. The same
  // batch path serves both the per-value combobox create and the "create all
  // missing" banner; the route is idempotent, so values that already exist are
  // linked instead of duplicated.
  const creatableLookup = enumData.creatableLookup;
  const { create: createMissingValues, isCreating } = useCreateLookup({
    lookup: creatableLookup,
    onLinked: (csvValue, id, label) => {
      setOptions((prev) =>
        prev.some((o) => o.value === id)
          ? prev
          : [...prev, { label, value: id }]
      );
      onEnumMappingChange(name, csvValue, id);
    }
  });

  const unmatchedValues = creatableLookup
    ? uniqueValues.filter((csvValue) => !mappings[csvValue])
    : [];

  // Rich lookups (payment term, shipping method) need more than a name, so
  // "create" opens the existing form modal pre-filled with the typed value.
  // Once the refreshed options contain it, the pending CSV value is linked.
  const creatableForm = enumData.creatableForm;
  const permissions = usePermissions();
  const canCreateViaForm =
    !!creatableForm &&
    permissions.can("create", creatableFormPermissions[creatableForm]);
  const formModal = useDisclosure();
  const [formCreatedName, setFormCreatedName] = useState("");
  const pendingFormCsvValueRef = useRef<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: link once options refresh
  useEffect(() => {
    const csvValue = pendingFormCsvValueRef.current;
    if (csvValue === null || !formCreatedName) return;
    const matched = matchCsvValue(buildOptionLookup(options), formCreatedName);
    if (matched) {
      onEnumMappingChange(name, csvValue, matched);
      pendingFormCsvValueRef.current = null;
      setFormCreatedName("");
    }
  }, [options]);

  return (
    <div>
      {creatableLookup && unmatchedValues.length > 0 && (
        <div className="mt-1 mb-4 flex items-center justify-between gap-4 rounded-md border bg-muted/40 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md border bg-background">
              <LuListPlus className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="flex min-w-0 flex-col">
              <span className="text-sm font-medium">
                <Trans>{unmatchedValues.length} values missing</Trans>
              </span>
              <TooltipProvider delayDuration={50}>
                <Tooltip>
                  <TooltipTrigger className="w-fit text-left text-xs text-muted-foreground">
                    <Trans>View missing values</Trans>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-64 p-2 text-sm">
                    {unmatchedValues.join(", ")}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
          <Button
            variant="secondary"
            size="md"
            leftIcon={<LuPlus />}
            disabled={isCreating}
            onClick={() =>
              createMissingValues(unmatchedValues, unmatchedValues)
            }
          >
            <Trans>Create {unmatchedValues.length} values</Trans>
          </Button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-4">
        <div className="font-medium ">
          {`${capitalize(mappedColumn ?? "CSV")} Value`}
        </div>
        <div className="font-medium">
          <Trans>Carbon Value</Trans>
        </div>

        {[...new Set([...uniqueValues, "Default"])].map((csvValue) => {
          const comboboxProps = {
            name: `${name}-${csvValue}`,
            value: mappings[csvValue],
            options,
            // Optional so the combobox shows a clear (×) affordance. Clearing
            // resets the row to empty — this lets a mis-pick be undone, and
            // clearing the Default row sets the field back to "leave blank".
            isOptional: true,
            onChange: (value: { value: string; label: ReactNode } | null) => {
              onEnumMappingChange(name, csvValue, value?.value ?? "");
            }
          };
          return (
            <Fragment key={csvValue}>
              <div className="flex min-w-0 items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1.5">
                  <div className="min-w-0 truncate" title={csvValue}>
                    {csvValue}
                  </div>
                  {csvValue === "Default" && (
                    <TooltipProvider delayDuration={50}>
                      <Tooltip>
                        <TooltipTrigger className="flex-shrink-0">
                          <LuInfo className="text-muted-foreground" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-64 p-2 text-sm">
                          <Trans>
                            Used when a cell is empty or doesn't match an option
                            above. Clear it to leave those rows blank.
                          </Trans>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
                <LuMoveRight className="flex-shrink-0 text-muted-foreground" />
              </div>
              {creatableLookup ? (
                <CreatableCombobox
                  {...comboboxProps}
                  onCreateOption={(inputValue) =>
                    createMissingValues([csvValue], [inputValue])
                  }
                />
              ) : canCreateViaForm ? (
                <CreatableCombobox
                  {...comboboxProps}
                  onCreateOption={(inputValue) => {
                    setFormCreatedName(inputValue);
                    pendingFormCsvValueRef.current = csvValue;
                    formModal.onOpen();
                  }}
                />
              ) : (
                <Combobox {...comboboxProps} />
              )}
            </Fragment>
          );
        })}
      </div>
      {formModal.isOpen && creatableForm === "paymentTerm" && (
        <PaymentTermForm
          type="modal"
          onClose={() => {
            formModal.onClose();
            fetchOptions();
          }}
          initialValues={{
            name: formCreatedName,
            calculationMethod: "Net" as const,
            daysDue: 0,
            discountPercentage: 0,
            daysDiscount: 0
          }}
        />
      )}
      {formModal.isOpen && creatableForm === "shippingMethod" && (
        <ShippingMethodForm
          type="modal"
          onClose={() => {
            formModal.onClose();
            fetchOptions();
          }}
          initialValues={{
            name: formCreatedName,
            carrier: "" as "FedEx"
          }}
        />
      )}
    </div>
  );
}
