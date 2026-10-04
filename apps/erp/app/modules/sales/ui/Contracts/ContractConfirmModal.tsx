// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  SHORTCUTS,
  Spinner,
  useRouteData,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useRef } from "react";
import { LuCircleAlert } from "react-icons/lu";
import { useFetcher } from "react-router";
import { DateTime, MotionMoney } from "~/components";
import { useCurrencyDecimals, usePermissions } from "~/hooks";
import type { loader as contractConfirmLoader } from "~/routes/x+/contract+/$id.confirm";
import { path } from "~/utils/path";
import type { Contract, ContractRouteData } from "./types";
import { useContractLabels } from "./useContractLabels";

type ContractConfirmModalProps = {
  contract: Contract;
  onClose: () => void;
};

/** Confirm a Draft contract: what invoicing will do once it is Active — the
 *  first invoice, how many are planned, and the effective invoicing setting.
 *  A contract that sends via Stripe needs its billing customer linked to a
 *  Stripe customer first; the server function refuses without it. */
const ContractConfirmModal = ({
  contract,
  onClose
}: ContractConfirmModalProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const labels = useContractLabels();
  const fetcher = useFetcher<{}>();
  const stripeLink = useFetcher<typeof contractConfirmLoader>();
  const submitted = useRef(false);

  const id = contract.id!;
  const currencyCode = contract.currencyCode ?? "USD";
  const currencyDecimals = useCurrencyDecimals(currencyCode);
  const mode = contract.effectiveInvoiceAutomation ?? "Draft Only";
  const isStripe = mode === "Post and Send via Stripe";

  const routeData = useRouteData<ContractRouteData>(path.to.contract(id));
  const planned = plannedInvoices(routeData);
  const first = planned[0] ?? null;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `stripeLink` is a fresh object each render, so depending on it would re-run this effect forever.
  useEffect(() => {
    if (isStripe) stripeLink.load(path.to.contractConfirm(id));
  }, [isStripe, id]);

  // The action redirects with a flash; close once it has settled.
  useEffect(() => {
    if (fetcher.state === "idle" && submitted.current) {
      submitted.current = false;
      onClose();
    }
  }, [fetcher.state, onClose]);

  const isCheckingStripe =
    isStripe && (stripeLink.state !== "idle" || !stripeLink.data);
  const isStripeUnlinked =
    isStripe && !isCheckingStripe && !stripeLink.data?.stripeCustomerLinked;
  // Invoices that post on their own need the invoicing permission too.
  const needsInvoicing =
    mode !== "Draft Only" && !permissions.can("create", "invoicing");

  const automation: Record<typeof mode, string> = {
    "Draft Only": t`Invoices are drafted for review and posted by hand.`,
    Post: t`Invoices are drafted and posted automatically.`,
    "Post and Email": t`Invoices are drafted, posted and emailed automatically.`,
    "Post and Send via Stripe": t`Invoices are drafted, posted and sent via Stripe automatically.`
  };

  const isSubmitting = fetcher.state !== "idle";

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent size="medium">
        <ModalHeader>
          <ModalTitle>
            <Trans>Confirm {contract.customerContractId}</Trans>
          </ModalTitle>
          <ModalDescription>
            <Trans>
              Confirming fixes the invoice schedule and starts invoicing. The
              terms and lines are then changed with Amend.
            </Trans>
          </ModalDescription>
        </ModalHeader>
        <ModalBody>
          <VStack spacing={4}>
            <VStack spacing={2} className="w-full">
              <HStack className="justify-between text-sm w-full">
                <span className="text-muted-foreground">
                  <Trans>First invoice</Trans>
                </span>
                {first ? (
                  <span className="flex items-center gap-2">
                    <DateTime value={first.invoiceDate} variant="date" />
                    <span aria-hidden>·</span>
                    <MotionMoney
                      value={first.total}
                      currency={currencyCode}
                      decimalPlaces={currencyDecimals}
                    />
                  </span>
                ) : (
                  <span>—</span>
                )}
              </HStack>
              <HStack className="justify-between text-sm w-full">
                <span className="text-muted-foreground">
                  {contract.endDate ? (
                    <Trans>Planned invoices</Trans>
                  ) : (
                    <Trans>Planned invoices so far</Trans>
                  )}
                </span>
                <span>{planned.length}</span>
              </HStack>
              <HStack className="justify-between text-sm w-full">
                <span className="text-muted-foreground">
                  <Trans>Invoicing</Trans>
                </span>
                <span>{labels.invoiceAutomation[mode]}</span>
              </HStack>
              <p className="text-xs text-muted-foreground w-full">
                {automation[mode]} <Trans>Amounts are before tax.</Trans>
              </p>
            </VStack>

            {isStripe &&
              (isCheckingStripe ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Spinner className="size-4" />
                  <Trans>Checking the Stripe customer link…</Trans>
                </div>
              ) : isStripeUnlinked ? (
                <Alert variant="warning">
                  <LuCircleAlert />
                  <AlertTitle>
                    <Trans>No Stripe customer is linked</Trans>
                  </AlertTitle>
                  <AlertDescription>
                    <Trans>
                      This contract sends its invoices via Stripe, so its
                      billing customer must be linked to a Stripe customer
                      first. Link one by posting an invoice for this customer
                      with Send via Stripe, or change the contract's invoicing
                      setting.
                    </Trans>
                  </AlertDescription>
                </Alert>
              ) : (
                <p className="text-sm text-muted-foreground">
                  <Trans>
                    Invoices are sent to the Stripe customer already linked to
                    the billing customer.
                  </Trans>
                </p>
              ))}

            {needsInvoicing && (
              <p className="text-sm text-muted-foreground">
                <Trans>
                  This contract's invoices post automatically, so confirming it
                  needs permission to create invoices.
                </Trans>
              </p>
            )}
          </VStack>
        </ModalBody>
        <ModalFooter>
          <Button
            variant="secondary"
            isDisabled={isSubmitting}
            onClick={onClose}
          >
            <Trans>Cancel</Trans>
          </Button>
          <fetcher.Form
            method="post"
            action={path.to.contractConfirm(id)}
            onSubmit={() => {
              submitted.current = true;
            }}
          >
            <Button
              type="submit"
              isLoading={isSubmitting}
              isDisabled={
                isSubmitting ||
                isCheckingStripe ||
                isStripeUnlinked ||
                needsInvoicing ||
                !permissions.can("update", "sales")
              }
              shortcut={SHORTCUTS.confirm}
            >
              <Trans>Confirm</Trans>
            </Button>
          </fetcher.Form>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

/** The invoices still to be drafted, with their totals — planned live for an
 *  unedited Draft, else persisted. Billed Externally rows are not invoiced. */
function plannedInvoices(
  data: ContractRouteData | undefined
): { invoiceDate: string; total: number }[] {
  if (!data) return [];
  if (data.computedSchedule) {
    return data.computedSchedule
      .filter((invoice) => invoice.status === "Planned")
      .map((invoice) => ({
        invoiceDate: invoice.invoiceDate,
        total: invoice.rows.reduce((sum, row) => sum + row.amount, 0)
      }));
  }
  return data.schedule
    .filter((invoice) => invoice.status === "Planned")
    .map((invoice) => ({
      invoiceDate: invoice.invoiceDate,
      total: invoice.customerContractInvoiceLine.reduce(
        (sum, row) => sum + Number(row.amount),
        0
      )
    }));
}

export default ContractConfirmModal;
