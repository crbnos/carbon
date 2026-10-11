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
import type { Lease, LeaseScheduleLine } from "./types";
import { firstOpenLeaseMonth, leaseCarryingAt } from "./utils";

type LeaseModifyModalProps = {
  lease: Lease;
  schedule: LeaseScheduleLine[];
  onClose: () => void;
};

/** Remeasure an Active lease from the first day of a lease month: the
 *  remaining payments are cut again from the new terms and re-discounted at
 *  the revised rate, and the right-of-use asset moves with the liability. */
const LeaseModifyModal = ({
  lease,
  schedule,
  onClose
}: LeaseModifyModalProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher<{}>();
  const currencyCode = lease.currencyCode ?? "";
  const decimals = useCurrencyDecimals(currencyCode);

  const defaultEffectiveDate = firstOpenLeaseMonth(lease, schedule) ?? "";
  const [terms, setTerms] = useState({
    effectiveDate: defaultEffectiveDate,
    endDate: lease.endDate ?? "",
    discountRate: Number(lease.discountRate ?? 0),
    paymentAmount: Number(lease.paymentAmount ?? 0),
    paymentFrequency: (lease.paymentFrequency ??
      "Monthly") as LeasePaymentFrequency,
    annualEscalationPercent: Number(lease.annualEscalationPercent ?? 0)
  });

  const isShortTerm = lease.lesseeClassification === "Short-Term";
  const commencementDay = lease.commencementDate?.slice(8) ?? "";
  const moneyFormat = INPUT_FORMAT.money(currencyCode, decimals);
  const moneyStep = INPUT_STEP.money(decimals);

  const preview = (() => {
    if (isShortTerm || !terms.effectiveDate || !terms.endDate) return null;
    if (!lease.paymentTiming) return null;
    const timing = lease.paymentTiming;
    try {
      const carrying = leaseCarryingAt(lease, schedule, terms.effectiveDate);
      const rows = generateLeasePayments({
        commencementDate: terms.effectiveDate,
        endDate: terms.endDate,
        paymentAmount: terms.paymentAmount,
        frequency: terms.paymentFrequency,
        timing,
        annualEscalationPercent: terms.annualEscalationPercent,
        purchaseOptionAmount: lease.purchaseOptionReasonablyCertain
          ? Number(lease.purchaseOptionAmount ?? 0)
          : 0,
        decimals
      });
      const remeasured = remeasureLease({
        carryingLiability: carrying.liability,
        carryingRouAsset: carrying.rouAsset,
        remainingPayments: rows.map((row) => ({
          monthIndex: paymentMonthIndex(row, terms.effectiveDate, timing),
          amount: row.amount
        })),
        annualRate: terms.discountRate
      });
      return { carrying, remeasured };
    } catch {
      return null;
    }
  })();

  const journal: LeaseJournalPreviewRow[] = (() => {
    if (!preview) return [];
    const { adjustment, gain } = preview.remeasured;
    const rouAsset = t`Right-of-Use Asset`;
    const liability = t`Lease Liability`;
    if (adjustment >= 0) {
      return [
        { account: rouAsset, debit: adjustment, credit: 0 },
        { account: liability, debit: 0, credit: adjustment }
      ];
    }
    return [
      { account: liability, debit: -adjustment, credit: 0 },
      { account: rouAsset, debit: 0, credit: -(adjustment + gain) },
      { account: t`Gain on Lease Modification`, debit: 0, credit: gain }
    ];
  })();

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
                The remaining payments are cut again from these terms and
                discounted at the revised rate. The right-of-use asset moves by
                the same amount as the liability.
              </Trans>
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <VStack spacing={4}>
              <DatePicker
                name="effectiveDate"
                label={t`Effective Date`}
                helperText={t`The first day of a lease month (day ${commencementDay}), after the last posted lease run`}
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
              <NumberField
                name="paymentAmount"
                label={t`Payment Amount`}
                minValue={0}
                step={moneyStep}
                formatOptions={moneyFormat}
                onChange={(value) =>
                  setTerms((prev) => ({
                    ...prev,
                    paymentAmount: Number.isNaN(value) ? 0 : value
                  }))
                }
              />
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
              {isShortTerm ? (
                <p className="text-sm text-muted-foreground">
                  <Trans>
                    A short-term lease has no schedule: only its payment rows
                    change, and no journal is posted.
                  </Trans>
                </p>
              ) : preview ? (
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
