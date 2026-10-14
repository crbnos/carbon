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
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { useFetcher } from "react-router";
import {
  AssetClass,
  DatePicker,
  Hidden,
  Input,
  NumberControlled,
  Submit,
  TextArea
} from "~/components/Form";
import Money from "~/components/Money";
import {
  useCurrencyDecimals,
  useCurrencyFormatter,
  usePermissions
} from "~/hooks";
import { path } from "~/utils/path";
import { leasePurchaseValidator } from "../../purchasing.models";
import LeaseJournalPreview from "./LeaseJournalPreview";
import type {
  Lease,
  LeaseLine,
  LeasePayment,
  LeaseScheduleLine
} from "./types";
import { useLeaseLegLabel } from "./useLeaseLabels";
import {
  invoicedPurchaseOption,
  type LeasePurchaseOffer,
  lastPostedLeaseMonthEnd,
  leaseJournalRows,
  leasePurchasePreview,
  leasePurchaseRefusal
} from "./utils";

type LeasePurchaseModalProps = {
  lease: Lease;
  line: LeaseLine;
  /** How the asset can be bought (`leasePurchaseOffer`). */
  offer: LeasePurchaseOffer;
  payments: LeasePayment[];
  schedule: LeaseScheduleLine[];
  onClose: () => void;
};

/** Buy one leased asset: its right-of-use asset becomes a fixed asset at
 *  its net book value, adjusted by the price less the carrying liability.
 *  The price stays in the liability as a payment row the next invoice
 *  settles — or is the option row already invoiced. An asset whose
 *  ownership transfers with no option is taken on the end date for
 *  nothing. */
const LeasePurchaseModal = ({
  lease,
  line,
  offer,
  payments,
  schedule,
  onClose
}: LeasePurchaseModalProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher<{}>();
  const currencyCode = lease.currencyCode ?? "";
  const decimals = useCurrencyDecimals(currencyCode);
  const formatter = useCurrencyFormatter({ currency: currencyCode });
  const legLabel = useLeaseLegLabel();
  const isOwnership = offer.kind === "ownership";

  // Only what the user typed is state; the defaults come from the data.
  const [dateInput, setDateInput] = useState<string | null>(null);
  const [priceInput, setPriceInput] = useState<number | null>(null);
  const exerciseDate =
    offer.kind === "ownership"
      ? offer.exerciseDate
      : (dateInput ??
        lastPostedLeaseMonthEnd(
          schedule.filter((row) => row.leaseLineId === line.id)
        ) ??
        "");
  const invoicedOption = exerciseDate
    ? invoicedPurchaseOption(payments, line.id, exerciseDate)
    : null;
  const price =
    offer.kind === "ownership"
      ? 0
      : (priceInput ?? invoicedOption ?? offer.price);

  const preview = exerciseDate
    ? leasePurchasePreview({ line, payments, schedule, exerciseDate, price })
    : null;
  const refusal = exerciseDate
    ? leasePurchaseRefusal({
        offer,
        exerciseDate,
        price,
        invoicedOption,
        assetCost: preview?.assetCost ?? null
      })
    : null;
  const refusalText =
    refusal === "invoicedPrice" && invoicedOption !== null
      ? t`The purchase option is already invoiced at ${formatter.format(invoicedOption)}. Exercise it at that price, or delete the invoice first.`
      : refusal === "negativeCost"
        ? t`The asset would have a negative cost. Check the purchase price.`
        : null;
  const commencementDay = lease.commencementDate?.slice(8) ?? "";

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
              {isOwnership ? (
                <Trans>Take Ownership: {line.description}</Trans>
              ) : (
                <Trans>Exercise Purchase Option: {line.description}</Trans>
              )}
            </ModalTitle>
            <ModalDescription>
              {isOwnership ? (
                <Trans>
                  Ownership passes to you at the end of the lease, for nothing.
                  The leased asset becomes a fixed asset that depreciates from
                  the end date. The lease's other assets do not change.
                </Trans>
              ) : (
                <Trans>
                  The leased asset becomes a fixed asset that depreciates from
                  the exercise date. Its payments due after it are removed. The
                  lease's other assets do not change.
                </Trans>
              )}
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <VStack spacing={4}>
              <DatePicker
                name="exerciseDate"
                label={isOwnership ? t`Transfer Date` : t`Exercise Date`}
                isDisabled={isOwnership}
                value={isOwnership ? exerciseDate : undefined}
                helperText={
                  isOwnership
                    ? t`The end date of the lease`
                    : t`The last day of a lease month (the day before day ${commencementDay}), after the last posted lease run and on or before the end date`
                }
                onChange={(date) => setDateInput(date ?? "")}
              />
              {isOwnership ? (
                <>
                  <Hidden name="purchasePrice" value={0} />
                  <VStack spacing={1}>
                    <span className="text-xs font-medium text-muted-foreground">
                      <Trans>Purchase Price</Trans>
                    </span>
                    <Money value={0} currencyCode={currencyCode} />
                  </VStack>
                </>
              ) : (
                <NumberControlled
                  name="purchasePrice"
                  label={t`Purchase Price`}
                  value={price}
                  minValue={0}
                  step={INPUT_STEP.money(decimals)}
                  formatOptions={INPUT_FORMAT.money(currencyCode, decimals)}
                  helperText={
                    invoicedOption !== null
                      ? t`The purchase option is already invoiced; its invoice settles the price`
                      : undefined
                  }
                  onChange={(value) =>
                    setPriceInput(Number.isNaN(value) ? 0 : value)
                  }
                />
              )}
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
                    rows={leaseJournalRows(preview.legs, (leg) =>
                      legLabel(leg.account)
                    )}
                    currencyCode={currencyCode}
                  />
                </VStack>
              )}
              {refusalText && (
                <p className="text-sm text-destructive">{refusalText}</p>
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
                !exerciseDate ||
                refusal !== null
              }
            >
              {isOwnership ? (
                <Trans>Take Ownership</Trans>
              ) : (
                <Trans>Purchase Asset</Trans>
              )}
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
};

export default LeasePurchaseModal;
