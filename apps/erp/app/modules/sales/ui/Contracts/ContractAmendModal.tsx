// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Checkbox,
  cn,
  IconButton,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  NumberField,
  NumberInput,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  useDebounce,
  VStack
} from "@carbon/react";
import type { ContractAmendmentPreview } from "@carbon/server-functions/post-customer-contract";
import { equals, INPUT_FORMAT, INPUT_STEP, round } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { Fragment, useEffect, useState } from "react";
import { LuCircleAlert, LuPlus, LuTriangleAlert, LuX } from "react-icons/lu";
import { useFetcher } from "react-router";
import type { z } from "zod";
import {
  DatePicker,
  Hidden,
  Item,
  Select,
  SelectControlled,
  Submit,
  TextArea
} from "~/components/Form";
import {
  useCompanyToday,
  useCurrencyDecimals,
  useDateFormatter,
  usePermissions
} from "~/hooks";
import {
  type contractAmendmentChangeValidator,
  contractAmendmentEffects,
  contractRateUnits,
  customerContractAmendmentValidator,
  customerContractTypes
} from "../../sales.models";
import ContractMoney from "./ContractMoney";
import type {
  Contract,
  ContractLine,
  ContractRouteData,
  ContractType
} from "./types";
import { useContractLabels } from "./useContractLabels";

type Effect = (typeof contractAmendmentEffects)[number];
type RateUnit = (typeof contractRateUnits)[number];
/** An added line's kind and rate unit as one choice: one-time, or per unit. */
type Billing = "One-time" | RateUnit;
type AmendmentChange = z.infer<typeof contractAmendmentChangeValidator>;

/** An open line as the modal edits it. Percentages in percent points, as the
 *  amendment posts them. */
type LineDraft = {
  quantity: number;
  rate: number;
  discountPercent: number;
  taxPercent: number;
  description: string;
  end: boolean;
};

type AddedLine = {
  key: string;
  itemId: string;
  description: string;
  billing: Billing;
  quantity: number;
  rate: number;
  discountPercent: number;
  taxPercent: number;
};

type PreviewResponse = {
  preview: ContractAmendmentPreview | null;
  error: string | null;
};

type ContractAmendModalProps = Pick<ContractRouteData, "lines"> & {
  contract: Contract;
  action: string;
  onClose: () => void;
};

const toDraft = (line: ContractLine): LineDraft => ({
  quantity: Number(line.quantity),
  rate: Number(line.rate),
  discountPercent: round(Number(line.discountPercent) * 100),
  taxPercent: round(Number(line.taxPercent) * 100),
  description: line.description ?? "",
  end: false
});

const isValidNumber = (value: number, min = 0) =>
  Number.isFinite(value) && value >= min;

/** Amend an Active contract: change, add or end lines from a date. Each edit
 *  is previewed — the amendment runs and rolls back on the server — so the
 *  adjustments and the next invoices are seen before saving. */
const ContractAmendModal = ({
  contract,
  lines,
  action,
  onClose
}: ContractAmendModalProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const today = useCompanyToday();
  const labels = useContractLabels();
  const { formatDate } = useDateFormatter();
  const fetcher = useFetcher<{}>();
  const previewFetcher = useFetcher<PreviewResponse>();

  const id = contract.id!;
  const currencyCode = contract.currencyCode ?? "USD";
  const currencyDecimals = useCurrencyDecimals(currencyCode);
  const rateFormat = INPUT_FORMAT.rate(currencyCode, currencyDecimals);

  // A line that has already ended cannot be amended; a replaced line has.
  const openLines = lines.filter(
    (line) => line.endDate === null || line.endDate >= today
  );
  const lineById = new Map(lines.map((line) => [line.id, line]));
  const nameOf = (lineId: string) => {
    const line = lineById.get(lineId);
    return line
      ? line.description || line.item?.name || line.itemId
      : t`New line`;
  };

  const [amendmentDate, setAmendmentDate] = useState(today);
  const [effect, setEffect] = useState<Effect>("Change Date");
  const [drafts, setDrafts] = useState<Record<string, LineDraft>>(() =>
    Object.fromEntries(openLines.map((line) => [line.id, toDraft(line)]))
  );
  const [added, setAdded] = useState<AddedLine[]>([]);
  const [nextKey, setNextKey] = useState(0);
  const [chosenType, setChosenType] = useState<ContractType | null>(null);
  const [submittedKey, setSubmittedKey] = useState<string | null>(null);

  const updateDraft = (lineId: string, patch: Partial<LineDraft>) =>
    setDrafts((prev) => ({
      ...prev,
      [lineId]: { ...prev[lineId], ...patch }
    }));
  const updateAdded = (key: string, patch: Partial<AddedLine>) =>
    setAdded((prev) =>
      prev.map((line) => (line.key === key ? { ...line, ...patch } : line))
    );
  const addLine = () => {
    setAdded((prev) => [
      ...prev,
      {
        key: `added-${nextKey}`,
        itemId: "",
        description: "",
        billing: contract.billingFrequency ?? "Month",
        quantity: 1,
        rate: 0,
        discountPercent: 0,
        taxPercent: 0
      }
    ]);
    setNextKey((key) => key + 1);
  };

  // The changes as the amendment posts them — only what differs.
  const changes: AmendmentChange[] = [
    ...openLines.flatMap((line): AmendmentChange[] => {
      const draft = drafts[line.id];
      if (!draft) return [];
      if (draft.end) return [{ op: "end", lineId: line.id }];
      const original = toDraft(line);
      const change = {
        ...(!equals(draft.quantity, original.quantity) && {
          quantity: draft.quantity
        }),
        ...(!equals(draft.rate, original.rate) && { rate: draft.rate }),
        ...(!equals(draft.discountPercent, original.discountPercent) && {
          discountPercent: draft.discountPercent
        }),
        ...(!equals(draft.taxPercent, original.taxPercent) && {
          taxPercent: draft.taxPercent
        }),
        ...(draft.description !== original.description && {
          description: draft.description
        })
      };
      return Object.keys(change).length > 0
        ? [{ op: "change", lineId: line.id, ...change }]
        : [];
    }),
    ...added.map(
      (line): AmendmentChange => ({
        op: "add",
        line: {
          kind: line.billing === "One-time" ? "One-time" : "Recurring",
          itemId: line.itemId,
          description: line.description || undefined,
          quantity: line.quantity,
          rate: line.rate,
          rateUnit: line.billing === "One-time" ? undefined : line.billing,
          discountPercent: line.discountPercent,
          taxPercent: line.taxPercent,
          // The server starts it on the effective date when that is later.
          startDate: amendmentDate,
          revenueMethod: "Daily"
        }
      })
    )
  ];

  const isValid =
    !!amendmentDate &&
    Object.values(drafts).every(
      (draft) =>
        draft.end ||
        (isValidNumber(draft.quantity) &&
          draft.quantity > 0 &&
          isValidNumber(draft.rate) &&
          isValidNumber(draft.discountPercent) &&
          isValidNumber(draft.taxPercent))
    ) &&
    added.every(
      (line) =>
        !!line.itemId &&
        isValidNumber(line.quantity) &&
        line.quantity > 0 &&
        isValidNumber(line.rate) &&
        isValidNumber(line.discountPercent) &&
        isValidNumber(line.taxPercent)
    );
  const hasChanges = changes.length > 0;
  const changesJson = JSON.stringify(changes);

  // Preview whenever the amendment changes, once it is complete.
  const previewKey =
    isValid && hasChanges
      ? JSON.stringify({ amendmentDate, effect, changes })
      : null;
  const submitPreview = useDebounce((key: string) => {
    const { amendmentDate, effect, changes } = JSON.parse(key);
    const formData = new FormData();
    formData.set("intent", "preview");
    formData.set("customerContractId", id);
    formData.set("amendmentDate", amendmentDate);
    formData.set("effect", effect);
    formData.set("changes", JSON.stringify(changes));
    setSubmittedKey(key);
    previewFetcher.submit(formData, { method: "post", action });
  }, 500);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key carries every input; the debounced submitter is a new function each render
  useEffect(() => {
    if (previewKey) submitPreview(previewKey);
  }, [previewKey]);

  const isPreviewing =
    previewFetcher.state !== "idle" || submittedKey !== previewKey;
  const preview = previewKey ? previewFetcher.data?.preview : null;
  const previewError = previewKey ? previewFetcher.data?.error : null;
  const isRefused = !isPreviewing && !!previewError;

  // The type follows the preview's suggestion until it is chosen by hand.
  const contractType = chosenType ?? preview?.suggestedType;

  const effectLabels: Record<Effect, string> = {
    "Change Date": t`From the change date`,
    "Next Period": t`From the next billing period`
  };
  const billingLabels: Record<Billing, string> = {
    "One-time": t`One-time`,
    Day: t`Per day`,
    Week: t`Per week`,
    Month: t`Per month`,
    Quarter: t`Per quarter`,
    Year: t`Per year`
  };
  const perUnit: Record<RateUnit, string> = {
    Day: t`per day`,
    Week: t`per week`,
    Month: t`per month`,
    Quarter: t`per quarter`,
    Year: t`per year`
  };

  const period = (start: string, end: string) =>
    `${formatDate(start)} – ${formatDate(end)}`;

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent size="xxlarge">
        <ValidatedForm
          validator={customerContractAmendmentValidator}
          method="post"
          action={action}
          fetcher={fetcher}
          defaultValues={{
            customerContractId: id,
            amendmentDate: today,
            effect: "Change Date"
          }}
          onSubmit={onClose}
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>Amend {contract.customerContractId}</Trans>
            </ModalTitle>
            <ModalDescription>
              <Trans>
                Change, add or end lines from a date. Periods already invoiced
                past it are adjusted on the next invoice.
              </Trans>
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <Hidden name="intent" value="save" />
            <Hidden name="customerContractId" value={id} />
            <Hidden name="changes" value={changesJson} />
            <VStack spacing={4}>
              <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 md:grid-cols-2">
                <DatePicker
                  name="amendmentDate"
                  label={t`Change Date`}
                  onChange={(date) => setAmendmentDate(date ?? "")}
                />
                <Select
                  name="effect"
                  label={t`Takes Effect`}
                  options={contractAmendmentEffects.map((value) => ({
                    value,
                    label: effectLabels[value]
                  }))}
                  onChange={(option) => {
                    const next = contractAmendmentEffects.find(
                      (value) => value === option?.value
                    );
                    if (next) setEffect(next);
                  }}
                />
              </div>

              <Table>
                <Thead>
                  <Tr>
                    <Th className="min-w-[240px]">
                      <Trans>Line</Trans>
                    </Th>
                    <Th className="w-28">
                      <Trans>Quantity</Trans>
                    </Th>
                    <Th className="w-36">
                      <Trans>Rate</Trans>
                    </Th>
                    <Th className="w-36">
                      <Trans>Per</Trans>
                    </Th>
                    <Th className="w-24">
                      <Trans>Discount (%)</Trans>
                    </Th>
                    <Th className="w-24">
                      <Trans>Tax (%)</Trans>
                    </Th>
                    <Th className="w-16 text-center">
                      <Trans>End</Trans>
                    </Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {openLines.length === 0 && added.length === 0 && (
                    <Tr>
                      <Td colSpan={7} className="text-muted-foreground">
                        <Trans>No open lines. Add a line to amend.</Trans>
                      </Td>
                    </Tr>
                  )}
                  {openLines.map((line) => {
                    const draft = drafts[line.id];
                    if (!draft) return null;
                    const isEnded = draft.end;
                    return (
                      <Tr key={line.id}>
                        <Td>
                          <VStack spacing={1}>
                            <span
                              className={cn(
                                "text-xs text-muted-foreground truncate w-full",
                                isEnded && "line-through"
                              )}
                            >
                              {line.item?.name ?? line.itemId}
                            </span>
                            <Input
                              size="sm"
                              aria-label={t`Description`}
                              placeholder={line.item?.name ?? undefined}
                              value={draft.description}
                              isDisabled={isEnded}
                              onChange={(event) =>
                                updateDraft(line.id, {
                                  description: event.target.value
                                })
                              }
                            />
                          </VStack>
                        </Td>
                        <Td>
                          <NumberField
                            aria-label={t`Quantity`}
                            minValue={0}
                            step={INPUT_STEP.quantity}
                            formatOptions={INPUT_FORMAT.quantity}
                            value={draft.quantity}
                            isDisabled={isEnded}
                            onChange={(quantity) =>
                              updateDraft(line.id, { quantity })
                            }
                          >
                            <NumberInput size="sm" />
                          </NumberField>
                        </Td>
                        <Td>
                          <NumberField
                            aria-label={t`Rate`}
                            minValue={0}
                            step={INPUT_STEP.rate}
                            formatOptions={rateFormat}
                            value={draft.rate}
                            isDisabled={isEnded}
                            onChange={(rate) => updateDraft(line.id, { rate })}
                          >
                            <NumberInput size="sm" />
                          </NumberField>
                        </Td>
                        <Td className="text-sm text-muted-foreground whitespace-nowrap">
                          {line.rateUnit
                            ? perUnit[line.rateUnit]
                            : billingLabels["One-time"]}
                        </Td>
                        <Td>
                          <NumberField
                            aria-label={t`Discount (%)`}
                            minValue={0}
                            maxValue={100}
                            step={INPUT_STEP.percent}
                            formatOptions={INPUT_FORMAT.percentPoints}
                            value={draft.discountPercent}
                            isDisabled={isEnded}
                            onChange={(discountPercent) =>
                              updateDraft(line.id, { discountPercent })
                            }
                          >
                            <NumberInput size="sm" />
                          </NumberField>
                        </Td>
                        <Td>
                          <NumberField
                            aria-label={t`Tax (%)`}
                            minValue={0}
                            maxValue={100}
                            step={INPUT_STEP.percent}
                            formatOptions={INPUT_FORMAT.percentPoints}
                            value={draft.taxPercent}
                            isDisabled={isEnded}
                            onChange={(taxPercent) =>
                              updateDraft(line.id, { taxPercent })
                            }
                          >
                            <NumberInput size="sm" />
                          </NumberField>
                        </Td>
                        <Td className="text-center">
                          <Checkbox
                            aria-label={t`End line`}
                            isChecked={isEnded}
                            onCheckedChange={(checked) =>
                              updateDraft(line.id, { end: checked === true })
                            }
                          />
                        </Td>
                      </Tr>
                    );
                  })}
                  {added.map((line) => (
                    <Tr key={line.key}>
                      <Td>
                        <VStack spacing={1}>
                          <Item
                            name={`${line.key}-itemId`}
                            type="Service"
                            onChange={(option) =>
                              updateAdded(line.key, {
                                itemId: option?.value ?? ""
                              })
                            }
                          />
                          <Input
                            size="sm"
                            aria-label={t`Description`}
                            placeholder={t`Description`}
                            value={line.description}
                            onChange={(event) =>
                              updateAdded(line.key, {
                                description: event.target.value
                              })
                            }
                          />
                        </VStack>
                      </Td>
                      <Td>
                        <NumberField
                          aria-label={t`Quantity`}
                          minValue={0}
                          step={INPUT_STEP.quantity}
                          formatOptions={INPUT_FORMAT.quantity}
                          value={line.quantity}
                          onChange={(quantity) =>
                            updateAdded(line.key, { quantity })
                          }
                        >
                          <NumberInput size="sm" />
                        </NumberField>
                      </Td>
                      <Td>
                        <NumberField
                          aria-label={t`Rate`}
                          minValue={0}
                          step={INPUT_STEP.rate}
                          formatOptions={rateFormat}
                          value={line.rate}
                          onChange={(rate) => updateAdded(line.key, { rate })}
                        >
                          <NumberInput size="sm" />
                        </NumberField>
                      </Td>
                      <Td>
                        <SelectControlled
                          name={`${line.key}-billing`}
                          value={line.billing}
                          options={(
                            ["One-time", ...contractRateUnits] as Billing[]
                          ).map((value) => ({
                            value,
                            label: billingLabels[value]
                          }))}
                          onChange={(option) => {
                            const next = (
                              ["One-time", ...contractRateUnits] as Billing[]
                            ).find((value) => value === option?.value);
                            if (next) updateAdded(line.key, { billing: next });
                          }}
                        />
                      </Td>
                      <Td>
                        <NumberField
                          aria-label={t`Discount (%)`}
                          minValue={0}
                          maxValue={100}
                          step={INPUT_STEP.percent}
                          formatOptions={INPUT_FORMAT.percentPoints}
                          value={line.discountPercent}
                          onChange={(discountPercent) =>
                            updateAdded(line.key, { discountPercent })
                          }
                        >
                          <NumberInput size="sm" />
                        </NumberField>
                      </Td>
                      <Td>
                        <NumberField
                          aria-label={t`Tax (%)`}
                          minValue={0}
                          maxValue={100}
                          step={INPUT_STEP.percent}
                          formatOptions={INPUT_FORMAT.percentPoints}
                          value={line.taxPercent}
                          onChange={(taxPercent) =>
                            updateAdded(line.key, { taxPercent })
                          }
                        >
                          <NumberInput size="sm" />
                        </NumberField>
                      </Td>
                      <Td className="text-center">
                        <IconButton
                          aria-label={t`Remove line`}
                          icon={<LuX />}
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setAdded((prev) =>
                              prev.filter((other) => other.key !== line.key)
                            )
                          }
                        />
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
              <Button
                variant="secondary"
                leftIcon={<LuPlus />}
                onClick={addLine}
              >
                <Trans>Add Line</Trans>
              </Button>

              {previewKey && (
                <VStack
                  spacing={3}
                  className={cn(
                    "w-full border-t border-border pt-4",
                    isPreviewing && "opacity-60"
                  )}
                >
                  {isRefused ? (
                    <Alert variant="destructive">
                      <LuCircleAlert className="h-4 w-4" />
                      <AlertTitle>
                        <Trans>This amendment cannot be made</Trans>
                      </AlertTitle>
                      <AlertDescription>{previewError}</AlertDescription>
                    </Alert>
                  ) : preview ? (
                    <AmendmentPreview
                      preview={preview}
                      currencyCode={currencyCode}
                      nameOf={nameOf}
                      period={period}
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      <Trans>Previewing the amendment…</Trans>
                    </p>
                  )}
                </VStack>
              )}

              <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 md:grid-cols-2 border-t border-border pt-4">
                <SelectControlled
                  name="contractType"
                  label={t`Contract Type`}
                  helperText={t`Suggested from the change in recurring value`}
                  value={contractType}
                  options={customerContractTypes.map((value) => ({
                    value,
                    label: labels.contractType[value]
                  }))}
                  onChange={(option) => {
                    const next = customerContractTypes.find(
                      (value) => value === option?.value
                    );
                    if (next) setChosenType(next);
                  }}
                />
                <TextArea name="reason" label={t`Reason`} />
              </div>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Submit
              isDisabled={
                !hasChanges ||
                !isValid ||
                isRefused ||
                !permissions.can("update", "sales")
              }
            >
              <Trans>Amend</Trans>
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
};

/** The amendment's effect before it is saved: the effective date, the
 *  adjustments to periods already invoiced, and the next two invoices. */
function AmendmentPreview({
  preview,
  currencyCode,
  nameOf,
  period
}: {
  preview: ContractAmendmentPreview;
  currencyCode: string;
  nameOf: (lineId: string) => string;
  period: (start: string, end: string) => string;
}) {
  const { formatDate } = useDateFormatter();
  const effectiveDate = formatDate(preview.effectiveDate);
  const resets = preview.resetsEditedInvoices;

  return (
    <>
      <p className="text-sm text-muted-foreground">
        <Trans>Takes effect {effectiveDate}.</Trans>
      </p>
      {resets > 0 && (
        <Alert variant="warning">
          <LuTriangleAlert className="h-4 w-4" />
          <AlertTitle>
            {resets === 1 ? (
              <Trans>This resets 1 edited invoice from {effectiveDate}</Trans>
            ) : (
              <Trans>
                This resets {resets} edited invoices from {effectiveDate}
              </Trans>
            )}
          </AlertTitle>
          <AlertDescription>
            <Trans>
              Their dates and splits are planned again from the lines.
            </Trans>
          </AlertDescription>
        </Alert>
      )}
      <Table>
        <Thead>
          <Tr>
            <Th>
              <Trans>Line</Trans>
            </Th>
            <Th>
              <Trans>Period</Trans>
            </Th>
            <Th className="text-right">
              <Trans>Amount</Trans>
            </Th>
          </Tr>
        </Thead>
        <Tbody>
          {preview.adjustments.length > 0 && (
            <>
              <Tr>
                <Td colSpan={3} className="font-medium">
                  <Trans>Adjustments</Trans>
                </Td>
              </Tr>
              {preview.adjustments.map((row, index) => (
                <Tr key={`adjustment-${index}`}>
                  <Td className="truncate">{nameOf(row.lineId)}</Td>
                  <Td className="tabular-nums whitespace-nowrap">
                    {period(row.periodStart, row.periodEnd)}
                  </Td>
                  <Td className="text-right">
                    <ContractMoney
                      value={row.amount}
                      currencyCode={currencyCode}
                    />
                  </Td>
                </Tr>
              ))}
            </>
          )}
          {preview.nextInvoices.length === 0 ? (
            <Tr>
              <Td colSpan={3} className="text-muted-foreground">
                <Trans>No invoices planned after the change.</Trans>
              </Td>
            </Tr>
          ) : (
            preview.nextInvoices.map((invoice) => {
              const invoiceDate = formatDate(invoice.invoiceDate);
              return (
                <Fragment key={invoice.invoiceDate}>
                  <Tr>
                    <Td colSpan={2} className="font-medium">
                      <Trans>Invoice {invoiceDate}</Trans>
                    </Td>
                    <Td className="text-right font-medium">
                      <ContractMoney
                        value={invoice.total}
                        currencyCode={currencyCode}
                      />
                    </Td>
                  </Tr>
                  {invoice.rows.map((row, index) => (
                    <Tr key={`${invoice.invoiceDate}-${index}`}>
                      <Td>
                        <span className="flex items-center gap-2 min-w-0">
                          <span className="truncate">{nameOf(row.lineId)}</span>
                          {row.isAdjustment && (
                            <Badge variant="secondary" className="shrink-0">
                              <Trans>Adjustment</Trans>
                            </Badge>
                          )}
                        </span>
                      </Td>
                      <Td className="tabular-nums whitespace-nowrap">
                        {period(row.periodStart, row.periodEnd)}
                      </Td>
                      <Td className="text-right">
                        <ContractMoney
                          value={row.amount}
                          currencyCode={currencyCode}
                        />
                      </Td>
                    </Tr>
                  ))}
                </Fragment>
              );
            })
          )}
        </Tbody>
      </Table>
    </>
  );
}

export default ContractAmendModal;
