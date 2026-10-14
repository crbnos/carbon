// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { unchecked } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { getExchangeRate } from "~/modules/accounting";
import { isPurchaseOrderLocked } from "~/modules/purchasing";
import { bulkDeletePurchaseOrders } from "~/modules/purchasing/purchasing.server";
import { requireUnlockedBulk } from "~/utils/lockedGuard.server";
import { bulkStartFormResponse } from "~/utils/table-jobs";
import { startAllMatchingBulkAction } from "~/utils/table-jobs.server";

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "purchasing"
  });

  const formData = await request.formData();
  const ids = formData.getAll("ids");
  const field = formData.get("field");
  const value = formData.get("value");

  if (typeof field !== "string") {
    return { error: { message: "Invalid form data" }, data: null };
  }

  // The purchase orders table's bulk Delete. It deletes the company's Draft
  // and Planned orders only (bulkDeletePurchaseOrders skips the rest), and
  // needs the delete permission as well as update, as the table does.
  if (field === "delete") {
    await requirePermissions(request, {
      update: "purchasing",
      delete: "purchasing"
    });
    const started = await startAllMatchingBulkAction(
      formData.get("allMatching"),
      { companyId, userId, actionKey: "purchase-orders.delete", params: {} }
    );
    if (started) return bulkStartFormResponse(started);

    const result = await bulkDeletePurchaseOrders(client, {
      purchaseOrderIds: ids as string[],
      companyId
    });
    return result.error
      ? { error: { message: result.error }, data: null }
      : { data: null, error: null };
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
          const rate = await getExchangeRate(client, companyId, currencyCode);
          if (rate.error) {
            return { error: rate.error, data: null };
          }
          return await client
            .from("purchaseOrder")
            .update({
              supplierId: value ?? undefined,
              currencyCode: currencyCode ?? undefined,
              exchangeRate: rate.data,
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
        .update(
          unchecked({
            [field]: value ?? undefined,
            updatedBy: userId,
            updatedAt: new Date().toISOString()
          })
        )
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
    case "currencyCode":
      if (value) {
        const rate = await getExchangeRate(client, companyId, value as string);
        if (rate.error) {
          return { error: rate.error, data: null };
        }
        return await client
          .from("purchaseOrder")
          .update({
            currencyCode: value as string,
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
    case "exchangeRate":
    case "orderDate":
      return await client
        .from("purchaseOrder")
        .update(
          unchecked({
            [field]: value ? value : null,
            updatedBy: userId,
            updatedAt: new Date().toISOString()
          })
        )
        .in("id", ids as string[]);
    default:
      return { error: { message: "Invalid field" }, data: null };
  }
}
