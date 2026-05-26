import { getAppUrl } from "@carbon/auth";
import { tool } from "ai";
import { getCurrencyByCode } from "~/modules/accounting/accounting.service.server";
import { getEmployeeJob } from "~/modules/people/people.service.server";
import {
  deletePurchaseOrder,
  getSupplier as getSupplierById,
  getSupplierPayment,
  getSupplierShipping,
  insertSupplierInteraction
} from "~/modules/purchasing/purchasing.service.server";
import { getNextSequence } from "~/modules/settings/settings.service.server";
import { path } from "~/utils/path";
import type { ChatContext } from "../agents/shared/context";
import { createPurchaseOrderSchema } from "./create-purchase-order";

export const createPurchaseOrderTool = tool({
  description: "Create a purchase order from a list of parts and a supplier",
  inputSchema: createPurchaseOrderSchema,
  execute: async function (args, executionOptions) {
    const context = executionOptions.experimental_context as ChatContext;

    console.log(
      "[createPurchaseOrderTool] Starting purchase order creation with args:",
      args
    );

    const [
      nextSequence,
      supplierInteraction,
      supplier,
      supplierPayment,
      supplierShipping,
      employeeJob
    ] = await Promise.all([
      getNextSequence("purchaseOrder"),
      insertSupplierInteraction(args.supplierId),
      getSupplierById(args.supplierId),
      getSupplierPayment(args.supplierId),
      getSupplierShipping(args.supplierId),
      getEmployeeJob(context.userId)
    ]);

    if (!supplierInteraction.data) {
      return {
        error: "Failed to create supplier interaction"
      };
    }

    if (!supplier.data) {
      return {
        error: "Supplier not found"
      };
    }
    if (!supplierPayment.data) {
      return {
        error: "Supplier payment not found"
      };
    }
    if (!supplierShipping.data) {
      return {
        error: "Supplier shipping not found"
      };
    }

    const purchaseOrder = {
      purchaseOrderId: nextSequence.data ?? "",
      supplierId: args.supplierId,
      supplierInteractionId: supplierInteraction.data?.id ?? null,
      exchangeRate: 1,
      exchangeRateUpdatedAt: new Date().toISOString(),
      companyId: context.companyId,
      createdBy: context.userId
    };

    const {
      paymentTermId,
      invoiceSupplierId,
      invoiceSupplierContactId,
      invoiceSupplierLocationId
    } = supplierPayment.data;

    const { shippingMethodId, shippingTermId } = supplierShipping.data;

    if (supplier.data?.currencyCode) {
      const currency = await getCurrencyByCode(
        context.companyGroupId,
        supplier.data?.currencyCode ?? ""
      );
      if (currency.data) {
        purchaseOrder.exchangeRate = currency.data.exchangeRate ?? 1;
        purchaseOrder.exchangeRateUpdatedAt = new Date().toISOString();
      }
    }

    const order = await context.client
      .from("purchaseOrder")
      .insert(purchaseOrder)
      .select("id, purchaseOrderId");

    if (!order) {
      return {
        error: "Failed to create purchase order"
      };
    }

    const purchaseOrderId = order.data?.[0]?.id ?? "";
    const locationId = employeeJob.data?.locationId ?? null;

    if (!purchaseOrderId) {
      return {
        error: "Failed to create purchase order"
      };
    }

    try {
      await Promise.all([
        context.client
          .from("purchaseOrderDelivery")
          .insert({
            id: purchaseOrderId,
            locationId: locationId,
            shippingMethodId: shippingMethodId ?? null,
            shippingTermId: shippingTermId ?? null,
            companyId: context.companyId
          })
          .select("id")
          .single(),
        context.client
          .from("purchaseOrderPayment")
          .insert({
            id: purchaseOrderId,
            invoiceSupplierId: invoiceSupplierId,
            invoiceSupplierContactId: invoiceSupplierContactId,
            invoiceSupplierLocationId: invoiceSupplierLocationId,
            paymentTermId: paymentTermId,
            companyId: context.companyId
          })
          .select("id")
          .single()
      ]);

      // Create purchase order lines for each part
      await Promise.all(
        args.parts.map(async (part: { partId: string; quantity: number }) => {
          // Get item details
          const [item, supplierPart] = await Promise.all([
            context.client
              .from("item")
              .select("*")
              .eq("id", part.partId)
              .eq("companyId", context.companyId)
              .single(),
            context.client
              .from("supplierPart")
              .select("*")
              .eq("itemId", part.partId)
              .eq("companyId", context.companyId)
              .eq("supplierId", args.supplierId)
              .single()
          ]);

          if (!item.data) {
            throw new Error(`Item with ID ${part.partId} not found`);
          }

          // Get item cost and replenishment info
          const [itemCost, itemReplenishment] = await Promise.all([
            context.client
              .from("itemCost")
              .select("*")
              .eq("itemId", part.partId)
              .eq("companyId", context.companyId)
              .single(),
            context.client
              .from("itemReplenishment")
              .select("*")
              .eq("itemId", part.partId)
              .eq("companyId", context.companyId)
              .single()
          ]);

          const lineData = {
            purchaseOrderId: purchaseOrderId,
            itemId: part.partId,
            description: item.data?.name,
            purchaseOrderLineType: item.data?.type,
            purchaseQuantity: part.quantity,
            supplierUnitPrice:
              (supplierPart?.data?.unitPrice ?? itemCost?.data?.unitCost ?? 0) /
              purchaseOrder.exchangeRate,
            supplierShippingCost: 0,
            purchaseUnitOfMeasureCode:
              supplierPart?.data?.supplierUnitOfMeasureCode ??
              itemReplenishment?.data?.purchasingUnitOfMeasureCode ??
              item.data?.unitOfMeasureCode ??
              "EA",
            inventoryUnitOfMeasureCode: item.data?.unitOfMeasureCode ?? "EA",
            conversionFactor:
              supplierPart?.data?.conversionFactor ??
              itemReplenishment?.data?.conversionFactor ??
              1,
            locationId: locationId,
            storageUnitId: null,
            supplierTaxAmount: 0,
            companyId: context.companyId,
            createdBy: context.userId
          };

          // Create the purchase order line
          return context.client
            .from("purchaseOrderLine")
            .insert(lineData)
            .select("id")
            .single();
        })
      );

      return {
        ...order.data,
        link: `${getAppUrl()}${path.to.purchaseOrder(purchaseOrderId)}`
      };
    } catch (error) {
      if (purchaseOrderId) {
        await deletePurchaseOrder(purchaseOrderId);
      }
      return {
        error: `Failed to create purchase order details: ${
          error instanceof Error ? error.message : String(error)
        }`
      };
    }
  }
});
