import { requirePermissions } from "@carbon/auth/auth.server";
import { datetime } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { getCurrencyByCode } from "~/modules/accounting";
import { isSalesReturnOrderLocked } from "~/modules/sales";
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
          const currency = await getCurrencyByCode(
            client,
            companyGroupId,
            currencyCode
          );
          return await client
            .from("salesReturnOrder")
            .update({
              customerId: value ?? undefined,
              currencyCode: currencyCode ?? undefined,
              exchangeRate: currency.data?.exchangeRate ?? 1,
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
        const currency = await getCurrencyByCode(
          client,
          companyGroupId,
          value as string
        );
        if (currency.data) {
          return await client
            .from("salesReturnOrder")
            .update({
              currencyCode: value as string,
              exchangeRate: currency.data.exchangeRate ?? 1,
              updatedBy: userId,
              updatedAt: datetime.timestamp()
            })
            .in("id", ids as string[]);
        }
      }
    // don't break -- just let it catch the next case
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
