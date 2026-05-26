import { requirePermissions } from "@carbon/auth/auth.server";
import { parseDate } from "@internationalized/date";
import type { ActionFunctionArgs } from "react-router";
import { getCurrencyByCode } from "~/modules/accounting/accounting.service.server";
import { isPurchaseInvoiceLocked } from "~/modules/invoicing";
import { requireUnlockedBulk } from "~/utils/lockedGuard.server";

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyGroupId, userId } = await requirePermissions(request, {
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
          const currency = await getCurrencyByCode(
            companyGroupId,
            currencyCode
          );
          return await client
            .from("purchaseInvoice")
            .update({
              invoiceSupplierId: value ?? undefined,
              invoiceSupplierContactId: null,
              invoiceSupplierLocationId: null,
              currencyCode: currencyCode ?? undefined,
              exchangeRate: currency.data?.exchangeRate ?? 1,
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
        const paymentTerms = await client
          .from("paymentTerm")
          .select("*")
          .eq("id", value as string)
          .single();
        if (paymentTerms.data) {
          return await client
            .from("purchaseInvoice")
            .update({
              dateIssued: value,
              dateDue: parseDate(value as string)
                .add({ days: paymentTerms.data.daysDue })
                .toString(),
              updatedBy: userId,
              updatedAt: new Date().toISOString()
            })
            .eq("id", ids[0] as string);
        } else {
          return await client
            .from("purchaseInvoice")
            .update({
              [field]: value ? value : null,
              updatedBy: userId,
              updatedAt: new Date().toISOString()
            })
            .in("id", ids as string[]);
        }
      }
      break;
    // don't break -- just let it catch the next case
    case "currencyCode":
      if (value) {
        const currency = await getCurrencyByCode(
          companyGroupId,
          value as string
        );
        if (currency.data) {
          return await client
            .from("purchaseInvoice")
            .update({
              currencyCode: value as string,
              exchangeRate: currency.data.exchangeRate ?? 1,
              updatedBy: userId,
              updatedAt: new Date().toISOString()
            })
            .in("id", ids as string[]);
        }
      }
    // don't break -- just let it catch the next case
    case "supplierId":
    case "invoiceSupplierContactId":
    case "invoiceSupplierLocationId":
    case "locationId":
    case "supplierReference":
    case "paymentTermId":
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
