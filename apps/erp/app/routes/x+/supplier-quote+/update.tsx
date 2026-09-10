import { requirePermissions } from "@carbon/auth/auth.server";
import { datetime } from "@carbon/utils";
import type { CalendarDate } from "@internationalized/date";
import { parseDate } from "@internationalized/date";
import type { ActionFunctionArgs } from "react-router";
import { getExchangeRate } from "~/modules/accounting";
import { isSupplierQuoteLocked } from "~/modules/purchasing";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import { requireUnlockedBulk } from "~/utils/lockedGuard.server";

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
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
      if (value) {
        const rate = await getExchangeRate(client, companyId, value as string);
        if (rate.error) {
          return { error: rate.error, data: null };
        }
        return await client
          .from("supplierQuote")
          .update({
            currencyCode: value,
            exchangeRate: rate.data,
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

    case "expirationDate": {
      // Reject non-canonical dates before comparing — a malformed string would
      // otherwise produce a status that disagrees with the stored date.
      let expirationDate: CalendarDate | null = null;
      if (value) {
        try {
          expirationDate = parseDate(value);
        } catch {
          return {
            error: { message: "Invalid expiration date" },
            data: null
          };
        }
      }
      // Expiry is judged on the company's calendar — one set of books, one
      // "today" — not the server's or the editing user's.
      const companyToday = datetime.today(
        await getCompanyTimeZone(client, companyId)
      );
      return await client
        .from("supplierQuote")
        .update({
          status:
            expirationDate && companyToday.compare(expirationDate) > 0
              ? "Expired"
              : "Active",
          expirationDate: expirationDate ? expirationDate.toString() : null,
          updatedBy: userId,
          updatedAt: new Date().toISOString()
        })
        .in("id", ids as string[]);
    }
    default:
      return { error: { message: "Invalid field" }, data: null };
  }
}
