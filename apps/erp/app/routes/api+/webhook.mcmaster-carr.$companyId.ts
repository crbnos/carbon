import crypto from "node:crypto";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { resolveIntegrationSecrets } from "@carbon/ee";
import {
  buildCxmlResponse,
  parseConfirmationRequest,
  parseCxmlEnvelope,
  parseInvoiceDetailRequest,
  parseShipNoticeRequest
} from "@carbon/ee/punchout";
import { getLogger } from "@carbon/logger";
import { datetime } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  applyCxmlConfirmation,
  applyCxmlShipNotice,
  insertCxmlDocument,
  updateCxmlDocumentStatus
} from "~/modules/purchasing";
import { getIntegration } from "~/modules/settings/settings.service";

const INTEGRATION_ID = "mcmaster-carr";
const logger = getLogger("erp", "webhook-mcmaster-carr");

const XML_HEADERS = { "Content-Type": "text/xml" };

function cxmlResponse(
  statusCode: number,
  statusText: string,
  httpStatus: number
) {
  return new Response(
    buildCxmlResponse({
      statusCode,
      statusText,
      payloadId: `${datetime.timestamp()}@carbon`,
      timestamp: datetime.timestamp()
    }),
    { headers: XML_HEADERS, status: httpStatus }
  );
}

function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export async function loader({ params }: LoaderFunctionArgs) {
  return params.companyId
    ? { success: true }
    : data({ success: false }, { status: 400 });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { companyId } = params;
  if (!companyId) return cxmlResponse(400, "bad request", 400);

  const serviceRole = getCarbonServiceRole();

  try {
    const rawBody = await request.text();

    const integration = await getIntegration(
      serviceRole,
      INTEGRATION_ID,
      companyId
    );
    if (!integration.data || !integration.data.active) {
      return cxmlResponse(400, "integration not installed", 400);
    }

    const resolved = (await resolveIntegrationSecrets(
      serviceRole,
      companyId,
      INTEGRATION_ID,
      integration.data.metadata,
      integration.data.secretRef
    )) as { supplierId?: string; inboundSharedSecret?: string };

    const envelope = parseCxmlEnvelope(rawBody);
    if (
      !resolved.inboundSharedSecret ||
      !timingSafeEqual(
        envelope.senderSharedSecret,
        resolved.inboundSharedSecret
      )
    ) {
      return cxmlResponse(401, "unauthorized", 401);
    }

    const supplierId = resolved.supplierId;
    if (!supplierId) {
      return cxmlResponse(400, "integration not configured", 400);
    }

    const body = (envelope.body ?? {}) as Record<string, unknown>;

    // ── Order Confirmation ──────────────────────────────────────────────
    if ("ConfirmationRequest" in body) {
      const parsed = parseConfirmationRequest(rawBody);
      if (!parsed.data) return cxmlResponse(400, "invalid confirmation", 400);

      const doc = await insertCxmlDocument(serviceRole, {
        companyId,
        integrationId: INTEGRATION_ID,
        supplierId,
        direction: "Inbound",
        documentType: "Order Confirmation",
        status: "Received",
        payloadId: envelope.payloadId,
        externalId: parsed.data.confirmId,
        payload: parsed.data as never,
        createdBy: "system"
      });
      if (doc.duplicate) return cxmlResponse(200, "success", 200);
      if (!doc.data) return cxmlResponse(500, "failed to record", 500);

      const applied = await applyCxmlConfirmation(serviceRole, {
        companyId,
        payload: parsed.data
      });
      if (applied.data) {
        await updateCxmlDocumentStatus(serviceRole, {
          id: doc.data.id,
          companyId,
          status: "Posted",
          purchaseOrderId: applied.data.purchaseOrderId
        });
      } else {
        await updateCxmlDocumentStatus(serviceRole, {
          id: doc.data.id,
          companyId,
          status: "Needs Review",
          issues: [applied.error?.message ?? "Could not apply confirmation"]
        });
      }
      return cxmlResponse(200, "success", 200);
    }

    // ── Ship Notice ─────────────────────────────────────────────────────
    if ("ShipNoticeRequest" in body) {
      const parsed = parseShipNoticeRequest(rawBody);
      if (!parsed.data) return cxmlResponse(400, "invalid ship notice", 400);

      const doc = await insertCxmlDocument(serviceRole, {
        companyId,
        integrationId: INTEGRATION_ID,
        supplierId,
        direction: "Inbound",
        documentType: "Ship Notice",
        status: "Received",
        payloadId: envelope.payloadId,
        externalId: parsed.data.shipmentId,
        payload: parsed.data as never,
        createdBy: "system"
      });
      if (doc.duplicate) return cxmlResponse(200, "success", 200);
      if (!doc.data) return cxmlResponse(500, "failed to record", 500);

      const applied = await applyCxmlShipNotice(serviceRole, {
        companyId,
        payload: parsed.data
      });
      if (applied.data) {
        await updateCxmlDocumentStatus(serviceRole, {
          id: doc.data.id,
          companyId,
          status: "Posted",
          purchaseOrderId: applied.data.purchaseOrderId
        });
      } else {
        await updateCxmlDocumentStatus(serviceRole, {
          id: doc.data.id,
          companyId,
          status: "Needs Review",
          issues: [applied.error?.message ?? "Could not apply ship notice"]
        });
      }
      return cxmlResponse(200, "success", 200);
    }

    // ── Invoice / Credit Memo ───────────────────────────────────────────
    if ("InvoiceDetailRequest" in body) {
      const parsed = parseInvoiceDetailRequest(rawBody);
      if (!parsed.data) return cxmlResponse(400, "invalid invoice", 400);

      const documentType =
        parsed.data.purpose === "lineLevelCreditMemo"
          ? "Credit Memo"
          : "Invoice";

      // Link the PO if we can find it; invoices are always held for review.
      const po = parsed.data.orderId
        ? await serviceRole
            .from("purchaseOrder")
            .select("id")
            .eq("companyId", companyId)
            .eq("purchaseOrderId", parsed.data.orderId)
            .maybeSingle()
        : null;
      const issues = po?.data
        ? []
        : [
            `No purchase order matched order id ${parsed.data.orderId ?? "(none)"}`
          ];

      const doc = await insertCxmlDocument(serviceRole, {
        companyId,
        integrationId: INTEGRATION_ID,
        supplierId,
        direction: "Inbound",
        documentType,
        status: "Needs Review",
        payloadId: envelope.payloadId,
        externalId: parsed.data.invoiceId,
        payload: parsed.data as never,
        purchaseOrderId: po?.data?.id ?? null,
        createdBy: "system"
      });
      if (doc.duplicate) return cxmlResponse(200, "success", 200);
      if (!doc.data) return cxmlResponse(500, "failed to record", 500);

      if (issues.length > 0) {
        await updateCxmlDocumentStatus(serviceRole, {
          id: doc.data.id,
          companyId,
          status: "Needs Review",
          issues
        });
      }
      return cxmlResponse(200, "success", 200);
    }

    return cxmlResponse(400, "unsupported document", 400);
  } catch (err) {
    logger.error("mcmaster-carr webhook failed", {
      error: (err as Error).message
    });
    // 5xx so McMaster redelivers.
    return cxmlResponse(500, "internal error", 500);
  }
}
