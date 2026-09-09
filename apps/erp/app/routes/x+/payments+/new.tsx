import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { Database } from "@carbon/database";
import { validationError, validator } from "@carbon/form";
import { datetime, round } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { getCurrencyByCode, getDefaultAccounts } from "~/modules/accounting";
import {
  computeEarlyPaymentDiscounts,
  getOpenPurchaseInvoicesForSupplier,
  getOpenSalesInvoicesForCustomer,
  PaymentForm,
  paymentValidator,
  replaceInvoiceSettlements,
  upsertPayment
} from "~/modules/invoicing";
import { getCompany, getNextSequence } from "~/modules/settings";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import { getDatabaseClient } from "~/services/database.server";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

// Open invoices the apply table / seed logic can settle, keyed by id with the
// fields needed to seed one application per invoice.
async function getSeedableOpenInvoices(
  client: SupabaseClient<Database>,
  companyId: string,
  paymentType: "Receipt" | "Disbursement",
  partyId: string
) {
  const res =
    paymentType === "Receipt"
      ? await getOpenSalesInvoicesForCustomer(client, companyId, partyId)
      : await getOpenPurchaseInvoicesForSupplier(client, companyId, partyId);
  return res.data ?? [];
}

// Resolve the payment currency's decimals, then the early-payment discount per
// invoice as of `asOfDate`. Returns an all-zero map (no discount) when the
// currency can't be resolved, so a missing currency never blocks seeding.
async function getSeededDiscounts(
  client: SupabaseClient<Database>,
  companyId: string,
  companyGroupId: string,
  currencyCode: string,
  asOfDate: string,
  invoices: {
    id?: string | null;
    balance?: number | null;
    dateIssued?: string | null;
    paymentTermId?: string | null;
  }[]
): Promise<Map<string, number>> {
  const currency = await getCurrencyByCode(
    client,
    companyGroupId,
    currencyCode
  );
  const currencyDecimals = currency.data?.decimalPlaces;
  if (currencyDecimals == null) {
    return new Map(invoices.map((inv) => [inv.id ?? "", 0]));
  }
  return computeEarlyPaymentDiscounts(client, {
    companyId,
    asOfDate,
    currencyDecimals,
    invoices: invoices.map((inv) => ({
      id: inv.id ?? "",
      balance: Number(inv.balance ?? 0),
      dateIssued: inv.dateIssued ?? null,
      paymentTermId: inv.paymentTermId ?? null
    }))
  });
}

// Loader pre-fills the form. Query params:
//   customerId  -> seeds counterparty + paymentType=Receipt
//   supplierId  -> seeds counterparty + paymentType=Disbursement
//   invoiceId   -> one or more; their open balances are summed into the total
//                  and (on submit) one application is seeded per invoice
//   amount      -> fallback total when no invoiceId is supplied
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, companyGroupId } = await requirePermissions(
    request,
    {
      create: "invoicing"
    }
  );

  const url = new URL(request.url);
  const customerId = url.searchParams.get("customerId");
  const supplierId = url.searchParams.get("supplierId");
  const invoiceIds = url.searchParams.getAll("invoiceId");
  const amount = url.searchParams.get("amount");

  const paymentType: "Receipt" | "Disbursement" = supplierId
    ? "Disbursement"
    : "Receipt";
  const partyId = paymentType === "Receipt" ? customerId : supplierId;

  const [company, defaults] = await Promise.all([
    getCompany(client, companyId),
    getDefaultAccounts(client, companyId)
  ]);
  const bankAccount = defaults.data?.bankCashAccount ?? "";

  let currencyCode = company.data?.baseCurrencyCode ?? "";
  let exchangeRate = 1;
  let totalAmount = amount ? Number(amount) : 0;

  const paymentDate = datetime
    .today(await getCompanyTimeZone(client, companyId))
    .toString();

  // When seeded from invoices, the total and currency come from the invoices
  // themselves (authoritative), not the URL amount. The seeded total is NET of
  // any early-payment discount the invoice's terms grant as of the payment date,
  // so a "2/10 net 30" invoice paid today pre-fills the discounted cash amount.
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
      exchangeRate = Number(selected[0].exchangeRate ?? 1);
      const discounts = await getSeededDiscounts(
        client,
        companyId,
        companyGroupId,
        currencyCode,
        paymentDate,
        selected
      );
      totalAmount = selected.reduce(
        (sum, inv) =>
          sum +
          round(Number(inv.balance ?? 0) - (discounts.get(inv.id ?? "") ?? 0)),
        0
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
      memo: ""
    },
    seedInvoiceIds: invoiceIds
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, companyGroupId, userId } =
    await requirePermissions(request, {
      create: "invoicing"
    });

  const formData = await request.formData();
  // Hidden field set by the loader so the action can seed applications without
  // re-reading the URL.
  const seedInvoiceIds = String(formData.get("seedInvoiceIds") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const validation = await validator(paymentValidator).validate(formData);
  if (validation.error) {
    return validationError(validation.error);
  }

  let paymentId = validation.data.paymentId;
  if (!paymentId) {
    const next = await getNextSequence(client, "payment", companyId);
    if (next.error || !next.data) {
      throw redirect(
        path.to.payments,
        await flash(request, error(next.error, "Failed to allocate payment id"))
      );
    }
    paymentId = next.data;
  }

  // The form posts a hidden `id` as "" which validates to null. The create
  // branch must omit it so the table's xid() default generates the id.
  const { id: _omitId, ...paymentData } = validation.data;

  const insert = await upsertPayment(client, {
    ...paymentData,
    paymentId,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });
  if (insert.error || !insert.data) {
    throw redirect(
      path.to.payments,
      await flash(request, error(insert.error, "Failed to create payment"))
    );
  }

  // Seed one application per selected invoice for its full open balance. Each
  // invoice's balance + rate are re-fetched server-side so the seed always
  // reflects the current books. The user can still adjust via the apply table.
  if (seedInvoiceIds.length > 0) {
    const isReceipt = validation.data.paymentType === "Receipt";
    const partyId = isReceipt
      ? validation.data.customerId
      : validation.data.supplierId;
    try {
      const open = partyId
        ? await getSeedableOpenInvoices(
            client,
            companyId,
            validation.data.paymentType,
            partyId
          )
        : [];
      const selected = open.filter((inv) =>
        seedInvoiceIds.includes(inv.id ?? "")
      );
      if (selected.length > 0) {
        // Seed the early-payment discount from each invoice's terms as of the
        // chosen payment date, so applied + discount = balance (settles the
        // invoice in full without over-settling). The discount uses the SAME
        // date basis as the loader's total, so the two agree for the default
        // (pay today) case.
        const discounts = await getSeededDiscounts(
          client,
          companyId,
          companyGroupId,
          validation.data.currencyCode,
          validation.data.paymentDate,
          selected
        );
        await replaceInvoiceSettlements(getDatabaseClient(), {
          paymentId: insert.data.id,
          companyId,
          createdBy: userId,
          applications: selected.map((inv) => {
            const discount = discounts.get(inv.id ?? "") ?? 0;
            return {
              targetSalesInvoiceId: isReceipt
                ? (inv.id ?? undefined)
                : undefined,
              targetPurchaseInvoiceId: isReceipt
                ? undefined
                : (inv.id ?? undefined),
              appliedAmount: round(Number(inv.balance ?? 0) - discount),
              discountAmount: discount,
              writeOffAmount: 0,
              targetExchangeRate: Number(inv.exchangeRate ?? 1),
              sourceExchangeRate: Number(validation.data.exchangeRate) || 1,
              appliedDate: validation.data.paymentDate
            };
          })
        });
      }
    } catch (e) {
      // The payment was created (a Draft with no applications is valid), but
      // seeding failed. Send the user to the detail page to apply manually.
      throw redirect(
        path.to.payment(insert.data.id),
        await flash(
          request,
          error(e, "Payment created, but applying it to the invoices failed")
        )
      );
    }
  }

  throw redirect(
    path.to.payment(insert.data.id),
    await flash(request, success("Payment created"))
  );
}

export default function NewPaymentRoute() {
  const { initialValues, seedInvoiceIds } = useLoaderData<typeof loader>();
  return (
    <div className="max-w-4xl w-full p-2 sm:p-0 mx-auto mt-0 md:mt-8">
      <PaymentForm
        initialValues={initialValues}
        seedInvoiceIds={seedInvoiceIds}
      />
    </div>
  );
}
