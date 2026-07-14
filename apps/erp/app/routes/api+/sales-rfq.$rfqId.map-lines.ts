import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { resolveItemIdFromExtractedText, upsertPart } from "~/modules/items";

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
  const serviceRole = await getCarbonServiceRole();

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
