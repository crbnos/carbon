import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { getExchangeRate } from "~/modules/accounting";
import { isQuoteLocked } from "~/modules/sales";
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

  // Per-ID locked check
  const quotes = await client
    .from("quote")
    .select("status")
    .in("id", ids as string[]);

  const lockedError = requireUnlockedBulk({
    statuses: (quotes.data ?? []).map((q) => q.status),
    checkFn: isQuoteLocked,
    message: "Cannot modify a locked quote. Reopen it first."
  });
  if (lockedError) return lockedError;

  switch (field) {
    case "customerId":
      let currencyCode: string | undefined;
      if (value && ids.length === 1) {
        const customer = await client
          ?.from("customer")
          .select("currencyCode")
          .eq("id", value)
          .single();

        if (customer.data?.currencyCode) {
          currencyCode = customer.data.currencyCode;
          return await client
            .from("quote")
            .update({
              customerId: value ?? undefined,
              currencyCode: currencyCode ? currencyCode : undefined,
              updatedBy: userId,
              updatedAt: new Date().toISOString()
            })
            .in("id", ids as string[]);
        }
      }

      return await client
        .from("quote")
        .update({
          customerId: value ?? undefined,
          updatedBy: userId,
          updatedAt: new Date().toISOString()
        })
        .in("id", ids as string[]);
    case "currencyCode":
      if (value) {
        const exchangeRate = await getExchangeRate(client, companyId, value);
        if (exchangeRate.error) {
          return { error: exchangeRate.error, data: null };
        }
        return await client
          .from("quote")
          .update({
            currencyCode: value,
            exchangeRate: exchangeRate.data,
            updatedBy: userId,
            updatedAt: new Date().toISOString()
          })
          .in("id", ids as string[]);
      }
    // don't break -- just let it catch the next case

    case "customerContactId":
    case "customerEngineeringContactId":
    case "customerLocationId":
    case "customerReference":
    case "dueDate":
    case "estimatorId":
    case "expirationDate":
    case "locationId":
    case "salesPersonId":
      return await client
        .from("quote")
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
