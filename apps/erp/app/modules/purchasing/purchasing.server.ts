// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { CarbonError, defineServiceFn } from "@carbon/api/service-fn.server";
import { type Database, getCompanyTimeZone, type Json } from "@carbon/database";
import {
  convertUnitPrice,
  supplierPartCurrency
} from "@carbon/database/supplier-part-price";
import { approvalDecisionValidator } from "@carbon/ee/approvals";
import {
  decideApprovalRequest,
  openApprovalRequests
} from "@carbon/ee/approvals/document.server";
import {
  approveRequest,
  canApproveRequest,
  createApprovalRequest,
  getApprovalRuleByAmount,
  getApproverUserIdsForRule,
  getLatestApprovalRequestForDocument,
  getLowerTierApproverUserIds,
  hasPendingApproval,
  isApprovalRequired,
  rejectRequest
} from "@carbon/ee/approvals.server";
import { storage } from "@carbon/files";
import { trigger } from "@carbon/jobs";
import { checkPartyContactRequirement } from "@carbon/lib/party-contact.server";
import { trackWorkEvent } from "@carbon/lib/telemetry";
import { getLogger } from "@carbon/logger";
import { NotificationEvent } from "@carbon/notifications";
import type { JSONContent } from "@carbon/react";
import { serverFns } from "@carbon/server-functions";
import {
  applyRate,
  datetime,
  deriveRate,
  PO_EMAIL_ATTACHMENT_LIMIT_MB,
  SCALE,
  taxableBase,
  tiptapToHTML,
  unchecked
} from "@carbon/utils";
import { type CalendarDate, parseDate } from "@internationalized/date";
import { z } from "zod";
import { getExchangeRate } from "~/modules/accounting/accounting.service";
import { upsertDocument } from "~/modules/documents/documents.service";
import {
  assignPlanningActions,
  dismissPlanningActions,
  getPlanningActionsByIds,
  reopenDismissedPlanningActions,
  runMRP,
  settleNewSupplyPlanningActions
} from "~/modules/production/production.service";
import {
  getCompany,
  getCompanySettings
} from "~/modules/settings/settings.service";
import {
  getLocationTimeZone,
  isActiveCompanyEmployee,
  refuseUnlessOwned
} from "~/modules/shared/shared.service";
import { getUser } from "~/modules/users/users.service";
import { ERP_URL, path } from "~/utils/path";
import { stripSpecialCharacters } from "~/utils/string";
import {
  canCreatePurchaseOrderRevision,
  findPlanningPurchaseOrder,
  isPurchaseOrderEditableFromPlanning,
  isPurchaseOrderLocked,
  isPurchaseReturnOrderLocked,
  isRfqLocked,
  isSupplierQuoteLocked,
  leaseClassificationValidator,
  leaseModifyValidator,
  leasePurchaseValidator,
  leaseTerminateValidator,
  lockedReturnLineField,
  PURCHASE_ORDER_REOPEN_STATUSES,
  plannedOrderValidator,
  planningPurchaseOrderWeek,
  purchaseOrderDeleteRefusal,
  purchaseReturnOrderLineValidator,
  purchasingRfqFinalizeValidator,
  purchasingRfqValidator,
  selectedLineSchema,
  supplierQuoteFinalizeValidator,
  taxPairForQuantity
} from "./purchasing.models";
import { renderPurchaseReturnOrderPdf } from "./purchasing.pdf";
import {
  applyPurchasingPlanningActions,
  attachPurchaseOrderPdf,
  cancelPendingApprovals,
  cancelPurchaseReturnOrder,
  confirmPurchaseReturnOrder,
  deduplicateForecasts,
  finalizePurchaseOrder,
  fromServerFn,
  getDefaultAttachmentsForPO,
  getLinkedSupplierQuotes,
  getPurchaseOrder,
  getPurchaseReturnOrder,
  getPurchasingRFQ,
  getPurchasingRFQLines,
  getReturnableEntitiesForReceiptLine,
  getSupplier,
  getSupplierContact,
  getSupplierInteractionLineAttachments,
  getSupplierQuote,
  getSupplierQuoteLines,
  insertPurchaseOrder,
  insertPurchasingRFQ,
  interactionAttachments,
  kilobytes,
  postLease,
  promisedDateOf,
  purchaseOrderEmail,
  refusedBy,
  releaseApprovedPurchaseOrder,
  reopenPurchaseOrderAsRevision,
  reopenPurchaseReturnOrder,
  sendSupplierQuote,
  setPurchaseReturnOrderLineTrackedEntities,
  sharedSupplierQuote,
  signedAttachments,
  statusesOf,
  supplierQuoteLink,
  updatePricesOnFinalize,
  updatePurchaseOrderLineSchedule,
  updatePurchaseOrderStatus,
  updatePurchasingRFQStatus,
  upsertPurchaseOrderLine,
  upsertPurchaseReturnOrderLine,
  upsertPurchasingRFQSuppliers,
  worklistChange,
  writeClassificationOverride
} from "./purchasing.service";

// ── Operations ──────────────────────────────────────────────────────────────
// `defineServiceFn` operations: what the routes, the API and MCP call, so each
// holds every check its button made. Listed by entity in `index.server.ts`.

const logger = getLogger("erp", "purchasing");

/** Custom field values, as `setCustomFields` reads them from a form. */
const customFieldsInput = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean()])
);
// ── RFQs ────────────────────────────────────────────────────────────────────

/**
 * Create a request for quotation.
 *
 * @remarks
 * Creates the RFQ, numbered from the `purchasingRfq` sequence unless `rfqId`
 * is given, then invites `supplierIds`. The two writes are separate: when the
 * suppliers cannot be saved, the RFQ exists without them and the error says
 * so.
 *
 * @mcp
 */
export const createPurchasingRfq = defineServiceFn({
  input: purchasingRfqValidator
    .omit({ id: true })
    .extend({ customFields: customFieldsInput.optional() }),
  permission: { create: "purchasing" },

  async run(ctx, { supplierIds, ...rfq }) {
    const companyId = ctx.company.id;
    const created = await insertPurchasingRFQ(ctx.asCaller.supabase, {
      ...rfq,
      rfqId: rfq.rfqId || undefined,
      companyId,
      createdBy: ctx.auditUserId
    });
    if (created.error || !created.data) {
      return ctx.error("internal", "Failed to insert RFQ", created.error);
    }

    const suppliers = await upsertPurchasingRFQSuppliers(
      ctx.asCaller.supabase,
      created.data.id,
      supplierIds,
      companyId,
      ctx.auditUserId
    );
    if (suppliers.error) {
      return ctx.error(
        "internal",
        "Failed to assign suppliers",
        suppliers.error
      );
    }
    return { id: created.data.id, rfqId: created.data.rfqId };
  }
});

const rfqDateFields = [
  "employeeId",
  "expirationDate",
  "locationId",
  "rfqDate"
] as const;

/**
 * Change one field of RFQs.
 *
 * @remarks
 * The RFQ properties panel's edit. `employeeId`, `expirationDate`,
 * `locationId` and `rfqDate` take one value (null clears it); `supplierIds`
 * replaces the invited suppliers of every RFQ. Refused when any of the RFQs is
 * locked (Requested or Closed).
 *
 * @mcp
 */
export const updatePurchasingRfqs = defineServiceFn({
  input: z.discriminatedUnion("field", [
    z.object({
      ids: z.array(z.string()).min(1),
      field: z.enum(rfqDateFields),
      value: z.string().nullable()
    }),
    z.object({
      ids: z.array(z.string()).min(1),
      field: z.literal("supplierIds"),
      value: z.array(z.string())
    })
  ]),
  permission: { update: "purchasing" },

  async run(ctx, input) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const statuses = await statusesOf(ctx, "purchasingRfq", input.ids);
    if (statuses instanceof CarbonError) return statuses;
    if (statuses.some(isRfqLocked)) {
      return ctx.error("rule", "Cannot modify a locked RFQ.");
    }

    if (input.field === "supplierIds") {
      const removed = await client
        .from("purchasingRfqSupplier")
        .delete()
        .in("purchasingRfqId", input.ids)
        .eq("companyId", companyId);
      if (removed.error) {
        return ctx.error(
          "internal",
          "Failed to update suppliers",
          removed.error
        );
      }
      if (input.value.length === 0) return { ids: input.ids };
      const added = await client.from("purchasingRfqSupplier").insert(
        input.ids.flatMap((purchasingRfqId) =>
          input.value.map((supplierId) => ({
            purchasingRfqId,
            supplierId,
            companyId,
            createdBy: ctx.auditUserId
          }))
        )
      );
      if (added.error) {
        return ctx.error("internal", "Failed to update suppliers", added.error);
      }
      return { ids: input.ids };
    }

    const update = await client
      .from("purchasingRfq")
      .update(
        unchecked({
          [input.field]: input.value || null,
          updatedBy: ctx.auditUserId,
          updatedAt: datetime.timestamp()
        })
      )
      .in("id", input.ids)
      .eq("companyId", companyId);
    if (update.error) {
      return ctx.error("internal", "Failed to update the RFQ", update.error);
    }
    return { ids: input.ids };
  }
});

/**
 * Cancel an RFQ.
 *
 * @remarks
 * Closes the RFQ, clears its assignee, and cancels every supplier quote it
 * raised. A failure to cancel the quotes is logged; the RFQ stays Closed.
 *
 * @mcp destructive
 */
export const cancelPurchasingRfq = defineServiceFn({
  input: z.object({ rfqId: z.string() }),
  permission: { update: "purchasing" },

  async run(ctx, { rfqId }) {
    const client = ctx.asCaller.supabase;
    const update = await updatePurchasingRFQStatus(client, {
      id: rfqId,
      status: "Closed",
      assignee: null,
      updatedBy: ctx.auditUserId
    });
    if (update.error) {
      return ctx.error("internal", "Failed to cancel RFQ", update.error);
    }

    const linked = await getLinkedSupplierQuotes(client, rfqId);
    const quoteIds = (linked.data ?? []).map((link) => link.supplierQuoteId);
    if (quoteIds.length > 0) {
      const quotes = await client
        .from("supplierQuote")
        .update({ status: "Cancelled", updatedBy: ctx.auditUserId })
        .in("id", quoteIds)
        .eq("companyId", ctx.company.id);
      if (quotes.error) {
        logger.error("Failed to cancel the RFQ's supplier quotes", {
          companyId: ctx.company.id,
          rfqId,
          error: quotes.error
        });
      }
    }
    return { rfqId };
  }
});

/**
 * Send an RFQ to its suppliers.
 *
 * @remarks
 * Creates one supplier quote per invited supplier, with the RFQ's lines and a
 * share link, and marks the RFQ Requested, in one transaction
 * (`finalize-purchasing-rfq`, which refuses an RFQ that is not Draft). Then,
 * for each supplier with a `contactId`, emails the contact the quote's link
 * with the RFQ's documents and internal notes attached; a failed email is
 * logged and the rest still go. Refused when the RFQ has no lines.
 *
 * @mcp
 */
export const finalizePurchasingRfqAndNotify = defineServiceFn({
  input: purchasingRfqFinalizeValidator.extend({ rfqId: z.string() }),
  permission: { create: "purchasing" },

  async run(ctx, { rfqId, suppliers }) {
    const client = ctx.asSystem.supabase;
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;

    const owned = await refuseUnlessOwned(ctx, "purchasingRfq", { id: rfqId });
    if (owned) return owned;

    const [rfq, lines] = await Promise.all([
      getPurchasingRFQ(client, rfqId),
      getPurchasingRFQLines(client, rfqId)
    ]);
    if (rfq.error)
      return ctx.error("internal", "Failed to load RFQ", rfq.error);
    if (lines.error) {
      return ctx.error("internal", "Failed to load RFQ lines", lines.error);
    }
    if ((lines.data ?? []).length === 0) {
      return ctx.error("rule", "No line items found for this RFQ");
    }

    const [company, user] = await Promise.all([
      getCompany(client, companyId),
      getUser(client, userId)
    ]);

    const finalize = await serverFns
      .system({ db: ctx.asSystem.pg, companyId, userId })
      .invoke("finalize-purchasing-rfq", { rfqId });
    if (finalize.error) {
      return fromServerFn(
        ctx,
        finalize.error,
        "Failed to create supplier quotes"
      );
    }
    const quotes = finalize.data.quotes;

    const contactIdBySupplier = new Map(
      suppliers.flatMap((s) =>
        s.contactId ? [[s.supplierId, s.contactId] as const] : []
      )
    );
    const contacts = contactIdBySupplier.size
      ? await client
          .from("supplierContact")
          .select("id, contact(email, firstName)")
          .in("id", [...contactIdBySupplier.values()])
          .eq("companyId", companyId)
      : null;
    const contactById = new Map(
      (contacts?.data ?? []).map((row) => [row.id, row.contact])
    );
    const emails = quotes.flatMap((quote) => {
      const contactId = contactIdBySupplier.get(quote.supplierId);
      const contact = contactId ? contactById.get(contactId) : undefined;
      return contact?.email
        ? [
            {
              to: contact.email,
              firstName: contact.firstName ?? "there",
              quoteReadableId: quote.supplierQuoteId,
              externalLinkId: quote.externalLinkId
            }
          ]
        : [];
    });

    if (emails.length > 0 && company.data && user.data) {
      const attachments = [
        ...(await interactionAttachments(client, companyId, rfqId)),
        ...(await getSupplierInteractionLineAttachments(
          client,
          companyId,
          (lines.data ?? []).flatMap((line) => (line.id ? [line.id] : []))
        ))
      ];
      const notesHtml = tiptapToHTML(
        (rfq.data?.internalNotes ?? {}) as JSONContent
      );

      for (const email of emails) {
        try {
          const link = `${ERP_URL}${path.to.externalSupplierQuote(email.externalLinkId)}`;
          const body = `Hey ${email.firstName},\n\nPlease provide pricing and lead time(s) for the linked quote:`;
          const signature = `Thanks,\n${user.data.firstName} ${user.data.lastName}\n${company.data.name}`;
          await trigger("send-email", {
            to: [user.data.email, email.to],
            from: user.data.email,
            subject: `Supplier Quote ${email.quoteReadableId} from ${company.data.name}`,
            html: [
              body.replace(/\n/g, "<br>"),
              `<br><a href="${link}">${link}</a>`,
              notesHtml ? `<br><br>${notesHtml}` : "",
              `<br><br>${signature.replace(/\n/g, "<br>")}`
            ].join(""),
            text: `${body}\n\n${link}\n\n${signature}`,
            attachments,
            companyId
          });
        } catch (err) {
          logger.error("Failed to send email", { error: err });
        }
      }
    }

    return { quotesCreated: quotes.length, emailsSent: emails.length };
  }
});

// ── Supplier quotes ─────────────────────────────────────────────────────────

const supplierQuoteTextFields = [
  "supplierContactId",
  "supplierLocationId",
  "supplierReference",
  "quotedDate"
] as const;

/**
 * Change one field of supplier quotes.
 *
 * @remarks
 * The supplier quote properties panel's edit; `value` null clears the field.
 * A new `supplierId` on one quote takes the supplier's currency. A new
 * `currencyCode` takes today's exchange rate (refused when there is none).
 * A new `expirationDate` (`YYYY-MM-DD`) sets the quote Expired when it is
 * before today on the company's calendar, else Active. Refused when any of
 * the quotes is locked.
 *
 * @mcp
 */
export const updateSupplierQuotes = defineServiceFn({
  input: z.object({
    ids: z.array(z.string()).min(1),
    field: z.enum([
      "supplierId",
      "currencyCode",
      "expirationDate",
      ...supplierQuoteTextFields
    ]),
    value: z.string().nullable()
  }),
  permission: { update: "purchasing" },

  async run(ctx, { ids, field, value }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const statuses = await statusesOf(ctx, "supplierQuote", ids);
    if (statuses instanceof CarbonError) return statuses;
    if (statuses.some(isSupplierQuoteLocked)) {
      return ctx.error(
        "rule",
        "Cannot modify a locked supplier quote. Reopen it first."
      );
    }

    const write = (
      patch: Database["public"]["Tables"]["supplierQuote"]["Update"]
    ) =>
      client
        .from("supplierQuote")
        .update({
          ...patch,
          updatedBy: ctx.auditUserId,
          updatedAt: datetime.timestamp()
        })
        .in("id", ids)
        .eq("companyId", companyId);

    let patch: Database["public"]["Tables"]["supplierQuote"]["Update"];
    if (field === "supplierId") {
      patch = { supplierId: value ?? undefined };
      if (value && ids.length === 1) {
        const supplier = await client
          .from("supplier")
          .select("currencyCode")
          .eq("id", value)
          .single();
        if (supplier.data?.currencyCode) {
          patch.currencyCode = supplier.data.currencyCode;
        }
      }
    } else if (field === "currencyCode" && value) {
      const rate = await getExchangeRate(client, companyId, value);
      if (rate.error) {
        return ctx.error("rule", rate.error.message, rate.error);
      }
      patch = { currencyCode: value, exchangeRate: rate.data };
    } else if (field === "expirationDate") {
      let expirationDate: CalendarDate | null = null;
      if (value) {
        try {
          expirationDate = parseDate(value);
        } catch {
          return ctx.error("validation", "Invalid expiration date");
        }
      }
      // Expiry is judged on the company's calendar — one set of books, one
      // "today" — not the server's or the editing user's.
      const today = datetime.today(await getCompanyTimeZone(client, companyId));
      patch = {
        status:
          expirationDate && today.compare(expirationDate) > 0
            ? "Expired"
            : "Active",
        expirationDate: expirationDate ? expirationDate.toString() : null
      };
    } else {
      patch = unchecked({ [field]: value ? value : null });
    }

    const update = await write(patch);
    if (update.error) {
      return ctx.error("internal", "Failed to update the quote", update.error);
    }
    return { ids };
  }
});
/**
 * Finalize a supplier quote.
 *
 * @remarks
 * Refused when the company requires a reachable supplier contact and the
 * supplier has none. Makes sure the quote has a share link, then
 * (`finalize-supplier-quote`, one transaction) checks every line is priced,
 * marks the quote Active and writes the supplier's price list.
 *
 * @mcp
 */
export const finalizeSupplierQuoteWithLink = defineServiceFn({
  input: z.object({ supplierQuoteId: z.string() }),
  permission: { create: "purchasing" },

  async run(ctx, { supplierQuoteId }) {
    const client = ctx.asSystem.supabase;
    const companyId = ctx.company.id;

    const owned = await refuseUnlessOwned(ctx, "supplierQuote", {
      id: supplierQuoteId
    });
    if (owned) return owned;

    const quote = await getSupplierQuote(client, supplierQuoteId);
    if (quote.error) {
      return ctx.error("internal", "Failed to get supplier quote", quote.error);
    }

    // A supplier with no reachable contact cannot be created as a vendor at
    // a connected platform, so its documents are rejected there long after
    // anyone is watching. No-op unless the company has turned it on.
    const contactRule = await checkPartyContactRequirement(client, companyId, {
      kind: "supplier",
      id: quote.data.supplierId
    });
    if (contactRule) return ctx.error("rule", contactRule);

    const link = await supplierQuoteLink(ctx, {
      ...quote.data,
      id: supplierQuoteId
    });
    if (link instanceof CarbonError) return link;

    const finalize = await serverFns
      .system({ db: ctx.asSystem.pg, companyId, userId: ctx.auditUserId })
      .invoke("finalize-supplier-quote", { supplierQuoteId });
    if (finalize.error) {
      return fromServerFn(
        ctx,
        finalize.error,
        "Failed to finalize supplier quote"
      );
    }
    return { supplierQuoteId };
  }
});

/**
 * Send a supplier quote to the supplier.
 *
 * @remarks
 * Makes sure the quote has a share link and stamps it sent; the status stays
 * as it is. With `notification` Email, emails `supplierContact` (required
 * then) the link, copying `cc`, with the interaction's and the lines'
 * documents attached. Share sends nothing: the link is shared by hand.
 *
 * @mcp
 */
export const sendSupplierQuoteToSupplier = defineServiceFn({
  input: supplierQuoteFinalizeValidator.safeExtend({
    supplierQuoteId: z.string()
  }),
  permission: { create: "purchasing" },

  async run(ctx, { supplierQuoteId, notification, supplierContact, cc }) {
    const client = ctx.asSystem.supabase;
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;

    const owned = await refuseUnlessOwned(ctx, "supplierQuote", {
      id: supplierQuoteId
    });
    if (owned) return owned;

    const quote = await getSupplierQuote(client, supplierQuoteId);
    if (quote.error) {
      return ctx.error("internal", "Failed to get supplier quote", quote.error);
    }

    const link = await supplierQuoteLink(ctx, {
      ...quote.data,
      id: supplierQuoteId
    });
    if (link instanceof CarbonError) return link;

    const send = await sendSupplierQuote(client, supplierQuoteId, userId);
    if (send.error) {
      return ctx.error("internal", "Failed to send supplier quote", send.error);
    }

    if (notification !== "Email") return { supplierQuoteId };
    if (!supplierContact) {
      return ctx.error("validation", "Supplier contact is required for email");
    }

    const [company, contact, user, lines] = await Promise.all([
      getCompany(client, companyId),
      getSupplierContact(client, supplierContact, companyId),
      getUser(client, userId),
      getSupplierQuoteLines(client, supplierQuoteId)
    ]);
    if (!company.data || !contact.data?.contact || !user.data) {
      return ctx.error(
        "internal",
        "Failed to send email",
        company.error ?? contact.error ?? user.error
      );
    }

    const interactionId = quote.data.supplierInteractionId;
    const attachments = [
      ...(interactionId
        ? await interactionAttachments(client, companyId, interactionId)
        : []),
      ...(await getSupplierInteractionLineAttachments(
        client,
        companyId,
        (lines.data ?? []).flatMap((line) => (line.id ? [line.id] : []))
      ))
    ];

    const url = `${ERP_URL}${path.to.externalSupplierQuote(link)}`;
    const body = `Hey ${
      contact.data.contact.firstName || "there"
    },\n\nPlease provide pricing and lead time(s) for the linked quote:`;
    const signature = `Thanks,\n${user.data.firstName} ${user.data.lastName}\n${company.data.name}`;
    try {
      await trigger("send-email", {
        to: [user.data.email, contact.data.contact.email].filter(
          Boolean
        ) as string[],
        cc: cc?.length ? cc : undefined,
        from: user.data.email,
        subject: `Supplier Quote ${quote.data.supplierQuoteId} from ${company.data.name}`,
        html: `${body.replace(/\n/g, "<br>")}<br><a href="${url}">${url}</a><br><br>${signature.replace(/\n/g, "<br>")}`,
        text: `${body}\n\n${url}\n\n${signature}`,
        attachments,
        companyId
      });
    } catch (err) {
      return ctx.error("internal", "Failed to send email", err);
    }
    return { supplierQuoteId };
  }
});

// ── Supplier quote share link ────────────────────────────────────────────────
// The supplier answers through the quote's share link, which is the only
// credential: these run as the system, in the quote's company, on behalf of
// the quote's creator (`shareLinkContext`).
const supplierResponder = {
  submittedBy: z.string().min(1),
  submittedByEmail: z.string().email()
};

/**
 * Record that the supplier opened a quote's share link.
 *
 * @remarks
 * Stamps the link's `lastAccessedAt`.
 */
export const recordSupplierQuoteLinkVisit = defineServiceFn({
  input: z.object({ externalLinkId: z.string() }),
  permission: "system",

  async run(ctx, { externalLinkId }) {
    const visited = await ctx.asSystem.supabase
      .from("externalLink")
      .update({ lastAccessedAt: datetime.timestamp() } as never)
      .eq("id", externalLinkId)
      .eq("companyId", ctx.company.id);
    if (visited.error) {
      return ctx.error("internal", "Failed to record the visit", visited.error);
    }
    return { externalLinkId };
  }
});

/**
 * The supplier submits prices from a quote's share link.
 *
 * @remarks
 * Every line must be the quote's. Writes the price of each selected quantity
 * (the tax rate derived from the amounts), sets the quote Active with who
 * submitted it, stamps the link, and notifies the company's supplier-quote
 * group. A failed notification is logged; the submission stands.
 */
export const submitDigitalSupplierQuote = defineServiceFn({
  input: z.object({
    supplierQuoteId: z.string(),
    ...supplierResponder,
    selectedLines: z.record(
      z.string(),
      z.record(z.string(), selectedLineSchema)
    )
  }),
  permission: "system",

  async run(
    ctx,
    { supplierQuoteId, submittedBy, submittedByEmail, selectedLines }
  ) {
    const client = ctx.asSystem.supabase;
    const companyId = ctx.company.id;
    const quote = await sharedSupplierQuote(ctx, supplierQuoteId);
    if (quote instanceof CarbonError) return quote;

    const prices = Object.entries(selectedLines).flatMap(
      ([lineId, byQuantity]) =>
        Object.entries(byQuantity).flatMap(([quantity, line]) =>
          Number(quantity) > 0 && line.quantity > 0
            ? [{ lineId, quantity: Number(quantity), line }]
            : []
        )
    );

    // The line ids come from the link's visitor and every write below runs as
    // the service role: each line must be this quote's.
    const lineIds = [...new Set(prices.map(({ lineId }) => lineId))];
    if (lineIds.length > 0) {
      const owned = await client
        .from("supplierQuoteLine")
        .select("id")
        .eq("supplierQuoteId", supplierQuoteId)
        .eq("companyId", companyId)
        .in("id", lineIds);
      if (owned.error) {
        return ctx.error(
          "internal",
          "Failed to read the quote lines",
          owned.error
        );
      }
      if (owned.data.length !== lineIds.length) {
        return ctx.error("validation", "Invalid selected lines data");
      }
    }

    const existing =
      lineIds.length > 0
        ? await client
            .from("supplierQuoteLinePrice")
            .select("supplierQuoteLineId, quantity")
            .eq("supplierQuoteId", supplierQuoteId)
            .in("supplierQuoteLineId", lineIds)
        : { data: [], error: null };
    if (existing.error) {
      return ctx.error(
        "internal",
        "Failed to save quote prices",
        existing.error
      );
    }
    const stored = new Set(
      existing.data.map((row) => `${row.supplierQuoteLineId}:${row.quantity}`)
    );

    const now = datetime.timestamp();
    const userId = quote.createdBy;
    const writes = prices.map(({ lineId, quantity, line }) => {
      const fields = {
        supplierUnitPrice: line.supplierUnitPrice ?? 0,
        leadTime: line.leadTime ?? 0,
        supplierShippingCost: line.supplierShippingCost ?? 0,
        supplierTaxAmount: line.supplierTaxAmount ?? 0,
        // The share page collects amounts only: the rate is derived from the
        // canonical denominator (unit price × quantity + shipping).
        taxPercent: deriveRate(
          line.supplierTaxAmount ?? 0,
          taxableBase(
            line.supplierUnitPrice ?? 0,
            quantity,
            line.supplierShippingCost ?? 0
          )
        )
      };
      return stored.has(`${lineId}:${quantity}`)
        ? client
            .from("supplierQuoteLinePrice")
            .update({ ...fields, updatedAt: now, updatedBy: userId })
            .eq("supplierQuoteId", supplierQuoteId)
            .eq("supplierQuoteLineId", lineId)
            .eq("quantity", quantity)
        : client.from("supplierQuoteLinePrice").insert({
            ...fields,
            supplierQuoteId,
            supplierQuoteLineId: lineId,
            companyId,
            quantity,
            exchangeRate: quote.exchangeRate ?? 1,
            createdBy: userId
          });
    });
    // ponytail: one write per price, as the page always did; batch if quotes grow large.
    const failed = (await Promise.all(writes)).find((write) => write.error);
    if (failed?.error) {
      return ctx.error("internal", "Failed to save quote prices", failed.error);
    }

    const submitted = await client
      .from("supplierQuote")
      .update({
        status: "Active",
        updatedAt: now,
        externalNotes: {
          ...((quote.externalNotes as Record<string, unknown>) || {}),
          lastSubmittedBy: submittedBy,
          lastSubmittedByEmail: submittedByEmail,
          lastSubmittedAt: now
        }
      })
      .eq("id", supplierQuoteId)
      .eq("companyId", companyId);
    if (submitted.error) {
      return ctx.error(
        "internal",
        "Failed to submit the quote",
        submitted.error
      );
    }

    if (quote.externalLinkId) {
      await client
        .from("externalLink")
        .update({ submittedAt: now, submittedBy, submittedByEmail } as never)
        .eq("id", quote.externalLinkId)
        .eq("companyId", companyId);
    }

    const settings = await getCompanySettings(client, companyId);
    if (settings.error) {
      logger.error("Failed to get company settings", { error: settings.error });
    }
    const groupIds = settings.data?.supplierQuoteNotificationGroup ?? [];
    if (groupIds.length > 0) {
      try {
        await trigger("notify", {
          companyId,
          documentId: supplierQuoteId,
          event: NotificationEvent.SupplierQuoteResponse,
          recipient: { type: "group", groupIds }
        });
      } catch (err) {
        logger.error("Failed to trigger supplier quote notification", {
          error: err
        });
      }
    }

    return { supplierQuoteId };
  }
});

/**
 * The supplier declines a quote from its share link.
 *
 * @remarks
 * Sets the quote Declined with who declined it and their note, and stamps the
 * link.
 */
export const declineDigitalSupplierQuote = defineServiceFn({
  input: z.object({
    supplierQuoteId: z.string(),
    ...supplierResponder,
    note: z.string().optional()
  }),
  permission: "system",

  async run(ctx, { supplierQuoteId, submittedBy, submittedByEmail, note }) {
    const client = ctx.asSystem.supabase;
    const quote = await sharedSupplierQuote(ctx, supplierQuoteId);
    if (quote instanceof CarbonError) return quote;

    const now = datetime.timestamp();
    const declined = await client
      .from("supplierQuote")
      .update({
        status: "Declined",
        updatedAt: now,
        externalNotes: {
          ...((quote.externalNotes as Record<string, unknown>) || {}),
          declineNote: note ?? null,
          declinedBy: submittedBy,
          declinedByEmail: submittedByEmail,
          declinedAt: now
        }
      })
      .eq("id", supplierQuoteId)
      .eq("companyId", ctx.company.id);
    if (declined.error) {
      return ctx.error(
        "internal",
        "Failed to decline the quote",
        declined.error
      );
    }

    if (quote.externalLinkId) {
      await client
        .from("externalLink")
        .update({
          declinedAt: now,
          declinedBy: submittedBy,
          declinedByEmail: submittedByEmail,
          declineNote: note ?? null
        } as never)
        .eq("id", quote.externalLinkId)
        .eq("companyId", ctx.company.id);
    }
    return { supplierQuoteId };
  }
});

/**
 * The supplier writes notes on a quote line from the quote's share link.
 *
 * @remarks
 * `notes` is a TipTap document, or null to clear them. The line must be the
 * quote's.
 */
export const updateDigitalSupplierQuoteLineNotes = defineServiceFn({
  input: z.object({
    supplierQuoteId: z.string(),
    lineId: z.string(),
    notes: z.unknown()
  }),
  permission: "system",

  async run(ctx, { supplierQuoteId, lineId, notes }) {
    const updated = await ctx.asSystem.supabase
      .from("supplierQuoteLine")
      .update({
        externalNotes: (notes ?? null) as Json,
        updatedAt: datetime.timestamp()
      })
      .eq("id", lineId)
      .eq("supplierQuoteId", supplierQuoteId)
      .eq("companyId", ctx.company.id);
    if (updated.error) {
      return ctx.error("internal", "Failed to update notes", updated.error);
    }
    return { lineId };
  }
});

// ── Suppliers ───────────────────────────────────────────────────────────────

/**
 * Submit a supplier for approval.
 *
 * @remarks
 * Opens an approval request under the company's supplier approval rule, sets
 * the supplier Pending, and notifies the rule's approvers. Refused when
 * suppliers need no approval, or a request is already pending.
 *
 * @mcp
 */
export const requestSupplierApproval = defineServiceFn({
  input: z.object({ supplierId: z.string() }),
  permission: { update: "purchasing" },

  async run(ctx, { supplierId }) {
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;
    const owned = await refuseUnlessOwned(ctx, "supplier", { id: supplierId });
    if (owned) return owned;

    const opened = await openApprovalRequests(ctx.asSystem.supabase, {
      documentType: "supplier",
      documentIds: [supplierId],
      companyId,
      userId
    });
    if (opened.status === "not-required") {
      return ctx.error("rule", "Suppliers do not require approval");
    }
    if (opened.status !== "opened") {
      return ctx.error("internal", "Failed to submit for approval");
    }
    if (opened.requested.length === 0) {
      return ctx.error(
        "conflict",
        "An approval request already exists for this supplier"
      );
    }

    const update = await ctx.asCaller.supabase
      .from("supplier")
      .update({
        supplierStatus: "Pending",
        updatedBy: userId,
        updatedAt: datetime.timestamp()
      })
      .eq("id", supplierId)
      .eq("companyId", companyId);
    if (update.error) {
      return ctx.error(
        "internal",
        "The approval request is open, but the supplier could not be set Pending",
        update.error
      );
    }

    if (opened.approverIds.length > 0) {
      await trigger("notify", {
        event: NotificationEvent.ApprovalRequested,
        companyId,
        documentId: supplierId,
        documentType: "supplier",
        recipient: { type: "users", userIds: opened.approverIds },
        from: userId
      }).catch((e) =>
        logger.error("Failed to trigger approval notification", { error: e })
      );
    }
    return { supplierId };
  }
});

/**
 * Deactivate a supplier.
 *
 * @remarks
 * Sets the supplier Inactive. Only someone who may approve suppliers may do
 * it.
 *
 * @mcp destructive
 */
export const deactivateSupplier = defineServiceFn({
  input: z.object({ supplierId: z.string() }),
  permission: { update: "purchasing" },

  async run(ctx, { supplierId }) {
    const companyId = ctx.company.id;
    const owned = await refuseUnlessOwned(ctx, "supplier", { id: supplierId });
    if (owned) return owned;

    const canApprove = await canApproveRequest(
      ctx.asSystem.supabase,
      { amount: null, documentType: "supplier", companyId },
      ctx.auditUserId
    );
    if (!canApprove) {
      return ctx.error(
        "forbidden",
        "You do not have permission to deactivate this supplier"
      );
    }

    const update = await ctx.asCaller.supabase
      .from("supplier")
      .update({
        supplierStatus: "Inactive",
        updatedBy: ctx.auditUserId,
        updatedAt: datetime.timestamp()
      })
      .eq("id", supplierId)
      .eq("companyId", companyId);
    if (update.error) {
      return ctx.error(
        "internal",
        "Failed to deactivate the supplier",
        update.error
      );
    }
    return { supplierId };
  }
});

/**
 * Approve or reject a supplier's pending approval request.
 *
 * @remarks
 * Only an approver under the supplier rule may decide. Approving sets the
 * supplier Active; rejecting sets it Rejected. The requester is notified when
 * someone else decided.
 *
 * @mcp
 */
export const decideSupplierApproval = defineServiceFn({
  input: approvalDecisionValidator.extend({ supplierId: z.string() }),
  permission: { update: "purchasing" },

  async run(ctx, { supplierId, approvalRequestId, decision, notes }) {
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;
    const owned = await refuseUnlessOwned(ctx, "supplier", { id: supplierId });
    if (owned) return owned;

    const result = await decideApprovalRequest(
      ctx.asSystem.supabase,
      ctx.asSystem.pg,
      {
        documentType: "supplier",
        documentId: supplierId,
        companyId,
        userId,
        approvalRequestId,
        decision,
        notes
      }
    );
    if (result.error) {
      return ctx.error(
        result.error.code === "not-found"
          ? "notFound"
          : result.error.code === "forbidden"
            ? "forbidden"
            : "internal",
        result.error.message
      );
    }

    if (result.requestedBy !== userId) {
      await trigger("notify", {
        event:
          decision === "Approved"
            ? NotificationEvent.ApprovalApproved
            : NotificationEvent.ApprovalRejected,
        companyId,
        documentId: supplierId,
        documentType: "supplier",
        recipient: { type: "user", userId: result.requestedBy },
        from: userId
      }).catch((e) =>
        logger.error("Failed to trigger approval decision notification", {
          error: e
        })
      );
    }
    return { supplierId, decision };
  }
});
// ── Purchase return orders ──────────────────────────────────────────────────

const returnOrderTextFields = [
  "purchaseOrderId",
  "supplierContactId",
  "supplierLocationId",
  "supplierReference",
  "expirationDate",
  "locationId",
  "orderDate"
] as const;

/**
 * Change one field of purchase return orders.
 *
 * @remarks
 * The return order properties panel's edit; `value` null clears the field. A
 * new `supplierId` on one return takes the supplier's currency and today's
 * rate. A new `currencyCode` takes today's rate (refused when there is
 * none). Refused when any of the returns is Completed or Cancelled.
 *
 * @mcp
 */
export const updateReturnOrders = defineServiceFn({
  input: z.object({
    ids: z.array(z.string()).min(1),
    field: z.enum(["supplierId", "currencyCode", ...returnOrderTextFields]),
    value: z.string().nullable()
  }),
  permission: { update: "purchasing" },

  async run(ctx, { ids, field, value }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const statuses = await statusesOf(ctx, "purchaseReturnOrder", ids);
    if (statuses instanceof CarbonError) return statuses;
    if (statuses.some(isPurchaseReturnOrderLocked)) {
      return ctx.error(
        "rule",
        "Cannot modify a completed or cancelled return order."
      );
    }

    let patch: Database["public"]["Tables"]["purchaseReturnOrder"]["Update"];
    if (field === "supplierId") {
      patch = { supplierId: value ?? undefined };
      if (value && ids.length === 1) {
        const supplier = await client
          .from("supplier")
          .select("currencyCode")
          .eq("id", value)
          .single();
        const currencyCode = supplier.data?.currencyCode;
        if (currencyCode) {
          const rate = await getExchangeRate(client, companyId, currencyCode);
          if (rate.error)
            return ctx.error("rule", rate.error.message, rate.error);
          patch = { ...patch, currencyCode, exchangeRate: rate.data };
        }
      }
    } else if (field === "currencyCode" && value) {
      // Missing rate = refusal, never a stale rate or 1.
      const rate = await getExchangeRate(client, companyId, value);
      if (rate.error) return ctx.error("rule", rate.error.message, rate.error);
      patch = { currencyCode: value, exchangeRate: rate.data };
    } else {
      patch = unchecked({ [field]: value ? value : null });
    }

    const update = await client
      .from("purchaseReturnOrder")
      .update({
        ...patch,
        updatedBy: ctx.auditUserId,
        updatedAt: datetime.timestamp()
      })
      .in("id", ids)
      .eq("companyId", companyId);
    if (update.error) {
      return ctx.error(
        "internal",
        "Failed to update the return order",
        update.error
      );
    }
    return { ids };
  }
});

/**
 * Cancel a purchase return order.
 *
 * @remarks
 * Refused when the return is Completed or Cancelled, or has a shipment or
 * shipped quantity. Locks the return first, so a shipment posting at the
 * same time either wins or sees it Cancelled.
 *
 * @mcp destructive
 */
export const cancelReturnOrder = defineServiceFn({
  input: z.object({ purchaseReturnOrderId: z.string() }),
  permission: { update: "purchasing" },

  async run(ctx, { purchaseReturnOrderId }) {
    try {
      await cancelPurchaseReturnOrder(ctx.asSystem.pg, {
        id: purchaseReturnOrderId,
        companyId: ctx.company.id,
        userId: ctx.auditUserId
      });
    } catch (err) {
      return refusedBy(ctx, err, "Failed to update status");
    }
    return { purchaseReturnOrderId };
  }
});

/**
 * Reopen a purchase return order.
 *
 * @remarks
 * Sets a To Ship or Cancelled return back to Draft, so its lines can be
 * edited and it can be confirmed again. Refused when anything has shipped.
 *
 * @mcp
 */
export const reopenReturnOrder = defineServiceFn({
  input: z.object({ purchaseReturnOrderId: z.string() }),
  permission: { update: "purchasing" },

  async run(ctx, { purchaseReturnOrderId }) {
    try {
      await reopenPurchaseReturnOrder(ctx.asSystem.pg, {
        id: purchaseReturnOrderId,
        companyId: ctx.company.id,
        userId: ctx.auditUserId
      });
    } catch (err) {
      return refusedBy(ctx, err, "Failed to update status");
    }
    return { purchaseReturnOrderId };
  }
});

const returnOrderLineInput = purchaseReturnOrderLineValidator
  .omit({ id: true, purchaseReturnOrderId: true })
  .extend({
    purchaseReturnOrderId: z.string(),
    customFields: customFieldsInput.optional()
  });

/**
 * Add a line to a purchase return order.
 *
 * @remarks
 * Only while the return is Draft: quantities are checked against their
 * source lines at Confirm. A line added from a purchase order or receipt
 * line links the return to that purchase order when it has none yet (best
 * effort). The batch or serial to send back is `trackedEntityIds`; with none
 * given and a receipt line holding exactly one Available entity, that one is
 * chosen.
 *
 * @mcp
 */
export const addReturnOrderLine = defineServiceFn({
  input: returnOrderLineInput,
  permission: { create: "purchasing" },

  async run(ctx, { trackedEntityIds, ...line }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;
    const orderId = line.purchaseReturnOrderId;

    const order = await getPurchaseReturnOrder(client, orderId);
    if (isPurchaseReturnOrderLocked(order.data?.status)) {
      return ctx.error(
        "rule",
        "Cannot add lines to a completed or cancelled return order."
      );
    }
    if (order.data?.status !== "Draft") {
      return ctx.error(
        "rule",
        "Lines can only be added while the return order is Draft"
      );
    }

    const created = await upsertPurchaseReturnOrderLine(client, {
      ...line,
      companyId,
      createdBy: userId
    });
    if (created.error || !created.data) {
      return ctx.error(
        "internal",
        "Failed to create return order line",
        created.error
      );
    }
    const id = created.data.id;

    // The first line's order wins and a manually linked header is never
    // overwritten, so a return across several orders still works.
    if (!order.data.purchaseOrderId) {
      let purchaseOrderLineId = line.purchaseOrderLineId ?? null;
      if (!purchaseOrderLineId && line.receiptLineId) {
        const receiptLine = await client
          .from("receiptLine")
          .select("lineId")
          .eq("id", line.receiptLineId)
          .eq("companyId", companyId)
          .maybeSingle();
        purchaseOrderLineId = receiptLine.data?.lineId ?? null;
      }
      if (purchaseOrderLineId) {
        const purchaseOrderLine = await client
          .from("purchaseOrderLine")
          .select("purchaseOrderId")
          .eq("id", purchaseOrderLineId)
          .eq("companyId", companyId)
          .maybeSingle();
        if (purchaseOrderLine.data?.purchaseOrderId) {
          await client
            .from("purchaseReturnOrder")
            .update({
              purchaseOrderId: purchaseOrderLine.data.purchaseOrderId,
              updatedBy: userId
            })
            .eq("id", orderId)
            .eq("companyId", companyId);
        }
      }
    }

    let entityIds = trackedEntityIds ?? [];
    if (entityIds.length === 0 && line.receiptLineId) {
      const returnable = await getReturnableEntitiesForReceiptLine(
        client,
        companyId,
        line.itemId,
        line.receiptLineId
      );
      if (!returnable.error && returnable.data?.length === 1) {
        entityIds = [returnable.data[0].id];
      }
    }
    if (entityIds.length > 0) {
      const set = await setPurchaseReturnOrderLineTrackedEntities(
        client,
        id,
        companyId,
        entityIds,
        userId
      );
      if (set.error) {
        return ctx.error(
          "internal",
          "The line was added, but its tracked entities could not be set",
          set.error
        );
      }
    }
    return { id };
  }
});

/**
 * Change a line of a purchase return order.
 *
 * @remarks
 * Refused when the return is Completed or Cancelled, or the line is not on
 * it. Once the return is confirmed, the quantity, item, unit price,
 * restocking fee, unit of measure and source links are locked: they were
 * checked against their source lines at Confirm. `trackedEntityIds`
 * replaces the line's batches and serials.
 *
 * @mcp
 */
export const updateReturnOrderLine = defineServiceFn({
  input: returnOrderLineInput.extend({ lineId: z.string() }),
  permission: { update: "purchasing" },

  async run(ctx, { lineId, trackedEntityIds, ...line }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const orderId = line.purchaseReturnOrderId;

    const order = await getPurchaseReturnOrder(client, orderId);
    if (isPurchaseReturnOrderLocked(order.data?.status)) {
      return ctx.error(
        "rule",
        "Cannot modify a completed or cancelled return order."
      );
    }

    const existing = await client
      .from("purchaseReturnOrderLine")
      .select(
        "purchaseReturnOrderId, quantity, itemId, unitPrice, restockFeePercent, unitOfMeasureCode, purchaseOrderLineId, receiptLineId, purchaseInvoiceLineId"
      )
      .eq("id", lineId)
      .eq("companyId", companyId)
      .single();
    if (existing.error || existing.data.purchaseReturnOrderId !== orderId) {
      return ctx.error(
        "notFound",
        "This line does not belong to this return order"
      );
    }

    if (order.data?.status !== "Draft") {
      const locked = lockedReturnLineField(line, existing.data);
      if (locked) {
        return ctx.error("rule", `${locked} is locked after confirmation`);
      }
    }

    const update = await upsertPurchaseReturnOrderLine(client, {
      ...line,
      id: lineId,
      updatedBy: ctx.auditUserId
    });
    if (update.error) {
      return ctx.error(
        "internal",
        "Failed to update return order line",
        update.error
      );
    }

    const set = await setPurchaseReturnOrderLineTrackedEntities(
      client,
      lineId,
      companyId,
      trackedEntityIds ?? [],
      ctx.auditUserId
    );
    if (set.error) {
      return ctx.error("internal", "Failed to set tracked entities", set.error);
    }
    return { id: lineId };
  }
});

// ── Leases (lessee) ─────────────────────────────────────────────────────────
/**
 * Activate a Draft lease.
 *
 * @remarks
 * Classifies and measures each leased asset, posts the commencement journal
 * (or the opening balance, for a lease that commenced before the accounting
 * cutover) and writes the monthly schedule, in one transaction. Refused for a
 * lease that is not Draft, has no asset, an asset with no payment row, a
 * currency other than the base currency, or a Skipped payment no opening
 * balance holds.
 *
 * @mcp
 */
export const activateLease = defineServiceFn({
  input: z.object({ leaseId: z.string() }),
  permission: { update: "purchasing" },

  async run(ctx, { leaseId }) {
    const refused = await postLease(
      ctx,
      { type: "activate", leaseId },
      "Failed to activate lease"
    );
    return refused ?? { leaseId };
  }
});

/**
 * Cancel an Active lease.
 *
 * @remarks
 * Undoes an activation: voids its commencement or opening journal and deletes
 * the schedule. Refused for a Draft (delete it instead), and for a lease with
 * a Modify, Terminate or Purchase, an invoiced payment, or a posted or held
 * lease run month.
 *
 * @mcp destructive
 */
export const cancelLease = defineServiceFn({
  input: z.object({ leaseId: z.string() }),
  permission: { update: "purchasing" },

  async run(ctx, { leaseId }) {
    const refused = await postLease(
      ctx,
      { type: "cancel", leaseId },
      "Failed to cancel lease"
    );
    return refused ?? { leaseId };
  }
});

/**
 * Modify an Active lease from an effective date.
 *
 * @remarks
 * Updates the term, rate, frequency and escalation, cuts each active asset's
 * remaining payments again at the payment in `lines`, remeasures each
 * capitalized asset, posts the adjustment and rewrites the unposted schedule,
 * in one transaction. The effective date must start a lease month and a
 * payment period, after every posted lease run month.
 *
 * @mcp
 */
export const modifyLease = defineServiceFn({
  input: leaseModifyValidator.safeExtend({ leaseId: z.string() }),
  permission: { update: "purchasing" },

  async run(ctx, { leaseId, notes, ...terms }) {
    const refused = await postLease(
      ctx,
      { type: "modify", leaseId, ...terms, notes: notes ?? null },
      "Failed to modify lease"
    );
    return refused ?? { leaseId };
  }
});

/**
 * Terminate one leased asset early.
 *
 * @remarks
 * Deletes its Pending payments after the date, adds a Termination Penalty
 * payment of `penaltyAmount`, posts the derecognition with its gain or loss,
 * and sets the asset Terminated; the lease ends with its last asset. The
 * date must end a payment period, on or after the commencement.
 *
 * @mcp destructive
 */
export const terminateLeaseLine = defineServiceFn({
  input: leaseTerminateValidator.extend({
    leaseId: z.string(),
    leaseLineId: z.string()
  }),
  permission: { update: "purchasing" },

  async run(ctx, { leaseId, leaseLineId, notes, ...terms }) {
    const refused = await postLease(
      ctx,
      {
        type: "terminate",
        leaseId,
        leaseLineId,
        ...terms,
        notes: notes ?? null
      },
      "Failed to terminate lease"
    );
    return refused ?? { leaseId, leaseLineId };
  }
});

/**
 * Exercise a leased asset's purchase option.
 *
 * @remarks
 * Posts the purchase, adds an Active fixed asset of `fixedAssetClassId` at
 * the asset's location, and sets the leased asset Purchased. Refused for a
 * Short-Term asset, and one with neither a purchase option nor ownership
 * transfer.
 *
 * @mcp
 */
export const purchaseLeaseLine = defineServiceFn({
  input: leasePurchaseValidator.extend({
    leaseId: z.string(),
    leaseLineId: z.string()
  }),
  permission: { update: "purchasing" },

  async run(ctx, { leaseId, leaseLineId, notes, ...terms }) {
    const refused = await postLease(
      ctx,
      {
        type: "purchase",
        leaseId,
        leaseLineId,
        ...terms,
        notes: notes ?? null
      },
      "Failed to purchase the leased asset"
    );
    return refused ?? { leaseId, leaseLineId };
  }
});
/**
 * Override a Draft lease asset's classification.
 *
 * @remarks
 * Sets the asset Operating or Finance whatever the five tests say, with the
 * reason; activation keeps it. Only while the lease is Draft. Audit logged.
 *
 * @mcp
 */
export const overrideLeaseLineClassification = defineServiceFn({
  input: leaseClassificationValidator.extend({
    leaseId: z.string(),
    leaseLineId: z.string()
  }),
  permission: { update: "accounting" },

  async run(ctx, { leaseId, leaseLineId, classification, reason }) {
    const refused = await writeClassificationOverride(ctx, {
      leaseId,
      leaseLineId,
      override: { classification, reason }
    });
    return refused ?? { leaseLineId, classification };
  }
});

/**
 * Remove a Draft lease asset's classification override.
 *
 * @remarks
 * The five tests decide the classification again. Only while the lease is
 * Draft. Audit logged.
 *
 * @mcp
 */
export const removeLeaseLineClassificationOverride = defineServiceFn({
  input: z.object({ leaseId: z.string(), leaseLineId: z.string() }),
  permission: { update: "accounting" },

  async run(ctx, { leaseId, leaseLineId }) {
    const refused = await writeClassificationOverride(ctx, {
      leaseId,
      leaseLineId,
      override: null
    });
    return refused ?? { leaseLineId };
  }
});

// ── Purchase orders ─────────────────────────────────────────────────────────

const purchaseOrderHeaderFields = [
  "supplierContactId",
  "supplierLocationId",
  "supplierReference",
  "exchangeRate",
  "orderDate"
] as const;

const purchaseOrderDeliveryFields = [
  "receiptRequestedDate",
  "locationId",
  "deliveryDate"
] as const;

/**
 * Change one field of purchase orders.
 *
 * @remarks
 * The purchase order properties panel's edit; `value` null clears the field
 * (an empty `supplierId` changes nothing). A new `supplierId` on one order
 * takes the supplier's currency and today's rate; a new `currencyCode` takes
 * today's rate (refused when there is none). `receiptRequestedDate`,
 * `locationId` and `deliveryDate` are the delivery's. `receiptPromisedDate`
 * also fills every line that has no promised date of its own. Refused when
 * any order is released, except for `deliveryDate`.
 *
 * @mcp
 */
export const updatePurchaseOrders = defineServiceFn({
  input: z.object({
    ids: z.array(z.string()).min(1),
    field: z.enum([
      "supplierId",
      "currencyCode",
      "receiptPromisedDate",
      ...purchaseOrderHeaderFields,
      ...purchaseOrderDeliveryFields
    ]),
    value: z.string().nullable()
  }),
  permission: { update: "purchasing" },

  async run(ctx, { ids, field, value }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const stamp = () => ({
      updatedBy: ctx.auditUserId,
      updatedAt: datetime.timestamp()
    });

    if (field !== "deliveryDate") {
      const statuses = await statusesOf(ctx, "purchaseOrder", ids);
      if (statuses instanceof CarbonError) return statuses;
      if (statuses.some(isPurchaseOrderLocked)) {
        return ctx.error("rule", "Cannot modify a confirmed purchase order.");
      }
    }

    const failed = (error: unknown) =>
      ctx.error("internal", "Failed to update the purchase order", error);

    if (field === "receiptPromisedDate") {
      const lines = await client
        .from("purchaseOrderLine")
        .update({ promisedDate: value ?? undefined, ...stamp() })
        .in("purchaseOrderId", ids)
        .eq("companyId", companyId)
        .is("promisedDate", null);
      if (lines.error) return failed(lines.error);
    }

    if (
      field === "receiptPromisedDate" ||
      (purchaseOrderDeliveryFields as readonly string[]).includes(field)
    ) {
      const delivery = await client
        .from("purchaseOrderDelivery")
        .update(unchecked({ [field]: value, ...stamp() }))
        .in("id", ids)
        .eq("companyId", companyId);
      return delivery.error ? failed(delivery.error) : { ids };
    }

    let patch: Database["public"]["Tables"]["purchaseOrder"]["Update"];
    if (field === "supplierId") {
      patch = { supplierId: value ?? undefined };
      if (value && ids.length === 1) {
        const supplier = await client
          .from("supplier")
          .select("currencyCode")
          .eq("id", value)
          .single();
        const currencyCode = supplier.data?.currencyCode;
        if (currencyCode) {
          const rate = await getExchangeRate(client, companyId, currencyCode);
          if (rate.error)
            return ctx.error("rule", rate.error.message, rate.error);
          patch = { ...patch, currencyCode, exchangeRate: rate.data };
        }
      }
    } else if (field === "currencyCode" && value) {
      const rate = await getExchangeRate(client, companyId, value);
      if (rate.error) return ctx.error("rule", rate.error.message, rate.error);
      patch = { currencyCode: value, exchangeRate: rate.data };
    } else {
      patch = unchecked({ [field]: value ? value : null });
    }

    const update = await client
      .from("purchaseOrder")
      .update({ ...patch, ...stamp() })
      .in("id", ids)
      .eq("companyId", companyId);
    return update.error ? failed(update.error) : { ids };
  }
});

/**
 * Delete purchase orders.
 *
 * @remarks
 * Only Draft, Planned or Needs Approval orders. An order that needs approval
 * can be deleted only by the person who requested it (an approver rejects
 * instead), and its pending approval requests are cancelled first. Every
 * order is checked before anything is deleted.
 *
 * @mcp destructive
 */
export const deletePurchaseOrders = defineServiceFn({
  input: z.object({ purchaseOrderIds: z.array(z.string()).min(1) }),
  permission: { delete: "purchasing" },

  async run(ctx, { purchaseOrderIds }) {
    const system = ctx.asSystem.supabase;
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;
    const ids = [...new Set(purchaseOrderIds)];

    const orders = await system
      .from("purchaseOrder")
      .select("id, status")
      .in("id", ids)
      .eq("companyId", companyId);
    if (orders.error) {
      return ctx.error("internal", "Purchase order not found", orders.error);
    }
    if (orders.data.length !== ids.length) {
      return ctx.error("notFound", "Purchase order not found");
    }

    const needsApproval = orders.data
      .filter((order) => order.status === "Needs Approval")
      .map((order) => order.id);
    const pending =
      needsApproval.length > 0
        ? await system
            .from("approvalRequest")
            .select("documentId, requestedBy, amount, requestedAt")
            .eq("documentType", "purchaseOrder")
            .in("documentId", needsApproval)
            .eq("companyId", companyId)
            .eq("status", "Pending")
            .order("requestedAt", { ascending: false })
        : null;
    if (pending?.error) {
      return ctx.error(
        "internal",
        "Failed to read the approval requests",
        pending.error
      );
    }

    for (const order of orders.data) {
      const latest = pending?.data.find((r) => r.documentId === order.id);
      const refusal = purchaseOrderDeleteRefusal({
        status: order.status,
        requestedBy: latest?.requestedBy,
        userId
      });
      if (refusal === "status") {
        return ctx.error(
          "rule",
          `Cannot delete purchase order with status "${order.status ?? "unknown"}". Only Draft, Planned, or Needs Approval (if you're the requester) purchase orders can be deleted.`
        );
      }
      if (refusal === "notRequester") {
        const isApprover = await canApproveRequest(
          system,
          {
            amount: latest?.amount ?? null,
            documentType: "purchaseOrder",
            companyId
          },
          userId
        );
        return ctx.error(
          "forbidden",
          isApprover
            ? "Please reject the approval request instead of deleting"
            : "You do not have permission to delete this purchase order"
        );
      }
    }

    if (needsApproval.length > 0) {
      const cancelled = await system
        .from("approvalRequest")
        .update({
          status: "Cancelled",
          updatedBy: userId,
          updatedAt: datetime.timestamp()
        })
        .eq("documentType", "purchaseOrder")
        .in("documentId", needsApproval)
        .eq("companyId", companyId)
        .eq("status", "Pending");
      if (cancelled.error) {
        return ctx.error(
          "internal",
          "Failed to cancel the approval requests",
          cancelled.error
        );
      }
    }

    const removed = await ctx.asCaller.supabase
      .from("purchaseOrder")
      .delete()
      .in("id", ids)
      .eq("companyId", companyId);
    if (removed.error) {
      return ctx.error("internal", removed.error.message, removed.error);
    }
    return { purchaseOrderIds: ids };
  }
});

/** The PO statuses whose open lines MRP counts as supply
 *  (`openPurchaseOrderLines`). */
const MRP_SUPPLY_STATUSES = new Set<string>([
  "Planned",
  "To Receive",
  "To Receive and Invoice"
]);
/**
 * Reopen a purchase order.
 *
 * @remarks
 * Moves the order back to Draft (from the order page) or Planned (from the
 * planning pages: Draft is not MRP supply). Reopening a released order needs
 * `delete: purchasing`. Pending approval requests are cancelled; an order
 * that needs approval can be reopened only by its requester or an approver.
 * With `createRevision`, a released order is reopened as its next revision
 * (refused for an order never released). Reopening to Planned runs MRP for
 * the order unless it already was supply.
 *
 * @mcp
 */
export const reopenPurchaseOrder = defineServiceFn({
  input: z.object({
    purchaseOrderId: z.string(),
    status: z.enum(PURCHASE_ORDER_REOPEN_STATUSES),
    createRevision: z.boolean().default(false)
  }),
  permission: { update: "purchasing" },

  async run(ctx, { purchaseOrderId, status, createRevision }) {
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;

    const current = await ctx.asCaller.supabase
      .from("purchaseOrder")
      .select("status, orderDate")
      .eq("id", purchaseOrderId)
      .eq("companyId", companyId)
      .maybeSingle();
    if (current.error) {
      return ctx.error(
        "internal",
        "Failed to read the purchase order",
        current.error
      );
    }
    if (!current.data) return ctx.error("notFound", "Purchase order not found");
    const currentStatus = current.data.status;

    // Checked BEFORE the approvals are cancelled below: a request about to
    // fail must not have side effects. The revision write re-checks in SQL.
    if (
      createRevision &&
      !canCreatePurchaseOrderRevision({
        newStatus: status,
        currentStatus,
        orderDate: current.data.orderDate
      })
    ) {
      return ctx.error("rule", "Only a released purchase order can be revised");
    }
    if (
      isPurchaseOrderLocked(currentStatus) &&
      !ctx.can({ delete: "purchasing" })
    ) {
      return ctx.error(
        "forbidden",
        "Reopening a released purchase order needs permission to delete purchase orders"
      );
    }

    if (currentStatus === "Needs Approval") {
      const latest = await ctx.asSystem.supabase
        .from("approvalRequest")
        .select("requestedBy, amount")
        .eq("documentType", "purchaseOrder")
        .eq("documentId", purchaseOrderId)
        .eq("companyId", companyId)
        .eq("status", "Pending")
        .limit(1)
        .maybeSingle();
      // Only the requester or an approver: anyone else would bypass the
      // approval by reopening.
      if (
        latest.data &&
        latest.data.requestedBy !== userId &&
        !(await canApproveRequest(
          ctx.asSystem.supabase,
          {
            amount: latest.data.amount,
            documentType: "purchaseOrder",
            companyId
          },
          userId
        ))
      ) {
        return ctx.error(
          "forbidden",
          "You do not have permission to reopen this purchase order"
        );
      }
    }
    if (currentStatus === "Needs Approval" || currentStatus === "Closed") {
      await cancelPendingApprovals(ctx, purchaseOrderId);
    }

    if (createRevision) {
      let rows: number;
      try {
        rows = await reopenPurchaseOrderAsRevision(ctx.asSystem.pg, {
          id: purchaseOrderId,
          companyId,
          updatedBy: userId,
          status
        });
      } catch (err) {
        return ctx.error("internal", "Failed to create revision", err);
      }
      if (rows === 0) {
        return ctx.error(
          "conflict",
          "Only a released purchase order can be revised"
        );
      }
      return { purchaseOrderId, status, revision: true };
    }

    const update = await updatePurchaseOrderStatus(ctx.asCaller.supabase, {
      id: purchaseOrderId,
      status,
      assignee: undefined,
      updatedBy: userId
    });
    if (update.error) {
      return ctx.error(
        "internal",
        "Failed to update purchasing order status",
        update.error
      );
    }

    // Planned makes the lines MRP supply. An order that already was supply
    // changes nothing MRP reads, so the reopen does not wait on a run.
    if (status === "Planned" && !MRP_SUPPLY_STATUSES.has(currentStatus ?? "")) {
      await runMRP(ctx.asSystem.supabase, ctx.asSystem.pg, {
        type: "purchaseOrder",
        id: purchaseOrderId,
        companyId,
        userId
      });
    }
    return { purchaseOrderId, status, revision: false };
  }
});

/**
 * Close a purchase order.
 *
 * @remarks
 * Sets the order Closed and clears its assignee; nothing more is received or
 * invoiced against it. Its pending approval requests are cancelled.
 *
 * @mcp destructive
 */
export const closePurchaseOrderAndApprovals = defineServiceFn({
  input: z.object({ purchaseOrderId: z.string() }),
  permission: { delete: "purchasing" },

  async run(ctx, { purchaseOrderId }) {
    const owned = await refuseUnlessOwned(ctx, "purchaseOrder", {
      id: purchaseOrderId
    });
    if (owned) return owned;

    const cancelled = await cancelPendingApprovals(ctx, purchaseOrderId);
    if (cancelled.data && cancelled.data.length > 0) {
      logger.info("Cancelled pending approval requests when closing", {
        companyId: ctx.company.id,
        purchaseOrderId,
        count: cancelled.data.length
      });
    }

    const update = await updatePurchaseOrderStatus(ctx.asCaller.supabase, {
      id: purchaseOrderId,
      status: "Closed",
      assignee: null,
      updatedBy: ctx.auditUserId
    });
    if (update.error) {
      return ctx.error(
        "internal",
        "Failed to update purchasing order status",
        update.error
      );
    }
    return { purchaseOrderId };
  }
});
const purchaseOrderNotification = {
  notification: z.enum(["Email", "None"]).optional(),
  supplierContact: z.string().optional(),
  cc: z.array(z.string()).optional(),
  /** The PDF's and email's locale (BCP 47); en-US when absent. */
  locale: z.string().optional()
};

/**
 * Finalize a purchase order.
 *
 * @remarks
 * Refused when the company requires a reachable supplier contact and the
 * supplier has none, or requires approved suppliers and this one is not
 * Active. The order gets its status from its lines and today's order date.
 * When the company's approval rule covers its total (a planning order skips
 * it if the company allows), it goes to Needs Approval instead: an approval
 * request is opened and the approvers notified, and nothing else happens
 * until it is approved. Otherwise the supplier prices are updated (when the
 * company does that on finalize), the PDF is stored as a document, and with
 * `notification` Email the supplier contact gets it with the interaction's
 * files and the default attachments (refused over the attachment limit).
 *
 * @mcp
 */
export const finalizePurchaseOrderAndNotify = defineServiceFn({
  input: z
    .object({ purchaseOrderId: z.string(), ...purchaseOrderNotification })
    .refine((d) => (d.notification === "Email" ? !!d.supplierContact : true), {
      message: "Supplier contact is required for email",
      path: ["supplierContact"]
    }),
  permission: { create: "purchasing" },

  async run(
    ctx,
    { purchaseOrderId, notification, supplierContact, cc, locale }
  ) {
    const system = ctx.asSystem.supabase;
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;

    const purchaseOrder = await getPurchaseOrder(system, purchaseOrderId);
    if (purchaseOrder.error) {
      return ctx.error(
        "internal",
        "Failed to get purchase order",
        purchaseOrder.error
      );
    }
    if (purchaseOrder.data.companyId !== companyId) {
      return ctx.error("notFound", "Purchase order not found");
    }

    const contactRule = await checkPartyContactRequirement(
      ctx.asCaller.supabase,
      companyId,
      { kind: "supplier", id: purchaseOrder.data.supplierId }
    );
    if (contactRule) return ctx.error("rule", contactRule);

    if (
      purchaseOrder.data.supplierId &&
      (await isApprovalRequired(system, "supplier", companyId))
    ) {
      const supplier = await getSupplier(system, purchaseOrder.data.supplierId);
      if (supplier.data?.status !== "Active") {
        return ctx.error(
          "rule",
          "Cannot finalize: supplier is not approved (Active)"
        );
      }
    }

    // A planning order, untouched by hand since, skips the approval rule when
    // the company allows it. Fail closed: a failed read is an ordinary check.
    const [planningOrigin, planningSettings] = await Promise.all([
      system
        .from("purchaseOrder")
        .select("createdFromPlanning")
        .eq("id", purchaseOrderId)
        .eq("companyId", companyId)
        .maybeSingle(),
      system
        .from("companySettings")
        .select("skipApprovalForPlanningPurchaseOrders")
        .eq("id", companyId)
        .maybeSingle()
    ]);
    if (planningOrigin.error || planningSettings.error) {
      logger.error("Failed to read the planning approval bypass", {
        companyId,
        purchaseOrderId,
        error: planningOrigin.error ?? planningSettings.error
      });
    }
    const skipsApproval =
      planningOrigin.data?.createdFromPlanning === true &&
      planningSettings.data?.skipApprovalForPlanningPurchaseOrders === true;
    const amount = purchaseOrder.data.orderTotal ?? 0;
    const approvalRequired =
      !skipsApproval &&
      (await isApprovalRequired(system, "purchaseOrder", companyId, amount));

    const finalize = await finalizePurchaseOrder(
      ctx.asCaller.supabase,
      purchaseOrderId,
      userId
    );
    if (finalize.error) {
      return ctx.error(
        "internal",
        "Failed to finalize purchase order",
        finalize.error
      );
    }
    trackWorkEvent(
      "purchase_order_finalized",
      {
        companyId,
        userId,
        purchaseOrderId,
        stage: approvalRequired ? "gated" : "committed"
      },
      { discriminator: approvalRequired ? "gated" : "committed" }
    );

    // The PDF, the email and the prices wait for the approval.
    if (approvalRequired) {
      if (
        !(await hasPendingApproval(system, "purchaseOrder", purchaseOrderId))
      ) {
        await createApprovalRequest(system, {
          documentType: "purchaseOrder",
          documentId: purchaseOrderId,
          companyId,
          requestedBy: userId,
          createdBy: userId,
          amount
        });
        const rule = await getApprovalRuleByAmount(
          system,
          "purchaseOrder",
          companyId,
          amount
        );
        const approverIds = rule.data
          ? await getApproverUserIdsForRule(system, rule.data)
          : [];
        if (approverIds.length > 0) {
          await trigger("notify", {
            event: NotificationEvent.ApprovalRequested,
            companyId,
            documentId: purchaseOrderId,
            documentType: "purchaseOrder",
            recipient: { type: "users", userIds: approverIds },
            from: userId
          }).catch((e) =>
            logger.error("Failed to trigger approval notification", {
              error: e
            })
          );
        }
      }
      const status = await updatePurchaseOrderStatus(ctx.asCaller.supabase, {
        id: purchaseOrderId,
        status: "Needs Approval",
        assignee: undefined,
        updatedBy: userId
      });
      if (status.error) {
        return ctx.error(
          "internal",
          "Failed to submit the purchase order for approval",
          status.error
        );
      }
      return { purchaseOrderId, needsApproval: true };
    }

    await updatePricesOnFinalize(ctx, purchaseOrderId);

    const pdf = await attachPurchaseOrderPdf(ctx, {
      purchaseOrder: purchaseOrder.data,
      locale: locale ?? "en-US"
    });
    if (pdf instanceof CarbonError) return pdf;

    if (notification === "Email" && supplierContact) {
      try {
        const email = await purchaseOrderEmail(ctx, {
          purchaseOrderId,
          supplierContactId: supplierContact,
          locale: locale ?? "en-US"
        });
        if (email) {
          const interactionId = email.purchaseOrder.supplierInteractionId;
          const defaults = await getDefaultAttachmentsForPO(system, {
            companyId,
            supplierId: email.purchaseOrder.supplierId ?? null,
            itemIds: [
              ...new Set(
                email.lines.flatMap((line) =>
                  line.itemId ? [line.itemId] : []
                )
              )
            ]
          });
          const attachments = [
            ...(interactionId
              ? await interactionAttachments(system, companyId, interactionId)
              : []),
            ...(await signedAttachments(
              system,
              companyId,
              defaults.map((file) => ({ filename: file.name, path: file.path }))
            ))
          ];
          const totalKb = attachments.length
            ? pdf.size + defaults.reduce((sum, r) => sum + (r.size ?? 0), 0)
            : 0;
          if (totalKb > PO_EMAIL_ATTACHMENT_LIMIT_MB * 1024) {
            return ctx.error(
              "rule",
              `Total attachments exceed ${PO_EMAIL_ATTACHMENT_LIMIT_MB} MB limit`
            );
          }
          await trigger("send-email", {
            to: email.to,
            cc: cc?.length ? cc : undefined,
            from: email.from,
            subject: email.subject,
            html: email.html,
            text: email.text,
            attachments: attachments.length ? attachments : undefined,
            companyId
          });
        }
      } catch (err) {
        return ctx.error("internal", "Failed to send email", err);
      }
    }
    return { purchaseOrderId, needsApproval: false };
  }
});

/**
 * Approve or reject a purchase order's pending approval request.
 *
 * @remarks
 * Only an approver whose tier covers the order's amount may decide. The
 * requester is notified, and so are the approvers of every lower tier. An
 * approved order is released: the supplier prices are updated (when the
 * company does that on finalize), the PDF is stored as a document, and with
 * `notification` Email the supplier contact gets it. Those follow-ups are
 * logged when they fail; the decision stands.
 *
 * @mcp
 */
export const decidePurchaseOrderApproval = defineServiceFn({
  input: z
    .object({
      purchaseOrderId: z.string(),
      approvalRequestId: z.string().min(1),
      decision: z.enum(["Approved", "Rejected"]),
      ...purchaseOrderNotification
    })
    .refine((d) => (d.notification === "Email" ? !!d.supplierContact : true), {
      message: "Supplier contact is required for email",
      path: ["supplierContact"]
    }),
  permission: { update: "purchasing" },

  async run(ctx, input) {
    const { purchaseOrderId, approvalRequestId, decision } = input;
    const system = ctx.asSystem.supabase;
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;

    const request = await getLatestApprovalRequestForDocument(
      system,
      "purchaseOrder",
      purchaseOrderId
    );
    // The request must be this order's pending one AND this company's.
    if (
      !request.data ||
      request.data.id !== approvalRequestId ||
      request.data.companyId !== companyId
    ) {
      return ctx.error("notFound", "Approval request not found");
    }
    const canApprove = await canApproveRequest(
      system,
      {
        amount: request.data.amount,
        documentType: request.data.documentType,
        companyId
      },
      userId
    );
    if (!canApprove) {
      return ctx.error(
        "forbidden",
        "You do not have permission to approve this request"
      );
    }

    const decided =
      decision === "Approved"
        ? await approveRequest(ctx.asSystem.pg, approvalRequestId, userId)
        : await rejectRequest(ctx.asSystem.pg, approvalRequestId, userId);
    if (decided.error) {
      return ctx.error(
        "internal",
        decided.error.message ?? "Failed to process approval decision",
        decided.error
      );
    }

    const event =
      decision === "Approved"
        ? NotificationEvent.ApprovalApproved
        : NotificationEvent.ApprovalRejected;
    const requestedBy = request.data.requestedBy;
    if (requestedBy && requestedBy !== userId) {
      await trigger("notify", {
        event,
        companyId,
        documentId: purchaseOrderId,
        documentType: "purchaseOrder",
        recipient: { type: "user", userId: requestedBy },
        from: userId
      }).catch((e) =>
        logger.error("Failed to trigger approval decision notification", {
          error: e
        })
      );
    }
    // The approvers of every lower tier see spend that bypassed their tier.
    try {
      const lowerTier = await getLowerTierApproverUserIds(
        system,
        "purchaseOrder",
        companyId,
        request.data.amount ?? undefined
      );
      const recipients = lowerTier.filter(
        (id) => id !== requestedBy && id !== userId
      );
      if (recipients.length > 0) {
        await trigger("notify", {
          event,
          companyId,
          documentId: purchaseOrderId,
          documentType: "purchaseOrder",
          recipient: { type: "users", userIds: recipients },
          from: userId
        });
      }
    } catch (e) {
      logger.error(
        "Failed to trigger lower-tier spend notification for purchase order",
        { error: e }
      );
    }

    if (decision === "Approved") {
      await releaseApprovedPurchaseOrder(ctx, input);
    }
    return { purchaseOrderId, decision };
  }
});
/**
 * Confirm a purchase return order.
 *
 * @remarks
 * Moves a Draft return to To Ship after checking, under row locks, that no
 * line returns more than its source received, ordered or was invoiced. Then
 * stores the return's PDF as a document; when that fails the return stays
 * confirmed and `warning` says so.
 *
 * @mcp
 */
export const confirmReturnOrder = defineServiceFn({
  input: z.object({
    purchaseReturnOrderId: z.string(),
    /** The PDF's locale (BCP 47); en-US when absent. */
    locale: z.string().optional()
  }),
  permission: { update: "purchasing" },

  async run(ctx, { purchaseReturnOrderId, locale }) {
    const system = ctx.asSystem.supabase;
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;

    const order = await getPurchaseReturnOrder(system, purchaseReturnOrderId);
    if (order.error) {
      return ctx.error(
        "internal",
        "Failed to load purchase return order",
        order.error
      );
    }
    if (order.data.companyId !== companyId) {
      return ctx.error("notFound", "Purchase return order not found");
    }

    try {
      await confirmPurchaseReturnOrder(
        ctx.asSystem.pg,
        { id: purchaseReturnOrderId, companyId },
        userId
      );
    } catch (err) {
      return refusedBy(ctx, err, "Failed to confirm return order");
    }

    try {
      const pdf = await renderPurchaseReturnOrderPdf(ctx.asCaller.supabase, {
        companyId,
        companyGroupId: ctx.company.groupId,
        purchaseReturnOrderId,
        locale: locale ?? "en-US"
      });
      const fileName = stripSpecialCharacters(
        `${order.data.purchaseReturnOrderId ?? ""} - ${datetime
          .timestamp()
          .slice(0, -5)}.pdf`
      );
      const path = `${companyId}/purchase-return-order/${purchaseReturnOrderId}/${fileName}`;
      const upload = await storage(system)
        .company(companyId)
        .upload(path, pdf.body, {
          cacheControl: `${12 * 60 * 60}`,
          contentType: "application/pdf",
          upsert: true
        });
      if (upload.error) throw upload.error;
      const document = await upsertDocument(system, {
        path,
        name: fileName,
        size: kilobytes(pdf.body),
        sourceDocument: "Purchase Return Order",
        sourceDocumentId: purchaseReturnOrderId,
        readGroups: [userId],
        writeGroups: [userId],
        createdBy: userId,
        companyId
      });
      if (document.error) throw document.error;
    } catch (err) {
      logger.error("Failed to attach the return order PDF", {
        companyId,
        purchaseReturnOrderId,
        error: err
      });
      return {
        purchaseReturnOrderId,
        warning: "Return order confirmed, but the PDF could not be generated"
      };
    }
    return { purchaseReturnOrderId, warning: null };
  }
});

// ── Purchasing planning ─────────────────────────────────────────────────────
/**
 * Order purchasing suggestions at a location.
 *
 * @remarks
 * The purchasing planning page's Order. Each suggested order with a supplier
 * and a period becomes a line on a Planned purchase order: one order per
 * supplier per week (`planningPurchaseOrderWeek`), reusing the supplier's open
 * Draft / Planned order at the location that covers only that week in the
 * supplier's currency, else a new one. An order for an item the purchase
 * order already has on the same date adds to that line. The quantity is
 * raised to the supplier part's minimum; the price is the supplier part's,
 * converted at today's rate (refused for a currency with no rate); the tax is
 * the supplier's. An item whose purchasing is blocked is skipped. The orders
 * raised keep their planning approval bypass, the supply forecast is
 * recorded, and the Order suggestions they answer are settled.
 *
 * Existing lines are changed with `purchasing_planning_updateLine` or
 * `purchasing_planning_apply`, never here. Refused when nothing could be
 * ordered; otherwise the problems are listed in `errors`.
 *
 * @mcp
 */
export const orderPlannedPurchases = defineServiceFn({
  input: z.object({
    locationId: z.string(),
    items: z
      .array(
        z.object({ id: z.string(), orders: z.array(plannedOrderValidator) })
      )
      .min(1, "No items were provided to create purchase orders")
  }),
  permission: { create: "purchasing" },

  async run(ctx, { locationId, items: itemsToOrder }) {
    const client = ctx.asSystem.supabase;
    const companyId = ctx.company.id;
    const companyGroupId = ctx.company.groupId;
    const userId = ctx.auditUserId;

    // `order` only creates PO lines. An existing line is changed through
    // `updateLine` or Apply, which carry the status, promised-date and
    // tax-pair guards; a stale client naming one here would get a duplicate.
    if (
      itemsToOrder.some((item) =>
        item.orders.some((o) => o.existingLineId || o.existingId)
      )
    ) {
      return ctx.error(
        "validation",
        "Existing orders are changed from the Open Orders list"
      );
    }

    const supplierIds = new Set<string>();
    const itemIds = new Set<string>();
    const periodIds = new Set<string>();
    const allSupplyForecasts: Array<{
      itemId: string;
      locationId: string;
      sourceType: "Purchase Order";
      forecastQuantity: number;
      periodId: string;
      companyId: string;
      createdBy: string;
      updatedBy: string;
    }> = [];

    // Group new orders by supplier; below, each supplier's orders are split
    // again by week, so a supplier gets one PO per week.
    type OrderEntry = {
      itemId: string;
      order: (typeof itemsToOrder)[0]["orders"][0];
    };
    const ordersBySupplier = new Map<string, OrderEntry[]>();
    const errors: string[] = [];
    // The (item, week) of every order that became a PO line, so the Order
    // suggestions it answers leave the worklist now, not at the next run.
    const ordered: { itemId: string; periodId: string }[] = [];

    for (const item of itemsToOrder) {
      itemIds.add(item.id);
      let itemHasUsableOrder = false;
      for (const order of item.orders) {
        if (order.supplierId) supplierIds.add(order.supplierId);
        if (order.periodId) periodIds.add(order.periodId);
        if (order.supplierId && order.periodId) {
          ordersBySupplier.set(order.supplierId, [
            ...(ordersBySupplier.get(order.supplierId) ?? []),
            { itemId: item.id, order }
          ]);
          itemHasUsableOrder = true;
        }
      }
      if (!itemHasUsableOrder) {
        errors.push(
          `Item ${item.id} skipped: no order had both a supplier and a period (check that the item has a preferred supplier)`
        );
      }
    }

    // Every id comes from the caller and the writes bypass RLS: the location
    // and items must be this company's (supplyForecast upserts on
    // (itemId, locationId, periodId) alone).
    const location = await refuseUnlessOwned(ctx, "location", {
      id: locationId
    });
    if (location) return location;
    const ownedItems = await client
      .from("item")
      .select("id")
      .in("id", Array.from(itemIds))
      .eq("companyId", companyId);
    if (ownedItems.error || (ownedItems.data?.length ?? 0) !== itemIds.size) {
      logger.error("Planning order references records outside company", {
        companyId,
        userId,
        locationId,
        itemIds: Array.from(itemIds),
        error: ownedItems.error
      });
      return ctx.error("notFound", "Item not found");
    }

    const [suppliers, supplierParts, company, currencies, exchangeRates] =
      await Promise.all([
        client
          .from("supplier")
          .select("id, name, taxPercent, currencyCode")
          .in("id", Array.from(supplierIds))
          .eq("companyId", companyId),
        client
          .from("supplierPart")
          .select("*")
          .in("itemId", Array.from(itemIds))
          .eq("companyId", companyId),
        client
          .from("company")
          .select("id, baseCurrencyCode")
          .eq("id", companyId)
          .single(),
        client
          .from("currencies")
          .select("code, decimalPlaces")
          .eq("companyGroupId", companyGroupId),
        // Today's rate for each currency a supplier part is priced in.
        client.rpc("get_exchange_rates", { p_company_id: companyId })
      ]);
    if (suppliers.error) {
      return ctx.error(
        "internal",
        "Failed to retrieve supplier information from database",
        suppliers.error
      );
    }
    if (supplierParts.error) {
      return ctx.error(
        "internal",
        "Failed to retrieve supplier part information from database",
        supplierParts.error
      );
    }
    if (company.error) {
      return ctx.error(
        "internal",
        "Failed to retrieve company information from database",
        company.error
      );
    }

    const suppliersById = new Map(
      suppliers.data.map((supplier) => [supplier.id, supplier])
    );
    const baseCurrencyCode = company.data.baseCurrencyCode ?? "USD";
    const exchangeRateByCurrency = new Map(
      (exchangeRates.data ?? []).map((rate) => [rate.currencyCode, rate.rate])
    );
    // Settlement amounts round at the currency's own decimals, so the planned
    // order carries a real money value rather than a raw product.
    const currencyDecimals = new Map(
      currencies.data?.map((c) => [c.code, c.decimalPlaces]) ?? []
    );

    let processedItems = 0;
    // Readable ids too, so the client can present a clickable toast.
    const poCache = new Map<string, { id: string; readableId: string }>();

    // Whether purchasing is blocked, for every item ordered, in one read.
    const purchasingRows = await client
      .from("itemReplenishment")
      .select("itemId, purchasingBlocked")
      .in("itemId", Array.from(itemIds))
      .eq("companyId", companyId);
    const purchasingByItem = new Map(
      (purchasingRows.data ?? []).map((row) => [row.itemId, row])
    );

    // Weeks are counted from the location's today, as the planning grid's are.
    const asOf = datetime.today(
      await getLocationTimeZone(client, locationId, companyId)
    );

    // Every open PO an order may join, with its lines, in one read: the
    // suppliers' Draft / Planned purchase orders at this location, oldest
    // first. The lines tell which weeks a PO already covers, and which line a
    // same-item, same-date order adds its quantity to.
    const openPurchaseOrders = await client
      .from("purchaseOrder")
      .select(
        "id, purchaseOrderId, supplierId, currencyCode, exchangeRate, createdFromPlanning, purchaseOrderDelivery!inner(locationId), purchaseOrderLine(id, itemId, requiredDate, purchaseQuantity, supplierUnitPrice, supplierShippingCost, taxPercent, supplierTaxAmount)"
      )
      .eq("companyId", companyId)
      .in("supplierId", Array.from(ordersBySupplier.keys()))
      .eq("purchaseOrderType", "Purchase")
      .in("status", ["Draft", "Planned"])
      .eq("purchaseOrderDelivery.locationId", locationId)
      .order("createdAt", { ascending: true });
    if (openPurchaseOrders.error) {
      return ctx.error(
        "internal",
        "Failed to retrieve open purchase orders from database",
        openPurchaseOrders.error
      );
    }

    const candidatePurchaseOrders = openPurchaseOrders.data.map((po) => ({
      id: po.id,
      purchaseOrderId: po.purchaseOrderId,
      supplierId: po.supplierId,
      currencyCode: po.currencyCode,
      exchangeRate: po.exchangeRate ?? 1,
      createdFromPlanning: po.createdFromPlanning,
      purchaseOrderLine: po.purchaseOrderLine ?? []
    }));

    // The POs this call raised, and the planning POs it added to: their
    // approval bypass (`createdFromPlanning`) is restored once their lines are
    // written, since the shared line writer clears it on any change. A Draft /
    // Planned PO someone created by hand stays unflagged.
    const planningPurchaseOrderIds = new Set<string>();

    for (const [supplierId, ordersForSupplier] of ordersBySupplier) {
      const supplier = suppliersById.get(supplierId);
      if (!supplier) {
        errors.push(`Supplier ${supplierId} not found`);
        continue;
      }

      const currencyCode = supplier.currencyCode ?? baseCurrencyCode;
      const decimals = currencyDecimals.get(currencyCode) ?? SCALE;

      // One PO per supplier per week, so each week's PO is finalized and sent
      // on its own and the later weeks stay Planned, where MRP can still move,
      // resize or cancel them.
      const ordersByWeek = new Map<string, OrderEntry[]>();
      for (const entry of ordersForSupplier) {
        const week = planningPurchaseOrderWeek(entry.order.dueDate, asOf);
        ordersByWeek.set(week, [...(ordersByWeek.get(week) ?? []), entry]);
      }

      for (const [week, ordersInGroup] of ordersByWeek) {
        let purchaseOrder = findPlanningPurchaseOrder(
          candidatePurchaseOrders,
          { supplierId, currencyCode, week },
          asOf
        );

        if (purchaseOrder) {
          if (purchaseOrder.createdFromPlanning) {
            planningPurchaseOrderIds.add(purchaseOrder.id);
          }
        } else {
          const createPO = await insertPurchaseOrder(client, {
            status: "Planned",
            supplierId,
            purchaseOrderType: "Purchase",
            currencyCode,
            locationId,
            companyId,
            companyGroupId,
            createdBy: userId
          });
          if (createPO.error || !createPO.data) {
            logger.error("Failed to create PO for supplier", {
              companyId,
              locationId,
              supplierId,
              week,
              error: createPO.error
            });
            errors.push(
              `Failed to create PO for supplier ${supplierId}: ${createPO.error?.message ?? "no data returned"}`
            );
            continue;
          }
          purchaseOrder = {
            id: createPO.data.id,
            purchaseOrderId: createPO.data.purchaseOrderId,
            supplierId,
            currencyCode,
            exchangeRate: createPO.data.exchangeRate,
            createdFromPlanning: true,
            purchaseOrderLine: []
          };
          planningPurchaseOrderIds.add(createPO.data.id);
          candidatePurchaseOrders.push(purchaseOrder);
        }

        const purchaseOrderId = purchaseOrder.id;
        poCache.set(`${supplierId}:${week}`, {
          id: purchaseOrderId,
          readableId: purchaseOrder.purchaseOrderId ?? purchaseOrderId
        });

        for (const { itemId, order } of ordersInGroup) {
          const supplierPart = supplierParts.data.find(
            (sp) => sp.itemId === itemId && sp.supplierId === supplierId
          );

          const purchasingError =
            purchasingRows.error ??
            (purchasingByItem.has(itemId)
              ? null
              : { message: "No replenishment record" });
          if (purchasingError) {
            errors.push(
              `Failed to retrieve purchasing data for item ${itemId}: ${purchasingError.message}`
            );
            continue;
          }
          if (purchasingByItem.get(itemId)?.purchasingBlocked) {
            errors.push(`Purchasing is blocked for item ${itemId}`);
            continue;
          }

          const minimumOrderQuantity = supplierPart?.minimumOrderQuantity ?? 0;
          const adjustedQuantity =
            minimumOrderQuantity > 0 && order.quantity < minimumOrderQuantity
              ? minimumOrderQuantity
              : order.quantity;

          // An order for an item the PO already has on the same date adds to
          // that line. Orders for different dates stay on separate lines so
          // each keeps its own required date.
          const requiredDate = order.dueDate ?? null;
          const existing = purchaseOrder.purchaseOrderLine.find(
            (line) =>
              line.itemId === itemId && line.requiredDate === requiredDate
          );

          if (existing) {
            const purchaseQuantity =
              (existing.purchaseQuantity ?? 0) + adjustedQuantity;
            // The extended price follows the quantity on its own; the tax
            // amount is stored, so it is restated at the line's rate.
            const tax = taxPairForQuantity(
              existing,
              purchaseQuantity,
              decimals
            );
            const updateLine = await client
              .from("purchaseOrderLine")
              .update({
                purchaseQuantity,
                taxPercent: tax.percent,
                supplierTaxAmount: tax.amount,
                updatedBy: userId
              })
              .eq("id", existing.id)
              .eq("companyId", companyId);
            if (updateLine.error) {
              errors.push(
                `Failed to update PO line for item ${itemId}: ${updateLine.error.message}`
              );
              continue;
            }
            existing.purchaseQuantity = purchaseQuantity;
            existing.taxPercent = tax.percent;
            existing.supplierTaxAmount = tax.amount;
          } else {
            // The supplier part's price is in its own currency; the line holds
            // the order's, converted at today's rate.
            const partCurrency = supplierPartCurrency(
              supplierPart?.currencyCode,
              baseCurrencyCode
            );
            // Base is always 1, whether or not the group lists it.
            const partRate =
              partCurrency === baseCurrencyCode
                ? 1
                : exchangeRateByCurrency.get(partCurrency);
            if (
              supplierPart?.supplierUnitPrice != null &&
              partCurrency !== currencyCode &&
              !partRate
            ) {
              errors.push(
                `No exchange rate for ${partCurrency}: set one in Accounting → Exchange Rates`
              );
              continue;
            }
            const supplierUnitPrice =
              supplierPart?.supplierUnitPrice != null
                ? convertUnitPrice(
                    supplierPart.supplierUnitPrice,
                    { currencyCode: partCurrency, exchangeRate: partRate ?? 1 },
                    { currencyCode, exchangeRate: purchaseOrder.exchangeRate }
                  )
                : 0;
            const taxPercent = supplier.taxPercent ?? 0;
            // supplier.taxPercent is a 0..1 fraction; the amount follows the
            // canonical denominator. Shipping is 0 on this path.
            const supplierTaxAmount = applyRate(
              taxableBase(supplierUnitPrice, adjustedQuantity, 0),
              taxPercent,
              decimals
            );
            const createLine = await upsertPurchaseOrderLine(client, {
              purchaseOrderId,
              itemId,
              description: order.description,
              purchaseOrderLineType: "Part",
              purchaseQuantity: adjustedQuantity,
              purchaseUnitOfMeasureCode:
                supplierPart?.supplierUnitOfMeasureCode ??
                order.unitOfMeasureCode,
              inventoryUnitOfMeasureCode: order.unitOfMeasureCode,
              conversionFactor: supplierPart?.conversionFactor ?? 1,
              supplierUnitPrice,
              exchangeRate: purchaseOrder.exchangeRate,
              taxPercent,
              supplierTaxAmount,
              supplierShippingCost: 0,
              requiredDate: order.dueDate ?? undefined,
              locationId,
              companyId,
              createdBy: userId
            });
            if (createLine.error) {
              errors.push(
                `Failed to create PO line for item ${itemId}: ${createLine.error.message}`
              );
              continue;
            }
            purchaseOrder.purchaseOrderLine.push({
              id: createLine.data.id,
              itemId,
              requiredDate,
              purchaseQuantity: adjustedQuantity,
              supplierUnitPrice,
              supplierShippingCost: 0,
              taxPercent,
              supplierTaxAmount
            });
          }

          processedItems++;
          ordered.push({ itemId, periodId: order.periodId });
          allSupplyForecasts.push({
            itemId,
            locationId,
            sourceType: "Purchase Order",
            forecastQuantity:
              order.quantity * (supplierPart?.conversionFactor ?? 1),
            periodId: order.periodId,
            companyId,
            createdBy: userId,
            updatedBy: userId
          });
        }
      }
    }

    if (allSupplyForecasts.length > 0) {
      const forecasts = await client
        .from("supplyForecast")
        .upsert(deduplicateForecasts(allSupplyForecasts), {
          onConflict: "itemId,locationId,periodId",
          ignoreDuplicates: false
        });
      if (forecasts.error) {
        const message = `Failed to insert supply forecasts: ${forecasts.error.message}`;
        logger.error(message, { companyId, locationId });
        errors.push(message);
      }
    }

    if (planningPurchaseOrderIds.size > 0) {
      const flagged = await client
        .from("purchaseOrder")
        .update({ createdFromPlanning: true })
        .in("id", [...planningPurchaseOrderIds])
        .eq("companyId", companyId);
      if (flagged.error) {
        // The orders stand; they go through approval like any other PO.
        logger.error("Failed to mark planning purchase orders", {
          companyId,
          purchaseOrderIds: [...planningPurchaseOrderIds],
          error: flagged.error
        });
      }
    }

    const settled = await settleNewSupplyPlanningActions(ctx.asSystem.pg, {
      companyId,
      locationId,
      userId,
      type: "Order",
      ordered
    });
    if (settled.error) {
      // The PO lines stand; the suggestions clear on the next MRP run.
      logger.error("Failed to settle ordered planning actions", {
        companyId,
        locationId,
        error: settled.error
      });
    }

    if (errors.length > 0 && processedItems === 0) {
      logger.error("Failed to process any planning orders", {
        companyId,
        locationId,
        itemIds: Array.from(itemIds),
        supplierIds: Array.from(supplierIds),
        periodIds: Array.from(periodIds),
        errors
      });
      return ctx.error(
        "rule",
        `Failed to process any items. Errors: ${errors.slice(0, 3).join("; ")}${
          errors.length > 3 ? ` and ${errors.length - 3} more...` : ""
        }`
      );
    }

    return {
      message:
        processedItems === itemsToOrder.length
          ? `Successfully processed all ${processedItems} items`
          : `Processed ${processedItems} of ${itemsToOrder.length} items. ${
              errors.length
            } errors occurred: ${errors.slice(0, 2).join("; ")}${
              errors.length > 2 ? "..." : ""
            }`,
      processedItems,
      totalItems: itemsToOrder.length,
      // Each supplier week has its own PO; the dedupe is only a guard.
      purchaseOrders: Array.from(
        new Map(Array.from(poCache.values()).map((po) => [po.id, po])).values()
      ),
      errors: errors.length > 0 ? errors : undefined
    };
  }
});

/**
 * Change the quantity or due date of a purchase order line from planning.
 *
 * @remarks
 * The planning drawer's Open Orders cell. Only a line at `locationId`, on a
 * Draft or Planned order (not in approval, not sent), and for a due date only
 * when the supplier has promised none. The tax pair is restated with the
 * quantity.
 *
 * @mcp
 */
export const updatePlanningPurchaseOrderLine = defineServiceFn({
  input: z.object({
    locationId: z.string(),
    line: z.discriminatedUnion("field", [
      z.object({
        id: z.string().min(1),
        field: z.literal("quantity"),
        value: z.number().positive()
      }),
      z.object({
        id: z.string().min(1),
        field: z.literal("dueDate"),
        value: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
      })
    ])
  }),
  permission: { update: "purchasing" },

  async run(ctx, { locationId, line }) {
    const companyId = ctx.company.id;
    const committed = () =>
      ctx.error(
        "conflict",
        "This purchase order is in approval or has been sent to the supplier. Change it on the order."
      );

    const target = await ctx.asSystem.supabase
      .from("purchaseOrderLine")
      .select(
        "id, locationId, promisedDate, purchaseOrder!inner(id, status, purchaseOrderDelivery(receiptPromisedDate))"
      )
      .eq("id", line.id)
      .eq("companyId", companyId)
      .maybeSingle();
    if (target.error || !target.data) {
      return ctx.error(
        "notFound",
        "Purchase order line not found",
        target.error
      );
    }
    // The drawer lists one location's orders; a request for another
    // location's line did not come from it.
    if (target.data.locationId !== locationId) {
      return ctx.error(
        "conflict",
        "This purchase order line is for another location."
      );
    }
    if (
      !isPurchaseOrderEditableFromPlanning(target.data.purchaseOrder?.status)
    ) {
      return committed();
    }
    if (
      line.field === "dueDate" &&
      promisedDateOf({
        promisedDate: target.data.promisedDate,
        receiptPromisedDate:
          target.data.purchaseOrder?.purchaseOrderDelivery?.receiptPromisedDate
      }) !== null
    ) {
      return ctx.error(
        "conflict",
        "The supplier has promised a date for this line. Change it on the order."
      );
    }

    const saved = await updatePurchaseOrderLineSchedule(
      ctx.asSystem.supabase,
      ctx.asSystem.pg,
      {
        lineId: target.data.id,
        companyId,
        companyGroupId: ctx.company.groupId,
        userId: ctx.auditUserId,
        ...(line.field === "quantity"
          ? { purchaseQuantity: line.value }
          : { requiredDate: line.value })
      }
    );
    if (saved.error) {
      return ctx.error(
        "internal",
        "Failed to update purchase order line",
        saved.error
      );
    }
    // Sent or put in approval after the status check above.
    if (!saved.updated) return committed();
    return { message: "Updated purchase order line" };
  }
});

const PLANNING_ACTION_TYPE_OF: Record<string, string> = {
  expedite: "Expedite",
  defer: "Defer",
  increase: "Increase",
  decrease: "Decrease",
  cancel: "Cancel"
};
const PLANNING_CHANGE_TYPES = new Set(Object.values(PLANNING_ACTION_TYPE_OF));

/** A planning worklist's ids: one each, at least one. */
const planningActionIds = z
  .array(z.string().min(1))
  .min(1)
  .transform((ids) => [...new Set(ids)]);

type PlanningLine = {
  id: string;
  purchaseOrderId: string;
  conversionFactor: number | null;
  promisedDate: string | null;
  purchaseOrderStatus:
    | Database["public"]["Enums"]["purchaseOrderStatus"]
    | null;
  receiptPromisedDate: string | null;
};

/**
 * Apply MRP's suggestions to their purchase order lines.
 *
 * @remarks
 * Each Open planning action is applied as it was suggested (the type, line,
 * quantity and date come from the stored action, never the caller):
 * Expedite and Defer move the line's required date, Increase and Decrease
 * its quantity, Cancel deletes the line (needs `delete: purchasing`). `type`
 * `apply` takes any of them; the others only their own. An action whose
 * order is in approval or sent, or whose date the supplier promised, is
 * listed in `requiresManualAction` to review on the order. Everything is
 * written in one transaction. `success` is false when an action failed or
 * nothing could be applied.
 *
 * @mcp
 */
export const applyPlanningActions = defineServiceFn({
  input: z.object({
    planningActionIds,
    type: z.enum([
      "apply",
      "expedite",
      "defer",
      "increase",
      "decrease",
      "cancel"
    ])
  }),
  permission: { update: "purchasing" },

  async run(ctx, { planningActionIds: ids, type }) {
    const db = ctx.asSystem.pg;
    const companyId = ctx.company.id;
    const applied: string[] = [];
    const requiresManualAction: {
      id: string;
      purchaseOrderId: string | null;
    }[] = [];
    const errors: string[] = [];

    // Two reads for the whole batch decide what is eligible, then ONE
    // transaction applies all of it.
    const actionRows = await getPlanningActionsByIds(db, { ids, companyId });
    if (actionRows.error) {
      return ctx.error(
        "internal",
        "Failed to read planning actions",
        actionRows.error
      );
    }
    const rowById = new Map(actionRows.data.map((row) => [row.id, row]));

    const eligible: {
      planningActionId: string;
      row: (typeof actionRows.data)[number];
    }[] = [];
    for (const planningActionId of ids) {
      const row = rowById.get(planningActionId);
      if (!row) {
        errors.push(`Planning action ${planningActionId} not found`);
        continue;
      }
      if (row.status !== "Open") {
        errors.push(`Planning action ${planningActionId} is not open`);
        continue;
      }
      if (
        type === "apply"
          ? !PLANNING_CHANGE_TYPES.has(row.type)
          : PLANNING_ACTION_TYPE_OF[type] !== row.type
      ) {
        errors.push(
          type === "apply"
            ? `Planning action ${planningActionId} is a ${row.type}, which Apply cannot batch`
            : `Planning action ${planningActionId} is a ${row.type}, not ${PLANNING_ACTION_TYPE_OF[type]}`
        );
        continue;
      }
      if (!row.purchaseOrderLineId) {
        errors.push(
          `Planning action ${planningActionId} does not target a purchase order line`
        );
        continue;
      }
      eligible.push({ planningActionId, row });
    }

    // One statement: the id list goes to Postgres as a parameter, never into
    // a PostgREST URL.
    const lineIds = [
      ...new Set(eligible.map(({ row }) => row.purchaseOrderLineId!))
    ];
    let lineById: Map<string, PlanningLine>;
    try {
      const lines =
        lineIds.length > 0
          ? await db
              .selectFrom("purchaseOrderLine as pol")
              .innerJoin("purchaseOrder as po", (join) =>
                join
                  .onRef("po.id", "=", "pol.purchaseOrderId")
                  .on("po.companyId", "=", companyId)
              )
              .leftJoin("purchaseOrderDelivery as pod", "pod.id", "po.id")
              .select([
                "pol.id",
                "pol.purchaseOrderId",
                "pol.conversionFactor",
                "pol.promisedDate",
                "po.status as purchaseOrderStatus",
                "pod.receiptPromisedDate"
              ])
              .where("pol.id", "in", lineIds)
              .where("pol.companyId", "=", companyId)
              .execute()
          : [];
      lineById = new Map(lines.map((line) => [line.id, line]));
    } catch (err) {
      return ctx.error(
        "internal",
        "Failed to read the planning actions' purchase order lines",
        err
      );
    }

    const mayDeleteLines = ctx.can({ delete: "purchasing" });
    const toClaim: {
      planningActionId: string;
      row: (typeof eligible)[number]["row"];
      line: PlanningLine;
    }[] = [];
    for (const { planningActionId, row } of eligible) {
      const line = lineById.get(row.purchaseOrderLineId!);
      if (!line) {
        errors.push(
          `Purchase order line for planning action ${planningActionId} not found`
        );
        continue;
      }
      const datePromised =
        (row.type === "Expedite" || row.type === "Defer") &&
        promisedDateOf(line) !== null;
      if (
        !isPurchaseOrderEditableFromPlanning(line.purchaseOrderStatus) ||
        datePromised
      ) {
        // In approval or sent, or a date the supplier promised (which the
        // required date cannot move): review on the order instead.
        requiresManualAction.push({
          id: planningActionId,
          purchaseOrderId: line.purchaseOrderId
        });
        continue;
      }
      if (row.type === "Cancel" && !mayDeleteLines) {
        errors.push(
          `Planning action ${planningActionId} deletes a purchase order line, which needs delete permission`
        );
        continue;
      }
      toClaim.push({ planningActionId, row, line });
    }

    let outcome: Awaited<ReturnType<typeof applyPurchasingPlanningActions>>;
    try {
      outcome = await applyPurchasingPlanningActions(db, {
        companyId,
        companyGroupId: ctx.company.groupId,
        userId: ctx.auditUserId,
        actions: toClaim.map(({ planningActionId, row, line }) => ({
          planningActionId,
          type: row.type as
            | "Expedite"
            | "Defer"
            | "Increase"
            | "Decrease"
            | "Cancel",
          lineId: line.id,
          purchaseOrderId: line.purchaseOrderId,
          suggestedDate: row.suggestedDate ?? null,
          suggestedQuantity:
            row.suggestedQuantity === null ||
            row.suggestedQuantity === undefined
              ? null
              : Number(row.suggestedQuantity)
        }))
      });
    } catch (err) {
      return ctx.error(
        "internal",
        `Failed to apply planning actions: ${
          err instanceof Error ? err.message : "unknown error"
        }`,
        err
      );
    }
    applied.push(...outcome.applied);
    requiresManualAction.push(...outcome.refused);
    for (const id of outcome.alreadyApplied) {
      errors.push(`Planning action ${id} was already applied`);
    }
    for (const failure of outcome.failed) {
      errors.push(`Planning action ${failure.id}: ${failure.message}`);
    }

    // Committed targets are not failures, but "Applied 0" as a success is a
    // lie: name the manual-review count, and report success only when
    // something was applied (or nothing needed review).
    const manualCount = requiresManualAction.length;
    const messageParts = [
      `Applied ${applied.length} planning action${applied.length === 1 ? "" : "s"}`
    ];
    if (manualCount > 0) {
      messageParts.push(
        `${manualCount} target${manualCount === 1 ? " is" : "s are"} committed — review on the order`
      );
    }
    if (errors.length > 0) messageParts.push(`${errors.length} failed`);
    return {
      success:
        errors.length === 0 && !(applied.length === 0 && manualCount > 0),
      message: messageParts.join("; "),
      applied,
      requiresManualAction,
      errors: errors.length > 0 ? errors : undefined
    };
  }
});
/**
 * Dismiss purchasing suggestions.
 *
 * @remarks
 * Hides Open Buy planning actions from the worklist until their need changes
 * materially. An action applied or changed since it was read is skipped;
 * refused when none changed.
 *
 * @mcp
 */
export const dismissPurchasingPlanningActions = defineServiceFn({
  input: z.object({ planningActionIds }),
  permission: { update: "purchasing" },

  async run(ctx, { planningActionIds: ids }) {
    const result = await dismissPlanningActions(ctx.asSystem.pg, {
      ids,
      companyId: ctx.company.id,
      userId: ctx.auditUserId,
      kind: "Buy"
    });
    if (result.error) {
      return ctx.error(
        "internal",
        "Failed to dismiss planning actions",
        result.error
      );
    }
    return worklistChange(
      ctx,
      "Dismissed",
      result.data?.length ?? 0,
      ids.length
    );
  }
});

/**
 * Reopen dismissed purchasing suggestions.
 *
 * @remarks
 * Puts dismissed Buy planning actions back on the worklist. An action that
 * changed since it was read is skipped; refused when none changed.
 *
 * @mcp
 */
export const reopenPurchasingPlanningActions = defineServiceFn({
  input: z.object({ planningActionIds }),
  permission: { update: "purchasing" },

  async run(ctx, { planningActionIds: ids }) {
    const result = await reopenDismissedPlanningActions(ctx.asSystem.pg, {
      ids,
      companyId: ctx.company.id,
      userId: ctx.auditUserId,
      kind: "Buy"
    });
    if (result.error) {
      return ctx.error(
        "internal",
        "Failed to reopen planning actions",
        result.error
      );
    }
    return worklistChange(
      ctx,
      "Reopened",
      result.data?.length ?? 0,
      ids.length
    );
  }
});

/**
 * Assign purchasing suggestions to a person.
 *
 * @remarks
 * Sets the owner of Buy planning actions, which MRP then keeps; no
 * `assignee` clears it. The assignee must be an active employee of the
 * company. An action that changed since it was read is skipped; refused when
 * none changed.
 *
 * @mcp
 */
export const assignPurchasingPlanningActions = defineServiceFn({
  input: z.object({ planningActionIds, assignee: z.string().optional() }),
  permission: { update: "purchasing" },

  async run(ctx, { planningActionIds: ids, assignee }) {
    const companyId = ctx.company.id;
    if (
      assignee &&
      !(await isActiveCompanyEmployee(
        ctx.asSystem.supabase,
        companyId,
        assignee
      ))
    ) {
      return ctx.error("validation", "Choose an employee of this company");
    }
    const result = await assignPlanningActions(ctx.asSystem.pg, {
      ids,
      companyId,
      assignee: assignee || null,
      userId: ctx.auditUserId,
      kind: "Buy"
    });
    if (result.error) {
      return ctx.error(
        "internal",
        "Failed to assign planning actions",
        result.error
      );
    }
    return worklistChange(
      ctx,
      "Assigned",
      result.data?.length ?? 0,
      ids.length
    );
  }
});
