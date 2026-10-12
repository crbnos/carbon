// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  VStack
} from "@carbon/react";
import {
  generateLeasePayments,
  INPUT_FORMAT,
  INPUT_STEP,
  type LeasePaymentFrequency,
  paymentMonthIndex,
  remeasureLease
} from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { useFetcher } from "react-router";
import {
  DatePicker,
  Hidden,
  Number as NumberField,
  Select,
  Submit,
  TextArea
} from "~/components/Form";
import { useCurrencyDecimals, usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import {
  leaseModifyValidator,
  leasePaymentFrequencies
} from "../../purchasing.models";
import LeaseJournalPreview, {
  type LeaseJournalPreviewRow
} from "./LeaseJournalPreview";
import type { Lease, LeaseLine, LeaseScheduleLine } from "./types";
import { firstOpenLeaseMonth, leaseCarryingAt } from "./utils";

type LeaseModifyModalProps = {
  lease: Lease;
  lines: LeaseLine[];
  schedule: LeaseScheduleLine[];
  onClose: () => void;
};

/** Remeasure every active asset of an Active lease from the first day of a
 *  lease month: each asset's remaining payments are cut again from the new
 *  terms at its own payment and re-discounted at the revised rate, and its
 *  right-of-use asset moves with its liability. */
const LeaseModifyModal = ({
  lease,
  lines,
  schedule,
  onClose
}: LeaseModifyModalProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher<{}>();
  const currencyCode = lease.currencyCode ?? "";
  const decimals = useCurrencyDecimals(currencyCode);

  const active = lines.filter((line) => line.status === "Active");
  const activeIds = active.map((line) => line.id);
  const defaultEffectiveDate =
    firstOpenLeaseMonth(
      lease,
      schedule.filter((row) => activeIds.includes(row.leaseLineId))
    ) ?? "";
  const [terms, setTerms] = useState({
    effectiveDate: defaultEffectiveDate,
    endDate: lease.endDate ?? "",
    discountRate: Number(lease.discountRate ?? 0),
    paymentFrequency: (lease.paymentFrequency ??
      "Monthly") as LeasePaymentFrequency,
    annualEscalationPercent: Number(lease.annualEscalationPercent ?? 0)
  });
  const [paymentOf, setPaymentOf] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      active.map((line) => [line.id, Number(line.paymentAmount)])
    )
  );

  const commencementDay = lease.commencementDate?.slice(8) ?? "";
  const moneyFormat = INPUT_FORMAT.money(currencyCode, decimals);
  const moneyStep = INPUT_STEP.money(decimals);
  const severalAssets = active.length > 1;

  // Each capitalized asset's remeasurement; a short-term asset only has its
  // payment rows cut again.
  const remeasured = (() => {
    if (!terms.effectiveDate || !terms.endDate || !lease.paymentTiming) {
      return null;
    }
    const timing = lease.paymentTiming;
    try {
      return active
        .filter((line) => line.lesseeClassification !== "Short-Term")
        .map((line) => {
          const carrying = leaseCarryingAt(line, schedule, terms.effectiveDate);
          const rows = generateLeasePayments({
            commencementDate: terms.effectiveDate,
            endDate: terms.endDate,
            paymentAmount: paymentOf[line.id] ?? 0,
            frequency: terms.paymentFrequency,
            timing,
            annualEscalationPercent: terms.annualEscalationPercent,
            purchaseOptionAmount: line.purchaseOptionReasonablyCertain
              ? Number(line.purchaseOptionAmount ?? 0)
              : 0,
            decimals
          }).filter((row) => row.amount > 0);
          return {
            line,
            result: remeasureLease({
              carryingLiability: carrying.liability,
              carryingRouAsset: carrying.rouAsset,
              remainingPayments: rows.map((row) => ({
                monthIndex: paymentMonthIndex(row, terms.effectiveDate, timing),
                amount: row.amount
              })),
              annualRate: terms.discountRate
            })
          };
        });
    } catch {
      return null;
    }
  })();

  const journal: LeaseJournalPreviewRow[] = (remeasured ?? []).flatMap(
    ({ line, result }) => {
      const { adjustment, gain } = result;
      if (adjustment === 0 && gain === 0) return [];
      const suffix = severalAssets ? ` — ${line.description}` : "";
      const rouAsset = `${t`Right-of-Use Asset`}${suffix}`;
      const liability = `${t`Lease Liability`}${suffix}`;
      if (adjustment >= 0) {
        return [
          { account: rouAsset, debit: adjustment, credit: 0 },
          { account: liability, debit: 0, credit: adjustment }
        ];
      }
      return [
        { account: liability, debit: -adjustment, credit: 0 },
        { account: rouAsset, debit: 0, credit: -(adjustment + gain) },
        {
          account: `${t`Gain on Lease Modification`}${suffix}`,
          debit: 0,
          credit: gain
        }
      ];
    }
  );

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalOverlay />
      <ModalContent>
        <ValidatedForm
          validator={leaseModifyValidator}
          method="post"
          action={path.to.leaseModify(lease.id!)}
          fetcher={fetcher}
          defaultValues={{
            ...terms,
            lines: active.map((line) => ({
              leaseLineId: line.id,
              paymentAmount: Number(line.paymentAmount)
            })),
            notes: ""
          }}
          onSubmit={onClose}
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>Modify {lease.leaseId}</Trans>
            </ModalTitle>
            <ModalDescription>
              <Trans>
                Each active asset's remaining payments are cut again from these
                terms and discounted at the revised rate. Its right-of-use asset
                moves by the same amount as its liability.
              </Trans>
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <VStack spacing={4}>
              <DatePicker
                name="effectiveDate"
                label={t`Effective Date`}
                helperText={t`The first day of a lease month (day ${commencementDay}) where a payment period starts, after the last posted lease run`}
                onChange={(date) =>
                  setTerms((prev) => ({ ...prev, effectiveDate: date ?? "" }))
                }
              />
              <DatePicker
                name="endDate"
                label={t`End Date`}
                onChange={(date) =>
                  setTerms((prev) => ({ ...prev, endDate: date ?? "" }))
                }
              />
              {active.map((line, index) => (
                <div key={line.id} className="w-full">
                  <Hidden
                    name={`lines[${index}].leaseLineId`}
                    value={line.id}
                  />
                  <NumberField
                    name={`lines[${index}].paymentAmount`}
                    label={
                      severalAssets
                        ? t`Payment — ${line.description}`
                        : t`Payment Amount`
                    }
                    minValue={0}
                    step={moneyStep}
                    formatOptions={moneyFormat}
                    onChange={(value) =>
                      setPaymentOf((prev) => ({
                        ...prev,
                        [line.id]: Number.isNaN(value) ? 0 : value
                      }))
                    }
                  />
                </div>
              ))}
              <Select
                name="paymentFrequency"
                label={t`Payment Frequency`}
                options={leasePaymentFrequencies.map((frequency) => ({
                  value: frequency,
                  label:
                    frequency === "Monthly"
                      ? t`Monthly`
                      : frequency === "Quarterly"
                        ? t`Quarterly`
                        : t`Annual`
                }))}
                onChange={(option) => {
                  if (option?.value) {
                    setTerms((prev) => ({
                      ...prev,
                      paymentFrequency: option.value as LeasePaymentFrequency
                    }));
                  }
                }}
              />
              <NumberField
                name="annualEscalationPercent"
                label={t`Annual Escalation (%)`}
                minValue={0}
                step={INPUT_STEP.percent}
                formatOptions={INPUT_FORMAT.percentPoints}
                onChange={(value) =>
                  setTerms((prev) => ({
                    ...prev,
                    annualEscalationPercent: Number.isNaN(value) ? 0 : value
                  }))
                }
              />
              <NumberField
                name="discountRate"
                label={t`Discount Rate (%)`}
                helperText={t`The rate at the effective date`}
                minValue={0}
                step={INPUT_STEP.percent}
                formatOptions={INPUT_FORMAT.percentPoints}
                onChange={(value) =>
                  setTerms((prev) => ({
                    ...prev,
                    discountRate: Number.isNaN(value) ? 0 : value
                  }))
                }
              />
              <TextArea name="notes" label={t`Notes`} />
              {remeasured && remeasured.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  <Trans>
                    A short-term asset has no schedule: only its payment rows
                    change, and no journal is posted.
                  </Trans>
                </p>
              ) : journal.length > 0 ? (
                <VStack spacing={2}>
                  <p className="text-sm text-muted-foreground">
                    <Trans>
                      Remeasurement journal (the effective date and the
                      classification are checked when you confirm):
                    </Trans>
                  </p>
                  <LeaseJournalPreview
                    rows={journal}
                    currencyCode={currencyCode}
                  />
                </VStack>
              ) : null}
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Submit isDisabled={!permissions.can("update", "purchasing")}>
              <Trans>Modify Lease</Trans>
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
};

export default LeaseModifyModal;
