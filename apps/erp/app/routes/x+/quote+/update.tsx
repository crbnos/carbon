import { requirePermissions } from "@carbon/auth/auth.server";
import { datetime } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { resolveCurrencyAndRate } from "~/modules/accounting";
import { isQuoteLocked } from "~/modules/sales";
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
      if (value) {
        const customer = await client
          ?.from("customer")
          .select("currencyCode")
          .eq("id", value)
          .single();

        if (customer.data?.currencyCode) {
          const resolved = await resolveCurrencyAndRate(
            client,
            companyGroupId,
            customer.data.currencyCode
          );
          if (resolved.error) return resolved;
          return await client
            .from("quote")
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
        .from("quote")
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
        .from("quote")
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
