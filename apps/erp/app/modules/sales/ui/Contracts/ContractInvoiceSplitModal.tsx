// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import {
  Button,
  DatePicker,
  HStack,
  IconButton,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  NumberField,
  NumberInput,
  VStack
} from "@carbon/react";
import { equals, INPUT_FORMAT, INPUT_STEP, round } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuPlus, LuX } from "react-icons/lu";
import { useFetcher } from "react-router";
import { Hidden, Submit } from "~/components/Form";
import { useCurrencyDecimals, useDateFormatter, usePermissions } from "~/hooks";
import { customerContractScheduleEditValidator } from "../../sales.models";
import ContractMoney from "./ContractMoney";

/** The schedule row being split, in the terms the modal shows it. */
export type ContractSplitRow = {
  /** The row's id, or its planned ref while the schedule is computed. */
  ref: string;
  lineName: string;
  periodStart: string;
  periodEnd: string;
  invoiceDate: string;
  amount: number;
};

type Installment = { invoiceDate: string | null; amount: number };

type ContractInvoiceSplitModalProps = {
  action: string;
  row: ContractSplitRow;
  currencyCode: string;
  onClose: () => void;
};

/** `count` installments of `total`, at internal scale, the last carrying the
 *  rounding so they sum to it exactly. */
function spread(total: number, count: number): number[] {
  const each = round(total / count);
  return Array.from({ length: count }, (_, index) =>
    index === count - 1 ? round(total - each * (count - 1)) : each
  );
}

const nextMonth = (date: string) =>
  parseDate(date).add({ months: 1 }).toString();

/** Split one schedule row into installments on dates of your choosing. The
 *  installments must place the row's whole amount — the server function
 *  refuses anything else — so the residual is shown live. */
const ContractInvoiceSplitModal = ({
  action,
  row,
  currencyCode,
  onClose
}: ContractInvoiceSplitModalProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher<{}>();
  const { formatDate } = useDateFormatter();
  const currencyDecimals = useCurrencyDecimals(currencyCode);

  const [installments, setInstallments] = useState<Installment[]>(() => {
    const [first, second] = spread(row.amount, 2);
    return [
      { invoiceDate: row.invoiceDate, amount: first },
      { invoiceDate: nextMonth(row.invoiceDate), amount: second }
    ];
  });

  const placed = installments.reduce(
    (sum, installment) =>
      sum + (Number.isFinite(installment.amount) ? installment.amount : 0),
    0
  );
  const left = round(row.amount - placed);
  const isBalanced = equals(left, 0);
  const hasAllDates = installments.every((i) => !!i.invoiceDate);

  const update = (index: number, patch: Partial<Installment>) =>
    setInstallments((prev) =>
      prev.map((installment, i) =>
        i === index ? { ...installment, ...patch } : installment
      )
    );

  const add = () =>
    setInstallments((prev) => {
      const last = prev[prev.length - 1]?.invoiceDate ?? row.invoiceDate;
      return [
        ...prev,
        { invoiceDate: nextMonth(last), amount: Math.max(left, 0) }
      ];
    });

  const remove = (index: number) =>
    setInstallments((prev) => prev.filter((_, i) => i !== index));

  const spreadEvenly = () =>
    setInstallments((prev) => {
      const amounts = spread(row.amount, prev.length);
      return prev.map((installment, i) => ({
        ...installment,
        amount: amounts[i]
      }));
    });

  const rateFormat = INPUT_FORMAT.rate(currencyCode, currencyDecimals);

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent size="medium">
        <ValidatedForm
          validator={customerContractScheduleEditValidator}
          method="post"
          action={action}
          fetcher={fetcher}
          defaultValues={{
            intent: "split",
            customerContractInvoiceLineId: row.ref
          }}
          onSubmit={onClose}
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>Split {row.lineName}</Trans>
            </ModalTitle>
            <ModalDescription>
              <span className="tabular-nums">
                {formatDate(row.periodStart)} – {formatDate(row.periodEnd)}
              </span>
              {" · "}
              <ContractMoney value={row.amount} currencyCode={currencyCode} />
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <Hidden name="intent" value="split" />
            <Hidden name="customerContractInvoiceLineId" value={row.ref} />
            <Hidden
              name="installments"
              value={JSON.stringify(
                installments.map((installment) => ({
                  invoiceDate: installment.invoiceDate ?? "",
                  amount: Number.isFinite(installment.amount)
                    ? installment.amount
                    : 0
                }))
              )}
            />
            <VStack spacing={3}>
              <HStack className="w-full px-1 text-xs text-muted-foreground">
                <span className="flex-1">
                  <Trans>Invoice Date</Trans>
                </span>
                <span className="w-40 shrink-0">
                  <Trans>Amount</Trans>
                </span>
                <span className="w-8 shrink-0" />
              </HStack>
              {installments.map((installment, index) => (
                <HStack key={index} className="w-full">
                  <div className="flex-1 min-w-0">
                    <DatePicker
                      aria-label={t`Invoice date ${index + 1}`}
                      value={
                        installment.invoiceDate
                          ? parseDate(installment.invoiceDate)
                          : null
                      }
                      onChange={(date) =>
                        update(index, {
                          invoiceDate: date ? date.toString() : null
                        })
                      }
                    />
                  </div>
                  <div className="w-40 shrink-0">
                    <NumberField
                      aria-label={t`Amount ${index + 1}`}
                      formatOptions={rateFormat}
                      step={INPUT_STEP.rate}
                      value={installment.amount}
                      onChange={(amount) => update(index, { amount })}
                    >
                      <NumberInput size="md" />
                    </NumberField>
                  </div>
                  <IconButton
                    aria-label={t`Remove installment`}
                    icon={<LuX />}
                    variant="ghost"
                    className="shrink-0"
                    isDisabled={installments.length <= 2}
                    onClick={() => remove(index)}
                  />
                </HStack>
              ))}
              <HStack className="w-full justify-between">
                <HStack spacing={2}>
                  <Button
                    variant="secondary"
                    leftIcon={<LuPlus />}
                    onClick={add}
                  >
                    <Trans>Add Installment</Trans>
                  </Button>
                  <Button variant="ghost" onClick={spreadEvenly}>
                    <Trans>Spread Evenly</Trans>
                  </Button>
                </HStack>
                <span
                  className={
                    isBalanced
                      ? "text-sm text-muted-foreground"
                      : "text-sm text-destructive"
                  }
                >
                  {isBalanced ? (
                    <Trans>Every amount placed</Trans>
                  ) : left > 0 ? (
                    <Trans>
                      <ContractMoney value={left} currencyCode={currencyCode} />{" "}
                      left to place
                    </Trans>
                  ) : (
                    <Trans>
                      <ContractMoney
                        value={-left}
                        currencyCode={currencyCode}
                      />{" "}
                      over the row's amount
                    </Trans>
                  )}
                </span>
              </HStack>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Submit
              isDisabled={
                !isBalanced ||
                !hasAllDates ||
                !permissions.can("update", "sales")
              }
            >
              <Trans>Split</Trans>
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
};

export default ContractInvoiceSplitModal;
