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
import {
  DEFAULT_PAYMENT_TERM,
  distinctItemText,
  formatExchangeRate
} from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
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
  useCurrencyDecimals,
  useCurrencyFormatter,
  useQuantityFormatter,
  useRouteData,
  useUser
} from "~/hooks";
import { useIntegrations } from "~/hooks/useIntegrations";
import type { StripeCustomerResolution } from "~/modules/invoicing/invoicing.service";
import { path } from "~/utils/path";
import { salesInvoicePostValidator } from "../../invoicing.models";
import type {
  SalesInvoicePostCheck,
  SalesInvoicePostFacts
} from "../../invoicing.utils";
import {
  salesInvoiceLineAmounts,
  salesInvoicePostChecks
} from "../../invoicing.utils";
import type { SalesInvoice, SalesInvoiceLine } from "../../types";
import StripeCustomerPanel from "./StripeCustomerPanel";
import { useSalesInvoiceLineName } from "./useSalesInvoiceLineName";
import { useSalesInvoiceTotals } from "./useSalesInvoiceTotals";

/** What the post action answers: the operation's result, or the violations. */
export type SalesInvoicePostResult = {
  data?: {
    sentVia: "Email" | "Stripe" | null;
    warning: string | null;
    /** The auto-issued certificates' outcome; the post stands either way. */
    certificate?: { ok: boolean; message: string } | null;
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
  /** The order facts the checks compare against; null when unread. */
  postFacts: SalesInvoicePostFacts | null;
  /** The facts could not be read, so the order checks did not run. */
  postFactsFailed: boolean;
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
 * caught while it can still be changed. Only what `salesInvoicePostChecks`
 * finds is flagged in amber; everything else, $0 shipping included, is shown
 * plainly. The checks are nudges, not blocks. Amounts are in base currency
 * with the invoice's own currency under them, and line amounts include tax,
 * as on the invoice card. The due date is not shown: posting sets it from the
 * payment term.
 */
const SalesInvoicePostSummary = ({
  invoiceId,
  postFacts,
  postFactsFailed
}: {
  invoiceId: string;
  postFacts: SalesInvoicePostFacts | null;
  postFactsFailed: boolean;
}) => {
  const { t } = useLingui();
  const { locale } = useLocale();
  const { company } = useUser();
  const lineName = useSalesInvoiceLineName();
  const formatQuantity = useQuantityFormatter();
  const routeData = useRouteData<{
    salesInvoice: SalesInvoice;
    salesInvoiceLines: SalesInvoiceLine[];
  }>(path.to.salesInvoice(invoiceId));
  const totals = useSalesInvoiceTotals(invoiceId);

  const baseCurrency = company?.baseCurrencyCode ?? "USD";
  const baseDecimals = useCurrencyDecimals(baseCurrency);
  const formatter = useCurrencyFormatter({ currency: baseCurrency });
  const priceFormatter = useCurrencyFormatter({
    currency: baseCurrency,
    rate: true
  });
  const presentationCurrencyFormatter = useCurrencyFormatter({
    currency: routeData?.salesInvoice?.currencyCode ?? "USD"
  });

  const salesInvoice = routeData?.salesInvoice;
  const lines = routeData?.salesInvoiceLines ?? [];
  if (!salesInvoice) return null;

  const checks = salesInvoicePostChecks({
    lines,
    shippingCost: totals.shippingCost,
    currencyCode: salesInvoice.currencyCode,
    exchangeRate: salesInvoice.exchangeRate,
    baseCurrencyCode: company?.baseCurrencyCode ?? null,
    decimals: baseDecimals,
    facts: postFacts
  });
  const lineChecks = new Map<string, SalesInvoicePostCheck[]>();
  for (const check of checks) {
    if (!("lineId" in check)) continue;
    lineChecks.set(check.lineId, [
      ...(lineChecks.get(check.lineId) ?? []),
      check
    ]);
  }
  const count = (type: SalesInvoicePostCheck["type"]) =>
    checks.filter((check) => check.type === type).length;
  const noPrice = count("noPrice");
  const noQuantity = count("noQuantity");
  const overInvoiced = count("overInvoiced");
  const billedByContract = count("billedByContract");
  const chargesLeftOff = count("orderChargesLeftOff");

  const billsAnotherCustomer =
    !!salesInvoice.invoiceCustomerId &&
    salesInvoice.invoiceCustomerId !== salesInvoice.customerId;
  // Posting gives an invoice with no term `DEFAULT_PAYMENT_TERM` (Net 30).
  const defaultTermDays = DEFAULT_PAYMENT_TERM.daysDue;

  // Base currency first, the invoice's own currency under it.
  const money = (base: number, customer: number, className?: string) => (
    <>
      <span className={className}>{formatter.format(base)}</span>
      {totals.shouldConvertCurrency && (
        <span className="text-xs text-muted-foreground">
          {presentationCurrencyFormatter.format(customer)}
        </span>
      )}
    </>
  );

  const lineCheckText = (check: SalesInvoicePostCheck) => {
    switch (check.type) {
      case "noQuantity":
        return t`No quantity`;
      case "noPrice":
        return t`No price`;
      case "overInvoiced": {
        const remaining = formatQuantity(check.remainingQuantity);
        return t`Only ${remaining} left to invoice on the order`;
      }
      case "billedByContract":
        return t`A contract made from the order bills this line`;
      case "orderChargesLeftOff": {
        const amount = formatter.format(check.amount);
        return t`${amount} of the order line's charges not billed`;
      }
      default:
        return null;
    }
  };

  return (
    <VStack spacing={3} className="w-full">
      {checks.length > 0 && (
        <Alert variant="warning">
          <LuTriangleAlert />
          <AlertTitle>
            <Trans>Check before posting</Trans>
          </AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4 space-y-0.5">
              {checks.map((check) => {
                if (check.type === "orderShippingLeftOff") {
                  const order = check.salesOrderReadableId;
                  const amount = formatter.format(check.amount);
                  return (
                    <li key={`shipping-${order}`}>
                      <Trans>
                        {order} has {amount} of shipping that is not on any
                        invoice
                      </Trans>
                    </li>
                  );
                }
                if (check.type === "exchangeRateNotSet") {
                  const currencyCode = check.currencyCode;
                  const currentRate = formatExchangeRate(
                    check.currentRate,
                    locale
                  );
                  return (
                    <li key="exchange-rate">
                      <Trans>
                        This invoice uses a rate of 1 for {currencyCode}, but
                        today's rate is {currentRate}
                      </Trans>
                    </li>
                  );
                }
                return null;
              })}
              {noPrice > 0 && (
                <li>
                  <Plural
                    value={noPrice}
                    one="# line has no price"
                    other="# lines have no price"
                  />
                </li>
              )}
              {noQuantity > 0 && (
                <li>
                  <Plural
                    value={noQuantity}
                    one="# line has no quantity"
                    other="# lines have no quantity"
                  />
                </li>
              )}
              {overInvoiced > 0 && (
                <li>
                  <Plural
                    value={overInvoiced}
                    one="# line bills more than its order has left to invoice"
                    other="# lines bill more than their order has left to invoice"
                  />
                </li>
              )}
              {billedByContract > 0 && (
                <li>
                  <Plural
                    value={billedByContract}
                    one="# line is billed by a contract made from its order"
                    other="# lines are billed by contracts made from their orders"
                  />
                </li>
              )}
              {chargesLeftOff > 0 && (
                <li>
                  <Plural
                    value={chargesLeftOff}
                    one="# line leaves off add-ons or shipping from its order"
                    other="# lines leave off add-ons or shipping from their order"
                  />
                </li>
              )}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {postFactsFailed && (
        <p className="w-full text-sm text-muted-foreground">
          <Trans>
            The sales order could not be read, so it was not checked against
            this invoice.
          </Trans>
        </p>
      )}

      <div className="w-full rounded-lg border text-sm">
        <div className="space-y-1 px-3 py-2">
          <SummaryFact label={t`Customer`}>
            <CustomerAvatar customerId={salesInvoice.customerId ?? null} />
          </SummaryFact>
          {billsAnotherCustomer && (
            <SummaryFact label={t`Bill To`}>
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
          <SummaryFact label={t`Payment Term`}>
            {salesInvoice.paymentTermName || (
              <span className="text-muted-foreground">
                <Trans>None (Net {defaultTermDays})</Trans>
              </span>
            )}
          </SummaryFact>
          {totals.shouldConvertCurrency && (
            <SummaryFact label={t`Currency`}>
              <span className="tabular-nums">
                {salesInvoice.currencyCode} @{" "}
                {formatExchangeRate(salesInvoice.exchangeRate ?? 1, locale)}
              </span>
            </SummaryFact>
          )}
        </div>
        <div className="border-t max-h-48 overflow-y-auto">
          {lines.map((line, index) => {
            const key = line.id ?? `line-${index}`;
            if (line.invoiceLineType === "Comment") {
              return (
                <div
                  key={key}
                  className="px-3 py-2 text-muted-foreground line-clamp-2"
                >
                  {line.description}
                </div>
              );
            }
            const name = lineName(line) ?? line.description ?? "";
            const description = distinctItemText(name, line.description);
            const amounts = salesInvoiceLineAmounts(line);
            const flagged = line.id ? (lineChecks.get(line.id) ?? []) : [];
            return (
              <div
                key={key}
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
                    {formatQuantity(line.quantity ?? 0)} ×{" "}
                    {priceFormatter.format(line.netUnitPrice ?? 0)}
                  </span>
                  {flagged.map((check) => (
                    <span
                      key={check.type}
                      className="text-xs font-medium text-amber-600 dark:text-amber-400"
                    >
                      {lineCheckText(check)}
                    </span>
                  ))}
                </div>
                <div
                  className={cn(
                    "flex shrink-0 flex-col items-end tabular-nums",
                    flagged.length > 0 &&
                      "font-medium text-amber-600 dark:text-amber-400"
                  )}
                >
                  {money(amounts.total, amounts.customerTotal)}
                </div>
              </div>
            );
          })}
        </div>

        <div className="border-t px-3 py-2 space-y-1 text-muted-foreground">
          <div className="flex items-start justify-between">
            <span>
              <Trans>Subtotal</Trans>
            </span>
            <div className="flex flex-col items-end tabular-nums">
              {money(totals.subtotal, totals.customerSubtotal)}
            </div>
          </div>
          <div className="flex items-start justify-between">
            <span>
              <Trans>Tax</Trans>
            </span>
            <div className="flex flex-col items-end tabular-nums">
              {money(totals.tax, totals.customerTax)}
            </div>
          </div>
          <div className="flex items-start justify-between">
            <span>
              <Trans>Shipping</Trans>
            </span>
            <div className="flex flex-col items-end tabular-nums">
              {money(totals.shippingCost, totals.customerShippingCost)}
            </div>
          </div>
        </div>

        <div className="flex items-start justify-between border-t px-3 py-2.5">
          <span className="text-base font-semibold">
            <Trans>Total</Trans>
          </span>
          <div className="flex flex-col items-end tabular-nums">
            {money(
              totals.total,
              totals.customerTotal,
              "text-base font-semibold"
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
  postFacts,
  postFactsFailed,
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

  useEffect(() => {
    if (!isStripe || !contactId) return;
    loadedKeyRef.current = requestKey;
    stripeCustomer.load(
      path.to.api.stripeConnectCustomer(invoiceId, contactId, committedEmail)
    );
    // oxlint-disable-next-line react/exhaustive-deps -- `stripeCustomer` is a fresh object each render, so depending on it would re-run this effect forever.
  }, [isStripe, contactId, invoiceId, committedEmail]);

  // Errors are toasted and violations shown by the violation hook.
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
    if (posted.certificate) {
      if (posted.certificate.ok) toast.success(posted.certificate.message);
      else toast.error(posted.certificate.message);
    }
    onClose();
    // oxlint-disable-next-line react/exhaustive-deps -- runs once per answer
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
          <SalesInvoicePostSummary
            invoiceId={invoiceId}
            postFacts={postFacts}
            postFactsFailed={postFactsFailed}
          />
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
            <EmailRecipients
              name="cc"
              label={t`CC`}
              type="employee"
              customerId={customerId ?? undefined}
            />
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
