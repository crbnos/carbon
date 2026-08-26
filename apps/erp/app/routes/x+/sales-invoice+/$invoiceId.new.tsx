import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import {
  dedupeViolations,
  evaluateSalesRuleLines,
  isBlocked
} from "@carbon/ee/rules.server";
import { validationError, validator } from "@carbon/form";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import { NotificationEvent } from "@carbon/notifications";
import { useRouteData } from "@carbon/react";
import type { ActionFunctionArgs } from "react-router";
import { redirect, useParams } from "react-router";
import { useUser } from "~/hooks";
import type { SalesInvoice } from "~/modules/invoicing";
import {
  getSalesInvoice,
  isSalesInvoiceLocked,
  salesInvoiceLineValidator,
  upsertSalesInvoiceLine
} from "~/modules/invoicing";
import SalesInvoiceLineForm from "~/modules/invoicing/ui/SalesInvoice/SalesInvoiceLineForm";
import { getCompanySettings } from "~/modules/settings";
import type { MethodItemType } from "~/modules/shared";
import { setCustomFields } from "~/utils/form";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path } from "~/utils/path";

const logger = getLogger("erp", "invoiceid-new");

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);

  const { invoiceId } = params;
  if (!invoiceId) throw new Error("Could not find invoiceId");

  // Check if SI is locked
  const { client: viewClient } = await requirePermissions(request, {
    view: "invoicing"
  });

  const invoice = await getSalesInvoice(viewClient, invoiceId);
  if (invoice.error) {
    throw redirect(
      path.to.salesInvoiceDetails(invoiceId),
      await flash(request, error(invoice.error, "Failed to load sales invoice"))
    );
  }

  await requireUnlocked({
    request,
    isLocked: isSalesInvoiceLocked(invoice.data?.status),
    redirectTo: path.to.salesInvoiceDetails(invoiceId),
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

  // Sales-rule enforcement — only for lines that reference an item (Comment
  // and Fixed Asset lines carry no itemId). A manually created invoice line
  // is standalone: it has no source sales order, so there is no ship-to and
  // none may be invented — the bill-to is a different address. A null
  // location flows into the engine's required-field semantics, so a
  // destination rule blocks rather than passes.
  const serviceRole = getCarbonServiceRole();
  let acknowledgedViolations: ReturnType<typeof dedupeViolations> = [];
  let acknowledgedRuleNames: Record<string, string> = {};
  if (d.itemId) {
    const acknowledged = formData.get("acknowledged") === "true";
    const { violations, ruleNames } = await evaluateSalesRuleLines({
      client: serviceRole,
      companyId,
      userId,
      surface: "salesInvoiceLine",
      lines: [{ lineId: "new", itemId: d.itemId, quantity: d.quantity ?? 1 }],
      customerId: invoice.data?.customerId ?? null,
      customerLocationId: null
    });
    const deduped = dedupeViolations(violations);
    if (deduped.length > 0) {
      const blocked = isBlocked(deduped, acknowledged);
      const outcome = blocked
        ? ("blocked" as const)
        : ("acknowledged" as const);

      if (blocked) {
        // Persist blocked evidence — one row per deduped violation. No line
        // exists on a blocked create, so documentLineId stays null. Failures
        // must never break the submission.
        const acknowledgmentInsert = await serviceRole
          .from("enforcementRuleAcknowledgment")
          .insert(
            deduped.map((v) => ({
              companyId,
              ruleId: v.ruleId,
              ruleName: ruleNames[v.ruleId] ?? null,
              documentType: "salesInvoice" as const,
              documentId: invoiceId,
              documentLineId: null,
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
      acknowledgedViolations = deduped;
      acknowledgedRuleNames = ruleNames;
    }
  }

  const createSalesInvoiceLine = await upsertSalesInvoiceLine(client, {
    ...d,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });

  if (createSalesInvoiceLine.error) {
    throw redirect(
      path.to.salesInvoiceDetails(invoiceId),
      await flash(
        request,
        error(
          createSalesInvoiceLine.error,
          "Failed to create sales invoice line."
        )
      )
    );
  }

  // Acknowledged proceed: persist override evidence now that the line exists
  // so documentLineId captures the created line. Failures must never break
  // the submission.
  if (acknowledgedViolations.length > 0) {
    const acknowledgmentInsert = await serviceRole
      .from("enforcementRuleAcknowledgment")
      .insert(
        acknowledgedViolations.map((v) => ({
          companyId,
          ruleId: v.ruleId,
          ruleName: acknowledgedRuleNames[v.ruleId] ?? null,
          documentType: "salesInvoice" as const,
          documentId: invoiceId,
          documentLineId: createSalesInvoiceLine.data.id,
          itemId: d.itemId ?? null,
          severity: v.severity,
          outcome: "acknowledged" as const,
          message: v.message,
          createdBy: userId
        }))
      );
    if (acknowledgmentInsert.error) {
      logger.error("Failed to record sales rule acknowledgments", {
        error: acknowledgmentInsert.error
      });
    }
  }

  throw redirect(path.to.salesInvoiceDetails(invoiceId));
}

export default function NewSalesInvoiceLineRoute() {
  const { defaults } = useUser();
  const { invoiceId } = useParams();
  if (!invoiceId) throw new Error("Could not find sales invoice id");
  const salesInvoiceData = useRouteData<{
    salesInvoice: SalesInvoice;
  }>(path.to.salesInvoice(invoiceId));

  if (!invoiceId) throw new Error("Could not find sales invoice id");

  const initialValues = {
    invoiceId: invoiceId,
    invoiceLineType: "Item" as MethodItemType,
    quantity: 1,
    unitOfMeasureCode: "EA",
    locationId:
      salesInvoiceData?.salesInvoice?.locationId ?? defaults.locationId ?? "",
    unitPrice: 0,
    shippingCost: 0,
    addOnCost: 0,
    nonTaxableAddOnCost: 0,
    taxPercent: 0,
    exchangeRate: salesInvoiceData?.salesInvoice?.exchangeRate ?? 1
  };

  return <SalesInvoiceLineForm initialValues={initialValues} />;
}
