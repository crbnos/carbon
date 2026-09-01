import { requirePermissions } from "@carbon/auth/auth.server";
import { datetime } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { resolveCurrencyAndRate } from "~/modules/accounting";
import { isSalesOrderLocked } from "~/modules/sales";
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
    case "exchangeRate": {
      // A rate written directly still has to be usable: 0 zeroes every sales
      // `converted*` column (they carry no zero-guard) and a null violates the
      // NOT NULL on the invoice tables.
      const rate = Number(value);
      if (!Number.isFinite(rate) || rate <= 0) {
        return {
          error: { message: "Exchange rate must be greater than zero" },
          data: null
        };
      }
      return await client
        .from("salesOrder")
        .update({
          exchangeRate: rate,
          exchangeRateUpdatedAt: datetime.timestamp(),
          updatedBy: userId,
          updatedAt: datetime.timestamp()
        })
        .in("id", ids as string[]);
    }
    case "customerId":
      let currencyCode: string | undefined;
      if (value) {
        const customer = await client
          ?.from("customer")
          .select("currencyCode")
          .eq("id", value)
          .single();

        if (customer.data?.currencyCode) {
          currencyCode = customer.data.currencyCode;
          const resolved = await resolveCurrencyAndRate(
            client,
            companyGroupId,
            currencyCode
          );
          if (resolved.error) return resolved;
          return await client
            .from("salesOrder")
            .update({
              customerId: value ?? undefined,
              currencyCode: resolved.data.currencyCode,
              exchangeRate: resolved.data.exchangeRate,
              exchangeRateUpdatedAt: datetime.timestamp(),
              updatedBy: userId,
              updatedAt: datetime.timestamp()
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
    case "currencyCode": {
      if (!value) {
        return { error: { message: "A currency is required" }, data: null };
      }
      const resolved = await resolveCurrencyAndRate(
        client,
        companyGroupId,
        value as string
      );
      if (resolved.error) return resolved;
      return await client
        .from("salesOrder")
        .update({
          currencyCode: resolved.data.currencyCode,
          exchangeRate: resolved.data.exchangeRate,
          exchangeRateUpdatedAt: datetime.timestamp(),
          updatedBy: userId,
          updatedAt: datetime.timestamp()
        })
        .in("id", ids as string[]);
    }
    case "customerContactId":
    case "customerEngineeringContactId":
    case "customerLocationId":
    case "customerReference":

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
