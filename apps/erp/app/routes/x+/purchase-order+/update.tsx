import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { resolveCurrencyAndRate } from "~/modules/accounting";
import { isPurchaseOrderLocked } from "~/modules/purchasing";
import { requireUnlockedBulk } from "~/utils/lockedGuard.server";

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyGroupId, userId } = await requirePermissions(request, {
    update: "purchasing"
  });

  const formData = await request.formData();
  const ids = formData.getAll("ids");
  const field = formData.get("field");
  const value = formData.get("value");

  if (typeof field !== "string") {
    return { error: { message: "Invalid form data" }, data: null };
  }

  if (field === "delete") {
    return await client
      .from("purchaseOrder")
      .delete()
      .in("id", ids as string[]);
  }

  // Check if any of the POs are locked except for deliveryDate
  if (field !== "deliveryDate") {
    const purchaseOrders = await client
      .from("purchaseOrder")
      .select("status")
      .in("id", ids as string[]);
    const lockedError = requireUnlockedBulk({
      statuses: (purchaseOrders.data ?? []).map((d) => d.status),
      checkFn: isPurchaseOrderLocked,
      message: "Cannot modify a confirmed purchase order."
    });
    if (lockedError) {
      return lockedError;
    }
  }

  if (typeof value !== "string" && value !== null) {
    return { error: { message: "Invalid form data" }, data: null };
  }

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
          const resolved = await resolveCurrencyAndRate(
            client,
            companyGroupId,
            currencyCode
          );
          if (resolved.error) return resolved;
          return await client
            .from("purchaseOrder")
            .update({
              supplierId: value ?? undefined,
              currencyCode: resolved.data.currencyCode,
              exchangeRate: resolved.data.exchangeRate,
              exchangeRateUpdatedAt: new Date().toISOString(),
              updatedBy: userId,
              updatedAt: new Date().toISOString()
            })
            .in("id", ids as string[]);
        }
      }

      return await client
        .from("purchaseOrder")
        .update({
          supplierId: value ?? undefined,
          updatedBy: userId,
          updatedAt: new Date().toISOString()
        })
        .in("id", ids as string[]);
    case "receiptRequestedDate":
    case "locationId":
    case "deliveryDate":
      return await client
        .from("purchaseOrderDelivery")
        .update({
          [field]: value ?? undefined,
          updatedBy: userId,
          updatedAt: new Date().toISOString()
        })
        .in("id", ids as string[]);
    case "receiptPromisedDate":
      const lineUpdates = await client
        .from("purchaseOrderLine")
        .update({
          promisedDate: value ?? undefined,
          updatedBy: userId,
          updatedAt: new Date().toISOString()
        })
        .in("purchaseOrderId", ids as string[])
        .is("promisedDate", null);

      if (lineUpdates.error) {
        return lineUpdates;
      }

      return await client
        .from("purchaseOrderDelivery")
        .update({
          [field]: value ?? undefined,
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
        .from("purchaseOrder")
        .update({
          currencyCode: resolved.data.currencyCode,
          exchangeRate: resolved.data.exchangeRate,
          exchangeRateUpdatedAt: new Date().toISOString(),
          updatedBy: userId,
          updatedAt: new Date().toISOString()
        })
        .in("id", ids as string[]);
    }
    case "supplierContactId":
    case "supplierLocationId":
    case "supplierReference":
    case "exchangeRate":
    case "orderDate":
      return await client
        .from("purchaseOrder")
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
