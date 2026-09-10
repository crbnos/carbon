// Sales-rule gate for the operation dispatch path.
//
// The route actions that write sales-document lines (and the terminal
// finalize/convert transitions) evaluate sales rules before acting. The
// dispatch path calls the same service functions by name — HTTP v1, MCP
// call_tool, the in-app agent, and the workflow dispatcher all pass through
// `dispatchOperation` — so without this gate any of those callers could put a
// restricted item on a sales document, or finalize/convert one carrying
// error-severity violations, with no evaluation at all.
//
// The check lives HERE rather than inside the service functions deliberately:
// service files are re-exported from module barrels that client components
// import, so they must stay free of server-only imports. This module is
// server-only by construction.
//
// Only `error`-severity violations block. A `warn` needs a human to
// acknowledge it, and there is no human on this path — warns pass so an agent
// isn't wedged on a rule a person could have waved past. Blocks record the
// same acknowledgment evidence the human routes write; passed warns leave no
// row on purpose ("acknowledged" means a person waved them past, and none
// did).
//
// The gate reads the RESOLVED positional payload out of `functionArgs` — the
// exact object the service will receive, after `dispatchOperation`'s named /
// wrapped / flat shape resolution — so a nested request cannot skip
// evaluation and still reach the service.

import type { ManifestEntry } from "@carbon/api";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  dedupeViolations,
  evaluateSalesRuleLines,
  evaluateSalesRulesForSalesDocument,
  resolveSalesOrderShipTo,
  type SalesDocumentType
} from "@carbon/ee/rules.server";
import { recordSalesRuleOutcome } from "~/modules/sales/sales.server";

type GateContext = { companyId: string; userId: string };

const LINE_WRITE_OPERATIONS: Record<
  string,
  {
    surface: "quoteLine" | "salesOrderLine" | "salesInvoiceLine";
    param: string;
    documentKey: string;
    documentType: "quote" | "salesOrder" | "salesInvoice";
  }
> = {
  sales_upsertQuoteLine: {
    surface: "quoteLine",
    param: "quotationLine",
    documentKey: "quoteId",
    documentType: "quote"
  },
  sales_upsertSalesOrderLine: {
    surface: "salesOrderLine",
    param: "salesOrderLine",
    documentKey: "salesOrderId",
    documentType: "salesOrder"
  },
  invoicing_upsertSalesInvoiceLine: {
    surface: "salesInvoiceLine",
    param: "salesInvoiceLine",
    documentKey: "invoiceId",
    documentType: "salesInvoice"
  }
};

/** The resolved positional value for `paramName`, as the service will receive it. */
function resolvedParam(
  meta: ManifestEntry,
  functionArgs: unknown[],
  paramName: string
): unknown {
  const index = meta.serviceParams.indexOf(paramName);
  return index >= 0 ? functionArgs[index] : undefined;
}

/**
 * Evaluate sales rules for a gated operation. Returns the block message when
 * error-severity violations fire, null when the operation may proceed.
 * Non-gated operations return null without touching the database.
 */
export async function checkSalesRulesForOperation(
  meta: ManifestEntry,
  context: GateContext,
  functionArgs: unknown[]
): Promise<string | null> {
  return (
    (await checkLineWrite(meta, context, functionArgs)) ??
    (await checkDocumentTransition(meta, context, functionArgs))
  );
}

async function checkLineWrite(
  meta: ManifestEntry,
  context: GateContext,
  functionArgs: unknown[]
): Promise<string | null> {
  const op = LINE_WRITE_OPERATIONS[meta.name];
  if (!op) return null;

  const resolved = resolvedParam(meta, functionArgs, op.param);
  if (!resolved || typeof resolved !== "object" || Array.isArray(resolved)) {
    return null;
  }
  const payload = resolved as Record<string, unknown>;

  const itemId = typeof payload.itemId === "string" ? payload.itemId : null;
  if (!itemId) return null;

  const documentId =
    typeof payload[op.documentKey] === "string"
      ? (payload[op.documentKey] as string)
      : null;
  if (!documentId) return null;

  const serviceRole = getCarbonServiceRole();
  const lineId = typeof payload.id === "string" ? payload.id : "new";

  const shipTo =
    op.surface === "salesOrderLine"
      ? await resolveSalesOrderShipTo(
          serviceRole,
          documentId,
          context.companyId
        )
      : op.surface === "salesInvoiceLine"
        ? await (async () => {
            // An invoice line converted from a sales order resolves its
            // ship-to through that order; a standalone line has none and
            // none may be invented (the bill-to is a different address), so
            // a null location lets a destination rule fail closed via the
            // engine's required-field semantics.
            if (lineId !== "new") {
              const existing = await serviceRole
                .from("salesInvoiceLine")
                .select("salesOrderId")
                .eq("id", lineId)
                .eq("companyId", context.companyId)
                .maybeSingle();
              if (existing.data?.salesOrderId) {
                return resolveSalesOrderShipTo(
                  serviceRole,
                  existing.data.salesOrderId,
                  context.companyId
                );
              }
            }
            const { data } = await serviceRole
              .from("salesInvoice")
              .select("customerId")
              .eq("id", documentId)
              .eq("companyId", context.companyId)
              .maybeSingle();
            return {
              customerId: data?.customerId ?? null,
              customerLocationId: null
            };
          })()
        : await (async () => {
            const { data } = await serviceRole
              .from("quote")
              .select("customerId, customerLocationId")
              .eq("id", documentId)
              .eq("companyId", context.companyId)
              .maybeSingle();
            return {
              customerId: data?.customerId ?? null,
              customerLocationId: data?.customerLocationId ?? null
            };
          })();

  const quantity =
    typeof payload.saleQuantity === "number"
      ? payload.saleQuantity
      : Array.isArray(payload.quantity)
        ? Math.max(1, ...(payload.quantity as number[]))
        : typeof payload.quantity === "number"
          ? payload.quantity
          : 1;

  const { violations, ruleNames } = await evaluateSalesRuleLines({
    client: serviceRole,
    companyId: context.companyId,
    userId: context.userId,
    surface: op.surface,
    lines: [{ lineId, itemId, quantity }],
    customerId: shipTo.customerId,
    customerLocationId: shipTo.customerLocationId
  });

  const errors = dedupeViolations(violations).filter(
    (v) => v.severity === "error"
  );
  if (errors.length === 0) return null;

  await recordSalesRuleOutcome(serviceRole, {
    companyId: context.companyId,
    userId: context.userId,
    documentType: op.documentType,
    documentId,
    documentLineId: lineId === "new" ? null : lineId,
    itemId,
    outcome: "blocked",
    violations: errors,
    ruleNames
  });

  return `Blocked by sales rules: ${errors.map((v) => v.message).join("; ")}`;
}

async function checkDocumentTransition(
  meta: ManifestEntry,
  context: GateContext,
  functionArgs: unknown[]
): Promise<string | null> {
  const documentType: SalesDocumentType | null =
    meta.name === "sales_finalizeQuote" ||
    meta.name === "sales_convertQuoteToOrder"
      ? "quote"
      : meta.name === "sales_convertSalesRfqToQuote"
        ? "salesRfq"
        : null;
  if (!documentType) return null;

  // `finalizeQuote` addresses the quote by a scalar `quoteId` param; the two
  // convert functions take a `payload` object whose document id is `id`.
  const scalarId = resolvedParam(meta, functionArgs, "quoteId");
  const payload = resolvedParam(meta, functionArgs, "payload");
  const documentId =
    typeof scalarId === "string"
      ? scalarId
      : payload && typeof payload === "object" && !Array.isArray(payload)
        ? typeof (payload as Record<string, unknown>).id === "string"
          ? ((payload as Record<string, unknown>).id as string)
          : null
        : null;
  if (!documentId) return null;

  const serviceRole = getCarbonServiceRole();
  const { violations, ruleNames } = await evaluateSalesRulesForSalesDocument({
    client: serviceRole,
    companyId: context.companyId,
    userId: context.userId,
    documentType,
    documentId
  });

  const errors = dedupeViolations(violations).filter(
    (v) => v.severity === "error"
  );
  if (errors.length === 0) return null;

  // Blocked evidence, same as the route gates. An RFQ has no evidence row
  // (the acknowledgment table's documentType CHECK covers quote / salesOrder /
  // salesInvoice only); its lines are re-gated at the quote stage.
  if (documentType === "quote") {
    await recordSalesRuleOutcome(serviceRole, {
      companyId: context.companyId,
      userId: context.userId,
      documentType: "quote",
      documentId,
      outcome: "blocked",
      violations: errors,
      ruleNames
    });
  }

  return `Blocked by sales rules: ${errors.map((v) => v.message).join("; ")}`;
}
