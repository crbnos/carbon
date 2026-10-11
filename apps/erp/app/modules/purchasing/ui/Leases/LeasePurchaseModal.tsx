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
import type { Lease, LeaseScheduleLine } from "./types";
import { lastPostedLeaseMonthEnd, leaseCarryingAt } from "./utils";

type LeasePurchaseModalProps = {
  lease: Lease;
  schedule: LeaseScheduleLine[];
  onClose: () => void;
};

/** Exercise the purchase option: the right-of-use asset becomes a fixed
 *  asset at its net book value, adjusted by the price less the carrying
 *  liability. The price stays in the liability as a payment row the next
 *  invoice settles. */
const LeasePurchaseModal = ({
  lease,
  schedule,
  onClose
}: LeasePurchaseModalProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher<{}>();
  const currencyCode = lease.currencyCode ?? "";
  const decimals = useCurrencyDecimals(currencyCode);

  const [exerciseDate, setExerciseDate] = useState(
    lastPostedLeaseMonthEnd(schedule) ?? ""
  );
  const [price, setPrice] = useState(Number(lease.purchaseOptionAmount ?? 0));
  const commencementDay = lease.commencementDate?.slice(8) ?? "";

  const preview = (() => {
    if (!exerciseDate) return null;
    const carrying = leaseCarryingAt(lease, schedule, addDays(exerciseDate, 1));
    const rouAssetCost = Number(lease.rouAssetCost ?? 0);
    const assetCost = round(carrying.rouAsset + price - carrying.liability);
    const rows: LeaseJournalPreviewRow[] = [
      { account: t`Fixed Asset`, debit: assetCost, credit: 0 },
      {
        account: t`Accumulated ROU Amortization`,
        debit: carrying.accumulated,
        credit: 0
      },
      { account: t`Lease Liability`, debit: carrying.liability, credit: 0 },
      { account: t`Right-of-Use Asset`, debit: 0, credit: rouAssetCost },
      { account: t`Lease Liability`, debit: 0, credit: price }
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
          action={path.to.leasePurchase(lease.id!)}
          fetcher={fetcher}
          defaultValues={{
            exerciseDate,
            purchasePrice: price,
            fixedAssetClassId: "",
            name: lease.name ?? "",
            notes: ""
          }}
          onSubmit={onClose}
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>Exercise Purchase Option</Trans>
            </ModalTitle>
            <ModalDescription>
              <Trans>
                The leased asset becomes a fixed asset that depreciates from the
                exercise date. Payments due after it are removed.
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
