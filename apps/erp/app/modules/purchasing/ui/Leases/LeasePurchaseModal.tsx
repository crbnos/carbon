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
import { addDays, INPUT_FORMAT, INPUT_STEP, round } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { useFetcher } from "react-router";
import {
  AssetClass,
  DatePicker,
  Input,
  Number as NumberField,
  Submit,
  TextArea
} from "~/components/Form";
import { useCurrencyDecimals, usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { leasePurchaseValidator } from "../../purchasing.models";
import LeaseJournalPreview, {
  type LeaseJournalPreviewRow
} from "./LeaseJournalPreview";
import type {
  Lease,
  LeaseLine,
  LeasePayment,
  LeaseScheduleLine
} from "./types";
import {
  endedPaymentsAddBack,
  lastPostedLeaseMonthEnd,
  leaseCarryingAt
} from "./utils";

type LeasePurchaseModalProps = {
  lease: Lease;
  line: LeaseLine;
  payments: LeasePayment[];
  schedule: LeaseScheduleLine[];
  onClose: () => void;
};

/** Exercise one asset's purchase option: its right-of-use asset becomes a
 *  fixed asset at its net book value, adjusted by the price less the
 *  carrying liability. The price stays in the liability as a payment row the
 *  next invoice settles — or is the option row already invoiced. */
const LeasePurchaseModal = ({
  lease,
  line,
  payments,
  schedule,
  onClose
}: LeasePurchaseModalProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher<{}>();
  const currencyCode = lease.currencyCode ?? "";
  const decimals = useCurrencyDecimals(currencyCode);

  const lineSchedule = schedule.filter((row) => row.leaseLineId === line.id);
  const [exerciseDate, setExerciseDate] = useState(
    lastPostedLeaseMonthEnd(lineSchedule) ?? ""
  );
  const [price, setPrice] = useState(Number(line.purchaseOptionAmount ?? 0));
  const commencementDay = lease.commencementDate?.slice(8) ?? "";

  const preview = (() => {
    if (!exerciseDate) return null;
    const carrying = leaseCarryingAt(line, schedule, addDays(exerciseDate, 1));
    // An option row already invoiced on or before the date is the price: its
    // invoice settles the liability, so nothing more is payable.
    const invoicedOption = payments.some(
      (payment) =>
        payment.leaseLineId === line.id &&
        payment.paymentType === "Purchase Option" &&
        payment.status === "Invoiced" &&
        payment.dueDate <= exerciseDate
    );
    const payable = invoicedOption ? 0 : price;
    const liability = round(
      carrying.liability + endedPaymentsAddBack(payments, line.id, exerciseDate)
    );
    const rouAssetCost = Number(line.rouAssetCost ?? 0);
    const assetCost = round(carrying.rouAsset + payable - liability);
    const rows: LeaseJournalPreviewRow[] = [
      { account: t`Fixed Asset`, debit: assetCost, credit: 0 },
      {
        account: t`Accumulated ROU Amortization`,
        debit: carrying.accumulated,
        credit: 0
      },
      { account: t`Lease Liability`, debit: liability, credit: 0 },
      { account: t`Right-of-Use Asset`, debit: 0, credit: rouAssetCost },
      { account: t`Lease Liability`, debit: 0, credit: payable }
    ];
    return { assetCost, rows };
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
          validator={leasePurchaseValidator}
          method="post"
          action={path.to.leaseLinePurchase(lease.id!, line.id)}
          fetcher={fetcher}
          defaultValues={{
            exerciseDate,
            purchasePrice: price,
            fixedAssetClassId: "",
            name: line.description,
            notes: ""
          }}
          onSubmit={onClose}
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>Exercise Purchase Option: {line.description}</Trans>
            </ModalTitle>
            <ModalDescription>
              <Trans>
                The leased asset becomes a fixed asset that depreciates from the
                exercise date. Its payments due after it are removed. The
                lease's other assets do not change.
              </Trans>
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <VStack spacing={4}>
              <DatePicker
                name="exerciseDate"
                label={t`Exercise Date`}
                helperText={t`The last day of a lease month (the day before day ${commencementDay}), after the last posted lease run and on or before the end date`}
                onChange={(date) => setExerciseDate(date ?? "")}
              />
              <NumberField
                name="purchasePrice"
                label={t`Purchase Price`}
                minValue={0}
                step={INPUT_STEP.money(decimals)}
                formatOptions={INPUT_FORMAT.money(currencyCode, decimals)}
                onChange={(value) => setPrice(Number.isNaN(value) ? 0 : value)}
              />
              <AssetClass name="fixedAssetClassId" label={t`Asset Class`} />
              <Input name="name" label={t`Asset Name`} />
              <TextArea name="notes" label={t`Notes`} />
              {preview && (
                <VStack spacing={2}>
                  <p className="text-sm text-muted-foreground">
                    <Trans>
                      Purchase journal (the asset account comes from the asset
                      class):
                    </Trans>
                  </p>
                  <LeaseJournalPreview
                    rows={preview.rows}
                    currencyCode={currencyCode}
                  />
                  {preview.assetCost < 0 && (
                    <p className="text-sm text-destructive">
                      <Trans>
                        The asset would have a negative cost. Check the purchase
                        price.
                      </Trans>
                    </p>
                  )}
                </VStack>
              )}
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Submit
              isDisabled={
                !permissions.can("update", "purchasing") ||
                (preview?.assetCost ?? 0) < 0
              }
            >
              <Trans>Purchase Asset</Trans>
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
};

export default LeasePurchaseModal;
