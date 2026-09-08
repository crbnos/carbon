import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { VStack } from "@carbon/react";
import type { FundingSource } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData } from "react-router";
import {
  AvailableCreditsTable,
  getAvailableCreditsForParty,
  getAvailableOnAccountCreditSources,
  getInvoiceSettlements,
  getOpenPurchaseInvoicesForSupplier,
  getOpenSalesInvoicesForCustomer,
  getPayment,
  getPaymentCurrencyConfiguration,
  getStagedCreditsForPayment,
  isPaymentLocked,
  PaymentApplications,
  PaymentApplyTable,
  PaymentForm,
  paymentValidator,
  upsertPayment
} from "~/modules/invoicing";
import { setCustomFields } from "~/utils/form";
import { detailBreadcrumb, type Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: detailBreadcrumb(
    { breadcrumb: "Payments", to: path.to.payments },
    (data) => data?.payment?.paymentId
  ),
  module: "invoicing"
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "invoicing"
  });
  const { paymentId } = params;
  if (!paymentId) throw notFound("Missing paymentId");
  const [payment, applications] = await Promise.all([
    getPayment(client, paymentId, companyId),
    getInvoiceSettlements(client, companyId, paymentId)
  ]);
  if (payment.error || !payment.data)
    throw redirect(
      path.to.payments,
      await flash(request, error(payment.error, "Failed to load payment"))
    );
  try {
    if (applications.error) throw new Error(applications.error.message);
    const configuration = await getPaymentCurrencyConfiguration(
      client,
      companyId,
      payment.data.currencyCode
    );
    let openInvoices: NonNullable<
      Awaited<ReturnType<typeof getOpenSalesInvoicesForCustomer>>["data"]
    > = [];
    let funding = {
      sources: [] as FundingSource[],
      availableDocumentAmount: 0,
      availableBaseAmount: 0
    };
    let availableCredits: NonNullable<
      Awaited<ReturnType<typeof getAvailableCreditsForParty>>["data"]
    > = [];
    let stagedCredits: NonNullable<
      Awaited<ReturnType<typeof getStagedCreditsForPayment>>["data"]
    > = [];
    if (payment.data.status === "Draft") {
      const isAR = payment.data.paymentType === "Receipt";
      const partyId = isAR ? payment.data.customerId : payment.data.supplierId;
      if (!partyId) throw new Error("Payment party is required");
      const [invoices, credit, credits, staged] = await Promise.all([
        isAR
          ? getOpenSalesInvoicesForCustomer(
              client,
              companyId,
              partyId,
              payment.data.currencyCode
            )
          : getOpenPurchaseInvoicesForSupplier(
              client,
              companyId,
              partyId,
              payment.data.currencyCode
            ),
        getAvailableOnAccountCreditSources(
          client,
          companyId,
          isAR
            ? { paymentType: "Receipt", customerId: partyId }
            : { paymentType: "Disbursement", supplierId: partyId },
          payment.data.currencyCode
        ),
        getAvailableCreditsForParty(
          client,
          companyId,
          isAR
            ? { side: "sales", customerId: partyId }
            : { side: "purchase", supplierId: partyId },
          paymentId,
          payment.data.currencyCode
        ),
        getStagedCreditsForPayment(
          client,
          paymentId,
          isAR ? "sales" : "purchase",
          companyId
        )
      ]);
      const loadError =
        invoices.error ?? credit.error ?? credits.error ?? staged.error;
      if (loadError) throw loadError;
      if (!credit.data) throw new Error("Unable to load payment funding");
      openInvoices = invoices.data ?? [];
      funding = credit.data;
      availableCredits = credits.data ?? [];
      stagedCredits = staged.data ?? [];
    }
    return {
      payment: payment.data,
      applications: applications.data ?? [],
      openInvoices,
      funding,
      availableCredits,
      stagedCredits,
      ...configuration
    };
  } catch (e) {
    throw redirect(
      path.to.payments,
      await flash(
        request,
        error(
          e,
          e instanceof Error ? e.message : "Failed to load payment balances"
        )
      )
    );
  }
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
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
  const existing = await getPayment(client, paymentId, companyId);
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

  try {
    await getPaymentCurrencyConfiguration(
      client,
      companyId,
      validation.data.currencyCode
    );
  } catch (e) {
    throw redirect(
      path.to.payment(paymentId),
      await flash(
        request,
        error(
          e,
          e instanceof Error ? e.message : "Invalid currency configuration"
        )
      )
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
    funding,
    baseCurrencyCode,
    currencyDecimals,
    availableCredits,
    stagedCredits
  } = useLoaderData<typeof loader>();
  const locked = isPaymentLocked(payment.status);
  const side: "sales" | "purchase" = payment.customerId ? "sales" : "purchase";

  const initialValues = {
    id: payment.id,
    paymentId: payment.paymentId,
    paymentType: payment.paymentType,
    customerId: payment.customerId ?? "",
    supplierId: payment.supplierId ?? "",
    paymentDate: payment.paymentDate,
    currencyCode: payment.currencyCode ?? "",
    exchangeRate: Number(payment.exchangeRate),
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
        paymentCurrency={payment.currencyCode}
        baseCurrency={baseCurrencyCode}
      />

      {!locked && (
        <PaymentApplyTable
          paymentId={payment.id}
          paymentType={payment.paymentType}
          paymentCurrency={payment.currencyCode}
          baseCurrency={baseCurrencyCode}
          currencyDecimals={currencyDecimals}
          priorSources={funding.sources}
          paymentTotal={Number(payment.totalAmount)}
          paymentExchangeRate={Number(payment.exchangeRate)}
          availableCredit={funding.availableDocumentAmount}
          openInvoices={(openInvoices ?? []).map((inv) => ({
            id: inv.id,
            invoiceId: inv.invoiceId ?? inv.id,
            dateDue: inv.dateDue,
            currencyCode: inv.currencyCode,
            exchangeRate: Number(inv.exchangeRate),
            totalAmount: Number(inv.totalAmount ?? 0),
            balance: Number(inv.balance ?? 0),
            remainingDocument: inv.remainingDocument,
            status: inv.status
          }))}
          existingApplications={applications.map((a) => ({
            targetSalesInvoiceId: a.targetSalesInvoiceId,
            targetPurchaseInvoiceId: a.targetPurchaseInvoiceId,
            sourceAmount: a.sourceAmount,
            sourcePaymentId: a.sourcePaymentId,
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
          currency={baseCurrencyCode}
          documentCurrency={payment.currencyCode}
          documentDecimals={currencyDecimals}
          credits={availableCredits.map((c) => ({
            id: c.id,
            memoId: c.memoId,
            direction: c.direction,
            currencyCode: c.currencyCode,
            exchangeRate: Number(c.exchangeRate),
            remaining: Number(c.remaining),
            remainingDocument: c.remainingDocument
          }))}
          openInvoices={(openInvoices ?? []).map((inv) => ({
            id: inv.id,
            invoiceId: inv.invoiceId ?? inv.id,
            exchangeRate: Number(inv.exchangeRate),
            balance: Number(inv.balance ?? 0),
            remainingDocument: inv.remainingDocument
          }))}
          staged={stagedCredits}
        />
      )}
    </VStack>
  );
}
