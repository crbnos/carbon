import SupabaseClient from "https://esm.sh/v135/@supabase/supabase-js@2.33.1/dist/module/SupabaseClient.d.ts";
import { Transaction } from "https://esm.sh/v135/kysely@0.26.3/dist/cjs/kysely.d.ts";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import z from "npm:zod@^3.24.1";
import { getCurrencyByCode } from "../lib/api/accounting.ts";
import {
  deletePurchaseOrder,
  getSupplier as getSupplierById,
  getSupplierPayment,
  getSupplierShipping,
  insertSupplierInteraction,
} from "../lib/api/purchasing.ts";
import { DB } from "../lib/database.ts";
import { tool } from "../lib/tool.ts";
import { Database } from "../lib/types.ts";
import { getNextSequence } from "../shared/get-next-sequence.ts";

const model = new Supabase.ai.Session("gte-small");

const createPurchaseOrder = tool({
  name: "createPurchaseOrder",
  description: "Create a purchase order from a list of parts and a supplier",
  args: z.object({
    supplierId: z.string(),
    parts: z.array(
      z.object({
        partId: z.string(),
        quantity: z.number().positive().default(1),
      })
    ),
  }),
  async run(args, context) {
    const [
      nextSequence,
      supplierInteraction,
      supplier,
      supplierPayment,
      supplierShipping,
      // purchaser
    ] = await Promise.all([
      getNextSequence(
        context.db as unknown as Transaction<DB>,
        "purchaseOrder",
        context.companyId
      ),
      insertSupplierInteraction(context.db, context.companyId, args.supplierId),
      getSupplierById(context.db, args.supplierId),
      getSupplierPayment(context.db, args.supplierId),
      getSupplierShipping(context.db, args.supplierId),
      // getEmployeeJob(client, context.userId, context.companyId),
    ]);

    if (!supplierInteraction) {
      return {
        error: "Failed to create supplier interaction",
      };
    }

    if (!supplier) {
      return {
        error: "Supplier not found",
      };
    }
    if (!supplierPayment) {
      return {
        error: "Supplier payment not found",
      };
    }
    if (!supplierShipping) {
      return {
        error: "Supplier shipping not found",
      };
    }

    const purchaseOrder = {
      purchaseOrderId: nextSequence,
      supplierId: args.supplierId,
      supplierInteractionId: supplierInteraction?.id! ?? null,
      exchangeRate: 1,
      exchangeRateUpdatedAt: new Date().toISOString(),
      companyId: context.companyId,
      createdBy: context.userId,
    };

    const {
      paymentTermId,
      invoiceSupplierId,
      invoiceSupplierContactId,
      invoiceSupplierLocationId,
    } = supplierPayment;

    const { shippingMethodId, shippingTermId } = supplierShipping;

    if (supplier.currencyCode) {
      const currency = await getCurrencyByCode(
        // @ts-ignore
        context.db,
        context.companyId,
        supplier.currencyCode
      );
      if (currency) {
        purchaseOrder.exchangeRate = currency.exchangeRate ?? 1;
        purchaseOrder.exchangeRateUpdatedAt = new Date().toISOString();
      }
    }

    const order = await context.db
      .insertInto("purchaseOrder")
      .values([purchaseOrder])
      .returning(["id", "purchaseOrderId"])
      .executeTakeFirst();

    if (!order) {
      return {
        error: "Failed to create purchase order",
      };
    }

    const purchaseOrderId = order.id;
    const locationId = null; // TODO

    if (!purchaseOrderId) {
      return {
        error: "Failed to create purchase order",
      };
    }

    try {
      await Promise.all([
        context.db
          .insertInto("purchaseOrderDelivery")
          .values({
            id: purchaseOrderId,
            locationId: locationId,
            shippingMethodId: shippingMethodId,
            shippingTermId: shippingTermId,
            companyId: context.companyId,
          })
          .executeTakeFirstOrThrow(),
        context.db
          .insertInto("purchaseOrderPayment")
          .values({
            id: purchaseOrderId,
            invoiceSupplierId: invoiceSupplierId,
            invoiceSupplierContactId: invoiceSupplierContactId,
            invoiceSupplierLocationId: invoiceSupplierLocationId,
            paymentTermId: paymentTermId,
            companyId: context.companyId,
          })
          .executeTakeFirstOrThrow(),
      ]);

      // Create purchase order lines for each part
      await Promise.all(
        args.parts.map(async (part: { partId: string; quantity: number }) => {
          // Get item details
          const [item, supplierPart] = await Promise.all([
            context.db
              .selectFrom("item")
              .select([
                "id",
                "name",
                "readableIdWithRevision",
                "type",
                "unitOfMeasureCode",
              ])
              .where("id", "=", part.partId)
              .where("companyId", "=", context.companyId)
              .executeTakeFirst(),
            context.db
              .selectFrom("supplierPart")
              .selectAll()
              .where("itemId", "=", part.partId)
              .where("companyId", "=", context.companyId)
              .where("supplierId", "=", args.supplierId)
              .executeTakeFirst(),
          ]);

          if (!item) {
            throw new Error(`Item not found: ${part.partId}`);
          }

          // Get item cost and replenishment info
          const [itemCost, itemReplenishment] = await Promise.all([
            context.db
              .selectFrom("itemCost")
              .select(["unitCost"])
              .where("itemId", "=", part.partId)
              .executeTakeFirst(),
            context.db
              .selectFrom("itemReplenishment")
              .select([
                "purchasingUnitOfMeasureCode",
                "conversionFactor",
                "leadTime",
              ])
              .where("itemId", "=", part.partId)
              .executeTakeFirst(),
          ]);

          // Create the purchase order line
          return context.db
            .insertInto("purchaseOrderLine")
            .values({
              purchaseOrderId: purchaseOrderId,
              itemId: part.partId,
              description: item.name,
              purchaseOrderLineType: item.type,
              purchaseQuantity: part.quantity,
              supplierUnitPrice:
                (supplierPart?.unitPrice ?? itemCost?.unitCost ?? 0) /
                purchaseOrder.exchangeRate,
              supplierShippingCost: 0,
              purchaseUnitOfMeasureCode:
                supplierPart?.supplierUnitOfMeasureCode ??
                itemReplenishment?.purchasingUnitOfMeasureCode ??
                item.unitOfMeasureCode ??
                "EA",
              inventoryUnitOfMeasureCode: item.unitOfMeasureCode ?? "EA",
              conversionFactor:
                supplierPart?.conversionFactor ??
                itemReplenishment?.conversionFactor ??
                1,
              locationId: locationId,
              shelfId: null,
              supplierTaxAmount: 0,
              companyId: context.companyId,
              createdBy: context.userId,
            })
            .returning(["id"])
            .executeTakeFirstOrThrow();
        })
      );

      return order;
    } catch (error) {
      if (purchaseOrderId) {
        await deletePurchaseOrder(context.db, purchaseOrderId);
      }
      return {
        error: `Failed to create purchase order details: ${error.message}`,
      };
    }
  },
});

const getPart = tool({
  name: "getPart",
  description: "Search for a part by description or readable id",
  args: z
    .object({
      readableId: z.string().optional(),
      description: z.string().optional(),
    })
    .refine((data) => data.readableId || data.description, {
      message: "Either readableId or description must be provided",
    }),
  async run(args, context) {
    let { readableId, description } = args;
    if (readableId) {
      const [part, supplierPart] = await Promise.all([
        context.client
          .from("item")
          .select("*")
          .or(
            `readableId.eq.${readableId},readableIdWithRevision.eq.${readableId}`
          )
          .eq("companyId", context.companyId)
          .order("revision", { ascending: false })
          .limit(1),
        context.client
          .from("supplierPart")
          .select("*, item(*)")
          .eq("supplierPartId", readableId)
          .eq("companyId", context.companyId)
          .single(),
      ]);

      if (supplierPart.data) {
        return {
          id: supplierPart.data.itemId,
          name: supplierPart.data.item?.name,
          description: supplierPart.data.item?.description,
          supplierId: supplierPart.data.supplierId,
        };
      }
      if (part.data?.[0]) {
        return {
          id: part.data[0].id,
          name: part.data[0].name,
          description: part.data[0].description,
        };
      }

      if (!description) {
        description = readableId;
      } else {
        return null;
      }
    }

    if (description) {
      const embedding = await generateEmbedding(description);
      const search = await context.client.rpc("items_search", {
        query_embedding: JSON.stringify(embedding),
        match_threshold: 0.7,
        match_count: 10,
        p_company_id: context.companyId,
      });

      if (search.data && search.data.length > 0) {
        return search.data;
      }
    }

    return null;
  },
});

const getSupplier = tool({
  name: "getSupplier",
  description:
    "Search for suppliers by a specific name as specified by the user, a deduced description, or a list of part ids",
  args: z
    .object({
      id: z.string().optional(),
      name: z.string().optional(),
      description: z.string().optional(),
      partIds: z.array(z.string()).optional(),
    })
    .refine(
      (data) => data.id || data.name || data.description || data.partIds,
      {
        message: "Either id, name, description, or partIds must be provided",
      }
    ),
  async run(args, context) {
    let { name, description, partIds } = args;

    if (args.id) {
      const supplier = await context.client
        .from("supplier")
        .select("*")
        .eq("id", args.id)
        .eq("companyId", context.companyId)
        .single();
      if (supplier.data) {
        return {
          id: supplier.data.id,
          name: supplier.data.name,
        };
      }
    }

    if (partIds && partIds.length > 0) {
      return getSuppliersForParts(context.client, partIds, context);
    }

    if (args.name) {
      const supplier = await context.client
        .from("supplier")
        .select("*")
        .eq("name", args.name)
        .eq("companyId", context.companyId)
        .single();
      if (supplier.data) {
        return {
          id: supplier.data.id,
        };
      }
      if (!description) {
        description = name;
      }
    }

    if (description) {
      const embedding = await generateEmbedding(description);
      const search = await context.client.rpc("suppliers_search", {
        query_embedding: JSON.stringify(embedding),
        match_threshold: 0.8,
        match_count: 10,
        p_company_id: context.companyId,
      });

      if (search.data && search.data.length > 0) {
        return search.data;
      }
    }

    return null;
  },
});

const getSupplierForParts = tool({
  name: "getSupplierForParts",
  description: "Suggest a list of suppliers for a given list of parts",
  args: z.object({
    partIds: z.array(z.string()),
  }),
  async run(args, context) {
    return await getSuppliersForParts(context.client, args.partIds, context);
  },
});

async function getSuppliersForParts(
  client: SupabaseClient<Database>,
  partIds: string[],
  context: { companyId: string }
) {
  // Find suppliers that provide these parts
  const [supplierParts, preferredSuppliers] = await Promise.all([
    client
      .from("supplierPart")
      .select("itemId, supplierId, unitPrice, supplierUnitOfMeasureCode")
      .in("itemId", partIds)
      .eq("companyId", context.companyId),
    client
      .from("itemReplenishment")
      .select("itemId, preferredSupplierId")
      .in("itemId", partIds)
      .eq("companyId", context.companyId),
  ]);

  if (partIds.length === 1) {
    const preferredSupplier = preferredSuppliers.data?.find(
      (p) => p.itemId === partIds[0]
    );
    if (preferredSupplier) {
      return {
        id: preferredSupplier.preferredSupplierId,
      };
    }

    const firstSupplier = supplierParts.data?.find(
      (p) => p.itemId === partIds[0]
    );
    if (firstSupplier) {
      return {
        id: firstSupplier.supplierId,
      };
    }
  }

  // Count occurrences of each supplier in preferred suppliers
  const preferredSupplierCounts =
    preferredSuppliers.data?.reduce((counts, item) => {
      if (item.preferredSupplierId) {
        counts[item.preferredSupplierId] =
          (counts[item.preferredSupplierId] || 0) + 1;
      }
      return counts;
    }, {} as Record<string, number>) || {};

  // Find the most frequent preferred supplier
  let mostFrequentPreferredSupplierId: string | null = null;
  let maxPreferredCount = 0;

  for (const [supplierId, count] of Object.entries(preferredSupplierCounts)) {
    if (count > maxPreferredCount) {
      maxPreferredCount = count;
      mostFrequentPreferredSupplierId = supplierId;
    }
  }

  // If we found a preferred supplier, return it
  if (mostFrequentPreferredSupplierId) {
    return {
      id: mostFrequentPreferredSupplierId,
    };
  }

  // If no preferred supplier, count occurrences in supplierParts
  const supplierPartCounts =
    supplierParts.data?.reduce((counts, item) => {
      if (item.supplierId) {
        counts[item.supplierId] = (counts[item.supplierId] || 0) + 1;
      }
      return counts;
    }, {} as Record<string, number>) || {};

  // Find the most frequent supplier from supplierParts
  let mostFrequentSupplierId: string | null = null;
  let maxCount = 0;

  for (const [supplierId, count] of Object.entries(supplierPartCounts)) {
    if (count > maxCount) {
      maxCount = count;
      mostFrequentSupplierId = supplierId;
    }
  }

  // Return the most frequent supplier if found
  if (mostFrequentSupplierId) {
    const supplier = supplierParts.data?.find(
      (p) => p.supplierId === mostFrequentSupplierId
    );
    return {
      id: mostFrequentSupplierId,
      unitPrice: supplier?.unitPrice,
      supplierUnitOfMeasureCode: supplier?.supplierUnitOfMeasureCode,
    };
  }

  // Return null if no supplier was found
  return null;
}

async function generateEmbedding(text: string): Promise<number[]> {
  const embedding = await model.run(text, {
    mean_pool: true,
    normalize: true,
  });

  return embedding as number[];
}

export const tools = [
  createPurchaseOrder,
  getPart,
  getSupplier,
  getSupplierForParts,
];

export const prompt = {
  name: "carbon-purchasing-mcp-prompt",
  description: "Instructions for using the Carbon Purchasing MCP effectively",
  instructions: `
This server provides access to Carbon, an ERP for manufacturing. Use it to effectively complete the tasks of a purchasing and procurement department.

When handling purchase order requests:
1. First identify the part details (including quantities and measurements)
2. Use getPart to look up the part ID
3. If no supplier is explicitly specified in the prompt:
   - Use getSupplierForParts to get recommended suppliers
   - Ask the user to confirm which supplier they want to use
4. Only proceed with createPurchaseOrder when both part and supplier are confirmed
5. If there are multiple options for a part or supplier, ask the user to confirm which one they want to use
6. If there are no options, ask the user for clarification

For example:
- If user says "create a purchase order for 5lb of 1/4" steel":
  1. First look up the part ID for "1/4" steel"
  2. Then ask user to specify a supplier, potentially offering suggestions
  3. Only create the PO once supplier is confirmed

- If user says "create a purchase order for 5lb of 1/4" steel from MetalCorp":
  1. Look up part ID for "1/4" steel"
  2. Look up supplier ID for "MetalCorp"
  3. Create the PO with both IDs

Key capabilities:
- Create and update purchase orders
- Search for suppliers and parts
- Suggest suppliers for parts
- Search for existing purchase orders
- Search for open purchase orders
- Search for purchase order history


Tools:
- getPart
  - Search for a part by readable id or description
  - Returns an id that can be used to create, update, or search for documents by part id
- getSupplier
  - Search for suppliers by id, a specific name from the prompt, a deduced description, or a list of part ids
  - Returns an id that can be used to create, update, or search for documents by supplier id
- getSupplierForParts
  - Suggest a list of suppliers for a given list of parts
- createPurchaseOrder
  - Create a purchase order in draft status with multiple parts
`,
};
