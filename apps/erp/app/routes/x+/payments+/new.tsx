// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@carbon/react";
import { datetime, redirect, toDocumentAmount } from "@carbon/utils";
import { Trans } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { NewRecordPage } from "~/components/NewRecordPage";
import { getDefaultAccounts } from "~/modules/accounting/accounting.service";
import { paymentValidator } from "~/modules/invoicing/invoicing.models";
import {
  checkDepositDocument,
  getDepositDocuments,
  getPaymentCurrencyConfiguration,
  getSeedableOpenInvoices,
  getSeededDiscounts
} from "~/modules/invoicing/invoicing.service";
import { PaymentForm } from "~/modules/invoicing/ui";
import { getCompany } from "~/modules/settings/settings.service";
import { getCompanyTimeZone } from "~/modules/shared/shared.service";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

// Loader pre-fills the form. Query params:
//   customerId  -> seeds counterparty + paymentType=Receipt
//   supplierId  -> seeds counterparty + paymentType=Disbursement
//   invoiceId   -> one or more; their open balances are summed into the total
//                  and (on submit) one application is seeded per invoice
//   amount      -> fallback total when no invoiceId is supplied
//   salesOrderId / rentalAgreementId -> seeds the deposit document
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, companyGroupId } = await requirePermissions(
    request,
    { create: "invoicing" }
  );

  const url = new URL(request.url);
  const customerId = url.searchParams.get("customerId");
  const supplierId = url.searchParams.get("supplierId");
  const invoiceIds = url.searchParams.getAll("invoiceId");
  const amount = url.searchParams.get("amount");
  const salesOrderId = url.searchParams.get("salesOrderId");
  const rentalAgreementId = url.searchParams.get("rentalAgreementId");

  const paymentType: "Receipt" | "Disbursement" = supplierId
    ? "Disbursement"
    : "Receipt";
  const partyId = paymentType === "Receipt" ? customerId : supplierId;

  const [company, defaults, depositDocuments] = await Promise.all([
    getCompany(client, companyId),
    getDefaultAccounts(client, companyId),
    getDepositDocuments(client, companyId, [salesOrderId])
  ]);
  const bankAccount = defaults.data?.bankCashAccount ?? "";

  let currencyCode = company.data?.baseCurrencyCode ?? "";
  let exchangeRate = 1;
  let totalAmount = amount ? Number(amount) : 0;

  // Resolved before seeding: the discount window is evaluated as of this date.
  const paymentDate = datetime
    .today(await getCompanyTimeZone(client, companyId))
    .toString();

  // When seeded from invoices, the total and currency come from the invoices
  // themselves (authoritative), not the URL amount.
  if (invoiceIds.length > 0 && partyId) {
    const open = await getSeedableOpenInvoices(
      client,
      companyId,
      paymentType,
      partyId
    );
    const selected = open.filter((inv) => invoiceIds.includes(inv.id ?? ""));
    if (selected.length > 0) {
      currencyCode = selected[0].currencyCode ?? currencyCode;
      exchangeRate = Number(selected[0].exchangeRate);
      if (selected.some((inv) => inv.currencyCode !== currencyCode))
        throw redirect(
          path.to.payments,
          await flash(
            request,
            error(null, "Selected invoices must use the same currency")
          )
        );
      const configuration = await getPaymentCurrencyConfiguration(
        client,
        companyId,
        currencyCode
      );
      // Net of any early-payment discount the invoice's terms grant as of the
      // payment date, so a "2/10 net 30" invoice paid today pre-fills the
      // discounted cash amount.
      const discounts = await getSeededDiscounts(
        client,
        companyId,
        companyGroupId,
        currencyCode,
        paymentDate,
        selected
      );
      totalAmount = toDocumentAmount(
        selected.reduce(
          (sum, inv) =>
            sum + inv.remainingDocument - (discounts.get(inv.id ?? "") ?? 0),
          0
        ),
        1,
        configuration.currencyDecimals
      );
    }
  }

  return {
    initialValues: {
      paymentId: "",
      paymentType,
      customerId: customerId ?? "",
      supplierId: supplierId ?? "",
      paymentDate,
      currencyCode,
      exchangeRate,
      totalAmount,
      bankAccount,
      reference: "",
      memo: "",
      salesOrderId: salesOrderId ?? "",
      rentalAgreementId: rentalAgreementId ?? ""
    },
    seedInvoiceIds: invoiceIds,
    depositDocuments
  };
}

export async function action(args: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(args.request, {
    create: "invoicing"
  });
  const input = await validator(paymentValidator).request(args);
  if ("invalid" in input) return input.invalid;
  // `createPayment` refuses the same deposit; checked here too so only that
  // refusal lands on the "Deposit for" field, and every other one is a toast.
  const depositError = await checkDepositDocument(
    client,
    companyId,
    input.data
  );
  if (depositError) {
    return validationError({ fieldErrors: { depositDocument: depositError } });
  }
  const formData = input.formData ?? new FormData();
  const api = await carbon(args.request);
  const result = await api.invoicing.createPayment({
    ...input.data,
    customFields: setCustomFields(formData),
    // Set by the loader, so the action can seed applications without
    // reading the URL again.
    seedInvoiceIds: String(formData.get("seedInvoiceIds") ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
  });
  if (!result.data) {
    return respond(args.request, result).redirect(path.to.paymentNew);
  }
  // The payment exists either way; a failed seed is applied by hand there.
  const { id, warning } = result.data;
  return respond(args.request, {
    error: warning ? { message: warning } : null
  }).redirect(path.to.payment(id), { message: "Payment created" });
}

export default function NewPaymentRoute() {
  const { initialValues, seedInvoiceIds, depositDocuments } =
    useLoaderData<typeof loader>();
  return (
    <NewRecordPage>
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>New Payment</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>
              Record a customer payment, supplier payment, refund, or employee
              reimbursement. Applications to invoices, memos or reimbursements
              are added after the payment is created.
            </Trans>
          </CardDescription>
        </CardHeader>
        <CardContent className="@container">
          <PaymentForm
            initialValues={initialValues}
            seedInvoiceIds={seedInvoiceIds}
            depositDocuments={depositDocuments}
          />
        </CardContent>
      </Card>
    </NewRecordPage>
  );
}
