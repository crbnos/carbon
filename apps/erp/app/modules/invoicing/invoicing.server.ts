// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { defineServiceFn } from "@carbon/api/service-fn.server";
import { paged, payload, unwrap } from "@carbon/api/service-tools.server";
import {
  dedupeViolations,
  evaluateSalesRulesForSalesDocument,
  isBlocked,
  resolveSalesInvoiceShipTo,
  resolveSalesOrderShipTo
} from "@carbon/ee/rules.server";
import { storage } from "@carbon/files";
import { trigger } from "@carbon/jobs";
import { checkPartyContactRequirement } from "@carbon/lib/party-contact.server";
import { trackWorkEvent } from "@carbon/lib/telemetry";
import { raiseMoment } from "@carbon/lib/workflows";
import { getLogger } from "@carbon/logger";
import { datetime, deriveRate, taxableBase, toBaseAmount } from "@carbon/utils";
import { z } from "zod";
import { upsertDocument } from "~/modules/documents/documents.service";
import {
  resolveItemIdFromExtractedText,
  upsertPart
} from "~/modules/items/items.service";
import {
  deletePurchaseInvoiceLineReleasingLeases,
  deletePurchaseInvoiceReleasingLeases
} from "~/modules/purchasing/purchasing.service";
import {
  deleteRentalCreditMemoReleasingPeriods,
  deleteSalesInvoiceLineReleasingRentals,
  deleteSalesInvoiceReleasingRentals,
  recordSalesRuleOutcome
} from "~/modules/sales/sales.service";
import {
  getCompanySettings,
  getNextSequence
} from "~/modules/settings/settings.service";
import { refuseUnlessOwned } from "~/modules/shared/shared.service";
import { stripSpecialCharacters } from "~/utils/string";
import * as accountingPostings from "../accounting/accounting.service";
import * as purchasingPostings from "../purchasing/purchasing.service";
import { fromServerFn, invokePosting } from "../shared/shared.service";
import {
  isMemoLocked,
  paymentValidator,
  purchaseInvoiceSupplierChange,
  purchaseInvoiceValidator,
  reimbursementLinesValidator,
  reimbursementPaymentValidator,
  reimbursementUpdateValidator,
  salesInvoiceCustomerChange,
  salesInvoiceLineValidator,
  salesInvoicePostValidator
} from "./invoicing.models";
import type { SalesRuleCheck, StripeSendContext } from "./invoicing.service";
import * as service from "./invoicing.service";

const logger = getLogger("erp", "invoicing");

// --- Shared -------------------------------------------------------------------

const customFieldValues = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean()])
);
// --- Sales invoices -----------------------------------------------------------
const salesInvoiceFields = [
  "invoiceCustomerId",
  "customerId",
  "dateIssued",
  "paymentTermId",
  "currencyCode",
  "invoiceCustomerContactId",
  "invoiceCustomerLocationId",
  "locationId",
  "customerReference",
  "exchangeRate",
  "dateDue",
  "datePaid"
] as const;

/**
 * Set one field on one or more sales invoices.
 *
 * @remarks
 * Refused when any of the invoices is posted, except for the issue, due and
 * paid dates. A new invoice customer brings its currency at today's rate
 * (a customer with none keeps the invoice's) and clears the invoice contact
 * and address. A new customer clears the ship-to of each invoice whose
 * customer changes. A new issue date or payment term on a single invoice
 * recomputes its due date; with several invoices nothing is written. A new
 * currency brings today's exchange rate. An empty value clears the field.
 */
export const updateSalesInvoiceField = defineServiceFn({
  input: service.fieldUpdate(salesInvoiceFields),
  permission: { update: "sales" },

  async run(ctx, { ids, field, value }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const locked = await service.refuseLockedInvoices(
      ctx,
      "salesInvoice",
      ids,
      field,
      "Cannot modify a locked sales invoice."
    );
    if (locked) return locked;
    const audit = {
      updatedBy: ctx.auditUserId,
      updatedAt: datetime.timestamp()
    };

    if (field === "invoiceCustomerId") {
      if (!value)
        return ctx.error("validation", "Invoice customer is required");
      const currency = await service.partyCurrency(ctx, "customer", value);
      if (currency instanceof Error) return currency;
      const update = await client
        .from("salesInvoice")
        .update({ ...salesInvoiceCustomerChange(value, currency), ...audit })
        .in("id", ids)
        .eq("companyId", companyId);
      if (update.error) {
        return ctx.error(
          "internal",
          "Failed to update the invoices",
          update.error
        );
      }
      return { ids };
    }

    if (field === "customerId") {
      // A ship-to is one of the old customer's locations, so a customer
      // change clears it (sales rules would otherwise evaluate an address
      // that is not the new customer's).
      if (value) {
        const changed = await client
          .from("salesInvoice")
          .select("id")
          .in("id", ids)
          .eq("companyId", companyId)
          .neq("customerId", value);
        if (changed.error) {
          return ctx.error(
            "internal",
            "Failed to load the invoices",
            changed.error
          );
        }
        const changedIds = changed.data.map((row) => row.id);
        if (changedIds.length > 0) {
          const cleared = await client
            .from("salesInvoiceShipment")
            .update({ customerLocationId: null, ...audit })
            .in("id", changedIds)
            .eq("companyId", companyId);
          if (cleared.error) {
            return ctx.error(
              "internal",
              "Failed to clear the ship-to",
              cleared.error
            );
          }
        }
      }
      const update = await client
        .from("salesInvoice")
        .update({ customerId: value || undefined, ...audit })
        .in("id", ids)
        .eq("companyId", companyId);
      if (update.error) {
        return ctx.error(
          "internal",
          "Failed to update the invoices",
          update.error
        );
      }
      return { ids };
    }

    return service.writeInvoiceField(ctx, "salesInvoice", {
      ids,
      field,
      value
    });
  }
});
const salesInvoiceLineInput = salesInvoiceLineValidator.safeExtend({
  customFields: customFieldValues.optional(),
  acknowledged: z.boolean().default(false)
});

/**
 * Add a line to a sales invoice.
 *
 * @remarks
 * Refused while the invoice is posted. `discountPercent` is in percent points
 * (0–100). A line with an item is first checked against the sales rules at
 * the invoice's ship-to (none is assumed when the invoice has none): an
 * error, or a warning not `acknowledged`, returns `violations` and adds
 * nothing.
 *
 * @mcp
 */
export const createSalesInvoiceLine = defineServiceFn({
  input: salesInvoiceLineInput,
  permission: { create: "invoicing" },

  async run(ctx, { id: _id, acknowledged, customFields, ...input }) {
    const line = service.salesInvoiceLineRow(input);
    const locked = await service.unlockedSalesInvoice(
      ctx,
      line.invoiceId,
      "Cannot modify a locked sales invoice. Reopen it first."
    );
    if (locked) return locked;

    let check: SalesRuleCheck = { violations: [], ruleNames: {} };
    if (line.itemId) {
      // A standalone line has no order, so the invoice's own ship-to.
      const shipTo = await resolveSalesInvoiceShipTo(
        ctx.asSystem.supabase,
        line.invoiceId,
        ctx.company.id
      );
      const gate = await service.salesInvoiceLineGate(ctx, {
        invoiceId: line.invoiceId,
        lineId: null,
        itemId: line.itemId,
        quantity: line.quantity ?? 1,
        shipTo,
        acknowledged
      });
      if (gate.blocked) return gate.blocked;
      check = gate.check;
    }

    const created = await service.upsertSalesInvoiceLine(
      ctx.asCaller.supabase,
      {
        ...line,
        companyId: ctx.company.id,
        createdBy: ctx.auditUserId,
        customFields
      }
    );
    if (created.error) {
      return ctx.error(
        "internal",
        "Failed to create sales invoice line.",
        created.error
      );
    }

    if (line.itemId && check.violations.length > 0) {
      await service.recordSalesInvoiceLineOutcome(
        ctx,
        {
          invoiceId: line.invoiceId,
          lineId: created.data.id,
          itemId: line.itemId
        },
        "acknowledged",
        check
      );
    }
    return { salesInvoiceLineId: created.data.id };
  }
});

/**
 * Change a sales invoice line.
 *
 * @remarks
 * Refused while the invoice is posted, and for a line that is not on
 * `invoiceId`. A line with an item is first checked against the sales rules
 * (see `createSalesInvoiceLine`); a line converted from a sales order is
 * checked at that order's ship-to.
 *
 * @mcp
 */
export const updateSalesInvoiceLine = defineServiceFn({
  input: salesInvoiceLineInput.safeExtend({ id: z.string() }),
  permission: { create: "invoicing" },

  async run(ctx, { id, acknowledged, customFields, ...input }) {
    const line = service.salesInvoiceLineRow(input);
    const refused = await refuseUnlessOwned(ctx, "salesInvoiceLine", {
      id,
      invoiceId: line.invoiceId
    });
    if (refused) return refused;
    const locked = await service.unlockedSalesInvoice(
      ctx,
      line.invoiceId,
      "Cannot modify a locked sales invoice. Reopen it first."
    );
    if (locked) return locked;

    let check: SalesRuleCheck = { violations: [], ruleNames: {} };
    if (line.itemId) {
      const serviceRole = ctx.asSystem.supabase;
      const existing = await serviceRole
        .from("salesInvoiceLine")
        .select("salesOrderId")
        .eq("id", id)
        .eq("companyId", ctx.company.id)
        .maybeSingle();
      if (existing.error) {
        // A failed read must not evaluate the wrong destination.
        return ctx.error(
          "internal",
          "Failed to load the sales invoice line",
          existing.error
        );
      }
      // An order's line ships where the order does (drop-ship included).
      const shipTo = existing.data?.salesOrderId
        ? await resolveSalesOrderShipTo(
            serviceRole,
            existing.data.salesOrderId,
            ctx.company.id
          )
        : await resolveSalesInvoiceShipTo(
            serviceRole,
            line.invoiceId,
            ctx.company.id
          );
      const gate = await service.salesInvoiceLineGate(ctx, {
        invoiceId: line.invoiceId,
        lineId: id,
        itemId: line.itemId,
        quantity: line.quantity ?? 1,
        shipTo,
        acknowledged
      });
      if (gate.blocked) return gate.blocked;
      check = gate.check;
    }

    const updated = await service.upsertSalesInvoiceLine(
      ctx.asCaller.supabase,
      {
        id,
        ...line,
        updatedBy: ctx.auditUserId,
        customFields
      }
    );
    if (updated.error) {
      return ctx.error(
        "internal",
        "Failed to update sales invoice line",
        updated.error
      );
    }

    if (line.itemId && check.violations.length > 0) {
      await service.recordSalesInvoiceLineOutcome(
        ctx,
        { invoiceId: line.invoiceId, lineId: id, itemId: line.itemId },
        "acknowledged",
        check
      );
    }
    return { salesInvoiceLineId: id };
  }
});

/**
 * Delete a line of a Draft sales invoice.
 *
 * @remarks
 * Refused while the invoice is posted. A line that billed a rental period, a
 * rental charge or a contract schedule line releases it in the same
 * transaction, so the next invoice run bills it again.
 *
 * @mcp destructive
 */
export const deleteDraftSalesInvoiceLine = defineServiceFn({
  input: z.object({ invoiceId: z.string(), lineId: z.string() }),
  permission: { delete: "invoicing" },

  async run(ctx, { invoiceId, lineId }) {
    const locked = await service.unlockedSalesInvoice(
      ctx,
      invoiceId,
      "Cannot delete lines on a locked sales invoice."
    );
    if (locked) return locked;
    try {
      await deleteSalesInvoiceLineReleasingRentals(ctx.asSystem.pg, {
        companyId: ctx.company.id,
        invoiceId,
        salesInvoiceLineId: lineId,
        userId: ctx.auditUserId
      });
    } catch (err) {
      return ctx.error("internal", "Failed to delete sales invoice line", err);
    }
    return { invoiceId, lineId };
  }
});

/**
 * Delete a Draft sales invoice.
 *
 * @remarks
 * Refused once the invoice is posted. An invoice that billed rental periods,
 * rental charges or contract schedule lines releases them in the same
 * transaction, so the next invoice run bills them again.
 *
 * @mcp destructive
 */
export const deleteDraftSalesInvoice = defineServiceFn({
  input: z.object({ invoiceId: z.string() }),
  permission: { delete: "invoicing" },

  async run(ctx, { invoiceId }) {
    const locked = await service.unlockedSalesInvoice(
      ctx,
      invoiceId,
      "Only a Draft sales invoice can be deleted."
    );
    if (locked) return locked;
    try {
      await deleteSalesInvoiceReleasingRentals(ctx.asSystem.pg, {
        companyId: ctx.company.id,
        invoiceId,
        userId: ctx.auditUserId
      });
    } catch (err) {
      return ctx.error("internal", "Failed to delete sales invoice", err);
    }
    return { invoiceId };
  }
});

/**
 * Void a posted sales invoice.
 *
 * @remarks
 * Refused for an invoice that was never posted. The `post-sales-invoice`
 * server function reverses its journal, its stock and its order and shipment
 * updates; its refusal is returned as it is.
 *
 * @mcp destructive
 */
export const voidSalesInvoice = defineServiceFn({
  input: z.object({ invoiceId: z.string() }),
  permission: { update: "invoicing" },

  async run(ctx, { invoiceId }) {
    const invoice = await ctx.asCaller.supabase
      .from("salesInvoice")
      .select("status, postingDate")
      .eq("id", invoiceId)
      .eq("companyId", ctx.company.id)
      .maybeSingle();
    if (invoice.error) {
      return ctx.error(
        "internal",
        "Failed to void sales invoice",
        invoice.error
      );
    }
    if (!invoice.data) return ctx.error("notFound", "Sales invoice not found");
    if (!invoice.data.postingDate) {
      return ctx.error("rule", "Can only void posted invoices");
    }

    const voided = await invokePosting(
      ctx,
      "post-sales-invoice",
      {
        type: "void",
        invoiceId
      },
      service.postSalesInvoice
    );
    if (voided.error) {
      return fromServerFn(ctx, voided.error, "Failed to void sales invoice");
    }
    return { invoiceId };
  }
});

/**
 * Send a posted sales invoice again, after its send failed.
 *
 * @remarks
 * Refused for an invoice that is not posted, is voided, or was already sent.
 * Queues invoice automation with `resend`: it sends through Stripe when the
 * invoice's recurring source sends via Stripe, otherwise by email.
 *
 * @mcp
 */
export const sendSalesInvoice = defineServiceFn({
  input: z.object({ invoiceId: z.string() }),
  permission: { update: "invoicing" },

  async run(ctx, { invoiceId }) {
    const companyId = ctx.company.id;
    const invoice = await ctx.asCaller.supabase
      .from("salesInvoice")
      .select("id, status, postingDate, sentAt")
      .eq("id", invoiceId)
      .eq("companyId", companyId)
      .maybeSingle();
    if (invoice.error) {
      return ctx.error(
        "internal",
        "Failed to load sales invoice",
        invoice.error
      );
    }
    if (!invoice.data) return ctx.error("notFound", "Sales invoice not found");

    // Posted, as the header reads it: has a posting date and is not voided.
    if (!invoice.data.postingDate || invoice.data.status === "Voided") {
      return ctx.error("rule", "Only a posted invoice can be sent");
    }
    if (invoice.data.sentAt) {
      return ctx.error("rule", "This invoice has already been sent");
    }

    try {
      await trigger("invoice-automate", { companyId, invoiceId, resend: true });
    } catch (err) {
      return ctx.error("internal", "Failed to send invoice", err);
    }
    return { invoiceId };
  }
});
/**
 * Post a Draft sales invoice, then send it.
 *
 * @remarks
 * In order, before anything is written: the customer must have a reachable
 * contact when the company requires one; the sales-rule gate re-checks every
 * line (an error, or a warning not `acknowledged`, returns `violations` and
 * posts nothing); for `notification` Stripe, the Stripe customer the user
 * confirmed (`stripeCustomerAction`) is resolved and linked. Then the invoice
 * is claimed (Draft to Pending, refused when it is no longer a Draft) and
 * posted by the `post-sales-invoice` server function; a failed post returns
 * the invoice to Draft. After the post: the PDF is filed and, with Email, it
 * is emailed to `customerContact` (and `cc`), or with Stripe the invoice is
 * sent through the connected account. A failure after the post keeps the
 * invoice posted, stamps the send error on it and returns `warning`.
 * `locale` formats the PDF.
 *
 * @mcp
 */
export const postSalesInvoice = defineServiceFn({
  input: salesInvoicePostValidator.safeExtend({
    invoiceId: z.string(),
    acknowledged: z.boolean().default(false),
    locale: z.string().default("en-US")
  }),
  permission: { update: "invoicing" },

  async run(ctx, input) {
    const { invoiceId, notification, customerContact, locale } = input;
    const client = ctx.asCaller.supabase;
    const serviceRole = ctx.asSystem.supabase;
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;

    // Everything below reads and writes through the service role, so the
    // invoice must be this company's before anything happens.
    const refused = await refuseUnlessOwned(ctx, "salesInvoice", {
      id: invoiceId
    });
    if (refused) return refused;

    // Off by default: only for a company that asked for the policy. The read
    // fails CLOSED: a party with no id is not checked at all.
    const invoiceCustomer = await client
      .from("salesInvoice")
      .select("customerId")
      .eq("id", invoiceId)
      .eq("companyId", companyId)
      .maybeSingle();
    if (invoiceCustomer.error || !invoiceCustomer.data) {
      return ctx.error(
        "internal",
        "Failed to post sales invoice",
        invoiceCustomer.error
      );
    }
    const contactRequired = await checkPartyContactRequirement(
      client,
      companyId,
      { kind: "customer", id: invoiceCustomer.data.customerId }
    );
    if (contactRequired) return ctx.error("rule", contactRequired);

    // The revenue checkpoint, and the only gate a standalone invoice passes:
    // lines arrive from convert, the API and MCP without the per-line check.
    // Before the claim below, or a blocked post strands the invoice Pending.
    let found: SalesRuleCheck;
    try {
      found = await evaluateSalesRulesForSalesDocument({
        client: serviceRole,
        companyId,
        userId,
        documentType: "salesInvoice",
        documentId: invoiceId
      });
    } catch (err) {
      return ctx.error(
        "internal",
        `Invoice not posted — ${
          err instanceof Error ? err.message : "sales rule evaluation failed"
        }`,
        err
      );
    }
    const check = {
      violations: dedupeViolations(found.violations),
      ruleNames: found.ruleNames
    };
    if (
      check.violations.length > 0 &&
      isBlocked(check.violations, input.acknowledged)
    ) {
      await recordSalesRuleOutcome(serviceRole, {
        companyId,
        userId,
        documentType: "salesInvoice",
        documentId: invoiceId,
        outcome: "blocked",
        ...check
      });
      return check;
    }

    let stripeSend: StripeSendContext | null = null;
    if (notification === "Stripe") {
      const preflight = await service
        .preflightStripeSend(ctx, {
          invoiceId,
          customerContact,
          stripeCustomerAction: input.stripeCustomerAction,
          stripeCustomerId: input.stripeCustomerId,
          stripeContactEmail: input.stripeContactEmail
        })
        .catch(
          (err: unknown) =>
            ({
              ok: false,
              message:
                err instanceof Error
                  ? err.message
                  : "the Stripe preflight failed"
            }) as const
        );
      if (!preflight.ok) {
        return ctx.error("rule", `Invoice not posted — ${preflight.message}`);
      }
      stripeSend = preflight.context;
    }

    // Claim: only a Draft. Invoice automation's own claim IS a Pending row,
    // so re-claiming Pending here could post twice.
    const claimed = await client
      .from("salesInvoice")
      .update({ status: "Pending" })
      .eq("id", invoiceId)
      .eq("companyId", companyId)
      .eq("status", "Draft")
      .select("id")
      .maybeSingle();
    if (claimed.error) {
      return ctx.error(
        "internal",
        "Failed to update sales invoice status",
        claimed.error
      );
    }
    if (!claimed.data) {
      return ctx.error(
        "conflict",
        "This invoice is no longer a draft — it may be posting already"
      );
    }

    const posted = await invokePosting(
      ctx,
      "post-sales-invoice",
      {
        invoiceId
      },
      service.postSalesInvoice
    );
    if (posted.error) {
      // Put back OUR claim only: a failed response can still have posted, so
      // a bare reset to Draft could un-post a posted invoice.
      const released = await client
        .from("salesInvoice")
        .update({ status: "Draft" })
        .eq("id", invoiceId)
        .eq("companyId", companyId)
        .eq("status", "Pending");
      if (released.error) {
        logger.error("Failed to release a failed post", {
          companyId,
          invoiceId,
          error: released.error
        });
      }
      return fromServerFn(ctx, posted.error, "Failed to post sales invoice");
    }

    // Override evidence only once the post has committed.
    if (check.violations.length > 0) {
      await recordSalesRuleOutcome(serviceRole, {
        companyId,
        userId,
        documentType: "salesInvoice",
        documentId: invoiceId,
        outcome: "acknowledged",
        ...check
      });
    }

    // Below the rollback above: a post returned to Draft fires no workflow.
    await raiseMoment("invoicing.salesInvoicePosted", {
      outputs: { salesInvoice: { id: invoiceId }, postedBy: { id: userId } },
      companyId,
      actorId: userId
    });
    trackWorkEvent("sales_invoice_posted", {
      companyId,
      userId,
      salesInvoiceId: invoiceId
    });

    const sentVia =
      notification === "Email" || notification === "Stripe"
        ? notification
        : null;
    const warning = await service.sendPostedSalesInvoice(ctx, {
      invoiceId,
      notification: sentVia,
      customerContact,
      cc: input.cc,
      stripeSend,
      stripeDueDate: input.stripeDueDate,
      locale
    });
    return { invoiceId, sentVia, warning };
  }
});
// --- Purchase invoices --------------------------------------------------------
/**
 * Create a purchase invoice.
 *
 * @remarks
 * The invoice is created with its supplier interaction and delivery, and the
 * supplier's payment and shipping defaults. Then, optionally: one line per
 * extracted `lines` entry that has a part number or description (an item
 * when its text matches one directly, otherwise a Comment line), with the
 * whole `taxAmount` on the first line; and the file at `documentPath` (an
 * extraction upload) copied onto the supplier interaction as a document. A
 * failed line or copy does not fail the invoice.
 *
 * @mcp
 */
export const createPurchaseInvoice = defineServiceFn({
  input: purchaseInvoiceValidator.safeExtend({
    customFields: customFieldValues.optional(),
    lines: z
      .array(
        z.object({
          partNumber: z.coerce.string().nullish(),
          description: z.coerce.string().nullish(),
          quantity: z.coerce.number().nullish(),
          unitPrice: z.coerce.number().nullish()
        })
      )
      .default([]),
    taxAmount: z.number().default(0),
    documentPath: z.string().optional()
  }),
  permission: { create: "invoicing" },

  async run(
    ctx,
    { id: _id, lines, taxAmount, documentPath, customFields, ...invoice }
  ) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;

    const result = await service.insertPurchaseInvoice(client, {
      ...invoice,
      invoiceId: invoice.invoiceId || undefined,
      companyId,
      companyGroupId: ctx.company.groupId,
      createdBy: userId,
      customFields
    });
    if (result.error || !result.data) {
      return ctx.error(
        "internal",
        "Failed to insert purchase invoice",
        result.error
      );
    }
    const id = result.data.id;

    const work: Promise<unknown>[] = [];
    let taxApplied = false;
    for (const line of lines) {
      if (!line.description && !line.partNumber) continue;

      // The document's whole tax lands on the first line. The AMOUNT is what
      // the supplier charged; the rate is derived from it, held inside the
      // 0..1 fraction the validator requires. No shipping: it is 0 here.
      const lineTax = taxApplied ? 0 : taxAmount;
      taxApplied = true;
      const subtotal = taxableBase(line.unitPrice || 0, line.quantity || 1, 0);
      const taxPercent = Math.min(1, deriveRate(lineTax, subtotal));

      // Map the line when its text directly matches an item; the rest stay
      // comments for the review modal.
      const itemId = await resolveItemIdFromExtractedText(
        client,
        companyId,
        { type: "supplier", id: invoice.supplierId },
        [line.partNumber, line.description]
      );
      work.push(
        service.upsertPurchaseInvoiceLine(client, {
          invoiceId: id,
          invoiceLineType: itemId ? "Part" : "Comment",
          itemId: itemId ?? undefined,
          description: line.partNumber || line.description || "Line Item",
          quantity: line.quantity || 1,
          supplierUnitPrice: line.unitPrice || 0,
          supplierShippingCost: 0,
          supplierTaxAmount: lineTax,
          taxPercent,
          locationId: invoice.locationId,
          companyId,
          createdBy: userId,
          customFields: {}
        })
      );
    }

    if (documentPath) {
      work.push(
        (async () => {
          const created = await service.getPurchaseInvoice(client, id);
          const interactionId = created.data?.supplierInteractionId;
          if (!interactionId) return;
          const basename =
            documentPath.split("/").pop() || "Extracted_Invoice.pdf";
          const originalFilename = basename.includes("_")
            ? basename.split("_").slice(1).join("_")
            : basename;
          const newStoragePath = `${companyId}/supplier-interaction/${interactionId}/${stripSpecialCharacters(originalFilename)}`;
          const copied = await storage(client)
            .company(companyId)
            .copy(documentPath, newStoragePath);
          if (copied.error) return;
          await upsertDocument(client, {
            path: newStoragePath,
            name: originalFilename,
            size: 0,
            sourceDocument: "Purchase Invoice",
            sourceDocumentId: id,
            readGroups: [userId],
            writeGroups: [userId],
            createdBy: userId,
            companyId
          });
        })()
      );
    }
    await Promise.all(work);

    return { id, invoiceId: result.data.invoiceId };
  }
});

const purchaseInvoiceFields = [
  "invoiceSupplierId",
  "supplierId",
  "dateIssued",
  "paymentTermId",
  "currencyCode",
  "invoiceSupplierContactId",
  "invoiceSupplierLocationId",
  "locationId",
  "supplierReference",
  "exchangeRate",
  "dateDue",
  "datePaid"
] as const;

/**
 * Set one field on one or more purchase invoices.
 *
 * @remarks
 * Refused when any of the invoices is posted, except for the issue, due and
 * paid dates. A new invoice supplier brings its currency at today's rate
 * (a supplier with none keeps the invoice's) and clears the invoice contact
 * and address. A new issue date or payment term on a single invoice
 * recomputes its due date; with several invoices nothing is written. A new
 * currency brings today's exchange rate. An empty value clears the field.
 */
export const updatePurchaseInvoiceField = defineServiceFn({
  input: service.fieldUpdate(purchaseInvoiceFields),
  permission: { update: "sales" },

  async run(ctx, { ids, field, value }) {
    const locked = await service.refuseLockedInvoices(
      ctx,
      "purchaseInvoice",
      ids,
      field,
      "Cannot modify a confirmed purchase invoice."
    );
    if (locked) return locked;

    if (field === "invoiceSupplierId") {
      if (!value)
        return ctx.error("validation", "Invoice supplier is required");
      const currency = await service.partyCurrency(ctx, "supplier", value);
      if (currency instanceof Error) return currency;
      const update = await ctx.asCaller.supabase
        .from("purchaseInvoice")
        .update({
          ...purchaseInvoiceSupplierChange(value, currency),
          updatedBy: ctx.auditUserId,
          updatedAt: datetime.timestamp()
        })
        .in("id", ids)
        .eq("companyId", ctx.company.id);
      if (update.error) {
        return ctx.error(
          "internal",
          "Failed to update the invoices",
          update.error
        );
      }
      return { ids };
    }

    return service.writeInvoiceField(ctx, "purchaseInvoice", {
      ids,
      field,
      value
    });
  }
});

/**
 * Post a Draft purchase invoice.
 *
 * @remarks
 * The supplier must have a reachable contact when the company requires one.
 * The invoice is claimed (Draft or Pending to Pending; refused once posted)
 * and posted by the `post-purchase-invoice` server function, which receives
 * its lines; with `skipReceiptPost` the receipt is created but not posted,
 * for tracked items, and its id is returned as `receiptId`. When the company
 * updates purchase prices on invoice post, they are updated next. A failed
 * post or price update returns the invoice to Draft.
 *
 * @mcp
 */
export const postPurchaseInvoice = defineServiceFn({
  input: z.object({
    invoiceId: z.string(),
    skipReceiptPost: z.boolean().default(false)
  }),
  permission: { update: "invoicing" },

  async run(ctx, { invoiceId, skipReceiptPost }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;

    const refused = await refuseUnlessOwned(ctx, "purchaseInvoice", {
      id: invoiceId
    });
    if (refused) return refused;

    // A supplier with no reachable contact cannot be created as a vendor at
    // a spend platform, so the invoice would be rejected there hours later.
    // The read fails CLOSED: a party with no id is not checked at all.
    const invoiceSupplier = await client
      .from("purchaseInvoice")
      .select("supplierId")
      .eq("id", invoiceId)
      .eq("companyId", companyId)
      .maybeSingle();
    if (invoiceSupplier.error || !invoiceSupplier.data) {
      return ctx.error(
        "internal",
        "Failed to post purchase invoice",
        invoiceSupplier.error
      );
    }
    const contactRequired = await checkPartyContactRequirement(
      client,
      companyId,
      { kind: "supplier", id: invoiceSupplier.data.supplierId }
    );
    if (contactRequired) return ctx.error("rule", contactRequired);

    const claimed = await client
      .from("purchaseInvoice")
      .update({ status: "Pending" })
      .eq("id", invoiceId)
      .eq("companyId", companyId)
      .in("status", ["Draft", "Pending"])
      .select("id");
    if (claimed.error) {
      return ctx.error(
        "internal",
        "Failed to post purchase invoice",
        claimed.error
      );
    }
    if (!claimed.data.length) {
      return ctx.error(
        "conflict",
        "This purchase invoice has already been posted"
      );
    }

    // Known gap, kept from the route: the price update runs after the post
    // has committed, so a failed one sets a posted invoice back to Draft.
    const backToDraft = async () => {
      const reverted = await client
        .from("purchaseInvoice")
        .update({ status: "Draft" })
        .eq("id", invoiceId)
        .eq("companyId", companyId);
      if (reverted.error) {
        logger.error("Failed to return a purchase invoice to Draft", {
          companyId,
          invoiceId,
          error: reverted.error
        });
      }
    };

    let receiptIds: string[] | undefined;
    try {
      const posted = await invokePosting(
        ctx,
        "post-purchase-invoice",
        {
          invoiceId,
          skipReceiptPost
        },
        service.postPurchaseInvoice
      );
      if (posted.error) {
        await backToDraft();
        return fromServerFn(
          ctx,
          posted.error,
          "Failed to post purchase invoice"
        );
      }
      receiptIds = posted.data?.receiptIds;

      const settings = await getCompanySettings(
        ctx.asSystem.supabase,
        companyId
      );
      const timing = settings.data?.purchasePriceUpdateTiming;
      if (!timing || timing === "Purchase Invoice Post") {
        const prices = await invokePosting(
          ctx,
          "update-purchased-prices",
          {
            invoiceId,
            source: "purchaseInvoice",
            updatePrices: true,
            updateLeadTimes: false
          },
          purchasingPostings.updatePurchasedPrices
        );
        if (prices.error) {
          await backToDraft();
          return ctx.error("internal", "Failed to update prices", prices.error);
        }
      }
    } catch (err) {
      await backToDraft();
      return ctx.error("internal", "Failed to post purchase invoice", err);
    }

    // Below the rollback: a post returned to Draft fires no workflow.
    await raiseMoment("invoicing.purchaseInvoicePosted", {
      outputs: { purchaseInvoice: { id: invoiceId }, postedBy: { id: userId } },
      companyId,
      actorId: userId
    });
    trackWorkEvent("purchase_invoice_posted", {
      companyId,
      userId,
      purchaseInvoiceId: invoiceId
    });

    return {
      invoiceId,
      receiptId: (skipReceiptPost && receiptIds?.[0]) || null
    };
  }
});

/**
 * Void a posted purchase invoice.
 *
 * @remarks
 * Refused for an invoice that was never posted, is already voided, or has a
 * payment applied (reverse the payment first). The `post-purchase-invoice`
 * server function reverses its journal and its receipts; its refusal is
 * returned as it is.
 *
 * @mcp destructive
 */
export const voidPurchaseInvoice = defineServiceFn({
  input: z.object({ invoiceId: z.string() }),
  permission: { update: "invoicing" },

  async run(ctx, { invoiceId }) {
    const invoice = await ctx.asCaller.supabase
      .from("purchaseInvoice")
      .select("status, postingDate")
      .eq("id", invoiceId)
      .eq("companyId", ctx.company.id)
      .maybeSingle();
    if (invoice.error) {
      return ctx.error(
        "internal",
        "Failed to void purchase invoice",
        invoice.error
      );
    }
    if (!invoice.data) {
      return ctx.error("notFound", "Purchase invoice not found");
    }
    const { status, postingDate } = invoice.data;
    if (!postingDate) {
      return ctx.error("rule", "Can only void posted purchase invoices");
    }
    if (status === "Voided") {
      return ctx.error("rule", "Purchase invoice is already voided");
    }
    if (status === "Paid" || status === "Partially Paid") {
      return ctx.error(
        "rule",
        "Cannot void a purchase invoice with payments applied. Reverse the payment first."
      );
    }

    const voided = await invokePosting(
      ctx,
      "post-purchase-invoice",
      {
        type: "void",
        invoiceId
      },
      service.postPurchaseInvoice
    );
    if (voided.error) {
      return fromServerFn(ctx, voided.error, "Failed to void purchase invoice");
    }
    return { invoiceId };
  }
});

/**
 * Delete a Draft purchase invoice.
 *
 * @remarks
 * Refused once the invoice is posted. An invoice that billed lease payment
 * rows returns them to Pending in the same transaction, so the next lease
 * run bills them again.
 *
 * @mcp destructive
 */
export const deleteDraftPurchaseInvoice = defineServiceFn({
  input: z.object({ invoiceId: z.string() }),
  permission: { delete: "invoicing" },

  async run(ctx, { invoiceId }) {
    const locked = await service.unlockedPurchaseInvoice(
      ctx,
      invoiceId,
      "Only a Draft purchase invoice can be deleted."
    );
    if (locked) return locked;
    try {
      await deletePurchaseInvoiceReleasingLeases(ctx.asSystem.pg, {
        companyId: ctx.company.id,
        invoiceId,
        userId: ctx.auditUserId
      });
    } catch (err) {
      return ctx.error("internal", "Failed to delete purchase invoice", err);
    }
    return { invoiceId };
  }
});

/**
 * Delete a line of a Draft purchase invoice.
 *
 * @remarks
 * Refused while the invoice is posted. A Lease line returns the payment row
 * it billed to Pending in the same transaction.
 *
 * @mcp destructive
 */
export const deleteDraftPurchaseInvoiceLine = defineServiceFn({
  input: z.object({ invoiceId: z.string(), lineId: z.string() }),
  permission: { delete: "invoicing" },

  async run(ctx, { invoiceId, lineId }) {
    const locked = await service.unlockedPurchaseInvoice(
      ctx,
      invoiceId,
      "Cannot delete lines on a confirmed purchase invoice."
    );
    if (locked) return locked;
    try {
      await deletePurchaseInvoiceLineReleasingLeases(ctx.asSystem.pg, {
        companyId: ctx.company.id,
        invoiceId,
        purchaseInvoiceLineId: lineId,
        userId: ctx.auditUserId
      });
    } catch (err) {
      return ctx.error(
        "internal",
        "Failed to delete purchase invoice line",
        err
      );
    }
    return { invoiceId, lineId };
  }
});

/**
 * Map a purchase invoice's extracted Comment lines to items.
 *
 * @remarks
 * Every line must be on the invoice and every named item the company's.
 * `map` sets the line's item; `create` first reuses the item whose part
 * number is `createName` (or the description), or creates it as a bought
 * part; `ignore` skips the line. A mapped line becomes a Part line.
 * `failed` counts the lines that could not be mapped.
 *
 * @mcp
 */
export const mapPurchaseInvoiceLines = defineServiceFn({
  input: z.object({
    invoiceId: z.string(),
    mappings: z.array(
      z.object({
        lineId: z.string(),
        action: z.enum(["map", "create", "ignore"]),
        itemId: z.string().nullish(),
        createName: z.string().nullish(),
        description: z.string().nullish()
      })
    )
  }),
  permission: { update: "invoicing" },

  async run(ctx, { invoiceId, mappings }) {
    const serviceRole = ctx.asSystem.supabase;
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;

    // Every line and item id is the caller's: prove each line is on this
    // invoice and each item this company's before any write.
    const active = mappings.filter((map) => map.action !== "ignore");
    const lineIds = [...new Set(active.map((map) => map.lineId))];
    const itemIds = [
      ...new Set(active.flatMap((map) => (map.itemId ? [map.itemId] : [])))
    ];
    if (lineIds.length > 0) {
      const lines = await serviceRole
        .from("purchaseInvoiceLine")
        .select("id")
        .eq("invoiceId", invoiceId)
        .eq("companyId", companyId)
        .in("id", lineIds);
      if (lines.error || lines.data.length !== lineIds.length) {
        logger.error("Invoice lines not found for mapping", {
          companyId,
          invoiceId,
          lineIds,
          error: lines.error
        });
        return ctx.error("notFound", "Invoice line not found");
      }
    }
    if (itemIds.length > 0) {
      const items = await serviceRole
        .from("item")
        .select("id")
        .eq("companyId", companyId)
        .in("id", itemIds);
      if (items.error || items.data.length !== itemIds.length) {
        logger.error("Items not found for invoice line mapping", {
          companyId,
          invoiceId,
          itemIds,
          error: items.error
        });
        return ctx.error("notFound", "Item not found");
      }
    }

    let failed = 0;
    for (const map of active) {
      let itemId = map.itemId;

      if (map.action === "create") {
        const name = (map.createName || map.description || "").trim();
        if (!name) continue;

        // Reuse an item with that part number rather than fail on the unique
        // constraint or create a duplicate.
        const existing = await serviceRole
          .from("item")
          .select("id")
          .eq("companyId", companyId)
          .eq("readableId", name)
          .maybeSingle();
        if (existing.data) {
          itemId = existing.data.id;
        } else {
          // The service role: the invoicing-scoped client cannot insert items.
          const created = await upsertPart(serviceRole, {
            id: name,
            name,
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
          if (created.error || !created.data?.id) {
            failed++;
            logger.error("Failed to create part for invoice line", {
              companyId,
              invoiceId,
              lineId: map.lineId,
              readableId: name,
              error: created.error
            });
          } else {
            itemId = created.data.id;
          }
        }
      }
      if (!itemId) continue;

      // Set the line's item and promote it from a Comment to a Part line.
      const mapped = await ctx.asCaller.supabase
        .from("purchaseInvoiceLine")
        .update({ itemId, invoiceLineType: "Part", updatedBy: userId })
        .eq("id", map.lineId)
        .eq("companyId", companyId);
      if (mapped.error) {
        failed++;
        logger.error("Failed to map invoice line to item", {
          companyId,
          invoiceId,
          lineId: map.lineId,
          itemId,
          error: mapped.error
        });
      }
    }

    return { failed };
  }
});

// --- Payments -----------------------------------------------------------------
/**
 * Create a Draft payment.
 *
 * @remarks
 * A deposit (`salesOrderId` / `rentalAgreementId`) must name this company's
 * and this customer's document, and a new deposit an open one; that refusal
 * is a `validation` error. The currency must be configured for the company.
 * Without a `paymentId` the next number is used. Then one application is
 * seeded per `seedInvoiceIds` invoice of the payment's party in the
 * payment's currency, for its full open balance less any early-payment
 * discount as of the payment date. When seeding fails the payment is kept
 * and `warning` says so.
 *
 * @mcp
 */
export const createPayment = defineServiceFn({
  input: paymentValidator.safeExtend({
    customFields: customFieldValues.optional(),
    seedInvoiceIds: z.array(z.string()).default([])
  }),
  permission: { create: "invoicing" },

  async run(ctx, { id: _id, seedInvoiceIds, customFields, ...payment }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;

    // The deposit ids arrive as hidden fields: never trust them to name this
    // company's, this customer's, open document.
    const depositError = await service.checkDepositDocument(
      client,
      companyId,
      payment
    );
    if (depositError) return ctx.error("validation", depositError);

    try {
      await service.getPaymentCurrencyConfiguration(
        client,
        companyId,
        payment.currencyCode
      );
    } catch (err) {
      return ctx.error(
        "rule",
        err instanceof Error ? err.message : "Invalid currency configuration",
        err
      );
    }

    let paymentId = payment.paymentId;
    if (!paymentId) {
      const next = await getNextSequence(client, "payment", companyId);
      if (next.error || !next.data) {
        return ctx.error(
          "internal",
          "Failed to allocate payment id",
          next.error
        );
      }
      paymentId = next.data;
    }

    const inserted = await service.upsertPayment(client, {
      ...payment,
      paymentId,
      companyId,
      createdBy: ctx.auditUserId,
      customFields
    });
    if (inserted.error || !inserted.data) {
      return ctx.error("internal", "Failed to create payment", inserted.error);
    }
    const id = inserted.data.id;

    let warning: string | null = null;
    if (seedInvoiceIds.length > 0) {
      try {
        await service.seedPaymentApplications(ctx, {
          id,
          ...payment,
          seedInvoiceIds
        });
      } catch (err) {
        // A Draft with no applications is valid; they are applied by hand.
        logger.error("Failed to seed payment applications", {
          companyId,
          paymentId: id,
          error: err
        });
        warning = "Payment created, but applying it to the invoices failed";
      }
    }
    return { id, paymentId, warning };
  }
});
/**
 * Post a Draft payment.
 *
 * @remarks
 * The `post-payment` server function books the payment's journal and its
 * applications; its refusal is returned as it is.
 *
 * @mcp
 */
export const postPayment = defineServiceFn({
  input: z.object({ paymentId: z.string() }),
  permission: { update: "invoicing" },

  async run(ctx, { paymentId }) {
    const refused = await refuseUnlessOwned(ctx, "payment", { id: paymentId });
    if (refused) return refused;
    const posted = await invokePosting(
      ctx,
      "post-payment",
      {
        type: "post",
        paymentId
      },
      service.postPayment
    );
    if (posted.error) {
      return fromServerFn(ctx, posted.error, "Failed to post payment");
    }
    return { paymentId };
  }
});

/**
 * Void a posted payment.
 *
 * @remarks
 * The `post-payment` server function reverses the payment's journal and its
 * applications; its refusal is returned as it is.
 *
 * @mcp destructive
 */
export const voidPayment = defineServiceFn({
  input: z.object({ paymentId: z.string() }),
  permission: { update: "invoicing" },

  async run(ctx, { paymentId }) {
    const refused = await refuseUnlessOwned(ctx, "payment", { id: paymentId });
    if (refused) return refused;
    const voided = await invokePosting(
      ctx,
      "post-payment",
      {
        type: "void",
        paymentId
      },
      service.postPayment
    );
    if (voided.error) {
      return fromServerFn(ctx, voided.error, "Failed to void payment");
    }
    return { paymentId };
  }
});

// --- Memos and charges ---------------------------------------------------------

/**
 * Post a Draft credit or debit memo.
 *
 * @remarks
 * The `post-memo` server function books its journal; its refusal is
 * returned as it is.
 *
 * @mcp
 */
export const postMemo = defineServiceFn({
  input: z.object({ memoId: z.string() }),
  permission: { update: "invoicing" },

  async run(ctx, { memoId }) {
    const refused = await refuseUnlessOwned(ctx, "memo", { id: memoId });
    if (refused) return refused;
    const posted = await invokePosting(
      ctx,
      "post-memo",
      {
        type: "post",
        memoId
      },
      service.postMemo
    );
    if (posted.error) {
      return fromServerFn(ctx, posted.error, "Failed to post memo");
    }
    return { memoId };
  }
});

/**
 * Void a posted credit or debit memo.
 *
 * @remarks
 * The `post-memo` server function reverses its journal; its refusal is
 * returned as it is.
 *
 * @mcp destructive
 */
export const voidMemo = defineServiceFn({
  input: z.object({ memoId: z.string() }),
  permission: { update: "invoicing" },

  async run(ctx, { memoId }) {
    const refused = await refuseUnlessOwned(ctx, "memo", { id: memoId });
    if (refused) return refused;
    const voided = await invokePosting(
      ctx,
      "post-memo",
      {
        type: "void",
        memoId
      },
      service.postMemo
    );
    if (voided.error) {
      return fromServerFn(ctx, voided.error, "Failed to void memo");
    }
    return { memoId };
  }
});

/**
 * Delete a Draft credit or debit memo.
 *
 * @remarks
 * Refused once the memo is posted. A rental early-return credit returns the
 * billing periods it credits to Pending in the same transaction, so the next
 * invoice run credits them again. `party` says which list the memo was on.
 *
 * @mcp destructive
 */
export const deleteDraftMemo = defineServiceFn({
  input: z.object({ memoId: z.string() }),
  permission: { delete: "invoicing" },

  async run(ctx, { memoId }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const memo = await service.getMemo(client, memoId, companyId);
    if (memo.error) {
      return ctx.error("internal", "Failed to delete memo", memo.error);
    }
    if (!memo.data) return ctx.error("notFound", "Memo not found");
    if (isMemoLocked(memo.data.status)) {
      return ctx.error("rule", "Only a Draft memo can be deleted");
    }
    const party = memo.data.supplierId ? "supplier" : "customer";

    if (memo.data.rentalAgreementId) {
      try {
        await deleteRentalCreditMemoReleasingPeriods(ctx.asSystem.pg, {
          companyId,
          memoId,
          userId: ctx.auditUserId
        });
      } catch (err) {
        return ctx.error(
          "internal",
          err instanceof Error ? err.message : "Failed to delete memo",
          err
        );
      }
      return { memoId, party };
    }

    const removed = await service.deleteMemo(client, memoId, companyId);
    if (removed.error) {
      return ctx.error("internal", "Failed to delete memo", removed.error);
    }
    return { memoId, party };
  }
});

/**
 * Void a posted card charge.
 *
 * @remarks
 * The `post-charge` server function posts the reversing journal; its refusal
 * (an already voided charge, a Draft one) is returned as it is.
 *
 * @mcp destructive
 */
export const voidCharge = defineServiceFn({
  input: z.object({ chargeId: z.string() }),
  permission: { update: "invoicing" },

  async run(ctx, { chargeId }) {
    const refused = await refuseUnlessOwned(ctx, "charge", { id: chargeId });
    if (refused) return refused;
    const voided = await invokePosting(
      ctx,
      "post-charge",
      {
        type: "void",
        chargeId
      },
      accountingPostings.postCharge
    );
    if (voided.error) {
      return fromServerFn(ctx, voided.error, "Failed to void charge");
    }
    return { chargeId };
  }
});

// --- Receivables and payables ------------------------------------------------
const adjustInput = z.object({ asOfDate: z.string().optional() });

/**
 * Create a Draft journal entry for the receivables tie-out variance.
 *
 * @remarks
 * Refused before the accounting cutover, and when there is no variance as
 * of `asOfDate` (default: today). The variance is recomputed here. When the
 * subledger is above the GL, receivables is debited; otherwise it is
 * credited; the rounding account takes the other side. When the lines
 * cannot be written the Draft entry is kept and `warning` says so.
 *
 * @mcp
 */
export const adjustReceivables = defineServiceFn({
  input: adjustInput,
  permission: { create: "accounting" },
  run: (ctx, { asOfDate }) => service.adjustTieOut(ctx, "receivables", asOfDate)
});

/**
 * Create a Draft journal entry for the payables tie-out variance.
 *
 * @remarks
 * Refused before the accounting cutover, and when there is no variance as
 * of `asOfDate` (default: today). The variance is recomputed here. When the
 * subledger is above the GL, payables is credited; otherwise it is debited;
 * the rounding account takes the other side. When the lines cannot be
 * written the Draft entry is kept and `warning` says so.
 *
 * @mcp
 */
export const adjustPayables = defineServiceFn({
  input: adjustInput,
  permission: { create: "accounting" },
  run: (ctx, { asOfDate }) => service.adjustTieOut(ctx, "payables", asOfDate)
});

// --- Reimbursements -------------------------------------------------------------
const REIMBURSEMENT_UNBALANCED_MESSAGE =
  "The coding lines must sum to the reimbursement amount before posting";
const reimbursementInput = reimbursementUpdateValidator.safeExtend({
  customFields: customFieldValues.optional(),
  lines: reimbursementLinesValidator
});

/**
 * Change a Draft reimbursement and replace its coding lines.
 *
 * @remarks
 * Refused once the reimbursement is posted. The header is updated, then the
 * lines are replaced as sent (each with its dimension pairs). Currency and
 * exchange rate are the source transaction's facts and are not changed.
 *
 * @mcp
 */
export const saveReimbursement = defineServiceFn({
  input: reimbursementInput,
  permission: { update: "invoicing" },

  async run(ctx, { lines, customFields, ...header }) {
    const existing = await service.loadReimbursement(ctx, header.id);
    if (existing instanceof Error) return existing;
    // A readable refusal beats the raw 55000 the draft guard trigger raises.
    if (existing.status !== "Draft") {
      return ctx.error("rule", "A posted reimbursement cannot be edited");
    }

    const updated = await service.updateReimbursement(ctx.asCaller.supabase, {
      ...header,
      companyId: ctx.company.id,
      updatedBy: ctx.auditUserId,
      customFields
    });
    if (updated.error) {
      return ctx.error(
        "internal",
        "Failed to update reimbursement",
        updated.error
      );
    }

    try {
      await service.upsertReimbursementLines(ctx.asSystem.pg, {
        reimbursementId: header.id,
        companyId: ctx.company.id,
        createdBy: ctx.auditUserId,
        lines
      });
    } catch (err) {
      return ctx.error(
        "internal",
        err instanceof Error && err.message
          ? err.message
          : "Failed to save coding lines",
        err
      );
    }
    return { reimbursementId: header.id };
  }
});

/**
 * Change a Draft reimbursement, replace its coding lines, then post it.
 *
 * @remarks
 * Before anything is written, the lines must sum to the amount. Then as
 * `saveReimbursement`, then as `postReimbursement`. When the post fails
 * the changes are kept.
 *
 * @mcp
 */
export const saveAndPostReimbursement = defineServiceFn({
  input: reimbursementInput,
  permission: { update: "invoicing" },

  async run(ctx, input) {
    if (
      !service.linesBalanceHeader(
        input.amount,
        input.lines.map((line) => line.amount)
      )
    ) {
      return ctx.error("rule", REIMBURSEMENT_UNBALANCED_MESSAGE);
    }
    const updated = await saveReimbursement(ctx, input);
    if (updated.error) return updated.error;
    const posted = await postReimbursement(ctx, { reimbursementId: input.id });
    if (posted.error) return posted.error;
    return { reimbursementId: input.id };
  }
});

/**
 * Post a Draft reimbursement.
 *
 * @remarks
 * Refused unless the reimbursement is a Draft whose coding lines sum to its
 * amount. The `post-reimbursement` server function books its journal; its
 * refusal is returned as it is.
 *
 * @mcp
 */
export const postReimbursement = defineServiceFn({
  input: z.object({ reimbursementId: z.string() }),
  permission: { update: "invoicing" },

  async run(ctx, { reimbursementId }) {
    const reimbursement = await service.loadReimbursement(ctx, reimbursementId);
    if (reimbursement instanceof Error) return reimbursement;
    if (reimbursement.status !== "Draft") {
      return ctx.error("rule", "Only a Draft reimbursement can be posted");
    }
    // Checked here, with a readable message, before the server function.
    const lines = reimbursement.reimbursementLine ?? [];
    if (
      !service.linesBalanceHeader(
        Number(reimbursement.amount),
        lines.map((line) => Number(line.amount))
      )
    ) {
      return ctx.error("rule", REIMBURSEMENT_UNBALANCED_MESSAGE);
    }

    const posted = await invokePosting(
      ctx,
      "post-reimbursement",
      {
        type: "post",
        reimbursementId
      },
      accountingPostings.postReimbursement
    );
    if (posted.error) {
      return fromServerFn(ctx, posted.error, "Failed to post reimbursement");
    }
    return { reimbursementId };
  }
});

/**
 * Void a posted reimbursement.
 *
 * @remarks
 * The `post-reimbursement` server function reverses whatever was posted; its
 * refusal is returned as it is.
 *
 * @mcp destructive
 */
export const voidReimbursement = defineServiceFn({
  input: z.object({ reimbursementId: z.string() }),
  permission: { update: "invoicing" },

  async run(ctx, { reimbursementId }) {
    const refused = await refuseUnlessOwned(ctx, "reimbursement", {
      id: reimbursementId
    });
    if (refused) return refused;
    const voided = await invokePosting(
      ctx,
      "post-reimbursement",
      {
        type: "void",
        reimbursementId
      },
      accountingPostings.postReimbursement
    );
    if (voided.error) {
      return fromServerFn(ctx, voided.error, "Failed to void reimbursement");
    }
    return { reimbursementId };
  }
});

/**
 * Pay a posted reimbursement to the employee.
 *
 * @remarks
 * Refused unless the reimbursement is Posted, has a balance due, and
 * `amount` (in its currency) is at most that balance, read again here. The
 * currency must be configured for the company. Creates a disbursement to
 * the employee at the reimbursement's own exchange rate, applies it to the
 * reimbursement, and posts it with `post-payment`. When the application or
 * the post fails, the Draft payment is kept and `warning` says so.
 *
 * @mcp
 */
export const payReimbursement = defineServiceFn({
  input: reimbursementPaymentValidator.safeExtend({
    reimbursementId: z.string()
  }),
  permission: { create: "invoicing" },

  async run(ctx, { reimbursementId, amount, paymentDate, bankAccount }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;

    const reimbursement = await service.loadReimbursement(ctx, reimbursementId);
    if (reimbursement instanceof Error) return reimbursement;
    if (reimbursement.status !== "Posted") {
      return ctx.error("rule", "Only a posted reimbursement can be paid");
    }

    // The modal's default came from a loader that may be minutes old, and
    // a second payout must not overdraw the payable.
    const open = await service.getOpenReimbursementsForEmployee(
      client,
      companyId,
      reimbursement.employeeId,
      reimbursement.currencyCode
    );
    if (open.error) {
      return ctx.error(
        "internal",
        "Failed to load the balance due",
        open.error
      );
    }
    const balance = (open.data ?? []).find((r) => r.id === reimbursementId);
    if (!balance) {
      return ctx.error("rule", "This reimbursement is fully paid");
    }
    if (amount > balance.remainingDocument) {
      return ctx.error(
        "rule",
        "The amount exceeds the reimbursement's balance due"
      );
    }

    try {
      await service.getPaymentCurrencyConfiguration(
        client,
        companyId,
        reimbursement.currencyCode
      );
    } catch (err) {
      return ctx.error(
        "rule",
        err instanceof Error ? err.message : "Invalid currency configuration",
        err
      );
    }

    const next = await getNextSequence(client, "payment", companyId);
    if (next.error || !next.data) {
      return ctx.error("internal", "Failed to allocate payment id", next.error);
    }

    // Paid at the reimbursement's own rate: no revaluation nobody asked for.
    const exchangeRate = Number(reimbursement.exchangeRate);
    const payment = await service.upsertPayment(client, {
      paymentId: next.data,
      paymentType: "Disbursement",
      employeeId: reimbursement.employeeId,
      paymentDate,
      currencyCode: reimbursement.currencyCode,
      exchangeRate,
      totalAmount: amount,
      bankAccount,
      companyId,
      createdBy: ctx.auditUserId
    });
    if (payment.error || !payment.data) {
      return ctx.error(
        "internal",
        "Failed to create the payment",
        payment.error
      );
    }
    const paymentId = payment.data.id;

    try {
      // The employee arm here is the authority on party, currency, Posted
      // status and the balance ceiling.
      await service.replaceInvoiceSettlements(ctx.asSystem.pg, {
        paymentId,
        companyId,
        createdBy: ctx.auditUserId,
        applications: [
          {
            targetReimbursementId: reimbursementId,
            sourceAmount: amount,
            appliedAmount: toBaseAmount(amount, exchangeRate),
            discountAmount: 0,
            writeOffAmount: 0,
            targetExchangeRate: exchangeRate,
            sourceExchangeRate: exchangeRate,
            appliedDate: paymentDate
          }
        ]
      });
    } catch (err) {
      logger.error("Failed to apply a reimbursement payout", {
        companyId,
        reimbursementId,
        paymentId,
        error: err
      });
      return {
        paymentId,
        warning: "Payment created, but applying it to the reimbursement failed"
      };
    }

    const posted = await invokePosting(
      ctx,
      "post-payment",
      {
        type: "post",
        paymentId
      },
      service.postPayment
    );
    if (posted.error) {
      logger.error("Failed to post a reimbursement payout", {
        companyId,
        reimbursementId,
        paymentId,
        error: posted.error
      });
      return {
        paymentId,
        warning: posted.error.message || "Failed to post the payment"
      };
    }
    return { paymentId, warning: null };
  }
});
/**
 * Create purchase invoice from purchase order
 *
 * @mcp
 */
export const createPurchaseInvoiceFromPurchaseOrder = defineServiceFn({
  input: z.looseObject({ purchaseOrderId: z.string() }),
  permission: { create: "invoicing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.createPurchaseInvoiceFromPurchaseOrder(
        ctx.asCaller.supabase,
        ctx.asSystem.pg,
        input.purchaseOrderId as never,
        ctx.company.id,
        ctx.auditUserId
      )
    );
  }
});

/**
 * Create sales invoice from sales order
 *
 * @mcp
 */
export const createSalesInvoiceFromSalesOrder = defineServiceFn({
  input: z.looseObject({ salesOrderId: z.string() }),
  permission: { create: "invoicing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.createSalesInvoiceFromSalesOrder(
        ctx.asCaller.supabase,
        ctx.asSystem.pg,
        input.salesOrderId as never,
        ctx.company.id,
        ctx.auditUserId
      )
    );
  }
});

/**
 * Create sales invoice from shipment
 *
 * @mcp
 */
export const createSalesInvoiceFromShipment = defineServiceFn({
  input: z.looseObject({ shipmentId: z.string() }),
  permission: { create: "invoicing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.createSalesInvoiceFromShipment(
        ctx.asCaller.supabase,
        ctx.asSystem.pg,
        input.shipmentId as never,
        ctx.company.id,
        ctx.auditUserId
      )
    );
  }
});

/**
 * Get purchase invoice
 *
 * @mcp read
 */
export const getPurchaseInvoice = defineServiceFn({
  input: z.looseObject({ purchaseInvoiceId: z.string() }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getPurchaseInvoice(
        ctx.asCaller.supabase,
        input.purchaseInvoiceId as never
      )
    );
  }
});

/**
 * Get purchase invoices
 *
 * @mcp read
 */
export const getPurchaseInvoices = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional(),
    supplierId: z.string().nullable().optional()
  }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getPurchaseInvoices(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get purchase invoice delivery
 *
 * @mcp read
 */
export const getPurchaseInvoiceDelivery = defineServiceFn({
  input: z.looseObject({ purchaseInvoiceId: z.string() }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getPurchaseInvoiceDelivery(
        ctx.asCaller.supabase,
        input.purchaseInvoiceId as never
      )
    );
  }
});

/**
 * Get purchase invoice lines
 *
 * @mcp read
 */
export const getPurchaseInvoiceLines = defineServiceFn({
  input: z.looseObject({ purchaseInvoiceId: z.string() }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getPurchaseInvoiceLines(
        ctx.asCaller.supabase,
        input.purchaseInvoiceId as never
      )
    );
  }
});

/**
 * Get purchase invoice line
 *
 * @mcp read
 */
export const getPurchaseInvoiceLine = defineServiceFn({
  input: z.looseObject({ purchaseInvoiceLineId: z.string() }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getPurchaseInvoiceLine(
        ctx.asCaller.supabase,
        input.purchaseInvoiceLineId as never
      )
    );
  }
});

/**
 * Get sales invoice
 *
 * @mcp read
 */
export const getSalesInvoice = defineServiceFn({
  input: z.looseObject({ salesInvoiceId: z.string() }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getSalesInvoice(
        ctx.asCaller.supabase,
        input.salesInvoiceId as never
      )
    );
  }
});

/**
 * Get sales invoices
 *
 * @mcp read
 */
export const getSalesInvoices = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional(),
    customerId: z.string().nullable().optional()
  }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getSalesInvoices(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get sales invoice shipment
 *
 * @mcp read
 */
export const getSalesInvoiceShipment = defineServiceFn({
  input: z.looseObject({ salesInvoiceId: z.string() }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getSalesInvoiceShipment(
        ctx.asCaller.supabase,
        input.salesInvoiceId as never
      )
    );
  }
});

/**
 * Get sales invoice lines
 *
 * @mcp read
 */
export const getSalesInvoiceLines = defineServiceFn({
  input: z.looseObject({ salesInvoiceId: z.string() }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getSalesInvoiceLines(
        ctx.asCaller.supabase,
        input.salesInvoiceId as never
      )
    );
  }
});

/**
 * Get sales invoice line
 *
 * @mcp read
 */
export const getSalesInvoiceLine = defineServiceFn({
  input: z.looseObject({ salesInvoiceLineId: z.string() }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getSalesInvoiceLine(
        ctx.asCaller.supabase,
        input.salesInvoiceLineId as never
      )
    );
  }
});

/**
 * Update purchase invoice exchange rate
 *
 * @mcp
 */
export const updatePurchaseInvoiceExchangeRate = defineServiceFn({
  input: z.looseObject({ id: z.string(), exchangeRate: z.number() }),
  permission: { update: "invoicing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.updatePurchaseInvoiceExchangeRate(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Update sales invoice exchange rate
 *
 * @mcp
 */
export const updateSalesInvoiceExchangeRate = defineServiceFn({
  input: z.looseObject({ id: z.string(), exchangeRate: z.number() }),
  permission: { update: "invoicing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.updateSalesInvoiceExchangeRate(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Update purchase invoice
 *
 * @mcp
 */
export const updatePurchaseInvoice = defineServiceFn({
  input: z.looseObject({
    id: z.string(),
    invoiceId: z.string().optional(),
    supplierId: z.string().optional(),
    supplierReference: z.string().nullable().optional(),
    paymentTermId: z.string().nullable().optional(),
    currencyCode: z.string().optional(),
    locationId: z.string().optional(),
    invoiceSupplierId: z.string().nullable().optional(),
    invoiceSupplierContactId: z.string().nullable().optional(),
    invoiceSupplierLocationId: z.string().nullable().optional(),
    dateIssued: z.string().nullable().optional(),
    dateDue: z.string().nullable().optional(),
    exchangeRate: z.number().optional(),
    exchangeRateUpdatedAt: z.string().optional(),
    customFields: z.unknown().optional()
  }),
  permission: { update: "invoicing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.updatePurchaseInvoice(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Updates an invoice's delivery
 *
 * @mcp
 */
export const upsertPurchaseInvoiceDelivery = defineServiceFn({
  input: z.looseObject({
    id: z.string(),
    locationId: z.string().optional(),
    shippingMethodId: z.string().optional(),
    shippingTermId: z.string().optional(),
    supplierShippingCost: z.number().optional(),
    incoterm: z
      .enum([
        "EXW",
        "FCA",
        "FAS",
        "FOB",
        "CPT",
        "CIP",
        "CFR",
        "CIF",
        "DAP",
        "DPU",
        "DDP"
      ])
      .optional(),
    incotermLocation: z.string().optional(),
    customFields: z.unknown().optional()
  }),
  permission: { update: "invoicing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertPurchaseInvoiceDelivery(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Create a purchase invoice line
 *
 * @remarks
 * Upsert purchase invoice line
 *
 * @mcp
 */
export const createPurchaseInvoiceLine = defineServiceFn({
  input: z.looseObject({
    invoiceId: z.string().min(1),
    invoiceLineType: z.enum([
      "Part",
      "Material",
      "Tool",
      "Consumable",
      "Service",
      "Fixture",
      "G/L Account",
      "Fixed Asset",
      "Lease",
      "Comment"
    ]),
    purchaseOrderId: z.string().optional(),
    purchaseOrderLineId: z.string().optional(),
    itemId: z.string().optional(),
    accountId: z.string().optional(),
    costCenterId: z.string().optional(),
    assetId: z.string().optional(),
    leaseId: z.string().optional(),
    leasePaymentId: z.string().optional(),
    description: z.string().optional(),
    quantity: z.number().optional(),
    purchaseUnitOfMeasureCode: z.string().optional(),
    inventoryUnitOfMeasureCode: z.string().optional(),
    conversionFactor: z.number().optional(),
    supplierUnitPrice: z.number().optional(),
    supplierShippingCost: z
      .number()
      .default(0)
      .describe(
        "Applied when creating; on update a field left out keeps its value."
      ),
    supplierTaxAmount: z
      .number()
      .default(0)
      .describe(
        "Applied when creating; on update a field left out keeps its value."
      ),
    taxPercent: z
      .number()
      .min(0)
      .max(1)
      .default(0)
      .describe(
        "Applied when creating; on update a field left out keeps its value."
      ),
    requiredDate: z.string().optional(),
    locationId: z.string().optional(),
    storageUnitId: z.string().optional(),
    exchangeRate: z.number().optional(),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "invoicing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertPurchaseInvoiceLine(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

/**
 * Update a purchase invoice line
 *
 * @remarks
 * Upsert purchase invoice line
 *
 * @mcp
 */
export const updatePurchaseInvoiceLine = defineServiceFn({
  input: z
    .looseObject({
      invoiceId: z.string().min(1),
      invoiceLineType: z.enum([
        "Part",
        "Material",
        "Tool",
        "Consumable",
        "Service",
        "Fixture",
        "G/L Account",
        "Fixed Asset",
        "Lease",
        "Comment"
      ]),
      purchaseOrderId: z.string().optional(),
      purchaseOrderLineId: z.string().optional(),
      itemId: z.string().optional(),
      accountId: z.string().optional(),
      costCenterId: z.string().optional(),
      assetId: z.string().optional(),
      leaseId: z.string().optional(),
      leasePaymentId: z.string().optional(),
      description: z.string().optional(),
      quantity: z.number().optional(),
      purchaseUnitOfMeasureCode: z.string().optional(),
      inventoryUnitOfMeasureCode: z.string().optional(),
      conversionFactor: z.number().optional(),
      supplierUnitPrice: z.number().optional(),
      supplierShippingCost: z
        .number()
        .describe(
          "Applied when creating; on update a field left out keeps its value."
        )
        .optional(),
      supplierTaxAmount: z
        .number()
        .describe(
          "Applied when creating; on update a field left out keeps its value."
        )
        .optional(),
      taxPercent: z
        .number()
        .min(0)
        .max(1)
        .describe(
          "Applied when creating; on update a field left out keeps its value."
        )
        .optional(),
      requiredDate: z.string().optional(),
      locationId: z.string().optional(),
      storageUnitId: z.string().optional(),
      exchangeRate: z.number().optional(),
      customFields: z.unknown().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "invoicing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertPurchaseInvoiceLine(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Update purchase invoice line order
 *
 * @mcp
 */
export const updatePurchaseInvoiceLineOrder = defineServiceFn({
  input: z.looseObject({
    invoiceId: z.string(),
    updates: z.array(z.looseObject({ id: z.string(), sortOrder: z.number() }))
  }),
  permission: { update: "invoicing" },
  async run(ctx, input) {
    return await service.updatePurchaseInvoiceLineOrder(
      ctx.asSystem.pg,
      ctx.company.id,
      ctx.auditUserId,
      input.invoiceId as never,
      payload(ctx, input.updates).forUpdate() as never
    );
  }
});

/**
 * Insert sales invoice
 *
 * @mcp destructive
 */
export const insertSalesInvoice = defineServiceFn({
  input: z.looseObject({
    customerId: z.string(),
    invoiceId: z.string().optional(),
    customerReference: z.string().optional(),
    paymentTermId: z.string().optional(),
    currencyCode: z.string().optional(),
    locationId: z.string().optional(),
    invoiceCustomerId: z.string().optional(),
    invoiceCustomerContactId: z.string().optional(),
    invoiceCustomerLocationId: z.string().optional(),
    dateIssued: z.string().optional(),
    dateDue: z.string().optional(),
    exchangeRate: z.number().optional(),
    exchangeRateUpdatedAt: z.string().optional(),
    customFields: z.unknown().optional()
  }),
  permission: { create: "invoicing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.insertSalesInvoice(
        ctx.asCaller.supabase,
        payload(ctx, input).withGroup().forUpsert() as never
      )
    );
  }
});

/**
 * Updates an invoice's shipment
 *
 * @mcp
 */
export const upsertSalesInvoiceShipment = defineServiceFn({
  input: z.looseObject({
    id: z.string(),
    locationId: z.string().optional(),
    customerLocationId: z.string().optional(),
    shippingMethodId: z.string().optional(),
    shippingTermId: z.string().optional(),
    shippingCost: z.number().optional(),
    incoterm: z
      .enum([
        "EXW",
        "FCA",
        "FAS",
        "FOB",
        "CPT",
        "CIP",
        "CFR",
        "CIF",
        "DAP",
        "DPU",
        "DDP"
      ])
      .optional(),
    incotermLocation: z.string().optional(),
    customFields: z.unknown().optional()
  }),
  permission: { update: "invoicing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertSalesInvoiceShipment(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Update sales invoice line order
 *
 * @mcp
 */
export const updateSalesInvoiceLineOrder = defineServiceFn({
  input: z.looseObject({
    invoiceId: z.string(),
    updates: z.array(z.looseObject({ id: z.string(), sortOrder: z.number() }))
  }),
  permission: { update: "invoicing" },
  async run(ctx, input) {
    return await service.updateSalesInvoiceLineOrder(
      ctx.asSystem.pg,
      ctx.company.id,
      ctx.auditUserId,
      input.invoiceId as never,
      payload(ctx, input.updates).forUpdate() as never
    );
  }
});

/**
 * Get payment
 *
 * @mcp read
 */
export const getPayment = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getPayment(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get payments
 *
 * @mcp read
 */
export const getPayments = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional(),
    paymentType: z.enum(["Receipt", "Disbursement"]).nullable().optional(),
    status: z.enum(["Draft", "Posted", "Voided"]).nullable().optional(),
    customerId: z.string().nullable().optional(),
    supplierId: z.string().nullable().optional(),
    counterpartyIds: z.array(z.string()).nullable().optional()
  }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getPayments(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get charge
 *
 * @mcp read
 */
export const getCharge = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getCharge(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.id as never
      )
    );
  }
});

/**
 * Get charges
 *
 * @mcp read
 */
export const getCharges = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional(),
    type: z
      .enum(["Charge", "Credit", "Payment", "Cashback", "Repayment"])
      .nullable()
      .optional(),
    status: z.enum(["Draft", "Posted", "Voided"]).nullable().optional()
  }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getCharges(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get reimbursement
 *
 * @mcp read
 */
export const getReimbursement = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getReimbursement(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.id as never
      )
    );
  }
});

/**
 * Get reimbursements
 *
 * @mcp read
 */
export const getReimbursements = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional(),
    status: z.enum(["Draft", "Posted", "Voided"]).nullable().optional(),
    employeeId: z.string().nullable().optional()
  }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getReimbursements(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * The payments that settle a reimbursement, for its Documents panel
 *
 * @mcp read
 */
export const getReimbursementRelatedItems = defineServiceFn({
  input: z.looseObject({ reimbursementId: z.string() }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return await service.getReimbursementRelatedItems(
      ctx.asCaller.supabase,
      ctx.company.id,
      input.reimbursementId as never
    );
  }
});

/**
 * Get invoice settlements
 *
 * @mcp read
 */
export const getInvoiceSettlements = defineServiceFn({
  input: z.looseObject({ paymentId: z.string() }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getInvoiceSettlements(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.paymentId as never
      )
    );
  }
});

/**
 * Get invoice settlements for invoice
 *
 * @mcp read
 */
export const getInvoiceSettlementsForInvoice = defineServiceFn({
  input: z.looseObject({
    side: z.enum(["sales", "purchase"]),
    invoiceId: z.string()
  }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getInvoiceSettlementsForInvoice(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.side as never,
        input.invoiceId as never
      )
    );
  }
});

/**
 * Get memo applications
 *
 * @mcp read
 */
export const getMemoApplications = defineServiceFn({
  input: z.looseObject({ memoId: z.string() }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getMemoApplications(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.memoId as never
      )
    );
  }
});

/**
 * Get open sales invoices for customer
 *
 * @mcp read
 */
export const getOpenSalesInvoicesForCustomer = defineServiceFn({
  input: z.looseObject({
    customerId: z.string(),
    currencyCode: z.string().optional()
  }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getOpenSalesInvoicesForCustomer(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.customerId as never,
        input.currencyCode as never
      )
    );
  }
});

/**
 * Get open purchase invoices for supplier
 *
 * @mcp read
 */
export const getOpenPurchaseInvoicesForSupplier = defineServiceFn({
  input: z.looseObject({
    supplierId: z.string(),
    currencyCode: z.string().optional()
  }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getOpenPurchaseInvoicesForSupplier(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.supplierId as never,
        input.currencyCode as never
      )
    );
  }
});

/**
 * Posted reimbursements an employee is still owed money on.
 *
 * @remarks
 * The apply table's target list when a payment's payee is an employee, and the
 * balance the Pay expense modal defaults to. A read only: posting a payment
 * locks and checks the reimbursements again.
 *
 * @mcp read
 */
export const getOpenReimbursementsForEmployee = defineServiceFn({
  input: z.looseObject({
    employeeId: z.string(),
    currencyCode: z.string().optional()
  }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getOpenReimbursementsForEmployee(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.employeeId as never,
        input.currencyCode as never
      )
    );
  }
});

/**
 * Get payment currency configuration
 *
 * @mcp read
 */
export const getPaymentCurrencyConfiguration = defineServiceFn({
  input: z.looseObject({ currencyCode: z.string() }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return await service.getPaymentCurrencyConfiguration(
      ctx.asCaller.supabase,
      ctx.company.id,
      input.currencyCode as never
    );
  }
});

/**
 * Get available on account credit sources
 *
 * @mcp read
 */
export const getAvailableOnAccountCreditSources = defineServiceFn({
  input: z.looseObject({
    party: z.union([
      z.looseObject({
        paymentType: z.literal("Receipt"),
        customerId: z.string()
      }),
      z.looseObject({
        paymentType: z.literal("Disbursement"),
        supplierId: z.string()
      })
    ]),
    currencyCode: z.string()
  }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getAvailableOnAccountCreditSources(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input.party).build() as never,
        input.currencyCode as never
      )
    );
  }
});

/**
 * Update a payment
 *
 * @remarks
 * Upsert payment
 *
 * @mcp
 */
export const updatePayment = defineServiceFn({
  input: z
    .looseObject({
      paymentType: z.enum(["Receipt", "Disbursement"]),
      customerId: z.string().optional(),
      supplierId: z.string().optional(),
      employeeId: z.string().optional(),
      paymentDate: z.string().min(1),
      currencyCode: z.string().min(1),
      exchangeRate: z
        .number()
        .gt(0)
        .describe(
          "Applied when creating; on update a field left out keeps its value."
        )
        .optional(),
      totalAmount: z.number().min(0),
      bankAccount: z.string().min(1),
      reference: z.string().optional(),
      memo: z.string().optional(),
      salesOrderId: z.string().optional(),
      rentalAgreementId: z.string().optional(),
      paymentId: z.string().optional(),
      customFields: z.unknown().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "invoicing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertPayment(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Delete payment
 *
 * @mcp destructive
 */
export const deletePayment = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "invoicing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deletePayment(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Replace invoice settlements
 *
 * @mcp destructive
 */
export const replaceInvoiceSettlements = defineServiceFn({
  input: z.looseObject({
    paymentId: z.string(),
    applications: z.array(
      z.looseObject({
        memoId: z.string().optional(),
        targetSalesInvoiceId: z.string().optional(),
        targetPurchaseInvoiceId: z.string().optional(),
        targetMemoId: z.string().optional(),
        targetReimbursementId: z.string().optional(),
        sourceAmount: z.number().min(0).optional(),
        appliedAmount: z.number().min(0).default(0),
        discountAmount: z.number().min(0).default(0),
        writeOffAmount: z.number().min(0).default(0),
        targetExchangeRate: z.number().gt(0),
        sourceExchangeRate: z.number().gt(0),
        appliedDate: z.string().min(1)
      })
    )
  }),
  permission: { update: "invoicing" },
  async run(ctx, input) {
    return await service.replaceInvoiceSettlements(
      ctx.asSystem.pg,
      payload(ctx, input).forCreate() as never
    );
  }
});

/**
 * Get memo
 *
 * @mcp read
 */
export const getMemo = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getMemo(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get memos
 *
 * @mcp read
 */
export const getMemos = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional(),
    direction: z.enum(["Credit", "Debit"]).nullable().optional(),
    status: z.enum(["Draft", "Posted", "Voided"]).nullable().optional(),
    counterpartyIds: z.array(z.string()).nullable().optional(),
    party: z.enum(["customer", "supplier"]).nullable().optional()
  }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getMemos(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Create a memo
 *
 * @remarks
 * Upsert memo
 *
 * @mcp
 */
export const createMemo = defineServiceFn({
  input: z.looseObject({
    direction: z.enum(["Credit", "Debit"]),
    customerId: z.string().optional(),
    supplierId: z.string().optional(),
    memoDate: z.string().min(1),
    currencyCode: z.string().min(1),
    exchangeRate: z
      .number()
      .gt(0)
      .default(1)
      .describe(
        "Applied when creating; on update a field left out keeps its value."
      ),
    amount: z.number().gt(0),
    reference: z.string().optional(),
    notes: z.string().optional(),
    memoId: z.string().optional(),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "invoicing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertMemo(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

/**
 * Update a memo
 *
 * @remarks
 * Upsert memo
 *
 * @mcp
 */
export const updateMemo = defineServiceFn({
  input: z
    .looseObject({
      direction: z.enum(["Credit", "Debit"]),
      customerId: z.string().optional(),
      supplierId: z.string().optional(),
      memoDate: z.string().min(1),
      currencyCode: z.string().min(1),
      exchangeRate: z
        .number()
        .gt(0)
        .describe(
          "Applied when creating; on update a field left out keeps its value."
        )
        .optional(),
      amount: z.number().gt(0),
      reference: z.string().optional(),
      notes: z.string().optional(),
      memoId: z.string().optional(),
      customFields: z.unknown().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "invoicing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertMemo(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Get available credits for party
 *
 * @mcp read
 */
export const getAvailableCreditsForParty = defineServiceFn({
  input: z.looseObject({
    party: z.union([
      z.looseObject({ side: z.literal("sales"), customerId: z.string() }),
      z.looseObject({ side: z.literal("purchase"), supplierId: z.string() })
    ]),
    excludePaymentId: z.string().optional(),
    currencyCode: z.string().optional()
  }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getAvailableCreditsForParty(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input.party).build() as never,
        input.excludePaymentId as never,
        input.currencyCode as never
      )
    );
  }
});

/**
 * Get company has open credits
 *
 * @mcp read
 */
export const getCompanyHasOpenCredits = defineServiceFn({
  input: z.looseObject({ side: z.enum(["sales", "purchase"]) }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return await service.getCompanyHasOpenCredits(
      ctx.asCaller.supabase,
      ctx.company.id,
      input.side as never
    );
  }
});

/**
 * Get staged credits for payment
 *
 * @mcp read
 */
export const getStagedCreditsForPayment = defineServiceFn({
  input: z.looseObject({
    paymentId: z.string(),
    side: z.enum(["sales", "purchase"])
  }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getStagedCreditsForPayment(
        ctx.asCaller.supabase,
        input.paymentId as never,
        input.side as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Apply credits to invoices
 *
 * @mcp destructive
 */
export const applyCreditsToInvoices = defineServiceFn({
  input: z.looseObject({
    paymentId: z.string(),
    appliedDate: z.string(),
    side: z.enum(["sales", "purchase"]),
    applications: z.array(
      z.looseObject({
        memoId: z.string(),
        invoiceId: z.string(),
        amount: z.number(),
        sourceAmount: z.number().optional()
      })
    )
  }),
  permission: { update: "invoicing" },
  async run(ctx, input) {
    return await service.applyCreditsToInvoices(
      ctx.asSystem.pg,
      payload(ctx, input).forCreate() as never
    );
  }
});

/**
 * Get ar tie out
 *
 * @mcp read
 */
export const getArTieOut = defineServiceFn({
  input: z.looseObject({ asOfDate: z.string() }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getArTieOut(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.asOfDate as never
      )
    );
  }
});

/**
 * Get ap tie out
 *
 * @mcp read
 */
export const getApTieOut = defineServiceFn({
  input: z.looseObject({ asOfDate: z.string() }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getApTieOut(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.asOfDate as never
      )
    );
  }
});

/**
 * Get ar open by customer
 *
 * @mcp read
 */
export const getArOpenByCustomer = defineServiceFn({
  input: z.looseObject({ asOfDate: z.string() }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getArOpenByCustomer(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.asOfDate as never
      )
    );
  }
});

/**
 * Get ap open by supplier
 *
 * @mcp read
 */
export const getApOpenBySupplier = defineServiceFn({
  input: z.looseObject({ asOfDate: z.string() }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getApOpenBySupplier(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.asOfDate as never
      )
    );
  }
});

/**
 * Get ar aging
 *
 * @mcp read
 */
export const getArAging = defineServiceFn({
  input: z.looseObject({
    asOfDate: z.string(),
    options: z
      .looseObject({
        agingMethod: z.enum(["dueDate", "documentDate"]).optional(),
        bucketDays: z.array(z.number()).nullable().optional()
      })
      .optional()
  }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getArAging(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.asOfDate as never,
        payload(ctx, input.options).build() as never
      )
    );
  }
});

/**
 * Get ap aging
 *
 * @mcp read
 */
export const getApAging = defineServiceFn({
  input: z.looseObject({
    asOfDate: z.string(),
    options: z
      .looseObject({
        agingMethod: z.enum(["dueDate", "documentDate"]).optional(),
        bucketDays: z.array(z.number()).nullable().optional()
      })
      .optional()
  }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getApAging(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.asOfDate as never,
        payload(ctx, input.options).build() as never
      )
    );
  }
});
