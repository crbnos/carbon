// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  cn,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  useDebounce,
  VStack
} from "@carbon/react";
import type { ContractCancellationPreview } from "@carbon/server-functions/post-customer-contract";
import { currentPeriodEnd } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { LuCircleAlert } from "react-icons/lu";
import { useFetcher } from "react-router";
import {
  Boolean,
  DatePicker,
  Hidden,
  Submit,
  TextArea
} from "~/components/Form";
import { useCompanyToday, useCurrencyFormatter, usePermissions } from "~/hooks";
import { customerContractCancelValidator } from "../../sales.models";
import { toContractTerms } from "./contractTerms";
import type { Contract } from "./types";

type PreviewResponse = {
  preview: ContractCancellationPreview | null;
  error: string | null;
};

type ContractCancelModalProps = {
  contract: Contract;
  action: string;
  onClose: () => void;
};

/** Cancel an Active contract: it ends on the chosen date and does not renew.
 *  The end date is previewed — the cancellation runs and rolls back on the
 *  server — to learn whether any billed time after it can be credited. */
const ContractCancelModal = ({
  contract,
  action,
  onClose
}: ContractCancelModalProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const today = useCompanyToday();
  const fetcher = useFetcher<{}>();
  const previewFetcher = useFetcher<PreviewResponse>();
  const currencyFormatter = useCurrencyFormatter({
    currency: contract.currencyCode ?? undefined
  });

  const id = contract.id!;
  // The end of the billing period running today: nothing billed is unused.
  const defaultEndDate = currentPeriodEnd(toContractTerms(contract), today);
  const [endDate, setEndDate] = useState(defaultEndDate);
  const [submittedDate, setSubmittedDate] = useState<string | null>(null);

  const submitPreview = useDebounce((date: string) => {
    const formData = new FormData();
    formData.set("intent", "preview");
    formData.set("customerContractId", id);
    formData.set("endDate", date);
    setSubmittedDate(date);
    previewFetcher.submit(formData, { method: "post", action });
  }, 300);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the date is the only input; the debounced submitter is a new function each render
  useEffect(() => {
    if (endDate) submitPreview(endDate);
  }, [endDate]);

  const isPreviewing =
    previewFetcher.state !== "idle" || submittedDate !== endDate;
  const preview = endDate ? previewFetcher.data?.preview : null;
  const previewError = endDate ? previewFetcher.data?.error : null;
  const isRefused = !isPreviewing && !!previewError;
  const credit = preview ? currencyFormatter.format(preview.credit) : "";
  const removed = preview?.removedInvoices ?? 0;

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent size="medium">
        <ValidatedForm
          validator={customerContractCancelValidator}
          method="post"
          action={action}
          fetcher={fetcher}
          defaultValues={{
            customerContractId: id,
            endDate: defaultEndDate,
            creditUnusedTime: false
          }}
          onSubmit={onClose}
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>Cancel {contract.customerContractId}</Trans>
            </ModalTitle>
            <ModalDescription>
              <Trans>
                The contract ends on the end date and does not renew. Planned
                invoices after it are removed.
              </Trans>
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <Hidden name="customerContractId" value={id} />
            <VStack spacing={4}>
              <DatePicker
                name="endDate"
                label={t`End Date`}
                onChange={(date) => setEndDate(date ?? "")}
              />
              {endDate && (
                <div className={cn("w-full", isPreviewing && "opacity-60")}>
                  {isRefused ? (
                    <Alert variant="destructive">
                      <LuCircleAlert className="h-4 w-4" />
                      <AlertTitle>
                        <Trans>The contract cannot be cancelled then</Trans>
                      </AlertTitle>
                      <AlertDescription>{previewError}</AlertDescription>
                    </Alert>
                  ) : preview ? (
                    <VStack spacing={4}>
                      <p className="text-sm text-muted-foreground">
                        {removed === 0 ? (
                          <Trans>No planned invoices are removed.</Trans>
                        ) : removed === 1 ? (
                          <Trans>1 planned invoice is removed.</Trans>
                        ) : (
                          <Trans>{removed} planned invoices are removed.</Trans>
                        )}
                      </p>
                      {preview.creditAvailable && (
                        <Boolean
                          name="creditUnusedTime"
                          label={t`Credit unused time (${credit})`}
                          description={t`Drafts a credit memo for the time already invoiced after the end date.`}
                          bordered
                        />
                      )}
                    </VStack>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      <Trans>Previewing the cancellation…</Trans>
                    </p>
                  )}
                </div>
              )}
              <TextArea name="reason" label={t`Reason`} />
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Close</Trans>
            </Button>
            <Submit
              variant="destructive"
              isDisabled={
                !endDate || isRefused || !permissions.can("update", "sales")
              }
            >
              <Trans>Cancel Contract</Trans>
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
};

export default ContractCancelModal;
