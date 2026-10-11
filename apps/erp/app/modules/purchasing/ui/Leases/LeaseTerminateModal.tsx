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
  DatePicker,
  Number as NumberField,
  Submit,
  TextArea
} from "~/components/Form";
import { useCurrencyDecimals, usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { leaseTerminateValidator } from "../../purchasing.models";
import LeaseJournalPreview, {
  type LeaseJournalPreviewRow
} from "./LeaseJournalPreview";
import type { Lease, LeaseScheduleLine } from "./types";
import { lastPostedLeaseMonthEnd, leaseCarryingAt } from "./utils";

type LeaseTerminateModalProps = {
  lease: Lease;
  schedule: LeaseScheduleLine[];
  onClose: () => void;
};

/** End an Active lease early: the liability and the right-of-use asset leave
 *  the books, and the difference is a gain or a loss. A penalty stays in the
 *  liability as a final payment row the next invoice settles. */
const LeaseTerminateModal = ({
  lease,
  schedule,
  onClose
}: LeaseTerminateModalProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher<{}>();
  const currencyCode = lease.currencyCode ?? "";
  const decimals = useCurrencyDecimals(currencyCode);

  const [terminationDate, setTerminationDate] = useState(
    lastPostedLeaseMonthEnd(schedule) ?? ""
  );
  const [penalty, setPenalty] = useState(0);

  const isShortTerm = lease.lesseeClassification === "Short-Term";
  const commencementDay = lease.commencementDate?.slice(8) ?? "";

  const journal: LeaseJournalPreviewRow[] = (() => {
    if (isShortTerm || !terminationDate) return [];
    const carrying = leaseCarryingAt(
      lease,
      schedule,
      addDays(terminationDate, 1)
    );
    const rouAssetCost = Number(lease.rouAssetCost ?? 0);
    const gainLoss = round(carrying.liability - penalty - carrying.rouAsset);
    return [
      {
        account: t`Lease Liability`,
        debit: round(carrying.liability - penalty),
        credit: 0
      },
      {
        account: t`Accumulated ROU Amortization`,
        debit: carrying.accumulated,
        credit: 0
      },
      { account: t`Right-of-Use Asset`, debit: 0, credit: rouAssetCost },
      gainLoss >= 0
        ? { account: t`Gain on Lease Termination`, debit: 0, credit: gainLoss }
        : { account: t`Loss on Lease Termination`, debit: -gainLoss, credit: 0 }
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
          validator={leaseTerminateValidator}
          method="post"
          action={path.to.leaseTerminate(lease.id!)}
          fetcher={fetcher}
          defaultValues={{
            terminationDate,
            penaltyAmount: 0,
            notes: ""
          }}
          onSubmit={onClose}
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>Terminate {lease.leaseId}</Trans>
            </ModalTitle>
            <ModalDescription>
              <Trans>
                Payments due after the termination date are removed. Invoiced
                payments stay.
              </Trans>
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <VStack spacing={4}>
              <DatePicker
                name="terminationDate"
                label={t`Termination Date`}
                helperText={t`The last day of a lease month (the day before day ${commencementDay}), after the last posted lease run`}
                onChange={(date) => setTerminationDate(date ?? "")}
              />
              <NumberField
                name="penaltyAmount"
                label={t`Termination Penalty`}
                minValue={0}
                step={INPUT_STEP.money(decimals)}
                formatOptions={INPUT_FORMAT.money(currencyCode, decimals)}
                onChange={(value) =>
                  setPenalty(Number.isNaN(value) ? 0 : value)
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
              ) : (
                journal.length > 0 && (
                  <VStack spacing={2}>
                    <p className="text-sm text-muted-foreground">
                      <Trans>Termination journal:</Trans>
                    </p>
                    <LeaseJournalPreview
                      rows={journal}
                      currencyCode={currencyCode}
                    />
                  </VStack>
                )
              )}
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Submit
              variant="destructive"
              isDisabled={!permissions.can("update", "purchasing")}
            >
              <Trans>Terminate Lease</Trans>
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
};

export default LeaseTerminateModal;
