import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import {
  dedupeViolations,
  evaluateLinesForSurface,
  isBlocked
} from "@carbon/ee/storage-rules.server";
import { getLocalTimeZone, parseDate, today } from "@internationalized/date";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { upsertDocument } from "~/modules/documents";
import { loader as pdfLoader } from "~/routes/file+/shipment+/$id[.]pdf";
import { path } from "~/utils/path";
import { stripSpecialCharacters } from "~/utils/string";

type ExpiredEntityPolicy = "Warn" | "Block" | "BlockWithOverride";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "inventory"
  });

  const { shipmentId } = params;
  if (!shipmentId) throw new Error("shipmentId not found");

  const formData = await request.formData();
  const acknowledged = formData.get("acknowledged") === "true";

  // Item Rule evaluation across every line on this shipment before posting.
  const serviceRole = getCarbonServiceRole();
  const { data: lines } = await serviceRole
    .from("shipmentLine")
    .select(
      "id, itemId, storageUnitId, shippedQuantity, locationId, shipmentId"
    )
    .eq("shipmentId", shipmentId)
    .eq("companyId", companyId);

  // Shipment source determines which surface(s) eval. Shipments leaving for
  // an Outbound Transfer ALSO eval the `warehouseTransfer` surface — the post
  // auto-completes the parent transfer, so warehouse-scoped rules need to
  // fire here too.
  const { data: shipmentForSurface } = await serviceRole
    .from("shipment")
    .select("sourceDocument")
    .eq("id", shipmentId)
    .single();
  const surfaces: ("shipment" | "warehouseTransfer")[] = ["shipment"];
  if (shipmentForSurface?.sourceDocument === "Outbound Transfer") {
    surfaces.push("warehouseTransfer");
  }

  const evalLines = (lines ?? []).map((l) => ({
    lineId: l.id as string,
    itemId: l.itemId as string | null,
    storageUnitId: l.storageUnitId as string | null,
    quantity: Number(l.shippedQuantity ?? 0),
    locationId: l.locationId as string | null
  }));

  const allViolations = [];
  const allRuleNames: Record<string, string> = {};
  for (const surface of surfaces) {
    const { violations, ruleNames } = await evaluateLinesForSurface({
      client: serviceRole,
      companyId,
      userId,
      targetType: "item",
      surface,
      lines: evalLines
    });
    allViolations.push(...violations);
    Object.assign(allRuleNames, ruleNames);
  }

  // Pick pass — the bin side of the shipment. Same lines, same item target;
  // item rules own the `pick` surface. Transfers double-up via the
  // warehouseTransfer surface (dedupe collapses the overlap).
  const pickSurfaces: ("pick" | "warehouseTransfer")[] = ["pick"];
  if (shipmentForSurface?.sourceDocument === "Outbound Transfer") {
    pickSurfaces.push("warehouseTransfer");
  }
  for (const surface of pickSurfaces) {
    const { violations, ruleNames } = await evaluateLinesForSurface({
      client: serviceRole,
      companyId,
      userId,
      targetType: "item",
      surface,
      lines: evalLines
    });
    allViolations.push(...violations);
    Object.assign(allRuleNames, ruleNames);
  }

  const deduped = dedupeViolations(allViolations);
  if (deduped.length > 0 && isBlocked(deduped, acknowledged)) {
    return {
      error: null,
      data: null,
      violations: deduped,
      ruleNames: allRuleNames
    };
  }

  // Expired-batch policy check. Mirrors post-stock-transfer / issue edge
  // functions: pulls inventoryShelfLife.expiredEntityPolicy from
  // companySettings and refuses to post when any tracked entity attached to
  // the shipment is past its expirationDate (unless policy is "Warn").
  const { data: companySettings } = await serviceRole
    .from("companySettings")
    .select("inventoryShelfLife")
    .eq("id", companyId)
    .single();
  const shelfLifeBlob = companySettings?.inventoryShelfLife as {
    expiredEntityPolicy?: ExpiredEntityPolicy;
  } | null;
  const expiredPolicy: ExpiredEntityPolicy =
    shelfLifeBlob?.expiredEntityPolicy ?? "Block";

  const { data: shipmentTrackedEntities } = await serviceRole
    .from("trackedEntity")
    .select("id, readableId, expirationDate")
    .eq("attributes ->> Shipment", shipmentId)
    .eq("companyId", companyId);

  const todayLocal = today(getLocalTimeZone());
  const expiredEntities = (shipmentTrackedEntities ?? []).filter((e) => {
    if (!e.expirationDate) return false;
    try {
      return parseDate(e.expirationDate).compare(todayLocal) < 0;
    } catch {
      return false;
    }
  });

  let expiredWarning: string | null = null;
  if (expiredEntities.length > 0) {
    const ids = expiredEntities.map((e) => e.readableId ?? e.id).join(", ");
    const message = `Cannot post shipment with expired batch${
      expiredEntities.length === 1 ? "" : "es"
    }: ${ids}`;

    if (expiredPolicy === "Block" || expiredPolicy === "BlockWithOverride") {
      throw redirect(
        path.to.shipmentDetails(shipmentId),
        await flash(request, error(null, message))
      );
    }

    expiredWarning = `Posted shipment with expired batch${
      expiredEntities.length === 1 ? "" : "es"
    }: ${ids}`;
  }

  const setPendingState = await client
    .from("shipment")
    .update({
      status: "Pending"
    })
    .eq("id", shipmentId);

  if (setPendingState.error) {
    throw redirect(
      path.to.shipments,
      await flash(
        request,
        error(setPendingState.error, "Failed to post shipment")
      )
    );
  }

  try {
    // Get shipment details to check if it's related to a sales order
    const { data: shipment } = await serviceRole
      .from("shipment")
      .select("sourceDocument, sourceDocumentId, shipmentId")
      .eq("id", shipmentId)
      .single();

    // If the shipment is related to a sales order, save the packing slip PDF
    if (
      shipment?.sourceDocument === "Sales Order" &&
      shipment?.sourceDocumentId
    ) {
      try {
        // Get the opportunity ID from the sales order
        const { data: salesOrder } = await serviceRole
          .from("salesOrder")
          .select("opportunityId")
          .eq("id", shipment.sourceDocumentId)
          .single();

        if (salesOrder?.opportunityId) {
          // Generate the packing slip PDF
          const pdfArgs = {
            request,
            params: { id: shipmentId },
            context: {}
          };

          // @ts-expect-error TS2741 - TODO: fix type
          const pdf = await pdfLoader(pdfArgs);

          if (pdf.headers.get("content-type") === "application/pdf") {
            const file = await pdf.arrayBuffer();
            const fileName = stripSpecialCharacters(
              `${shipment.shipmentId} - ${new Date()
                .toISOString()
                .slice(0, -5)}.pdf`
            );

            const documentFilePath = `${companyId}/opportunity/${salesOrder.opportunityId}/${fileName}`;

            // Upload the PDF to storage
            const documentFileUpload = await serviceRole.storage
              .from("private")
              .upload(documentFilePath, file, {
                cacheControl: `${12 * 60 * 60}`,
                contentType: "application/pdf",
                upsert: true
              });

            if (!documentFileUpload.error) {
              // Create document record
              await upsertDocument(serviceRole, {
                path: documentFilePath,
                name: fileName,
                size: Math.round(file.byteLength / 1024),
                sourceDocument: "Shipment",
                sourceDocumentId: shipmentId,
                readGroups: [userId],
                writeGroups: [userId],
                createdBy: userId,
                companyId
              });
            }
          }
        }
      } catch (err) {
        // Continue with posting even if PDF generation fails
        console.error("Failed to generate packing slip PDF:", err);
      }
    }

    const postShipment = await serviceRole.functions.invoke("post-shipment", {
      body: {
        type: "post",
        shipmentId: shipmentId,
        userId: userId,
        companyId: companyId
      }
    });

    if (postShipment.error) {
      await client
        .from("shipment")
        .update({
          status: "Draft"
        })
        .eq("id", shipmentId);

      throw redirect(
        path.to.shipmentDetails(shipmentId),
        await flash(
          request,
          error(postShipment.error, "Failed to post shipment")
        )
      );
    }
    // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  } catch (error) {
    await client
      .from("shipment")
      .update({
        status: "Draft"
      })
      .eq("id", shipmentId);
  }

  if (expiredWarning) {
    throw redirect(
      path.to.shipmentDetails(shipmentId),
      await flash(request, success(expiredWarning))
    );
  }

  throw redirect(path.to.shipmentDetails(shipmentId));
}
