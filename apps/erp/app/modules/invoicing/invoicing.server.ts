// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { defineServiceFn } from "@carbon/api/service-fn.server";
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
import {
  adjustTieOut,
  checkDepositDocument,
  deleteMemo as deleteMemoRow,
  fieldUpdate,
  fromServerFn,
  getMemo,
  getOpenReimbursementsForEmployee,
  getPaymentCurrencyConfiguration,
  getPurchaseInvoice,
  insertPurchaseInvoice,
  invoker,
  linesBalanceHeader,
  loadReimbursement,
  partyCurrency,
  preflightStripeSend,
  recordSalesInvoiceLineOutcome,
  refuseLockedInvoices,
  replaceInvoiceSettlements,
  type SalesRuleCheck,
  type StripeSendContext,
  salesInvoiceLineGate,
  salesInvoiceLineRow,
  seedPaymentApplications,
  sendPostedSalesInvoice,
  unlockedPurchaseInvoice,
  unlockedSalesInvoice,
  updateReimbursement as updateReimbursementRow,
  upsertPayment,
  upsertPurchaseInvoiceLine,
  upsertReimbursementLines,
  upsertSalesInvoiceLine,
  writeInvoiceField
} from "./invoicing.service";

const logger = getLogger("erp", "invoicing");

// Documents a customer payment can be a deposit for — or a refund of: every
// open sales order and Draft/Active rental agreement (a new deposit), plus
// every document a posted deposit receipt already references (a refund of a
// Closed agreement's deposit) and any ids the caller must keep listed. Loaded
// company-wide with the customer on each row because the form's customer can
// change before the payment is saved; the picker narrows to that customer.
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
  input: fieldUpdate(salesInvoiceFields),
  permission: { update: "sales" },

  async run(ctx, { ids, field, value }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const locked = await refuseLockedInvoices(
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
      const currency = await partyCurrency(ctx, "customer", value);
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

    return writeInvoiceField(ctx, "salesInvoice", { ids, field, value });
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
    const line = salesInvoiceLineRow(input);
    const locked = await unlockedSalesInvoice(
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
      const gate = await salesInvoiceLineGate(ctx, {
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

    const created = await upsertSalesInvoiceLine(ctx.asCaller.supabase, {
      ...line,
      companyId: ctx.company.id,
      createdBy: ctx.auditUserId,
      customFields
    });
    if (created.error) {
      return ctx.error(
        "internal",
        "Failed to create sales invoice line.",
        created.error
      );
    }

    if (line.itemId && check.violations.length > 0) {
      await recordSalesInvoiceLineOutcome(
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
    const line = salesInvoiceLineRow(input);
    const refused = await refuseUnlessOwned(ctx, "salesInvoiceLine", {
      id,
      invoiceId: line.invoiceId
    });
    if (refused) return refused;
    const locked = await unlockedSalesInvoice(
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
      const gate = await salesInvoiceLineGate(ctx, {
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

    const updated = await upsertSalesInvoiceLine(ctx.asCaller.supabase, {
      id,
      ...line,
      updatedBy: ctx.auditUserId,
      customFields
    });
    if (updated.error) {
      return ctx.error(
        "internal",
        "Failed to update sales invoice line",
        updated.error
      );
    }

    if (line.itemId && check.violations.length > 0) {
      await recordSalesInvoiceLineOutcome(
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
    const locked = await unlockedSalesInvoice(
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
    const locked = await unlockedSalesInvoice(
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

    const voided = await invoker(ctx).invoke("post-sales-invoice", {
      type: "void",
      invoiceId
    });
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
  permission: { create: "invoicing" },

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
      const preflight = await preflightStripeSend(ctx, {
        invoiceId,
        customerContact,
        stripeCustomerAction: input.stripeCustomerAction,
        stripeCustomerId: input.stripeCustomerId,
        stripeContactEmail: input.stripeContactEmail
      }).catch(
        (err: unknown) =>
          ({
            ok: false,
            message:
              err instanceof Error ? err.message : "the Stripe preflight failed"
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

    const posted = await invoker(ctx).invoke("post-sales-invoice", {
      invoiceId
    });
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
    const warning = await sendPostedSalesInvoice(ctx, {
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

    const result = await insertPurchaseInvoice(client, {
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
        upsertPurchaseInvoiceLine(client, {
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
          const created = await getPurchaseInvoice(client, id);
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
  input: fieldUpdate(purchaseInvoiceFields),
  permission: { update: "sales" },

  async run(ctx, { ids, field, value }) {
    const locked = await refuseLockedInvoices(
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
      const currency = await partyCurrency(ctx, "supplier", value);
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

    return writeInvoiceField(ctx, "purchaseInvoice", { ids, field, value });
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
      const posted = await invoker(ctx).invoke("post-purchase-invoice", {
        invoiceId,
        skipReceiptPost
      });
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
        const prices = await invoker(ctx).invoke("update-purchased-prices", {
          invoiceId,
          source: "purchaseInvoice",
          updatePrices: true,
          updateLeadTimes: false
        });
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

    const voided = await invoker(ctx).invoke("post-purchase-invoice", {
      type: "void",
      invoiceId
    });
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
    const locked = await unlockedPurchaseInvoice(
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
    const locked = await unlockedPurchaseInvoice(
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
    const depositError = await checkDepositDocument(client, companyId, payment);
    if (depositError) return ctx.error("validation", depositError);

    try {
      await getPaymentCurrencyConfiguration(
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

    const inserted = await upsertPayment(client, {
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
        await seedPaymentApplications(ctx, {
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
    const posted = await invoker(ctx).invoke("post-payment", {
      type: "post",
      paymentId
    });
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
    const voided = await invoker(ctx).invoke("post-payment", {
      type: "void",
      paymentId
    });
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
    const posted = await invoker(ctx).invoke("post-memo", {
      type: "post",
      memoId
    });
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
    const voided = await invoker(ctx).invoke("post-memo", {
      type: "void",
      memoId
    });
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
    const memo = await getMemo(client, memoId, companyId);
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

    const removed = await deleteMemoRow(client, memoId, companyId);
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
    const voided = await invoker(ctx).invoke("post-charge", {
      type: "void",
      chargeId
    });
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
  run: (ctx, { asOfDate }) => adjustTieOut(ctx, "receivables", asOfDate)
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
  run: (ctx, { asOfDate }) => adjustTieOut(ctx, "payables", asOfDate)
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
    const existing = await loadReimbursement(ctx, header.id);
    if (existing instanceof Error) return existing;
    // A readable refusal beats the raw 55000 the draft guard trigger raises.
    if (existing.status !== "Draft") {
      return ctx.error("rule", "A posted reimbursement cannot be edited");
    }

    const updated = await updateReimbursementRow(ctx.asCaller.supabase, {
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
      await upsertReimbursementLines(ctx.asSystem.pg, {
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
      !linesBalanceHeader(
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
    const reimbursement = await loadReimbursement(ctx, reimbursementId);
    if (reimbursement instanceof Error) return reimbursement;
    if (reimbursement.status !== "Draft") {
      return ctx.error("rule", "Only a Draft reimbursement can be posted");
    }
    // Checked here, with a readable message, before the server function.
    const lines = reimbursement.reimbursementLine ?? [];
    if (
      !linesBalanceHeader(
        Number(reimbursement.amount),
        lines.map((line) => Number(line.amount))
      )
    ) {
      return ctx.error("rule", REIMBURSEMENT_UNBALANCED_MESSAGE);
    }

    const posted = await invoker(ctx).invoke("post-reimbursement", {
      type: "post",
      reimbursementId
    });
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
    const voided = await invoker(ctx).invoke("post-reimbursement", {
      type: "void",
      reimbursementId
    });
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

    const reimbursement = await loadReimbursement(ctx, reimbursementId);
    if (reimbursement instanceof Error) return reimbursement;
    if (reimbursement.status !== "Posted") {
      return ctx.error("rule", "Only a posted reimbursement can be paid");
    }

    // The modal's default came from a loader that may be minutes old, and
    // a second payout must not overdraw the payable.
    const open = await getOpenReimbursementsForEmployee(
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
      await getPaymentCurrencyConfiguration(
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
    const payment = await upsertPayment(client, {
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
      await replaceInvoiceSettlements(ctx.asSystem.pg, {
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

    const posted = await invoker(ctx).invoke("post-payment", {
      type: "post",
      paymentId
    });
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
