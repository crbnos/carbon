// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import {
  Button,
  Checkbox,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  VStack
} from "@carbon/react";
import { parseDate } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { useFetcher } from "react-router";
import {
  DatePicker,
  Select as FormSelect,
  Hidden,
  Input,
  Submit
} from "~/components/Form";
import { useCompanyToday, usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import {
  type ContractDuration,
  contractBillingAlignments,
  contractBillingFrequencies,
  contractBillingTimings,
  contractDurations,
  contractRateUnits,
  createContractFromSalesOrderValidator,
  type customerContractLineKinds
} from "../../sales.models";
import type { SalesOrderLine } from "../../types";
import ContractMoney from "../Contracts/ContractMoney";
import { useContractLabels } from "../Contracts/useContractLabels";

type Kind = (typeof customerContractLineKinds)[number];
type RateUnit = (typeof contractRateUnits)[number];

type LineChoice = { kind: Kind; rateUnit: RateUnit };

type SalesOrderToContractModalProps = {
  orderId: string;
  /** The order's readable id and customer, for the default contract name. */
  salesOrderId: string;
  customerName: string | undefined;
  /** Service lines not yet invoiced at all — the only ones a contract can
   *  take. */
  lines: SalesOrderLine[];
  onClose: () => void;
};

/** Moves an order's Service lines onto a new Draft contract. The order keeps
 *  the lines, marked invoiced, and the contract bills them on its schedule. */
const SalesOrderToContractModal = ({
  orderId,
  salesOrderId,
  customerName,
  lines,
  onClose
}: SalesOrderToContractModalProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher<{}>();
  const companyToday = useCompanyToday();
  const labels = useContractLabels();

  const kindLabels: Record<Kind, string> = {
    "One-time": t`One-time`,
    Recurring: t`Recurring`
  };
  const rateUnitLabels: Record<RateUnit, string> = {
    Day: t`Day`,
    Week: t`Week`,
    Month: t`Month`,
    Quarter: t`Quarter`,
    Year: t`Year`
  };

  // Every eligible line starts selected, as the order's service is usually
  // moving as a whole.
  const [selected, setSelected] = useState<Record<string, LineChoice>>(() =>
    Object.fromEntries(
      lines.flatMap((line) =>
        line.id ? [[line.id, { kind: "One-time", rateUnit: "Month" }]] : []
      )
    )
  );
  const [startDate, setStartDate] = useState(companyToday);
  const [duration, setDuration] = useState<ContractDuration>("12");

  const selectedCount = Object.keys(selected).length;
  const allSelected = lines.length > 0 && selectedCount === lines.length;

  const toggleAll = () => {
    setSelected(
      allSelected
        ? {}
        : Object.fromEntries(
            lines.flatMap((line) =>
              line.id
                ? [
                    [
                      line.id,
                      selected[line.id] ?? {
                        kind: "One-time",
                        rateUnit: "Month"
                      }
                    ]
                  ]
                : []
            )
          )
    );
  };

  const toggle = (lineId: string) => {
    setSelected((prev) => {
      if (lineId in prev) {
        const { [lineId]: _removed, ...rest } = prev;
        return rest;
      }
      return { ...prev, [lineId]: { kind: "One-time", rateUnit: "Month" } };
    });
  };

  const update = (lineId: string, patch: Partial<LineChoice>) => {
    setSelected((prev) => {
      const current = prev[lineId];
      if (!current) return prev;
      return { ...prev, [lineId]: { ...current, ...patch } };
    });
  };

  const linesValue = JSON.stringify(
    Object.entries(selected).map(([salesOrderLineId, choice]) => ({
      salesOrderLineId,
      kind: choice.kind,
      ...(choice.kind === "Recurring" ? { rateUnit: choice.rateUnit } : {})
    }))
  );

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent size="xlarge">
        <ValidatedForm
          validator={createContractFromSalesOrderValidator}
          method="post"
          action={path.to.salesOrderContract(orderId)}
          fetcher={fetcher}
          defaultValues={{
            salesOrderId: orderId,
            name: customerName
              ? `${customerName} — ${salesOrderId}`
              : salesOrderId,
            startDate: companyToday,
            duration: "12",
            billingFrequency: "Month",
            billingAlignment: "Anniversary",
            billingTiming: "Advance"
          }}
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>Create Contract</Trans>
            </ModalTitle>
            <ModalDescription>
              <Trans>
                The chosen Service lines move to a new Draft contract, which
                invoices them on its schedule. The order counts them as
                invoiced.
              </Trans>
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <Hidden name="salesOrderId" value={orderId} />
            <Hidden name="lines" value={linesValue} />
            <VStack spacing={4}>
              <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 md:grid-cols-2">
                <Input name="name" label={t`Name`} />
                <DatePicker
                  name="startDate"
                  label={t`Start Date`}
                  onChange={(date) => setStartDate(date ?? "")}
                />
                <FormSelect
                  name="duration"
                  label={t`Duration`}
                  options={contractDurations.map((value) => ({
                    value,
                    label: labels.duration[value]
                  }))}
                  onChange={(option) =>
                    option && setDuration(option.value as ContractDuration)
                  }
                />
                {duration === "custom" && (
                  <DatePicker
                    name="endDate"
                    label={t`End Date`}
                    minValue={startDate ? parseDate(startDate) : undefined}
                  />
                )}
                <FormSelect
                  name="billingFrequency"
                  label={t`Billing Frequency`}
                  options={contractBillingFrequencies.map((value) => ({
                    value,
                    label: labels.billingFrequency[value]
                  }))}
                />
                <FormSelect
                  name="billingAlignment"
                  label={t`Billing Alignment`}
                  options={contractBillingAlignments.map((value) => ({
                    value,
                    label: labels.billingAlignment[value]
                  }))}
                />
                <FormSelect
                  name="billingTiming"
                  label={t`Billing Timing`}
                  termId="billing-timing"
                  options={contractBillingTimings.map((value) => ({
                    value,
                    label: labels.billingTiming[value]
                  }))}
                />
              </div>

              <VStack
                spacing={2}
                className="w-full border-t border-border pt-4"
              >
                <HStack className="w-full justify-between px-1">
                  <HStack>
                    <Checkbox
                      isChecked={allSelected}
                      isIndeterminate={selectedCount > 0 && !allSelected}
                      onCheckedChange={toggleAll}
                    />
                    <span className="text-xs text-muted-foreground">
                      <Trans>Service lines</Trans>
                    </span>
                  </HStack>
                  {selectedCount > 0 && (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {t`${selectedCount} selected`}
                    </span>
                  )}
                </HStack>
                <div className="max-h-[40dvh] w-full overflow-y-auto">
                  <VStack spacing={2} className="w-full">
                    {lines.map((line) => {
                      if (!line.id) return null;
                      const lineId = line.id;
                      const choice = selected[lineId];
                      return (
                        <HStack
                          key={lineId}
                          className="w-full justify-between p-3 border rounded-lg"
                        >
                          <HStack spacing={3} className="min-w-0">
                            <Checkbox
                              isChecked={!!choice}
                              onCheckedChange={() => toggle(lineId)}
                            />
                            <VStack spacing={0} className="min-w-0 items-start">
                              <span className="text-sm font-medium truncate">
                                {line.itemReadableId}
                              </span>
                              {line.description && (
                                <span className="text-xs text-muted-foreground truncate">
                                  {line.description}
                                </span>
                              )}
                              <span className="text-xs text-muted-foreground tabular-nums">
                                {line.saleQuantity} ×{" "}
                                <ContractMoney value={line.unitPrice} rate />
                              </span>
                            </VStack>
                          </HStack>
                          {choice && (
                            <HStack spacing={2} className="shrink-0">
                              <Select
                                value={choice.kind}
                                onValueChange={(value) =>
                                  update(lineId, { kind: value as Kind })
                                }
                              >
                                <SelectTrigger
                                  size="sm"
                                  className="w-[120px]"
                                  aria-label={t`Kind`}
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {(["One-time", "Recurring"] as const).map(
                                    (kind) => (
                                      <SelectItem key={kind} value={kind}>
                                        {kindLabels[kind]}
                                      </SelectItem>
                                    )
                                  )}
                                </SelectContent>
                              </Select>
                              {choice.kind === "Recurring" && (
                                <Select
                                  value={choice.rateUnit}
                                  onValueChange={(value) =>
                                    update(lineId, {
                                      rateUnit: value as RateUnit
                                    })
                                  }
                                >
                                  <SelectTrigger
                                    size="sm"
                                    className="w-[110px]"
                                    aria-label={t`Per`}
                                  >
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {contractRateUnits.map((unit) => (
                                      <SelectItem key={unit} value={unit}>
                                        {rateUnitLabels[unit]}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              )}
                            </HStack>
                          )}
                        </HStack>
                      );
                    })}
                  </VStack>
                </div>
              </VStack>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Submit
              isDisabled={
                selectedCount === 0 || !permissions.can("create", "sales")
              }
            >
              <Trans>Create Contract</Trans>
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
};

export default SalesOrderToContractModal;
