import { ValidatedForm } from "@carbon/form";
import {
  HStack,
  IconButton,
  Input as InputBase,
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerFooter,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle,
  NumberField,
  NumberInput,
  Status,
  toast,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { Fragment, useEffect, useState } from "react";
import { LuPlus, LuTrash } from "react-icons/lu";
import { useFetcher } from "react-router";
import type { z } from "zod";
import {
  AccountControlled,
  Boolean,
  DatePicker,
  Hidden,
  Input,
  Select,
  Submit
} from "~/components/Form";
import { usePermissions, useUser } from "~/hooks";
import { useCurrencyFormatter } from "~/hooks/useCurrencyFormatter";
import { path } from "~/utils/path";
import {
  recurringJournalFrequencies,
  recurringJournalTemplateValidator
} from "../../accounting.models";

type RecurringJournalFormProps = {
  initialValues: z.infer<typeof recurringJournalTemplateValidator>;
  type?: "modal" | "drawer";
  open?: boolean;
  onClose: () => void;
};

type ClientLine = {
  key: string;
  id?: string;
  accountId: string;
  description: string;
  debit: number | null;
  credit: number | null;
};

function generateKey() {
  return Math.random().toString(36).substring(2, 9);
}

function createEmptyLine(): ClientLine {
  return {
    key: generateKey(),
    accountId: "",
    description: "",
    debit: null,
    credit: null
  };
}

const RecurringJournalForm = ({
  initialValues,
  open = true,
  type = "drawer",
  onClose
}: RecurringJournalFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher<PostgrestResponse<{ id: string }>>();
  const { company } = useUser();
  const currencyFormatter = useCurrencyFormatter({
    currency: company.baseCurrencyCode
  });

  const [lines, setLines] = useState<ClientLine[]>(() => {
    if (!initialValues.lines || initialValues.lines.length === 0) {
      return [createEmptyLine(), createEmptyLine()];
    }
    return initialValues.lines.map((line) => ({
      key: generateKey(),
      id: line.id,
      accountId: line.accountId ?? "",
      description: line.description ?? "",
      debit: line.debit || null,
      credit: line.credit || null
    }));
  });

  useEffect(() => {
    if (type !== "modal") return;
    if (fetcher.state === "loading" && fetcher.data?.data) {
      onClose?.();
      toast.success(t`Created recurring journal`);
    } else if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(t`Failed to create recurring journal`);
    }
  }, [fetcher.data, fetcher.state, onClose, type, t]);

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "accounting")
    : !permissions.can("create", "accounting");

  const frequencyOptions = recurringJournalFrequencies.map((v) => ({
    label: v,
    value: v
  }));

  const totalDebits = lines.reduce((sum, line) => sum + (line.debit || 0), 0);
  const totalCredits = lines.reduce((sum, line) => sum + (line.credit || 0), 0);
  const difference = totalDebits - totalCredits;
  const isBalanced = Math.abs(difference) < 0.001 && totalDebits > 0;

  const handleAddLine = () => {
    setLines((prev) => [...prev, createEmptyLine()]);
  };

  const handleDeleteLine = (key: string) => {
    setLines((prev) => {
      if (prev.length <= 2) return prev;
      return prev.filter((line) => line.key !== key);
    });
  };

  const updateLine = (key: string, patch: Partial<ClientLine>) => {
    setLines((prev) =>
      prev.map((line) => (line.key === key ? { ...line, ...patch } : line))
    );
  };

  return (
    <ModalDrawerProvider type={type}>
      <ModalDrawer
        open={open}
        onOpenChange={(open) => {
          if (!open) onClose?.();
        }}
      >
        <ModalDrawerContent size="lg">
          <ValidatedForm
            validator={recurringJournalTemplateValidator}
            method="post"
            action={
              isEditing
                ? path.to.recurringJournal(initialValues.id!)
                : path.to.newRecurringJournal
            }
            defaultValues={initialValues}
            fetcher={fetcher}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? (
                  <Trans>Edit Recurring Journal</Trans>
                ) : (
                  <Trans>New Recurring Journal</Trans>
                )}
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <Hidden name="type" value={type} />
              {lines.map((line, index) => (
                <Fragment key={line.key}>
                  <input
                    type="hidden"
                    name={`lines[${index}].id`}
                    value={line.id ?? ""}
                  />
                  <input
                    type="hidden"
                    name={`lines[${index}].accountId`}
                    value={line.accountId}
                  />
                  <input
                    type="hidden"
                    name={`lines[${index}].description`}
                    value={line.description}
                  />
                  <input
                    type="hidden"
                    name={`lines[${index}].debit`}
                    value={line.debit ?? 0}
                  />
                  <input
                    type="hidden"
                    name={`lines[${index}].credit`}
                    value={line.credit ?? 0}
                  />
                  <input
                    type="hidden"
                    name={`lines[${index}].sortOrder`}
                    value={index}
                  />
                </Fragment>
              ))}
              <VStack spacing={4}>
                <Input name="name" label={t`Name`} />
                <Input name="description" label={t`Description`} />
                <Select
                  name="frequency"
                  label={t`Frequency`}
                  options={frequencyOptions}
                />
                <DatePicker name="nextRunDate" label={t`Next Run Date`} />
                <DatePicker name="endDate" label={t`End Date`} />
                <Boolean name="active" label={t`Active`} />

                <div className="w-full">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-medium">
                      <Trans>Lines</Trans>
                    </span>
                    {isBalanced ? (
                      <Status color="green">
                        <Trans>Balanced</Trans>
                      </Status>
                    ) : (
                      <Status color="yellow">
                        <Trans>Unbalanced</Trans>
                      </Status>
                    )}
                  </div>
                  <div className="rounded-lg border border-border divide-y divide-border">
                    {lines.map((line) => (
                      <div key={line.key} className="p-3 space-y-2">
                        <AccountControlled
                          value={line.accountId}
                          onChange={(accountId) =>
                            updateLine(line.key, { accountId: accountId ?? "" })
                          }
                          placeholder={t`Select account`}
                          isReadOnly={isDisabled}
                        />
                        <InputBase
                          placeholder={t`Line description (optional)`}
                          value={line.description}
                          onChange={(e) =>
                            updateLine(line.key, {
                              description: e.target.value
                            })
                          }
                          isReadOnly={isDisabled}
                          size="sm"
                        />
                        <div className="grid grid-cols-[1fr_1fr_40px] items-center gap-2">
                          <NumberField
                            value={line.debit ?? 0}
                            onChange={(value) =>
                              updateLine(line.key, {
                                debit: isNaN(value) ? null : value,
                                credit:
                                  !isNaN(value) && value > 0
                                    ? null
                                    : line.credit
                              })
                            }
                            formatOptions={{
                              style: "currency",
                              currency: company.baseCurrencyCode
                            }}
                            minValue={0}
                            isDisabled={isDisabled}
                          >
                            <NumberInput
                              aria-label={t`Debit`}
                              className="text-right font-mono tabular-nums"
                            />
                          </NumberField>
                          <NumberField
                            value={line.credit ?? 0}
                            onChange={(value) =>
                              updateLine(line.key, {
                                credit: isNaN(value) ? null : value,
                                debit:
                                  !isNaN(value) && value > 0 ? null : line.debit
                              })
                            }
                            formatOptions={{
                              style: "currency",
                              currency: company.baseCurrencyCode
                            }}
                            minValue={0}
                            isDisabled={isDisabled}
                          >
                            <NumberInput
                              aria-label={t`Credit`}
                              className="text-right font-mono tabular-nums"
                            />
                          </NumberField>
                          <IconButton
                            aria-label={t`Delete line`}
                            icon={<LuTrash />}
                            variant="ghost"
                            onClick={() => handleDeleteLine(line.key)}
                            isDisabled={isDisabled || lines.length <= 2}
                          />
                        </div>
                      </div>
                    ))}
                    {!isDisabled && (
                      <button
                        type="button"
                        onClick={handleAddLine}
                        className="flex w-full items-center justify-center gap-2 py-2.5 text-sm text-muted-foreground hover:bg-muted/30 hover:text-foreground transition-colors"
                      >
                        <LuPlus className="size-3.5" />
                        <Trans>Add Line</Trans>
                      </button>
                    )}
                    <div className="grid grid-cols-[1fr_1fr_40px] items-center gap-2 bg-muted/50 px-3 py-2 text-right font-mono text-sm tabular-nums">
                      <span>{currencyFormatter.format(totalDebits)}</span>
                      <span>{currencyFormatter.format(totalCredits)}</span>
                      <span />
                    </div>
                  </div>
                </div>
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={isDisabled}>
                  <Trans>Save</Trans>
                </Submit>
              </HStack>
            </ModalDrawerFooter>
          </ValidatedForm>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
};

export default RecurringJournalForm;
