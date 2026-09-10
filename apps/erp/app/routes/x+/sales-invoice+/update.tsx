import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { getExchangeRate } from "~/modules/accounting";
import {
  computeInvoiceDateDue,
  isSalesInvoiceLocked
} from "~/modules/invoicing";
import { requireUnlockedBulk } from "~/utils/lockedGuard.server";

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const formData = await request.formData();
  const ids = formData.getAll("ids");
  const field = formData.get("field");
  const value = formData.get("value");

  if (
    typeof field !== "string" ||
    (typeof value !== "string" && value !== null)
  ) {
    return { error: { message: "Invalid form data" }, data: null };
  }

  // Check if any of the SIs are locked
  const salesInvoices = await client
    .from("salesInvoice")
    .select("status")
    .in("id", ids as string[]);
  const dateFields = ["dateIssued", "dateDue", "datePaid"];
  if (!dateFields.includes(field)) {
    const lockedError = requireUnlockedBulk({
      statuses: (salesInvoices.data ?? []).map((si) => si.status),
      checkFn: isSalesInvoiceLocked,
      message: "Cannot modify a locked sales invoice."
    });
    if (lockedError) return lockedError;
  }

  switch (field) {
    case "invoiceCustomerId":
      let currencyCode: string | undefined;
      if (value && ids.length === 1) {
        const customer = await client
          ?.from("customer")
          .select("currencyCode")
          .eq("id", value)
          .single();

        if (customer.data?.currencyCode) {
          currencyCode = customer.data.currencyCode;
          const rate = await getExchangeRate(client, companyId, currencyCode);
          if (rate.error) return rate;
          return await client
            .from("salesInvoice")
            .update({
              invoiceCustomerId: value ?? undefined,
              invoiceCustomerContactId: null,
              invoiceCustomerLocationId: null,
              currencyCode: currencyCode ?? undefined,
              exchangeRate: rate.data,
              updatedBy: userId,
              updatedAt: new Date().toISOString()
            })
            .in("id", ids as string[]);
        }
      }

      return await client
        .from("salesInvoice")
        .update({
          customerId: value ?? undefined,
          updatedBy: userId,
          updatedAt: new Date().toISOString()
        })
        .in("id", ids as string[]);
    case "dateIssued":
      if (ids.length === 1) {
        const invoice = await client
          .from("salesInvoice")
          .select("paymentTermId")
          .eq("id", ids[0] as string)
          .eq("companyId", companyId)
          .single();
        const dateDue = await computeInvoiceDateDue(client, {
          dateIssued: value,
          paymentTermId: invoice.data?.paymentTermId,
          companyId
        });
        return await client
          .from("salesInvoice")
          .update({
            dateIssued: value ? value : null,
            ...(dateDue ? { dateDue } : {}),
            updatedBy: userId,
            updatedAt: new Date().toISOString()
          })
          .eq("id", ids[0] as string)
          .eq("companyId", companyId);
      }
      break;
    case "paymentTermId":
      if (ids.length === 1) {
        const invoice = await client
          .from("salesInvoice")
          .select("dateIssued")
          .eq("id", ids[0] as string)
          .eq("companyId", companyId)
          .single();
        const dateDue = await computeInvoiceDateDue(client, {
          dateIssued: invoice.data?.dateIssued,
          paymentTermId: value,
          companyId
        });
        return await client
          .from("salesInvoice")
          .update({
            paymentTermId: value ? value : null,
            ...(dateDue ? { dateDue } : {}),
            updatedBy: userId,
            updatedAt: new Date().toISOString()
          })
          .eq("id", ids[0] as string)
          .eq("companyId", companyId);
      }
      break;
    // don't break -- just let it catch the next case
    case "currencyCode":
      if (value) {
        const rate = await getExchangeRate(client, companyId, value as string);
        if (rate.error) return rate;
        return await client
          .from("salesInvoice")
          .update({
            currencyCode: value as string,
            exchangeRate: rate.data,
            updatedBy: userId,
            updatedAt: new Date().toISOString()
          })
          .in("id", ids as string[]);
      }
    // don't break -- just let it catch the next case
    case "customerId":
    case "invoiceCustomerContactId":
    case "invoiceCustomerLocationId":
    case "locationId":
    case "customerReference":
    case "exchangeRate":
    case "dateDue":
    case "datePaid":
      return await client
        .from("salesInvoice")
        .update({
          [field]: value ? value : null,
          updatedBy: userId,
          updatedAt: new Date().toISOString()
        })
        .in("id", ids as string[]);

    default:
      return { error: { message: "Invalid field" }, data: null };
  }
}
