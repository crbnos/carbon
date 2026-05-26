import { requirePermissions } from "@carbon/auth/auth.server";
import { getLocalTimeZone, today } from "@internationalized/date";
import type { ActionFunctionArgs } from "react-router";
import { getCurrencyByCode } from "~/modules/accounting/accounting.service.server";
import { isSupplierQuoteLocked } from "~/modules/purchasing";
import { requireUnlockedBulk } from "~/utils/lockedGuard.server";

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyGroupId, userId } = await requirePermissions(request, {
    update: "purchasing"
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

  // Per-ID locked check
  const quotes = await client
    .from("supplierQuote")
    .select("status")
    .in("id", ids as string[]);

  const lockedError = requireUnlockedBulk({
    statuses: (quotes.data ?? []).map((q) => q.status),
    checkFn: isSupplierQuoteLocked,
    message: "Cannot modify a locked supplier quote. Reopen it first."
  });
  if (lockedError) return lockedError;

  switch (field) {
    case "supplierId":
      let currencyCode: string | undefined;
      if (value && ids.length === 1) {
        const supplier = await client
          ?.from("supplier")
          .select("currencyCode")
          .eq("id", value)
          .single();

        if (supplier.data?.currencyCode) {
          currencyCode = supplier.data.currencyCode;
          return await client
            .from("supplierQuote")
            .update({
              supplierId: value ?? undefined,
              currencyCode: currencyCode ? currencyCode : undefined,
              updatedBy: userId,
              updatedAt: new Date().toISOString()
            })
            .in("id", ids as string[]);
        }
      }

      return await client
        .from("supplierQuote")
        .update({
          supplierId: value ?? undefined,
          updatedBy: userId,
          updatedAt: new Date().toISOString()
        })
        .in("id", ids as string[]);
    case "currencyCode":
      const currency = await getCurrencyByCode(companyGroupId, value as string);
      if (currency.data) {
        return await client
          .from("supplierQuote")
          .update({
            currencyCode: value,
            exchangeRate: currency.data.exchangeRate,
            updatedBy: userId,
            updatedAt: new Date().toISOString()
          })
          .in("id", ids as string[]);
      }
    // don't break -- just let it catch the next case

    case "supplierContactId":
    case "supplierLocationId":
    case "supplierReference":
    case "quotedDate":
      return await client
        .from("supplierQuote")
        .update({
          [field]: value ? value : null,
          updatedBy: userId,
          updatedAt: new Date().toISOString()
        })
        .in("id", ids as string[]);

    case "expirationDate":
      return await client
        .from("supplierQuote")
        .update({
          status: value
            ? today(getLocalTimeZone()).toString() > value
              ? "Expired"
              : "Active"
            : "Active",
          expirationDate: value ? value : null,
          updatedBy: userId,
          updatedAt: new Date().toISOString()
        })
        .in("id", ids as string[]);
    default:
      return { error: { message: "Invalid field" }, data: null };
  }
}
