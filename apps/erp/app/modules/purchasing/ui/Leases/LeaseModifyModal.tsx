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
  INPUT_FORMAT,
  INPUT_STEP,
  lesseeRemeasurementLegs
} from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { useFetcher } from "react-router";
import {
  DatePicker,
  Hidden,
  NumberControlled,
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
import LeaseJournalPreview from "./LeaseJournalPreview";
import type {
  Lease,
  LeaseLine,
  LeasePayment,
  LeaseScheduleLine
} from "./types";
import { useLeaseFrequencyLabel, useLeaseLegLabel } from "./useLeaseLabels";
import {
  firstOpenLeaseMonth,
  type LeaseModifyTerms,
  leaseJournalRows,
  leaseModifyPaymentAt,
  leaseModifyPreview,
  shortTermPastTwelveMonths
} from "./utils";

type LeaseModifyModalProps = {
  lease: Lease;
  lines: LeaseLine[];
  payments: LeasePayment[];
  schedule: LeaseScheduleLine[];
  onClose: () => void;
};

/** Remeasure every active asset of an Active lease from the first day of a
 *  lease month: each asset's remaining payments are cut again from the new
 *  terms — still on the commencement's months and anniversaries — at the
 *  payment it pays from the effective date, and re-discounted at the revised
 *  rate; its right-of-use asset moves with its liability. */
const LeaseModifyModal = ({
  lease,
  lines,
  payments,
  schedule,
  onClose
}: LeaseModifyModalProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher<{}>();
  const currencyCode = lease.currencyCode ?? "";
  const decimals = useCurrencyDecimals(currencyCode);
  const frequencyLabel = useLeaseFrequencyLabel();
  const legLabel = useLeaseLegLabel();

  const active = lines.filter((line) => line.status === "Active");
  const activeIds = new Set(active.map((line) => line.id));

  // Only what the user typed is state; every default comes from the lease.
  const [termsInput, setTermsInput] = useState<Partial<LeaseModifyTerms>>({});
  const [paymentInput, setPaymentInput] = useState<Record<string, number>>({});
  const defaults: LeaseModifyTerms = {
    effectiveDate:
      firstOpenLeaseMonth(
        lease,
        schedule.filter((row) => activeIds.has(row.leaseLineId))
      ) ?? "",
    endDate: lease.endDate ?? "",
    discountRate: Number(lease.discountRate ?? 0),
    paymentFrequency:
      leasePaymentFrequencies.find(
        (frequency) => frequency === lease.paymentFrequency
      ) ?? "Monthly",
    annualEscalationPercent: Number(lease.annualEscalationPercent ?? 0)
  };
  const terms: LeaseModifyTerms = { ...defaults, ...termsInput };
  const setTerm = (next: Partial<LeaseModifyTerms>) =>
    setTermsInput((prev) => ({ ...prev, ...next }));

  // The payment entered is the one the asset pays from the effective date:
  // until it is typed over, the rate it pays then, escalated on each
  // anniversary of the commencement.
  const paymentOf = (line: LeaseLine) =>
    paymentInput[line.id] ??
    (terms.effectiveDate
      ? leaseModifyPaymentAt(lease, line, terms.effectiveDate, decimals)
      : Number(line.paymentAmount));

  const commencementDay = lease.commencementDate?.slice(8) ?? "";
  const moneyFormat = INPUT_FORMAT.money(currencyCode, decimals);
  const moneyStep = INPUT_STEP.money(decimals);
  const severalAssets = active.length > 1;
  const shortTermTooLong = shortTermPastTwelveMonths(
    lease,
    active,
    terms.endDate
  );

  const remeasured = leaseModifyPreview({
    lease,
    lines: active,
    payments,
    schedule,
    terms,
    paymentOf,
    decimals
  });
  const journal = (remeasured ?? []).flatMap(({ line, result }) => {
    const suffix = severalAssets ? ` — ${line.description}` : "";
    return leaseJournalRows(
      lesseeRemeasurementLegs({
        adjustment: result.adjustment,
        gain: result.gain
      }),
      (leg) => `${legLabel(leg.account, "modification")}${suffix}`
    );
  });

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
              paymentAmount: paymentOf(line)
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
                onChange={(date) => setTerm({ effectiveDate: date ?? "" })}
              />
              <DatePicker
                name="endDate"
                label={t`End Date`}
                onChange={(date) => setTerm({ endDate: date ?? "" })}
              />
              {active.map((line, index) => (
                <div key={line.id} className="w-full">
                  <Hidden
                    name={`lines[${index}].leaseLineId`}
                    value={line.id}
                  />
                  <NumberControlled
                    name={`lines[${index}].paymentAmount`}
                    label={
                      severalAssets
                        ? t`Payment — ${line.description}`
                        : t`Payment Amount`
                    }
                    helperText={t`The payment from the effective date. Escalation still steps up on each anniversary of the commencement`}
                    value={paymentOf(line)}
                    minValue={0}
                    step={moneyStep}
                    formatOptions={moneyFormat}
                    onChange={(value) =>
                      setPaymentInput((prev) => ({
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
                  label: frequencyLabel(frequency)
                }))}
                onChange={(option) => {
                  const paymentFrequency = leasePaymentFrequencies.find(
                    (frequency) => frequency === option?.value
                  );
                  if (paymentFrequency) setTerm({ paymentFrequency });
                }}
              />
              <NumberControlled
                name="annualEscalationPercent"
                label={t`Annual Escalation (%)`}
                value={terms.annualEscalationPercent}
                minValue={0}
                step={INPUT_STEP.percent}
                formatOptions={INPUT_FORMAT.percentPoints}
                onChange={(value) =>
                  setTerm({
                    annualEscalationPercent: Number.isNaN(value) ? 0 : value
                  })
                }
              />
              <NumberControlled
                name="discountRate"
                label={t`Discount Rate (%)`}
                helperText={t`The rate at the effective date`}
                value={terms.discountRate}
                minValue={0}
                step={INPUT_STEP.percent}
                formatOptions={INPUT_FORMAT.percentPoints}
                onChange={(value) =>
                  setTerm({ discountRate: Number.isNaN(value) ? 0 : value })
                }
              />
              <TextArea name="notes" label={t`Notes`} />
              {shortTermTooLong ? (
                <p className="text-sm text-destructive">
                  <Trans>
                    A short-term asset cannot run past 12 months from the
                    commencement. End it and enter the extension as a new lease.
                  </Trans>
                </p>
              ) : remeasured && remeasured.length === 0 ? (
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
            <Submit
              isDisabled={
                !permissions.can("update", "purchasing") || shortTermTooLong
              }
            >
              <Trans>Modify Lease</Trans>
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
};

export default LeaseModifyModal;
