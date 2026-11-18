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
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  toast,
  VStack
} from "@carbon/react";
import { distinctItemText, getItemReadableId } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { LuTriangleAlert } from "react-icons/lu";
import type { FetcherWithComponents } from "react-router";
import { useFetcher } from "react-router";
import { CustomerAvatar } from "~/components";
import {
  CustomerContact,
  DatePicker,
  EmailRecipients,
  Hidden,
  SelectControlled
} from "~/components/Form";
import {
  useCompanyToday,
  useCurrencyFormatter,
  useRouteData,
  useUser
} from "~/hooks";
import { useIntegrations } from "~/hooks/useIntegrations";
import type { StripeCustomerResolution } from "~/modules/invoicing/invoicing.service";
import { useItems } from "~/stores";
import { path } from "~/utils/path";
import {
  isItemlessServiceLine,
  salesInvoicePostValidator
} from "../../invoicing.models";
import type { SalesInvoice, SalesInvoiceLine } from "../../types";
import StripeCustomerPanel from "./StripeCustomerPanel";
import { useRentalLineTypeLabel } from "./useRentalLineTypeLabel";
import { useSalesInvoiceTotals } from "./useSalesInvoiceTotals";

/** What the post action answers: the operation's result, or the violations. */
export type SalesInvoicePostResult = {
  data?: {
    sentVia: "Email" | "Stripe" | null;
    warning: string | null;
  } | null;
  error?: { message: string } | null;
  violations?: unknown[];
};

type SalesInvoicePostModalProps = {
  fetcher: FetcherWithComponents<SalesInvoicePostResult>;
  isOpen: boolean;
  onClose: () => void;
  invoiceId: string;
  linesToShip: {
    itemId: string | null;
    itemReadableId: string | null;
    description: string | null;
    quantity: number;
  }[];
  customerId: string | null;
  customerContactId: string | null;
  dateDue: string | null;
  defaultCc?: string[];
};

const SalesInvoicePostModal = ({
  isOpen,
  onClose,
  ...props
}: SalesInvoicePostModalProps) => (
  <Modal
    open={isOpen}
    onOpenChange={(open) => {
      if (!open) onClose();
    }}
  >
    <ModalContent>
      <SalesInvoicePostBody onClose={onClose} {...props} />
    </ModalContent>
  </Modal>
);

/** A line's amount before tax: what it adds to the subtotal. */
const lineAmount = (line: SalesInvoiceLine) =>
  (line.netUnitPrice ?? 0) * (line.quantity ?? 0) +
  (line.shippingCost ?? 0) +
  (line.addOnCost ?? 0) +
  (line.nonTaxableAddOnCost ?? 0);

/** One labelled fact in the post summary: label left, value right. */
const SummaryFact = ({
  label,
  children
}: {
  label: string;
  children: ReactNode;
}) => (
  <div className="flex items-center justify-between gap-4">
    <span className="shrink-0 text-muted-foreground">{label}</span>
    <div className="min-w-0 truncate text-right">{children}</div>
  </div>
);

/**
 * What the invoice will say once posted, so a wrong or missing figure is
 * caught while it can still be changed. Values that are often a mistake —
 * no shipping, a line with no price — are flagged in amber. They are nudges,
 * not blocks: each can be right. The due date is not shown: posting sets it
 * from the payment term.
 */
const SalesInvoicePostSummary = ({ invoiceId }: { invoiceId: string }) => {
  const { t } = useLingui();
  const [items] = useItems();
  const rentalLineTypeLabel = useRentalLineTypeLabel();
  const { company } = useUser();
  const routeData = useRouteData<{
    salesInvoice: SalesInvoice;
    salesInvoiceLines: SalesInvoiceLine[];
  }>(path.to.salesInvoice(invoiceId));
  const totals = useSalesInvoiceTotals(invoiceId);

  const formatter = useCurrencyFormatter({
    currency: company?.baseCurrencyCode ?? "USD"
  });
  const presentationCurrencyFormatter = useCurrencyFormatter({
    currency: routeData?.salesInvoice?.currencyCode ?? "USD"
  });

  const salesInvoice = routeData?.salesInvoice;
  const lines = routeData?.salesInvoiceLines ?? [];
  if (!salesInvoice) return null;

  const lineName = (line: SalesInvoiceLine) =>
    line.invoiceLineType === "Rental"
      ? rentalLineTypeLabel(line.rentalLineType)
      : line.invoiceLineType === "Fixed Asset"
        ? (line as any).assetReadableId || t`Fixed Asset`
        : isItemlessServiceLine(line)
          ? line.description || t`Service`
          : (getItemReadableId(items, line.itemId) ?? line.description ?? "");

  // A Comment line carries no charge, so it is never "unpriced". The check is
  // on the unit price: an add-on or line freight can hide a missing price.
  const isUnpriced = (line: SalesInvoiceLine) =>
    line.invoiceLineType !== "Comment" && (line.unitPrice ?? 0) === 0;
  const unpricedLines = lines.filter(isUnpriced).length;
  // Shipping is charged on the invoice's Shipping section or on its lines.
  const noShipping =
    totals.shippingCost === 0 &&
    lines.every((line) => (line.shippingCost ?? 0) === 0);
  const hasChecks = noShipping || unpricedLines > 0;
  const billsAnotherCustomer =
    !!salesInvoice.invoiceCustomerId &&
    salesInvoice.invoiceCustomerId !== salesInvoice.customerId;

  return (
    <VStack spacing={3} className="w-full">
      {hasChecks && (
        <Alert variant="warning">
          <LuTriangleAlert />
          <AlertTitle>
            <Trans>Check before posting</Trans>
          </AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4 space-y-0.5">
              {noShipping && (
                <li>
                  <Trans>No shipping is charged on this invoice</Trans>
                </li>
              )}
              {unpricedLines > 0 && (
                <li>
                  <Plural
                    value={unpricedLines}
                    one="# line has no price"
                    other="# lines have no price"
                  />
                </li>
              )}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <div className="w-full rounded-lg border text-sm">
        <div className="space-y-1 px-3 py-2">
          <SummaryFact label={t`Customer`}>
            <CustomerAvatar customerId={salesInvoice.customerId ?? null} />
          </SummaryFact>
          {billsAnotherCustomer && (
            <SummaryFact label={t`Bill to`}>
              <CustomerAvatar customerId={salesInvoice.invoiceCustomerId} />
            </SummaryFact>
          )}
          <SummaryFact label={t`Customer PO`}>
            {salesInvoice.customerReference || (
              <span className="text-muted-foreground">
                <Trans>None</Trans>
              </span>
            )}
          </SummaryFact>
          <SummaryFact label={t`Payment term`}>
            {salesInvoice.paymentTermName || (
              <span className="text-muted-foreground">
                <Trans>None (Net 30)</Trans>
              </span>
            )}
          </SummaryFact>
          {totals.shouldConvertCurrency && (
            <SummaryFact label={t`Currency`}>
              <span className="tabular-nums">
                {salesInvoice.currencyCode} @ {salesInvoice.exchangeRate}
              </span>
            </SummaryFact>
          )}
        </div>
        <div className="border-t max-h-48 overflow-y-auto">
          {lines.map((line) => {
            if (line.invoiceLineType === "Comment") {
              return (
                <div
                  key={line.id}
                  className="px-3 py-2 text-muted-foreground line-clamp-2"
                >
                  {line.description}
                </div>
              );
            }
            const name = lineName(line);
            const description = distinctItemText(name, line.description);
            return (
              <div
                key={line.id}
                className="flex items-center justify-between gap-4 px-3 py-2"
              >
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">{name}</span>
                  {description && (
                    <span className="truncate text-xs text-muted-foreground">
                      {description}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {line.quantity} × {formatter.format(line.netUnitPrice ?? 0)}
                  </span>
                </div>
                <span
                  className={cn(
                    "shrink-0 tabular-nums",
                    isUnpriced(line) &&
                      "font-medium text-amber-600 dark:text-amber-400"
                  )}
                >
                  {formatter.format(lineAmount(line))}
                </span>
              </div>
            );
          })}
        </div>

        <div className="border-t px-3 py-2 space-y-1">
          <div className="flex justify-between text-muted-foreground">
            <span>
              <Trans>Subtotal</Trans>
            </span>
            <span className="tabular-nums">
              {formatter.format(totals.subtotal)}
            </span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>
              <Trans>Tax</Trans>
            </span>
            <span className="tabular-nums">{formatter.format(totals.tax)}</span>
          </div>
          <div
            className={cn(
              "flex justify-between",
              noShipping
                ? "font-medium text-amber-600 dark:text-amber-400"
                : "text-muted-foreground"
            )}
          >
            <span>
              <Trans>Shipping</Trans>
            </span>
            <span className="tabular-nums">
              {formatter.format(totals.shippingCost)}
            </span>
          </div>
        </div>

        <div className="flex items-start justify-between border-t px-3 py-2.5">
          <span className="text-base font-semibold">
            <Trans>Total</Trans>
          </span>
          <div className="flex flex-col items-end">
            <span className="text-base font-semibold tabular-nums">
              {formatter.format(totals.total)}
            </span>
            {totals.shouldConvertCurrency && (
              <span className="text-xs text-muted-foreground tabular-nums">
                {presentationCurrencyFormatter.format(totals.customerTotal)}
              </span>
            )}
          </div>
        </div>
      </div>
    </VStack>
  );
};

const SalesInvoicePostBody = ({
  fetcher,
  onClose,
  invoiceId,
  linesToShip,
  customerId,
  customerContactId,
  dateDue,
  defaultCc = []
}: Omit<SalesInvoicePostModalProps, "isOpen">) => {
  const { t } = useLingui();
  const hasLinesToShip = linesToShip.length > 0;
  const integrations = useIntegrations();
  const canEmail = integrations.has("email");
  const canStripe = integrations.has("stripe-connect");

  // The invoice's own dateDue is a business date, so the "would this survive
  // stripeDueDate" check anchors on the company's calendar, not the browser's.
  const companyToday = parseDate(useCompanyToday());
  const minStripeDueDate = companyToday.add({ days: 1 });
  const maxStripeDueDate = companyToday.add({ years: 5 });
  const parsedDateDue = (() => {
    if (!dateDue) return null;
    try {
      return parseDate(dateDue.slice(0, 10));
    } catch {
      return null;
    }
  })();
  // Mirrors stripeDueDate's server-side rule (missing, on/before today, or
  // more than 5 years out) — if the invoice's own date wouldn't survive that
  // check, ask the user for one instead of silently sending with none.
  const needsStripeDueDate =
    !parsedDateDue ||
    parsedDateDue.compare(companyToday) <= 0 ||
    parsedDateDue.compare(maxStripeDueDate) > 0;

  const [notificationType, setNotificationType] = useState<
    "Email" | "Stripe" | "None"
  >(canStripe ? "Stripe" : canEmail ? "Email" : "None");

  const [contactId, setContactId] = useState<string | null>(customerContactId);
  const [contactMissingEmail, setContactMissingEmail] = useState(false);
  const [stripeEmail, setStripeEmail] = useState("");
  const [committedEmail, setCommittedEmail] = useState<string | undefined>();
  const stripeCustomer = useFetcher<StripeCustomerResolution>();
  const isStripe = notificationType === "Stripe";
  // The identity the current panel state must correspond to. Anything the
  // fetcher still holds for a different key is stale.
  const requestKey = `${contactId ?? ""}|${committedEmail ?? ""}`;
  const loadedKeyRef = useRef<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `stripeCustomer` is a fresh object each render, so depending on it would re-run this effect forever.
  useEffect(() => {
    if (!isStripe || !contactId) return;
    loadedKeyRef.current = requestKey;
    stripeCustomer.load(
      path.to.api.stripeConnectCustomer(invoiceId, contactId, committedEmail)
    );
  }, [isStripe, contactId, invoiceId, committedEmail]);

  // Errors are toasted and violations shown by the violation hook.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per answer
  useEffect(() => {
    const posted = fetcher.data?.data;
    if (!posted) return;
    if (posted.warning) {
      // Posted, but the PDF or the send failed: the header offers a resend.
      toast.error(posted.warning);
    } else {
      toast.success(
        posted.sentVia === "Stripe"
          ? t`Invoice posted and sent via Stripe`
          : t`Sales invoice confirmed`
      );
    }
    onClose();
  }, [fetcher.data]);

  const resolution = stripeCustomer.data ?? null;
  const isStale = loadedKeyRef.current !== requestKey;
  const isResolving = stripeCustomer.state !== "idle" || isStale;

  // Nothing may be created on a merchant's Stripe account without a decision,
  // so the submit stays shut until the panel has produced one.
  const isStripeBlocked =
    isStripe &&
    (!contactId ||
      isResolving ||
      !resolution ||
      resolution.state === "unavailable" ||
      resolution.state === "missing-email");

  return (
    <ValidatedForm
      method="post"
      validator={salesInvoicePostValidator}
      action={path.to.salesInvoicePost(invoiceId)}
      defaultValues={{
        notification: notificationType,
        customerContact: customerContactId ?? undefined,
        cc: defaultCc,
        stripeDueDate:
          isStripe && needsStripeDueDate
            ? companyToday.add({ days: 30 }).toString()
            : undefined
      }}
      fetcher={fetcher}
    >
      <ModalHeader>
        <ModalTitle>
          <Trans>Post Invoice</Trans>
        </ModalTitle>
        <ModalDescription>
          {hasLinesToShip ? (
            <>
              A shipment will be automatically created and posted for the items
              below.
            </>
          ) : (
            <Trans>
              Check the details below. A posted invoice can't be edited.
            </Trans>
          )}
        </ModalDescription>
      </ModalHeader>
      <ModalBody>
        <VStack spacing={4}>
          <SalesInvoicePostSummary invoiceId={invoiceId} />
          {hasLinesToShip && (
            <div className="w-full">
              <Table>
                <Thead>
                  <Tr>
                    <Th>
                      <Trans>Item</Trans>
                    </Th>
                    <Th className="text-right">Quantity</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {linesToShip.map((line) => (
                    <Tr key={line.itemId} className="text-sm">
                      <Td>
                        <VStack spacing={0}>
                          <span>{line.itemReadableId}</span>
                          {distinctItemText(
                            line.itemReadableId,
                            line.description
                          ) && (
                            <span className="text-xs text-muted-foreground">
                              {line.description}
                            </span>
                          )}
                        </VStack>
                      </Td>
                      <Td className="text-right">{line.quantity}</Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </div>
          )}

          {(canEmail || canStripe) && (
            <SelectControlled
              label={t`Send Via`}
              name="notification"
              options={[
                {
                  label: "None",
                  value: "None"
                },
                ...(canEmail
                  ? [
                      {
                        label: "Email",
                        value: "Email"
                      }
                    ]
                  : []),
                ...(canStripe
                  ? [
                      {
                        label: "Stripe",
                        value: "Stripe"
                      }
                    ]
                  : [])
              ]}
              value={notificationType}
              onChange={(t) => {
                if (t)
                  setNotificationType(t.value as "Email" | "Stripe" | "None");
              }}
            />
          )}

          {(notificationType === "Email" || notificationType === "Stripe") && (
            <CustomerContact
              name="customerContact"
              customer={customerId ?? undefined}
              warnIfNoEmail={notificationType === "Email"}
              onMissingEmailChange={setContactMissingEmail}
              onChange={(contact) => {
                setContactId(contact?.id ?? null);
                // A different contact may have an email of its own, so
                // drop anything typed for the previous one.
                setStripeEmail("");
                setCommittedEmail(undefined);
              }}
            />
          )}
          {isStripe && contactId && (
            <StripeCustomerPanel
              resolution={resolution}
              isLoading={isResolving}
              email={stripeEmail}
              onEmailChange={setStripeEmail}
              onEmailCommit={(email) => {
                // Re-resolve once an address exists: Stripe may already
                // have a customer under it, and linking beats duplicating.
                if (email.includes("@")) setCommittedEmail(email);
              }}
            />
          )}
          {isStripe && committedEmail && (
            <Hidden name="stripeContactEmail" value={committedEmail} />
          )}
          {isStripe && needsStripeDueDate && (
            <DatePicker
              name="stripeDueDate"
              label={t`Stripe Due Date`}
              helperText={t`This invoice has no usable due date — choose one for Stripe.`}
              minValue={minStripeDueDate}
              maxValue={maxStripeDueDate}
              isRequired
            />
          )}
          {notificationType === "Email" && (
            <EmailRecipients name="cc" label={t`CC`} type="employee" />
          )}
        </VStack>
      </ModalBody>
      <ModalFooter>
        <HStack>
          <Button variant="secondary" onClick={onClose}>
            <Trans>Cancel</Trans>
          </Button>
          <Button
            isDisabled={
              fetcher.state !== "idle" ||
              isStripeBlocked ||
              (notificationType === "Email" && contactMissingEmail)
            }
            isLoading={fetcher.state !== "idle"}
            type="submit"
          >
            {hasLinesToShip ? "Post and Ship Invoice" : "Post Invoice"}
          </Button>
        </HStack>
      </ModalFooter>
    </ValidatedForm>
  );
};

export default SalesInvoicePostModal;
