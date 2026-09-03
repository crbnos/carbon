import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { getExchangeRate } from "~/modules/accounting";
import { isSalesOrderLocked } from "~/modules/sales";
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

  // Check if any of the selected orders are locked
  const salesOrders = await client
    .from("salesOrder")
    .select("id, status")
    .in("id", ids as string[]);

  const lockedError = requireUnlockedBulk({
    statuses: (salesOrders.data ?? []).map((o) => o.status),
    checkFn: isSalesOrderLocked,
    message: "Cannot modify a confirmed sales order."
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
          const exchangeRate = await getExchangeRate(
            client,
            companyId,
            currencyCode
          );
          if (exchangeRate.error) {
            return { error: exchangeRate.error, data: null };
          }
          return await client
            .from("salesOrder")
            .update({
              customerId: value ?? undefined,
              currencyCode: currencyCode ?? undefined,
              exchangeRate: exchangeRate.data,
              updatedBy: userId,
              updatedAt: new Date().toISOString()
            })
            .in("id", ids as string[]);
        }
      }

      return await client
        .from("salesOrder")
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
          .from("salesOrder")
          .update({
            currencyCode: value as string,
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

    case "exchangeRate":
    case "expirationDate":
    case "locationId":
    case "orderDate":
    case "salesPersonId":
      return await client
        .from("salesOrder")
        .update({
          [field]: value ? value : null,
          updatedBy: userId,
          updatedAt: new Date().toISOString()
        })
        .in("id", ids as string[]);
    case "receiptPromisedDate":
    case "receiptRequestedDate":
      return await client
        .from("salesOrderShipment")
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
