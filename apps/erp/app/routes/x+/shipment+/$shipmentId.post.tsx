import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import {
  dedupeViolations,
  evaluateLinesForSurface,
  evaluateSalesRuleLines,
  isBlocked,
  resolveSalesOrderShipTo
} from "@carbon/ee/rules.server";
import { storage } from "@carbon/files";
import { trigger } from "@carbon/jobs";
import { trackWorkEvent } from "@carbon/lib/telemetry";
import { raiseMoment } from "@carbon/lib/workflows";
import { getLogger } from "@carbon/logger";
import { getCachedPrinterConfig } from "@carbon/printing/printing.server";
import { datetime, getPreferenceHeaders } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { upsertDocument } from "~/modules/documents";
import { getCertificateOfConformanceDefaults } from "~/modules/inventory";
import {
  issueCertificateOfConformance,
  sendCertificateOfConformance
} from "~/modules/inventory/inventory.server";
import { recordSalesRuleOutcome } from "~/modules/sales/sales.server";
import {
  getCompanyTimeZone,
  getLocationTimeZone
} from "~/modules/shared/timezone.server";
import { loader as pdfLoader } from "~/routes/file+/shipment+/$id[.]pdf";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";
import { stripSpecialCharacters } from "~/utils/string";

type ExpiredEntityPolicy = "Warn" | "Block" | "BlockWithOverride";

const logger = getLogger("erp", "shipment", "post");

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "inventory"
  });

  const { shipmentId } = params;
  if (!shipmentId) throw new Error("shipmentId not found");

  const formData = await request.formData();
  const acknowledged = formData.get("acknowledged") === "true";

  // Storage Rule evaluation across every line on this shipment before posting.
  const serviceRole = getCarbonServiceRole();
  const { data: lines } = await serviceRole
    .from("shipmentLine")
    .select(
      "id, lineId, itemId, storageUnitId, shippedQuantity, locationId, shipmentId"
    )
    .eq("shipmentId", shipmentId)
    .eq("companyId", companyId);

  // Shipment source determines which surface(s) eval. Shipments leaving for
  // an Outbound Transfer ALSO eval the `warehouseTransfer` surface — the post
  // auto-completes the parent transfer, so warehouse-scoped rules need to
  // fire here too.
  const { data: shipmentForSurface } = await serviceRole
    .from("shipment")
    .select("sourceDocument, sourceDocumentId, locationId")
    .eq("id", shipmentId)
    // Service-role read: companyId scope is not backstopped by RLS here.
    .eq("companyId", companyId)
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
  // storage rules own the `pick` surface. Transfers double-up via the
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

  // Sales rules on the originating sales order — the last physical checkpoint.
  // Sales rules have no `shipment` surface (their enum is sales-document only),
  // so this evaluates under `salesOrderLine` rather than inventing a surface.
  // Scope is THIS shipment's lines at their real shipped quantities — the
  // whole order would let an unshipped violating line block a partial
  // shipment of a clean one. The ship-to is the order's resolved destination
  // (drop-ship included).
  let salesRuleViolations: ReturnType<typeof dedupeViolations> = [];
  if (
    shipmentForSurface?.sourceDocument === "Sales Order" &&
    shipmentForSurface.sourceDocumentId
  ) {
    const shipTo = await resolveSalesOrderShipTo(
      serviceRole,
      shipmentForSurface.sourceDocumentId,
      companyId
    );
    const { violations, ruleNames } = await evaluateSalesRuleLines({
      client: serviceRole,
      companyId,
      userId,
      surface: "salesOrderLine",
      lines: (lines ?? [])
        .filter((l) => !!l.itemId && Number(l.shippedQuantity ?? 0) > 0)
        .map((l) => ({
          // Attribute to the source sales-order line when linked, so the
          // evidence row and deep link land on the order line.
          lineId: (l.lineId as string | null) ?? (l.id as string),
          itemId: l.itemId as string,
          quantity: Number(l.shippedQuantity)
        })),
      customerId: shipTo.customerId,
      customerLocationId: shipTo.customerLocationId
    });
    salesRuleViolations = violations;
    allViolations.push(...violations);
    Object.assign(allRuleNames, ruleNames);
  }

  const deduped = dedupeViolations(allViolations);
  // Evidence covers only the SALES violations (the acknowledgment table is
  // sales-family evidence, attributed to the source order); storage
  // violations on the same post carry no evidence, as on every other
  // storage surface. The outcome reflects the submission's overall fate —
  // a post blocked by any violation records its sales violations as
  // blocked too. Acknowledged evidence waits until the post has committed.
  const salesDeduped = dedupeViolations(salesRuleViolations);
  if (deduped.length > 0) {
    const blocked = isBlocked(deduped, acknowledged);
    if (
      blocked &&
      salesDeduped.length > 0 &&
      shipmentForSurface?.sourceDocumentId
    ) {
      await recordSalesRuleOutcome(serviceRole, {
        companyId,
        userId,
        documentType: "salesOrder",
        documentId: shipmentForSurface.sourceDocumentId,
        outcome: "blocked",
        violations: salesDeduped,
        ruleNames: allRuleNames
      });
    }
    if (blocked) {
      return {
        error: null,
        data: null,
        violations: deduped,
        ruleNames: allRuleNames
      };
    }
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

  // Expiry is judged on the shipping site's calendar, not the server's — a lot
  // that expires today must not read as expired at a plant still on yesterday.
  // No location on the shipment → the company calendar.
  const shipmentLocationId = shipmentForSurface?.locationId as string | null;
  const todayLocal = datetime.today(
    shipmentLocationId
      ? await getLocationTimeZone(serviceRole, shipmentLocationId, companyId)
      : await getCompanyTimeZone(serviceRole, companyId)
  );
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

  /** Set by the catch below when the post was rolled back to Draft. */
  let reverted = false;
  /** The auto-issued certificate's outcome, reported with the post. */
  let certificateOutcome: { ok: boolean; message: string } | null = null;

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
            const documentFileUpload = await storage(serviceRole)
              .company(companyId)
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
        logger.error("Failed to generate packing slip PDF", { error: err });
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

    // Auto-print labels if enabled
    try {
      const { data: shipmentForPrint } = await serviceRole
        .from("shipment")
        .select("locationId")
        .eq("id", shipmentId)
        .single();
      const locationId = shipmentForPrint?.locationId as string | undefined;
      if (locationId) {
        const config = await getCachedPrinterConfig(
          serviceRole,
          companyId,
          locationId,
          "shipping"
        );
        if (config?.autoPrint ?? true) {
          await trigger("print-job", {
            sourceDocument: "Shipment",
            sourceDocumentId: shipmentId,
            companyId,
            userId,
            locationId
          });
        }
      }
    } catch (e) {
      logger.error("Auto-print failed", { error: e });
    }

    // Auto-print labels for batch split entities. splitEntityIds carries the
    // RETAINED shelf lots (their quantity changed in the split) — existing
    // entities being reprinted, hence sourceDocument "Entity". The shipped
    // child departed Consumed and gets no label.
    const splitEntityIds = postShipment.data?.splitEntityIds || [];
    if (splitEntityIds.length > 0) {
      try {
        for (const entityId of splitEntityIds) {
          await trigger("print-job", {
            sourceDocument: "Entity",
            sourceDocumentId: entityId,
            companyId,
            userId
          });
        }
      } catch (e) {
        logger.error("Auto-print for split entities failed", { error: e });
      }
    }
  } catch (thrown) {
    if (thrown instanceof Response) throw thrown;
    reverted = true;
    await client
      .from("shipment")
      .update({
        status: "Draft"
      })
      .eq("id", shipmentId);
  }

  // Must stay below the rollback catch above — a post that got reverted to
  // Draft must not fire workflows.
  await raiseMoment("inventory.shipmentPosted", {
    outputs: { shipment: { id: shipmentId }, postedBy: { id: userId } },
    companyId,
    actorId: userId
  });

  // See the receipt post route: below the catch still runs after a rollback,
  // so the flag is what makes this "the post stuck", not the position.
  if (!reverted) {
    // Acknowledged-override evidence only once the post has stuck — a trail
    // (and notification) for a post that was rolled back would be false.
    if (salesDeduped.length > 0 && shipmentForSurface?.sourceDocumentId) {
      await recordSalesRuleOutcome(serviceRole, {
        companyId,
        userId,
        documentType: "salesOrder",
        documentId: shipmentForSurface.sourceDocumentId,
        outcome: "acknowledged",
        violations: salesDeduped,
        ruleNames: allRuleNames
      });
    }
    trackWorkEvent("shipment_posted", {
      companyId,
      userId,
      shipmentId,
      sourceDocument: shipmentForSurface?.sourceDocument ?? null
    });

    certificateOutcome = await autoIssueCertificateOfConformance(request, {
      client,
      companyId,
      shipmentId,
      userId
    });
  }

  // One flash per response: the expired-batch warning and the certificate
  // outcome share it.
  const messages = [expiredWarning, certificateOutcome?.message].filter(
    (message): message is string => !!message
  );
  if (messages.length > 0) {
    const message = messages.join(" ");
    throw redirect(
      path.to.shipmentDetails(shipmentId),
      await flash(
        request,
        certificateOutcome && !certificateOutcome.ok
          ? error(null, message)
          : success(message)
      )
    );
  }

  throw redirect(path.to.shipmentDetails(shipmentId));
}

/**
 * Issue (and email) the Certificate of Conformance a customer requires on
 * every shipment. Runs after a post that stuck and never changes its result:
 * every failure is reported, not thrown.
 */
async function autoIssueCertificateOfConformance(
  request: Request,
  args: {
    client: Parameters<typeof getCertificateOfConformanceDefaults>[0];
    companyId: string;
    shipmentId: string;
    userId: string;
  }
): Promise<{ ok: boolean; message: string } | null> {
  const { client, companyId, shipmentId, userId } = args;
  try {
    const defaults = await getCertificateOfConformanceDefaults(
      client,
      companyId,
      shipmentId
    );
    if (defaults.error) {
      logger.error("Failed to read certificate requirements", {
        shipmentId,
        error: defaults.error
      });
      return null;
    }
    if (!defaults.data.requiresCertificateOfConformance) return null;

    const { locale } = getPreferenceHeaders(request);
    const issued = await issueCertificateOfConformance(
      getDatabaseClient(),
      client,
      { companyId, shipmentId, userId, locale }
    );
    if (issued.error) {
      return {
        ok: false,
        message: `Shipment posted, but the certificate could not be issued: ${issued.error.message}`
      };
    }

    const number = issued.data.number;
    const contactId = defaults.data.shippingCustomerContactId;
    if (!contactId) {
      return {
        ok: true,
        message: `Certificate of Conformance ${number} issued (not emailed: the customer has no shipping contact)`
      };
    }

    const sent = await sendCertificateOfConformance(client, {
      companyId,
      shipmentId,
      userId,
      certificateOfConformanceId: issued.data.id,
      customerContactId: contactId,
      locale
    });
    if (sent.error) {
      return {
        ok: true,
        message: `Certificate of Conformance ${number} issued (not emailed: ${sent.error.message})`
      };
    }

    return {
      ok: true,
      message: `Certificate of Conformance ${number} issued and emailed to ${sent.data.to.join(", ")}`
    };
  } catch (err) {
    logger.error("Failed to auto-issue certificate of conformance", {
      shipmentId,
      error: err
    });
    return {
      ok: false,
      message: `Shipment posted, but the certificate could not be issued: ${
        err instanceof Error ? err.message : "unexpected error"
      }`
    };
  }
}
