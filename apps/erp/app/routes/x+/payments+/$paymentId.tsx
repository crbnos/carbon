import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { VStack } from "@carbon/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData } from "react-router";
import {
  AvailableCreditsTable,
  getAvailableCreditsForParty,
  getAvailableOnAccountCredit,
  getInvoiceSettlements,
  getOpenPurchaseInvoicesForSupplier,
  getOpenSalesInvoicesForCustomer,
  getPayment,
  getStagedCreditsForPayment,
  isPaymentLocked,
  PaymentApplications,
  PaymentApplyTable,
  PaymentForm,
  paymentValidator,
  upsertPayment
} from "~/modules/invoicing";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Payments",
  to: path.to.payments
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "invoicing"
  });
  const { paymentId } = params;
  if (!paymentId) throw notFound("Missing paymentId");

  const [payment, applications] = await Promise.all([
    getPayment(client, paymentId),
    getInvoiceSettlements(client, companyId, paymentId)
  ]);

  if (payment.error || !payment.data) {
    throw redirect(
      path.to.payments,
      await flash(request, error(payment.error, "Failed to load payment"))
    );
  }

  // Apply table needs the counterparty's open invoices. Only fetched
  // for Draft payments to keep the Posted/Voided detail render lean.
  // Cast to a common shape — sales and purchase status enums differ
  // ('Submitted' vs 'Open') so TypeScript can't unify the two without
  // help.
  type OpenInvoiceRow = {
    id: string;
    invoiceId: string | null;
    dateDue: string | null;
    currencyCode: string;
    exchangeRate: number;
    totalAmount: number;
    balance: number;
    status: string | null;
  };
  // Available on-account credit (base ccy) the counterparty can draw on when
  // this payment applies more than its cash. Only needed while editing a Draft.
  // Posted credits (balance-reducing memos) the party can apply to open invoices
  // alongside this payment's cash — the credits half of the settlement composer.
  type AvailableCreditRow = {
    id: string;
    memoId: string;
    direction: string;
    currencyCode: string;
    exchangeRate: number;
    remaining: number;
  };
  let availableCreditBase = 0;
  let openInvoices: OpenInvoiceRow[] = [];
  let availableCredits: AvailableCreditRow[] = [];
  let stagedCredits: { memoId: string; invoiceId: string; amount: number }[] =
    [];
  if (payment.data.status === "Draft") {
    if (payment.data.customerId) {
      const [res, credit, credits, staged] = await Promise.all([
        getOpenSalesInvoicesForCustomer(
          client,
          companyId,
          payment.data.customerId
        ),
        getAvailableOnAccountCredit(client, companyId, {
          paymentType: "Receipt",
          customerId: payment.data.customerId
        }),
        getAvailableCreditsForParty(
          client,
          companyId,
          { side: "sales", customerId: payment.data.customerId },
          paymentId
        ),
        getStagedCreditsForPayment(client, paymentId, "sales")
      ]);
      openInvoices = (res.data ?? []) as OpenInvoiceRow[];
      availableCreditBase = credit;
      availableCredits = (credits.data ?? []) as AvailableCreditRow[];
      stagedCredits = staged.data ?? [];
    } else if (payment.data.supplierId) {
      const [res, credit, credits, staged] = await Promise.all([
        getOpenPurchaseInvoicesForSupplier(
          client,
          companyId,
          payment.data.supplierId
        ),
        getAvailableOnAccountCredit(client, companyId, {
          paymentType: "Disbursement",
          supplierId: payment.data.supplierId
        }),
        getAvailableCreditsForParty(
          client,
          companyId,
          { side: "purchase", supplierId: payment.data.supplierId },
          paymentId
        ),
        getStagedCreditsForPayment(client, paymentId, "purchase")
      ]);
      openInvoices = (res.data ?? []) as OpenInvoiceRow[];
      availableCreditBase = credit;
      availableCredits = (credits.data ?? []) as AvailableCreditRow[];
      stagedCredits = staged.data ?? [];
    }
  }

  return {
    payment: payment.data,
    applications: applications.data ?? [],
    openInvoices: openInvoices ?? [],
    availableCreditBase,
    availableCredits,
    stagedCredits
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "invoicing"
  });
  const { paymentId } = params;
  if (!paymentId) throw notFound("Missing paymentId");

  const formData = await request.formData();
  const validation = await validator(paymentValidator).validate(formData);
  if (validation.error) {
    return validationError(validation.error);
  }

  // Only Draft payments are editable; Posted/Voided are immutable.
  const existing = await getPayment(client, paymentId);
  if (existing.error || !existing.data) {
    throw redirect(
      path.to.payments,
      await flash(request, error(existing.error, "Failed to load payment"))
    );
  }
  if (existing.data.status !== "Draft") {
    throw redirect(
      path.to.payment(paymentId),
      await flash(request, error(null, "Only draft payments can be edited"))
    );
  }

  const { id: _omitId, ...paymentData } = validation.data;
  const update = await upsertPayment(client, {
    ...paymentData,
    id: paymentId,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });
  if (update.error) {
    return data(
      {},
      await flash(request, error(update.error, "Failed to update payment"))
    );
  }

  throw redirect(
    path.to.payment(paymentId),
    await flash(request, success("Payment updated"))
  );
}

export default function PaymentDetailRoute() {
  const {
    payment,
    applications,
    openInvoices,
    availableCreditBase,
    availableCredits,
    stagedCredits
  } = useLoaderData<typeof loader>();
  const locked = isPaymentLocked(payment.status);
  const side: "sales" | "purchase" = payment.customerId ? "sales" : "purchase";

  // Convert the base-currency credit pool into the payment's currency so the
  // apply table can compare it against amounts entered in payment currency.
  const exchangeRate = Number(payment.exchangeRate ?? 1) || 1;
  const availableCredit = (availableCreditBase ?? 0) / exchangeRate;

  const initialValues = {
    id: payment.id,
    paymentId: payment.paymentId,
    paymentType: payment.paymentType,
    customerId: payment.customerId ?? "",
    supplierId: payment.supplierId ?? "",
    paymentDate: payment.paymentDate,
    currencyCode: payment.currencyCode ?? "",
    exchangeRate: Number(payment.exchangeRate ?? 1),
    totalAmount: Number(payment.totalAmount ?? 0),
    bankAccount: payment.bankAccount ?? "",
    reference: payment.reference ?? "",
    memo: payment.memo ?? "",
    status: payment.status ?? undefined
  };

  return (
    <VStack spacing={4} className="p-6 max-w-6xl w-full mx-auto">
      <PaymentForm initialValues={initialValues} />
      <PaymentApplications
        applications={applications}
        paymentTotal={Number(payment.totalAmount)}
      />

      {!locked && (
        <PaymentApplyTable
          paymentId={payment.id}
          paymentType={payment.paymentType}
          paymentCurrency={payment.currencyCode}
          paymentTotal={Number(payment.totalAmount)}
          paymentExchangeRate={Number(payment.exchangeRate)}
          availableCredit={availableCredit}
          openInvoices={(openInvoices ?? []).map((inv) => ({
            id: inv.id,
            invoiceId: inv.invoiceId ?? inv.id,
            dateDue: inv.dateDue,
            currencyCode: inv.currencyCode,
            exchangeRate: Number(inv.exchangeRate ?? 1),
            totalAmount: Number(inv.totalAmount ?? 0),
            balance: Number(inv.balance ?? 0),
            status: inv.status
          }))}
          existingApplications={applications.map((a) => ({
            targetSalesInvoiceId: a.targetSalesInvoiceId,
            targetPurchaseInvoiceId: a.targetPurchaseInvoiceId,
            appliedAmount: Number(a.appliedAmount),
            discountAmount: Number(a.discountAmount),
            writeOffAmount: Number(a.writeOffAmount),
            targetExchangeRate: Number(a.targetExchangeRate),
            sourceExchangeRate: Number(a.sourceExchangeRate),
            appliedDate: a.appliedDate
          }))}
        />
      )}

      {!locked && availableCredits.length > 0 && (
        <AvailableCreditsTable
          paymentId={payment.id}
          side={side}
          currency={payment.currencyCode}
          credits={availableCredits.map((c) => ({
            id: c.id,
            memoId: c.memoId,
            direction: c.direction,
            currencyCode: c.currencyCode,
            exchangeRate: Number(c.exchangeRate),
            remaining: Number(c.remaining)
          }))}
          openInvoices={(openInvoices ?? []).map((inv) => ({
            id: inv.id,
            invoiceId: inv.invoiceId ?? inv.id,
            exchangeRate: Number(inv.exchangeRate ?? 1),
            balance: Number(inv.balance ?? 0)
          }))}
          staged={stagedCredits}
        />
      )}
    </VStack>
  );
}
