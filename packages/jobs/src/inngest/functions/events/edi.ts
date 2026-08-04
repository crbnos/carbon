import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { z } from "zod";
import { inngest } from "../../client";

// Batched EDI event handler. Fires when an outbound-triggering record changes
// status (sales order confirmed, shipment posted, sales invoice submitted).
// It cheaply filters to EDI customers with the relevant document enabled and
// dispatches an edi-send-document task; the writers stay EDI-ignorant.

const EdiRecordSchema = z.object({
  event: z
    .object({
      table: z.string(),
      operation: z.enum(["INSERT", "UPDATE", "DELETE"]),
      recordId: z.string()
    })
    .passthrough(),
  companyId: z.string()
});

const EdiPayloadSchema = z.object({
  records: z.array(EdiRecordSchema)
});

// The outbound document each source table produces.
const TABLE_TO_DOCUMENT_TYPE: Record<
  string,
  "Purchase Order Acknowledgment" | "Advance Ship Notice" | "Invoice"
> = {
  salesOrder: "Purchase Order Acknowledgment",
  shipment: "Advance Ship Notice",
  salesInvoice: "Invoice"
};

// A sales order that is still in one of these has not been confirmed (plan
// refinement #2 — the confirm route sets status via getSalesOrderStatus, which
// may skip the literal "Confirmed").
const SALES_ORDER_SKIP_STATUSES = ["Draft", "Needs Approval", "Cancelled"];

export const ediEventFunction = inngest.createFunction(
  { id: "event-handler-edi", retries: 3 },
  { event: "carbon/event-edi" },
  async ({ event, step, logger }) => {
    const payload = EdiPayloadSchema.parse(event.data);

    const toDispatch = await step.run("resolve-edi-dispatches", async () => {
      const client = getCarbonServiceRole();
      const results: Array<{
        companyId: string;
        table: "salesOrder" | "shipment" | "salesInvoice";
        recordId: string;
        documentType: string;
      }> = [];

      for (const record of payload.records) {
        const { table, recordId } = record.event;
        const companyId = record.companyId;
        if (!companyId || companyId === "undefined") continue;

        const documentType = TABLE_TO_DOCUMENT_TYPE[table];
        if (!documentType) continue;

        // 1. Fetch the source row and gate on status.
        let customerId: string | null = null;
        if (table === "salesOrder") {
          const { data } = await client
            .from("salesOrder")
            .select("customerId, status")
            .eq("id", recordId)
            .eq("companyId", companyId)
            .maybeSingle();
          if (!data) continue;
          if (SALES_ORDER_SKIP_STATUSES.includes(data.status ?? "")) continue;
          customerId = data.customerId;
        } else if (table === "shipment") {
          const { data } = await client
            .from("shipment")
            .select("customerId, status, sourceDocument")
            .eq("id", recordId)
            .eq("companyId", companyId)
            .maybeSingle();
          if (!data) continue;
          if (data.status !== "Posted" || data.sourceDocument !== "Sales Order")
            continue;
          customerId = data.customerId;
        } else if (table === "salesInvoice") {
          const { data } = await client
            .from("salesInvoice")
            .select("customerId, status")
            .eq("id", recordId)
            .eq("companyId", companyId)
            .maybeSingle();
          if (!data) continue;
          if (data.status !== "Submitted") continue;
          customerId = data.customerId;
        }

        if (!customerId) continue;

        // 2. Active trading partner with the target outbound document enabled.
        const { data: partner } = await client
          .from("ediTradingPartner")
          .select("id")
          .eq("companyId", companyId)
          .eq("customerId", customerId)
          .eq("active", true)
          .maybeSingle();
        if (!partner) continue;

        const { data: enabledDoc } = await client
          .from("ediTradingPartnerDocument")
          .select("id")
          .eq("companyId", companyId)
          .eq("tradingPartnerId", partner.id)
          .eq("documentType", documentType)
          .eq("direction", "Outbound")
          .eq("enabled", true)
          .maybeSingle();
        if (!enabledDoc) continue;

        // 3. Dedup: an existing non-Failed document for this record + type.
        const { data: existing } = await client
          .from("ediDocument")
          .select("id")
          .eq("companyId", companyId)
          .eq("sourceDocumentId", recordId)
          .eq("documentType", documentType)
          .neq("status", "Failed");
        if (existing && existing.length > 0) continue;

        results.push({
          companyId,
          table: table as "salesOrder" | "shipment" | "salesInvoice",
          recordId,
          documentType
        });
      }

      return results;
    });

    for (let i = 0; i < toDispatch.length; i++) {
      await step.sendEvent(`edi-send-${i}`, {
        name: "carbon/edi.send-document" as const,
        data: toDispatch[i]!
      });
    }

    logger.info(`EDI handler dispatched ${toDispatch.length} document(s)`);
    return { dispatched: toDispatch.length };
  }
);
