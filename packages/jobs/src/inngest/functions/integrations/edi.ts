import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database, Json } from "@carbon/database";
import type {
  EdiIssue,
  EdiOutboundPayload,
  EdiProviderCredentials
} from "@carbon/ee/edi.server";
import {
  buildAckPayload,
  buildInvoicePayload,
  buildShipNoticePayload,
  ediProviderIds,
  getEdiProvider
} from "@carbon/ee/edi.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { inngest } from "../../client";

type ServiceClient = SupabaseClient<Database>;
type EdiDocumentTypeEnum = Database["public"]["Enums"]["ediDocumentType"];

const SOURCE_DOCUMENT_LABEL: Record<string, string> = {
  salesOrder: "Sales Order",
  shipment: "Shipment",
  salesInvoice: "Sales Invoice"
};

// Find the company's active EDI provider + credentials.
async function getActiveEdiProvider(client: ServiceClient, companyId: string) {
  for (const id of ediProviderIds) {
    const { data } = await client
      .from("companyIntegration")
      .select("active, metadata")
      .eq("id", id)
      .eq("companyId", companyId)
      .maybeSingle();
    if (data?.active) {
      return {
        provider: getEdiProvider(id),
        creds: data.metadata as unknown as EdiProviderCredentials
      };
    }
  }
  return null;
}

// itemId → buyer part number, for echoing the buyer's parts back on outbound docs.
async function getPartNumbersByItemId(
  client: ServiceClient,
  companyId: string,
  customerId: string,
  itemIds: string[]
): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  if (itemIds.length === 0) return map;
  const { data } = await client
    .from("customerPartToItem")
    .select("itemId, customerPartId")
    .eq("companyId", companyId)
    .eq("customerId", customerId)
    .in("itemId", itemIds);
  for (const row of data ?? []) {
    map[row.itemId] = row.customerPartId;
  }
  return map;
}

type BuiltOutbound = {
  customerId: string;
  sourceDocumentReadableId: string | null;
  partnerReference: string | null;
  payload: EdiOutboundPayload | null;
  issues: EdiIssue[];
};

// Build the canonical outbound payload from the actual posted record.
async function buildOutbound(
  client: ServiceClient,
  args: {
    companyId: string;
    table: "salesOrder" | "shipment" | "salesInvoice";
    recordId: string;
    documentType: string;
  }
): Promise<BuiltOutbound | null> {
  const { companyId, table, recordId } = args;

  if (table === "salesOrder") {
    const { data: so } = await client
      .from("salesOrder")
      .select("customerId, customerReference, salesOrderId")
      .eq("id", recordId)
      .eq("companyId", companyId)
      .maybeSingle();
    if (!so?.customerId) return null;
    const { payload, issues } = buildAckPayload({
      salesOrder: { customerReference: so.customerReference }
    });
    return {
      customerId: so.customerId,
      sourceDocumentReadableId: so.salesOrderId,
      partnerReference: so.customerReference,
      payload,
      issues
    };
  }

  if (table === "shipment") {
    const { data: shipment } = await client
      .from("shipment")
      .select(
        "customerId, shipmentId, sourceDocumentId, trackingNumber, shippingMethodId, postingDate"
      )
      .eq("id", recordId)
      .eq("companyId", companyId)
      .maybeSingle();
    if (!shipment?.customerId || !shipment.sourceDocumentId) return null;

    const [order, shipmentLines, shippingMethod] = await Promise.all([
      client
        .from("salesOrder")
        .select("customerReference")
        .eq("id", shipment.sourceDocumentId)
        .maybeSingle(),
      client
        .from("shipmentLine")
        .select("itemId, shippedQuantity, unitOfMeasure")
        .eq("shipmentId", recordId)
        .eq("companyId", companyId),
      shipment.shippingMethodId
        ? client
            .from("shippingMethod")
            .select("name, carrier")
            .eq("id", shipment.shippingMethodId)
            .maybeSingle()
        : Promise.resolve({ data: null })
    ]);

    const lines = (shipmentLines.data ?? []).filter(
      (l): l is typeof l & { itemId: string } => !!l.itemId
    );
    const partNumbers = await getPartNumbersByItemId(
      client,
      companyId,
      shipment.customerId,
      lines.map((l) => l.itemId)
    );
    const { payload, issues } = buildShipNoticePayload({
      shipment: {
        partnerReference: order.data?.customerReference ?? null,
        shipDate:
          shipment.postingDate ?? new Date().toISOString().split("T")[0]!,
        trackingNumber: shipment.trackingNumber,
        shipVia:
          shippingMethod.data?.carrier ?? shippingMethod.data?.name ?? null
      },
      shipmentLines: lines.map((l) => ({
        itemId: l.itemId,
        quantity: l.shippedQuantity ?? 0,
        unitOfMeasure: l.unitOfMeasure ?? "EA"
      })),
      partNumbersByItemId: partNumbers
    });
    return {
      customerId: shipment.customerId,
      sourceDocumentReadableId: shipment.shipmentId,
      partnerReference: order.data?.customerReference ?? null,
      payload,
      issues
    };
  }

  // salesInvoice
  const { data: invoice } = await client
    .from("salesInvoice")
    .select(
      "customerId, customerReference, invoiceId, currencyCode, dateIssued"
    )
    .eq("id", recordId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (!invoice?.customerId) return null;

  const { data: invoiceLines } = await client
    .from("salesInvoiceLine")
    .select("itemId, quantity, unitOfMeasureCode, unitPrice")
    .eq("invoiceId", recordId)
    .eq("companyId", companyId);
  const lines = (invoiceLines ?? []).filter(
    (l): l is typeof l & { itemId: string } => !!l.itemId
  );
  const partNumbers = await getPartNumbersByItemId(
    client,
    companyId,
    invoice.customerId,
    lines.map((l) => l.itemId)
  );
  const { payload, issues } = buildInvoicePayload({
    salesInvoice: {
      partnerReference: invoice.customerReference,
      invoiceNumber: invoice.invoiceId,
      invoiceDate:
        invoice.dateIssued ?? new Date().toISOString().split("T")[0]!,
      currencyCode: invoice.currencyCode ?? "USD"
    },
    salesInvoiceLines: lines.map((l) => ({
      itemId: l.itemId,
      quantity: l.quantity ?? 0,
      unitOfMeasure: l.unitOfMeasureCode ?? "EA",
      unitPrice: l.unitPrice ?? 0
    })),
    partNumbersByItemId: partNumbers
  });
  return {
    customerId: invoice.customerId,
    sourceDocumentReadableId: invoice.invoiceId,
    partnerReference: invoice.customerReference,
    payload,
    issues
  };
}

export const ediSendDocumentFunction = inngest.createFunction(
  { id: "edi-send-document", retries: 3 },
  { event: "carbon/edi.send-document" },
  async ({ event, step, logger }) => {
    const { companyId, table, recordId, documentType } = event.data;
    const client = getCarbonServiceRole();

    const active = await getActiveEdiProvider(client, companyId);
    if (!active) {
      logger.warn("EDI send: no active provider integration");
      return { skipped: "no-provider" };
    }
    const { provider, creds } = active;

    const staged = await step.run("stage", async () => {
      const built = await buildOutbound(client, {
        companyId,
        table,
        recordId,
        documentType
      });
      if (!built) return { ok: false as const, reason: "record-missing" };

      // Re-verify the partner + document enablement (the event may be stale).
      const { data: partner } = await client
        .from("ediTradingPartner")
        .select("id, externalId")
        .eq("companyId", companyId)
        .eq("customerId", built.customerId)
        .eq("active", true)
        .maybeSingle();
      if (!partner) return { ok: false as const, reason: "no-partner" };

      const { data: enabled } = await client
        .from("ediTradingPartnerDocument")
        .select("id")
        .eq("companyId", companyId)
        .eq("tradingPartnerId", partner.id)
        .eq("documentType", documentType as EdiDocumentTypeEnum)
        .eq("direction", "Outbound")
        .eq("enabled", true)
        .maybeSingle();
      if (!enabled) return { ok: false as const, reason: "not-enabled" };

      // Dedup: a Sent/Acknowledged document already exists → nothing to do.
      const { data: existing } = await client
        .from("ediDocument")
        .select("id, status")
        .eq("companyId", companyId)
        .eq("sourceDocumentId", recordId)
        .eq("documentType", documentType as EdiDocumentTypeEnum);
      const rows = existing ?? [];
      if (
        rows.some((r) => r.status === "Sent" || r.status === "Acknowledged")
      ) {
        return { ok: false as const, reason: "already-sent" };
      }
      const reuseId =
        rows.find((r) => r.status === "Pending" || r.status === "Failed")?.id ??
        null;

      const status = built.payload ? "Pending" : "Failed";
      const base = {
        companyId,
        tradingPartnerId: partner.id,
        direction: "Outbound" as const,
        documentType: documentType as EdiDocumentTypeEnum,
        status: status as Database["public"]["Enums"]["ediDocumentStatus"],
        partnerReference: built.partnerReference,
        payload: (built.payload ?? {}) as unknown as Json,
        issues: built.issues as unknown as Json,
        sourceDocument: SOURCE_DOCUMENT_LABEL[table] ?? null,
        sourceDocumentId: recordId,
        sourceDocumentReadableId: built.sourceDocumentReadableId,
        updatedBy: "system",
        updatedAt: new Date().toISOString()
      };

      let documentId: string;
      if (reuseId) {
        await client
          .from("ediDocument")
          .update(base)
          .eq("id", reuseId)
          .eq("companyId", companyId);
        documentId = reuseId;
      } else {
        const insert = await client
          .from("ediDocument")
          .insert({ ...base, createdBy: "system" })
          .select("id")
          .single();
        if (insert.error || !insert.data) {
          throw new Error(
            insert.error?.message ?? "Failed to stage EDI document"
          );
        }
        documentId = insert.data.id;
      }

      return {
        ok: true as const,
        documentId,
        partnerExternalId: partner.externalId ?? "",
        payload: built.payload
      };
    });

    if (!staged.ok) {
      logger.info(`EDI send skipped: ${staged.reason}`);
      return { skipped: staged.reason };
    }
    if (!staged.payload) {
      // Staged as Failed with build issues — never send an unmatchable document.
      logger.warn("EDI send: document could not be built, staged as Failed");
      return { failed: "unbuildable", documentId: staged.documentId };
    }

    const { documentId, partnerExternalId, payload } = staged;

    return await step.run("send", async () => {
      try {
        const res = await provider.sendTransaction(creds, {
          partnerExternalId,
          documentType: documentType as EdiDocumentTypeEnum,
          payload
        });
        await client
          .from("ediDocument")
          .update({
            status: "Sent",
            externalId: res.externalId,
            updatedAt: new Date().toISOString()
          })
          .eq("id", documentId)
          .eq("companyId", companyId);
        return { sent: true, externalId: res.externalId };
      } catch (err) {
        const status = (err as { status?: number }).status;
        if (status && status >= 400 && status < 500) {
          // Provider-side validation rejection → terminal, no retry.
          const issues: EdiIssue[] = [
            { code: "provider-rejected", message: (err as Error).message }
          ];
          await client
            .from("ediDocument")
            .update({
              status: "Failed",
              issues: issues as unknown as Json,
              updatedAt: new Date().toISOString()
            })
            .eq("id", documentId)
            .eq("companyId", companyId);
          return { failed: "provider-rejected" };
        }
        // Transport / 5xx → rethrow so Inngest retries (document stays Pending).
        throw err;
      }
    });
  }
);

export const ediReconcileAcksFunction = inngest.createFunction(
  { id: "edi-reconcile-acks", retries: 1 },
  { cron: "17 * * * *" },
  async ({ step, logger }) => {
    const client = getCarbonServiceRole();
    const result = await step.run("flag-unacknowledged", async () => {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: docs } = await client
        .from("ediDocument")
        .select("id, companyId, issues")
        .eq("status", "Sent")
        .is("acknowledgedAt", null)
        .lt("createdAt", cutoff);

      let flagged = 0;
      for (const doc of docs ?? []) {
        const issues = (
          Array.isArray(doc.issues) ? doc.issues : []
        ) as EdiIssue[];
        if (issues.some((i) => i.code === "unacknowledged")) continue;
        const next: EdiIssue[] = [
          ...issues,
          {
            code: "unacknowledged",
            message: "No functional acknowledgment received within 24 hours"
          }
        ];
        await client
          .from("ediDocument")
          .update({
            issues: next as unknown as Json,
            updatedAt: new Date().toISOString()
          })
          .eq("id", doc.id)
          .eq("companyId", doc.companyId);
        flagged++;
      }
      return { flagged };
    });
    logger.info(`EDI ack reconcile flagged ${result.flagged} document(s)`);
    return result;
  }
);
