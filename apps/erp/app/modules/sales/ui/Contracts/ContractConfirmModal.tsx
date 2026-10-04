// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import {
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
import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { DateTime, MotionMoney } from "~/components";
import { Hidden, Submit } from "~/components/Form";
import { useCurrencyDecimals, usePermissions } from "~/hooks";
import { stripeCustomerChoiceValidator } from "~/modules/invoicing";
import StripeCustomerPanel, {
  useStripeCustomerResolution
} from "~/modules/invoicing/ui/SalesInvoice/StripeCustomerPanel";
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
 *  Stripe customer; when it is not, the modal asks the same question the
 *  invoice post modal does (use a match, or create one) and the confirm
 *  action links the answer before confirming. */
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

  // An unlinked billing customer is linked as part of confirming: resolve it
  // against the connected account the way the invoice post modal does. The
  // lookup needs the invoicing permission, which confirming needs anyway.
  const billingCustomerId = contract.invoiceCustomerId ?? contract.customerId;
  const [stripeEmail, setStripeEmail] = useState("");
  const [committedEmail, setCommittedEmail] = useState<string | undefined>();
  const { resolution, isLoading: isResolving } = useStripeCustomerResolution(
    isStripeUnlinked && !needsInvoicing && billingCustomerId
      ? {
          customerId: billingCustomerId,
          customerContactId: contract.invoiceCustomerContactId
        }
      : null,
    committedEmail
  );
  // Nothing may be created on a merchant's Stripe account without a decision,
  // so Confirm stays shut until the panel has produced one.
  const isStripeBlocked =
    isCheckingStripe ||
    (isStripeUnlinked &&
      (!billingCustomerId ||
        isResolving ||
        !resolution ||
        resolution.state === "unavailable" ||
        resolution.state === "missing-email"));

  const automation: Record<typeof mode, string> = {
    "Draft Only": t`Invoices are drafted for review and posted by hand.`,
    Post: t`Invoices are drafted and posted automatically.`,
    "Post and Email": t`Invoices are drafted, posted and emailed automatically.`,
    "Post and Send via Stripe": t`Invoices are drafted, posted and sent via Stripe automatically.`
  };

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent size="medium">
        <ValidatedForm
          validator={stripeCustomerChoiceValidator}
          method="post"
          action={path.to.contractConfirm(id)}
          fetcher={fetcher}
          onSubmit={() => {
            submitted.current = true;
          }}
        >
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
                  needsInvoicing ? null : (
                    <VStack spacing={2} className="w-full">
                      <StripeCustomerPanel
                        subject="contract"
                        resolution={resolution}
                        isLoading={isResolving}
                        email={stripeEmail}
                        onEmailChange={setStripeEmail}
                        onEmailCommit={(email) => {
                          // Re-resolve once an address exists: Stripe may
                          // already have a customer under it, and linking beats
                          // duplicating.
                          if (email.includes("@")) setCommittedEmail(email);
                        }}
                      />
                      {committedEmail && (
                        <Hidden
                          name="stripeContactEmail"
                          value={committedEmail}
                        />
                      )}
                    </VStack>
                  )
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
                    This contract's invoices post automatically, so confirming
                    it needs permission to create invoices.
                  </Trans>
                </p>
              )}
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button
              variant="secondary"
              isDisabled={fetcher.state !== "idle"}
              onClick={onClose}
            >
              <Trans>Cancel</Trans>
            </Button>
            <Submit
              withBlocker={false}
              shortcut={SHORTCUTS.confirm}
              isDisabled={
                isStripeBlocked ||
                needsInvoicing ||
                !permissions.can("update", "sales")
              }
            >
              <Trans>Confirm</Trans>
            </Submit>
          </ModalFooter>
        </ValidatedForm>
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
