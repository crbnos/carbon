import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { resolveItemIdFromExtractedText, upsertPart } from "~/modules/items";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "invoicing"
  });

  const { invoiceId } = params;
  if (!invoiceId) throw new Error("invoiceId required");

  const url = new URL(request.url);
  const supplierId = url.searchParams.get("supplierId");

  const { data: lines } = await client
    .from("purchaseInvoiceLine")
    .select("id, description, quantity, supplierUnitPrice, invoiceLineType")
    .eq("invoiceId", invoiceId)
    .is("itemId", null)
    .eq("invoiceLineType", "Comment");

  if (!lines || lines.length === 0) {
    return { data: [] };
  }

  const suggestions = [];

  // The invoice line only carries a description (which prefers the extracted
  // part number when one was found), so that's our single candidate string.
  for (const line of lines) {
    const suggestedItemId = await resolveItemIdFromExtractedText(
      client,
      companyId,
      { type: "supplier", id: supplierId },
      [line.description]
    );

    suggestions.push({
      lineId: line.id,
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.supplierUnitPrice,
      suggestedItemId,
      action: suggestedItemId ? "map" : "create" // "map" | "create" | "ignore"
    });
  }

  return { data: suggestions };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "invoicing"
  });

  const { invoiceId } = params;
  if (!invoiceId) throw new Error("invoiceId required");

  const formData = await request.formData();
  const mappingsStr = formData.get("mappings") as string;
  if (!mappingsStr) return { success: false, error: "No mappings provided" };

  const mappings = JSON.parse(mappingsStr);
  const serviceRole = await getCarbonServiceRole();

  for (const map of mappings) {
    if (map.action === "ignore") continue;

    let finalItemId = map.itemId;

    if (map.action === "create") {
      // readableId and name are whatever the user typed in the create field,
      // falling back to the extracted description.
      const createName = (map.createName || map.description || "").trim();
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
        // with the service role, since the invoicing-scoped client can't insert
        // items under RLS. Purchased items default to Buy.
        const created = await upsertPart(serviceRole, {
          id: createName,
          name: createName,
          revision: "0",
          description: map.description || undefined,
          replenishmentSystem: "Buy",
          defaultMethodType: "Pull from Inventory",
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
      // Set the line's item and promote it from a Comment to a Part line.
      await client
        .from("purchaseInvoiceLine")
        .update({
          itemId: finalItemId,
          invoiceLineType: "Part",
          updatedBy: userId
        })
        .eq("id", map.lineId);
    }
  }

  return { success: true };
}
