import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { resolveItemIdFromExtractedText, upsertPart } from "~/modules/items";
import { requireCompanyRecord } from "~/modules/shared/shared.server";

const logger = getLogger("erp", "sales-rfq-map-lines");

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales"
  });

  const { rfqId } = params;
  if (!rfqId) throw new Error("rfqId required");

  const url = new URL(request.url);
  const customerId = url.searchParams.get("customerId");

  const { data: lines } = await client
    .from("salesRfqLine")
    .select("id, customerPartId, description, quantity")
    .eq("salesRfqId", rfqId)
    .is("itemId", null);

  if (!lines || lines.length === 0) {
    return { data: [] };
  }

  const suggestions = [];

  // Try every extracted string for a line — part number and description alike —
  // the classification doesn't matter; we just want the best chance of a match.
  for (const line of lines) {
    const suggestedItemId = await resolveItemIdFromExtractedText(
      client,
      companyId,
      { type: "customer", id: customerId },
      [line.customerPartId, line.description]
    );

    suggestions.push({
      lineId: line.id,
      customerPartId: line.customerPartId,
      description: line.description,
      quantity: line.quantity,
      suggestedItemId,
      action: suggestedItemId ? "map" : "create" // "map" | "create" | "ignore"
    });
  }

  return { data: suggestions };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const { rfqId } = params;
  if (!rfqId) throw new Error("rfqId required");

  const formData = await request.formData();
  const customerId = formData.get("customerId") as string;
  const mappingsStr = formData.get("mappings") as string;
  if (!mappingsStr) return { success: false, error: "No mappings provided" };

  const mappings = JSON.parse(mappingsStr);
  if (!Array.isArray(mappings)) {
    return { success: false, error: "Invalid mappings" };
  }
  const serviceRole = await getCarbonServiceRole();

  // Every line, item and customer id is caller-supplied, and the
  // customerPartToItem upsert runs as the service role keyed on
  // (customerId, itemId) — a foreign pair would overwrite another company's
  // mapping. Prove each id belongs to this company (lines to this RFQ) first.
  const activeMappings = mappings.filter((map) => map?.action !== "ignore");
  if (activeMappings.some((map) => typeof map?.lineId !== "string")) {
    return { success: false, error: "Invalid mappings" };
  }
  const lineIds = [...new Set(activeMappings.map((map) => map.lineId))];
  const itemIds = [
    ...new Set(
      activeMappings
        .filter((map) => map.itemId)
        .map((map) => String(map.itemId))
    )
  ];

  if (lineIds.length > 0) {
    const lines = await serviceRole
      .from("salesRfqLine")
      .select("id")
      .eq("salesRfqId", rfqId)
      .eq("companyId", companyId)
      .in("id", lineIds);
    if (lines.error || (lines.data?.length ?? 0) !== lineIds.length) {
      logger.error("RFQ lines not found for mapping", {
        companyId,
        rfqId,
        lineIds,
        error: lines.error
      });
      return { success: false, error: "RFQ line not found" };
    }
  }

  if (itemIds.length > 0) {
    const items = await serviceRole
      .from("item")
      .select("id")
      .eq("companyId", companyId)
      .in("id", itemIds);
    if (items.error || (items.data?.length ?? 0) !== itemIds.length) {
      logger.error("Items not found for RFQ line mapping", {
        companyId,
        rfqId,
        itemIds,
        error: items.error
      });
      return { success: false, error: "Item not found" };
    }
  }

  if (customerId) {
    await requireCompanyRecord(serviceRole, "customer", companyId, {
      id: customerId
    });
  }

  for (const map of mappings) {
    if (map.action === "ignore") continue;

    let finalItemId = map.itemId;

    if (map.action === "create") {
      // readableId and name are whatever the user typed in the create field,
      // defaulting to the extracted customer part number (then description).
      const createName = (
        map.createName ||
        map.customerPartId ||
        map.description ||
        ""
      ).trim();
      if (!createName) continue;

      // Reuse an existing item with the same readableId instead of failing on
      // the unique constraint / creating a duplicate.
      const existing = await serviceRole
        .from("item")
        .select("id")
        .eq("companyId", companyId)
        .eq("readableId", createName)
        .maybeSingle();

      if (existing.data) {
        finalItemId = existing.data.id;
      } else {
        // Create through the standard Part flow (item + part + companion rows)
        // with the service role, since the sales-scoped client can't insert
        // items under RLS.
        const created = await upsertPart(serviceRole, {
          id: createName,
          name: createName,
          revision: "0",
          description: map.description || undefined,
          replenishmentSystem: "Make",
          defaultMethodType: "Make to Order",
          itemTrackingType: "Inventory",
          unitOfMeasureCode: "EA",
          shelfLifeCalculateFromBom: false,
          companyId,
          createdBy: userId
        });

        if (!created.error && created.data?.id) {
          finalItemId = created.data.id;
        }
      }
    }

    if (finalItemId) {
      // Update salesRfqLine
      await client
        .from("salesRfqLine")
        .update({
          itemId: finalItemId,
          updatedBy: userId
        })
        .eq("id", map.lineId);

      // Upsert customerPartToItem
      if (customerId && map.customerPartId) {
        await serviceRole.from("customerPartToItem").upsert(
          {
            customerId,
            customerPartId: map.customerPartId,
            itemId: finalItemId,
            companyId,
            createdBy: userId
          },
          { onConflict: "customerId, itemId" }
        );
      }
    }
  }

  return { success: true };
}
