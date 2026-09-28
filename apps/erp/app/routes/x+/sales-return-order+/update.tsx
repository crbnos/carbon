import { requirePermissions } from "@carbon/auth/auth.server";
import { datetime } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { getExchangeRate } from "~/modules/accounting";
import { isSalesReturnOrderLocked } from "~/modules/sales";
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

  // Check if any of the selected return orders are locked
  const salesReturnOrders = await client
    .from("salesReturnOrder")
    .select("id, status")
    .in("id", ids as string[]);

  const lockedError = requireUnlockedBulk({
    statuses: (salesReturnOrders.data ?? []).map((o) => o.status),
    checkFn: isSalesReturnOrderLocked,
    message: "Cannot modify a completed or cancelled return order."
  });
  if (lockedError) return lockedError;

  switch (field) {
    case "customerId": {
      if (value && ids.length === 1) {
        const customer = await client
          ?.from("customer")
          .select("currencyCode")
          .eq("id", value)
          .single();

        if (customer.data?.currencyCode) {
          const currencyCode = customer.data.currencyCode;
          const exchangeRate = await getExchangeRate(
            client,
            companyId,
            currencyCode
          );
          if (exchangeRate.error) {
            return { error: exchangeRate.error, data: null };
          }
          return await client
            .from("salesReturnOrder")
            .update({
              customerId: value ?? undefined,
              currencyCode: currencyCode ?? undefined,
              exchangeRate: exchangeRate.data,
              updatedBy: userId,
              updatedAt: datetime.timestamp()
            })
            .in("id", ids as string[]);
        }
      }

      return await client
        .from("salesReturnOrder")
        .update({
          customerId: value ?? undefined,
          updatedBy: userId,
          updatedAt: datetime.timestamp()
        })
        .in("id", ids as string[]);
    }
    case "currencyCode":
      if (value) {
        const exchangeRate = await getExchangeRate(
          client,
          companyId,
          value as string
        );
        if (exchangeRate.error) {
          // Falling through here would write the code with a stale
          // exchangeRate — refuse instead (missing rate = error, never 1).
          return { error: exchangeRate.error, data: null };
        }
        return await client
          .from("salesReturnOrder")
          .update({
            currencyCode: value as string,
            exchangeRate: exchangeRate.data,
            updatedBy: userId,
            updatedAt: datetime.timestamp()
          })
          .in("id", ids as string[]);
      }
    // Clearing the currency falls through to the generic null update.
    case "salesOrderId":
    case "customerContactId":
    case "customerLocationId":
    case "customerReference":
    case "expirationDate":
    case "locationId":
    case "orderDate":
      return await client
        .from("salesReturnOrder")
        .update({
          [field]: value ? value : null,
          updatedBy: userId,
          updatedAt: datetime.timestamp()
        })
        .in("id", ids as string[]);
    default:
      return { error: { message: "Invalid field" }, data: null };
  }
}
