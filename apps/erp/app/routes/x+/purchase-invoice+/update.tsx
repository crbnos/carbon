import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { getExchangeRate } from "~/modules/accounting";
import {
  computeInvoiceDateDue,
  isPurchaseInvoiceLocked
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

  // Check if any of the PIs are locked
  const { data } = await client
    .from("purchaseInvoice")
    .select("id, status")
    .in("id", ids as string[]);

  const editableFields = ["dateIssued", "dateDue", "datePaid"];
  if (!editableFields.includes(field)) {
    const lockedError = requireUnlockedBulk({
      statuses: (data ?? []).map((d) => d.status),
      checkFn: isPurchaseInvoiceLocked,
      message: "Cannot modify a confirmed purchase invoice."
    });
    if (lockedError) return lockedError;
  }

  switch (field) {
    case "invoiceSupplierId":
      let currencyCode: string | undefined;
      if (value && ids.length === 1) {
        const supplier = await client
          ?.from("supplier")
          .select("currencyCode")
          .eq("id", value)
          .single();

        if (supplier.data?.currencyCode) {
          currencyCode = supplier.data.currencyCode;
          const rate = await getExchangeRate(client, companyId, currencyCode);
          if (rate.error) return rate;
          return await client
            .from("purchaseInvoice")
            .update({
              invoiceSupplierId: value ?? undefined,
              invoiceSupplierContactId: null,
              invoiceSupplierLocationId: null,
              currencyCode: currencyCode ?? undefined,
              exchangeRate: rate.data,
              updatedBy: userId,
              updatedAt: new Date().toISOString()
            })
            .in("id", ids as string[]);
        }
      }

      return await client
        .from("purchaseInvoice")
        .update({
          supplierId: value ?? undefined,
          updatedBy: userId,
          updatedAt: new Date().toISOString()
        })
        .in("id", ids as string[]);
    case "dateIssued":
      if (ids.length === 1) {
        const invoice = await client
          .from("purchaseInvoice")
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
          .from("purchaseInvoice")
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
          .from("purchaseInvoice")
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
          .from("purchaseInvoice")
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
          .from("purchaseInvoice")
          .update({
            currencyCode: value as string,
            exchangeRate: rate.data,
            updatedBy: userId,
            updatedAt: new Date().toISOString()
          })
          .in("id", ids as string[]);
      }
    // don't break -- just let it catch the next case
    case "supplierId":
    case "invoiceSupplierContactId":
    case "invoiceSupplierLocationId":
    case "locationId":
    case "supplierReference":
    case "exchangeRate":
    case "dateDue":
    case "datePaid":
      return await client
        .from("purchaseInvoice")
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
