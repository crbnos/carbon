import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { resolveIntegrationSecrets } from "@carbon/ee";
import type { CxmlAddress } from "@carbon/ee/punchout";
import {
  buildOrderRequest,
  parsePunchOutSetupResponse
} from "@carbon/ee/punchout";
import { datetime, round } from "@carbon/utils";
import { inngest } from "../../client";

const INTEGRATION_ID = "mcmaster-carr";

type McmasterMetadata = {
  supplierId?: string;
  environment?: string;
  orderUrlTest?: string;
  orderUrlProduction?: string;
  fromIdentity?: string;
  fromDomain?: string;
  toIdentity?: string;
  toDomain?: string;
  sharedSecret?: string;
};

/**
 * Send a finalized purchase order to McMaster-Carr as a cXML OrderRequest.
 * Two steps: stage a Pending outbound document (idempotent — a prior Sent
 * document short-circuits), then build + POST + record Sent/Failed. Retries are
 * safe because the duplicate-send guard runs before every send.
 */
export const punchoutSendPoFunction = inngest.createFunction(
  { id: "punchout-send-po", retries: 3 },
  { event: "carbon/punchout.send-po" },
  async ({ event, step }) => {
    const { companyId, purchaseOrderId, userId } = event.data;
    const serviceRole = getCarbonServiceRole();

    const staged = await step.run("stage", async () => {
      const integration = await serviceRole
        .from("companyIntegration")
        .select("metadata")
        .eq("id", INTEGRATION_ID)
        .eq("companyId", companyId)
        .maybeSingle();
      const metadata = (integration.data?.metadata ?? {}) as McmasterMetadata;
      if (!integration.data) {
        return { skipped: "integration-not-installed" as const };
      }

      const po = await serviceRole
        .from("purchaseOrder")
        .select("id, purchaseOrderId, supplierId")
        .eq("id", purchaseOrderId)
        .eq("companyId", companyId)
        .maybeSingle();
      if (!po.data) return { skipped: "purchase-order-not-found" as const };
      if (po.data.supplierId !== metadata.supplierId) {
        return { skipped: "supplier-mismatch" as const };
      }

      // Duplicate-send guard: never re-send a PO already accepted.
      const existingSent = await serviceRole
        .from("cxmlDocument")
        .select("id")
        .eq("companyId", companyId)
        .eq("purchaseOrderId", purchaseOrderId)
        .eq("direction", "Outbound")
        .eq("documentType", "Purchase Order")
        .eq("status", "Sent")
        .maybeSingle();
      if (existingSent.data) {
        return { skipped: "already-sent" as const };
      }

      const inserted = await serviceRole
        .from("cxmlDocument")
        .insert({
          companyId,
          integrationId: INTEGRATION_ID,
          supplierId: po.data.supplierId,
          direction: "Outbound",
          documentType: "Purchase Order",
          status: "Pending",
          payloadId: `${po.data.purchaseOrderId}-${datetime.timestamp()}@carbon`,
          payload: {
            purchaseOrderId: po.data.purchaseOrderId,
            orderId: po.data.id
          },
          purchaseOrderId,
          createdBy: userId
        })
        .select("id")
        .single();
      if (inserted.error || !inserted.data) {
        return {
          skipped: "stage-failed" as const,
          error: inserted.error?.message
        };
      }
      return { documentId: inserted.data.id };
    });

    if ("skipped" in staged) return staged;
    const documentId = staged.documentId;

    return await step.run("send", async () => {
      const integration = await serviceRole
        .from("companyIntegration")
        .select("metadata, secretRef")
        .eq("id", INTEGRATION_ID)
        .eq("companyId", companyId)
        .maybeSingle();
      const resolved = (await resolveIntegrationSecrets(
        serviceRole,
        companyId,
        INTEGRATION_ID,
        integration.data?.metadata,
        integration.data?.secretRef
      )) as McmasterMetadata;

      const isProduction = resolved.environment === "Production";
      const orderUrl = isProduction
        ? resolved.orderUrlProduction
        : resolved.orderUrlTest;

      const fail = async (message: string) => {
        await serviceRole
          .from("cxmlDocument")
          .update({
            status: "Failed",
            issues: [message],
            updatedAt: datetime.timestamp()
          })
          .eq("id", documentId)
          .eq("companyId", companyId);
        return { documentId, status: "Failed" as const, message };
      };

      if (!orderUrl) {
        return fail(
          `No order URL configured for the ${isProduction ? "production" : "test"} environment`
        );
      }

      const po = await serviceRole
        .from("purchaseOrder")
        .select("id, purchaseOrderId, currencyCode, orderDate")
        .eq("id", purchaseOrderId)
        .eq("companyId", companyId)
        .single();
      if (po.error || !po.data) return fail("Purchase order not found");

      const delivery = await serviceRole
        .from("purchaseOrderDelivery")
        .select("locationId")
        .eq("id", purchaseOrderId)
        .eq("companyId", companyId)
        .maybeSingle();
      const locationId = delivery.data?.locationId ?? null;

      const lines = await serviceRole
        .from("purchaseOrderLine")
        .select(
          "description, purchaseQuantity, supplierUnitPrice, supplierPartId, supplierPartAuxiliaryId, purchaseUnitOfMeasureCode"
        )
        .eq("purchaseOrderId", purchaseOrderId)
        .eq("companyId", companyId)
        .order("sortOrder", { ascending: true });
      const orderLines = (lines.data ?? []).filter(
        (line) => line.supplierPartId
      );

      const currencyCode = po.data.currencyCode ?? "USD";
      const currency = await serviceRole
        .from("currency")
        .select("decimalPlaces")
        .eq("code", currencyCode)
        .eq("companyId", companyId)
        .maybeSingle();
      const decimalPlaces = currency.data?.decimalPlaces ?? 2;

      const total = round(
        orderLines.reduce(
          (sum, line) =>
            sum + (line.supplierUnitPrice ?? 0) * (line.purchaseQuantity ?? 0),
          0
        ),
        decimalPlaces
      );

      let shipTo: CxmlAddress | null = null;
      if (locationId) {
        const location = await serviceRole
          .from("location")
          .select(
            "name, addressLine1, addressLine2, city, stateProvince, postalCode, countryCode"
          )
          .eq("id", locationId)
          .eq("companyId", companyId)
          .maybeSingle();
        if (location.data) {
          shipTo = {
            name: location.data.name,
            deliverTo: null,
            street: [
              location.data.addressLine1,
              location.data.addressLine2
            ].filter((s): s is string => Boolean(s)),
            city: location.data.city,
            state: location.data.stateProvince,
            postalCode: location.data.postalCode,
            countryCode: location.data.countryCode ?? "US"
          };
        }
      }

      const orderRequest = buildOrderRequest({
        credentials: {
          from: {
            domain: resolved.fromDomain ?? "NetworkID",
            identity: resolved.fromIdentity ?? ""
          },
          to: {
            domain: resolved.toDomain ?? "DUNS",
            identity: resolved.toIdentity ?? ""
          },
          sender: {
            domain: resolved.fromDomain ?? "NetworkID",
            identity: resolved.fromIdentity ?? ""
          },
          sharedSecret: resolved.sharedSecret ?? "",
          deploymentMode: isProduction ? "production" : "test",
          userAgent: "Carbon"
        },
        payloadId: `${po.data.purchaseOrderId}@carbon`,
        timestamp: datetime.timestamp(),
        orderId: po.data.purchaseOrderId,
        orderDate: po.data.orderDate ?? datetime.timestamp(),
        total,
        currencyCode,
        shipTo,
        billTo: null,
        contactEmail: null,
        contactName: null,
        comments: null,
        lines: orderLines.map((line, index) => ({
          lineNumber: index + 1,
          quantity: line.purchaseQuantity ?? 0,
          supplierPartId: line.supplierPartId ?? "",
          supplierPartAuxiliaryId: line.supplierPartAuxiliaryId,
          unitPrice: line.supplierUnitPrice ?? 0,
          description: line.description ?? "",
          unitOfMeasureCode: line.purchaseUnitOfMeasureCode ?? "EA"
        }))
      });

      let response: Response;
      try {
        response = await fetch(orderUrl, {
          method: "POST",
          headers: { "Content-Type": "text/xml" },
          body: orderRequest,
          signal: AbortSignal.timeout(15000)
        });
      } catch (err) {
        // Store Failed rather than rethrow — the stage guard makes a retry safe,
        // but we don't want retries to silently double-send on a flaky network.
        return fail((err as Error).message);
      }

      const responseXml = await response.text();
      const parsed = parsePunchOutSetupResponse(responseXml);
      const cxmlStatus = parsed.data?.statusCode ?? 0;
      if (!response.ok || cxmlStatus < 200 || cxmlStatus >= 300) {
        return fail(
          `McMaster-Carr rejected the order (HTTP ${response.status}, cXML ${cxmlStatus || "?"})`
        );
      }

      await serviceRole
        .from("cxmlDocument")
        .update({ status: "Sent", updatedAt: datetime.timestamp() })
        .eq("id", documentId)
        .eq("companyId", companyId);
      return { documentId, status: "Sent" as const };
    });
  }
);
