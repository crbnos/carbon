import { assertIsPost, error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import {
  dedupeViolations,
  evaluateSalesRuleLines,
  isBlocked,
  resolveSalesOrderShipTo
} from "@carbon/ee/rules.server";
import { validationError, validator } from "@carbon/form";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import { NotificationEvent } from "@carbon/notifications";
import type { JSONContent } from "@carbon/react";
import { getItemReadableId } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import { Fragment } from "react/jsx-runtime";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData, useParams } from "react-router";
import { DeferredFiles } from "~/components";
import {
  getSalesInvoice,
  getSalesInvoiceLine,
  isSalesInvoiceLocked,
  salesInvoiceLineValidator,
  upsertSalesInvoiceLine
} from "~/modules/invoicing";
import SalesInvoiceLineForm from "~/modules/invoicing/ui/SalesInvoice/SalesInvoiceLineForm";
import { getOpportunityLineDocuments } from "~/modules/sales";
import {
  OpportunityLineDocuments,
  OpportunityLineNotes
} from "~/modules/sales/ui/Opportunity";
import { getCompanySettings } from "~/modules/settings";
import { useItems } from "~/stores";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path } from "~/utils/path";

const logger = getLogger("erp", "invoiceid-lineid-details");

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "invoicing",
    role: "employee"
  });

  const { lineId } = params;
  if (!lineId) throw notFound("lineId not found");

  const salesInvoiceLine = await getSalesInvoiceLine(client, lineId);

  const itemId = salesInvoiceLine?.data?.itemId;

  return {
    salesInvoiceLine: salesInvoiceLine?.data ?? null,
    files: await getOpportunityLineDocuments(client, companyId, lineId, itemId)
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);

  const { invoiceId, lineId } = params;
  if (!invoiceId) throw new Error("Could not find invoiceId");
  if (!lineId) throw new Error("Could not find lineId");

  // Check if SI is locked
  const { client: viewClient } = await requirePermissions(request, {
    view: "invoicing"
  });

  const invoice = await getSalesInvoice(viewClient, invoiceId);
  if (invoice.error) {
    throw redirect(
      path.to.salesInvoiceLine(invoiceId, lineId),
      await flash(request, error(invoice.error, "Failed to load sales invoice"))
    );
  }

  await requireUnlocked({
    request,
    isLocked: isSalesInvoiceLocked(invoice.data?.status),
    redirectTo: path.to.salesInvoiceLine(invoiceId, lineId),
    message: "Cannot modify a locked sales invoice. Reopen it first."
  });

  const { client, companyId, userId } = await requirePermissions(request, {
    create: "invoicing"
  });

  const formData = await request.formData();
  const validation = await validator(salesInvoiceLineValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, ...d } = validation.data;

  if (d.invoiceLineType === "Fixed Asset") {
    d.accountId = undefined;
    d.itemId = undefined;
  } else {
    d.accountId = undefined;
    d.assetId = undefined;
  }

  // Sales-rule enforcement — only for lines that reference an item. A line
  // converted from a sales order resolves its ship-to through that order
  // (drop-ship included); a standalone line has no ship-to and none may be
  // invented — the bill-to is a different address, so a null location flows
  // into the engine's required-field semantics and a destination rule blocks
  // rather than passes.
  if (d.itemId) {
    const serviceRole = getCarbonServiceRole();
    const acknowledged = formData.get("acknowledged") === "true";

    const existingLine = await serviceRole
      .from("salesInvoiceLine")
      .select("salesOrderId")
      .eq("id", lineId)
      .eq("companyId", companyId)
      .maybeSingle();
    if (existingLine.error) {
      // A failed read must not evaluate the wrong destination.
      throw new Error(
        `Sales rule evaluation could not load sales invoice line ${lineId}: ${existingLine.error.message}`
      );
    }

    const shipTo = existingLine.data?.salesOrderId
      ? await resolveSalesOrderShipTo(
          serviceRole,
          existingLine.data.salesOrderId,
          companyId
        )
      : {
          customerId: invoice.data?.customerId ?? null,
          customerLocationId: null
        };

    const { violations, ruleNames } = await evaluateSalesRuleLines({
      client: serviceRole,
      companyId,
      userId,
      surface: "salesInvoiceLine",
      lines: [{ lineId, itemId: d.itemId, quantity: d.quantity ?? 1 }],
      customerId: shipTo.customerId,
      customerLocationId: shipTo.customerLocationId
    });
    const deduped = dedupeViolations(violations);
    if (deduped.length > 0) {
      const blocked = isBlocked(deduped, acknowledged);
      const outcome = blocked
        ? ("blocked" as const)
        : ("acknowledged" as const);

      // Persist evidence — one row per deduped violation; the line already
      // exists, so both outcomes carry its id. Failures must never break the
      // submission.
      const acknowledgmentInsert = await serviceRole
        .from("enforcementRuleAcknowledgment")
        .insert(
          deduped.map((v) => ({
            companyId,
            ruleId: v.ruleId,
            ruleName: ruleNames[v.ruleId] ?? null,
            documentType: "salesInvoice" as const,
            documentId: invoiceId,
            documentLineId: lineId,
            itemId: d.itemId ?? null,
            severity: v.severity,
            outcome,
            message: v.message,
            createdBy: userId
          }))
        );
      if (acknowledgmentInsert.error) {
        logger.error("Failed to record sales rule acknowledgments", {
          error: acknowledgmentInsert.error
        });
      }

      // Notify the configured group — fire-and-forget; a notification failure
      // must never break the submission.
      try {
        const companySettings = await getCompanySettings(
          serviceRole,
          companyId
        );
        if (companySettings.data?.salesRuleNotificationGroup?.length) {
          await trigger("notify", {
            companyId,
            documentId: `salesInvoice:${invoiceId}:${outcome}`,
            event: NotificationEvent.SalesRuleViolation,
            recipient: {
              type: "group",
              groupIds: companySettings.data.salesRuleNotificationGroup
            },
            from: userId
          });
        }
      } catch (err) {
        logger.error("Failed to trigger sales rule violation notification", {
          error: err
        });
      }

      if (blocked) {
        return { error: null, data: null, violations: deduped, ruleNames };
      }
    }
  }

  const updateSalesInvoiceLine = await upsertSalesInvoiceLine(client, {
    id: lineId,
    ...d,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });

  if (updateSalesInvoiceLine.error) {
    throw redirect(
      path.to.salesInvoiceLine(invoiceId, lineId),
      await flash(
        request,
        error(
          updateSalesInvoiceLine.error,
          "Failed to update sales invoice line"
        )
      )
    );
  }

  throw redirect(path.to.salesInvoiceLine(invoiceId, lineId));
}

export default function EditSalesInvoiceLineRoute() {
  const { t } = useLingui();
  const { invoiceId, lineId } = useParams();
  if (!invoiceId) throw notFound("invoiceId not found");
  if (!lineId) throw notFound("lineId not found");

  const { salesInvoiceLine, files } = useLoaderData<typeof loader>();

  const initialValues = {
    id: salesInvoiceLine?.id ?? undefined,
    invoiceId: salesInvoiceLine?.invoiceId ?? "",
    invoiceLineType: (salesInvoiceLine?.invoiceLineType ?? "Part") as "Part",
    methodType: (salesInvoiceLine?.methodType ??
      "Pull from Inventory") as "Pull from Inventory",
    itemId: salesInvoiceLine?.itemId ?? "",
    accountId: salesInvoiceLine?.accountId ?? "",
    addOnCost: salesInvoiceLine?.addOnCost ?? 0,
    nonTaxableAddOnCost: salesInvoiceLine?.nonTaxableAddOnCost ?? 0,
    assetId: salesInvoiceLine?.assetId ?? "",
    description: salesInvoiceLine?.description ?? "",
    quantity: salesInvoiceLine?.quantity ?? 1,
    unitPrice: salesInvoiceLine?.unitPrice ?? 0,
    shippingCost: salesInvoiceLine?.shippingCost ?? 0,
    taxPercent: salesInvoiceLine?.taxPercent ?? 0,
    exchangeRate: salesInvoiceLine?.exchangeRate ?? 1,
    unitOfMeasureCode: salesInvoiceLine?.unitOfMeasureCode ?? "",
    storageUnitId: salesInvoiceLine?.storageUnitId ?? "",
    assetReadableId: (salesInvoiceLine as any)?.assetReadableId ?? undefined,
    assetName: (salesInvoiceLine as any)?.assetName ?? undefined,
    ...getCustomFields(salesInvoiceLine?.customFields)
  };

  const [items] = useItems();

  return (
    <Fragment key={salesInvoiceLine?.id}>
      <SalesInvoiceLineForm
        key={initialValues.id}
        initialValues={initialValues}
        isSalesOrderLine={salesInvoiceLine?.salesOrderLineId !== undefined}
      />
      <OpportunityLineNotes
        id={salesInvoiceLine?.id ?? ""}
        table="salesInvoiceLine"
        title={t`Notes`}
        subTitle={getItemReadableId(items, salesInvoiceLine?.itemId) ?? ""}
        internalNotes={salesInvoiceLine?.internalNotes as JSONContent}
      />

      <DeferredFiles resolve={files}>
        {(resolvedFiles) => (
          <OpportunityLineDocuments
            files={resolvedFiles ?? []}
            id={invoiceId}
            lineId={lineId}
            itemId={salesInvoiceLine?.itemId}
            type="Sales Invoice"
          />
        )}
      </DeferredFiles>

      <Outlet />
    </Fragment>
  );
}
