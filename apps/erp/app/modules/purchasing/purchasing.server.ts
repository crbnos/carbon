// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { CarbonError, defineServiceFn } from "@carbon/api/service-fn.server";
import { paged, payload, unwrap } from "@carbon/api/service-tools.server";
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
  getApprovalRuleByAmount,
  getApproverUserIdsForRule,
  getLatestApprovalRequestForDocument,
  getLowerTierApproverUserIds,
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
import {
  applyRate,
  async,
  datetime,
  deriveRate,
  escapeHTMLChars,
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
  invokePosting,
  isActiveCompanyEmployee,
  refuseUnlessOwned
} from "~/modules/shared/shared.service";
import { getUser } from "~/modules/users/users.service";
import { ERP_URL, path } from "~/utils/path";
import { stripSpecialCharacters } from "~/utils/string";
import { fromServerFn } from "../shared/shared.service";
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
  purchaseOrderStatusType,
  purchaseReturnOrderLineValidator,
  purchasingRfqFinalizeValidator,
  purchasingRfqValidator,
  selectedLineSchema,
  splitRfqModelAttachments,
  supplierQuoteFinalizeValidator,
  taxPairForQuantity
} from "./purchasing.models";
import { renderPurchaseReturnOrderPdf } from "./purchasing.pdf";
import * as service from "./purchasing.service";

// ── Operations ──────────────────────────────────────────────────────────────
// `defineServiceFn` operations: what the routes, the API and MCP call, so each
// holds every check its button made. Listed by entity in `index.server.ts`.

const logger = getLogger("erp", "purchasing");

/** How long a model link in an RFQ email works: a supplier may open it days later. */
const RFQ_MODEL_LINK_SECONDS = 7 * 24 * 60 * 60;

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
    const created = await service.insertPurchasingRFQ(ctx.asCaller.supabase, {
      ...rfq,
      rfqId: rfq.rfqId || undefined,
      companyId,
      createdBy: ctx.auditUserId
    });
    if (created.error || !created.data) {
      return ctx.error("internal", "Failed to insert RFQ", created.error);
    }

    const suppliers = await service.upsertPurchasingRFQSuppliers(
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
    const statuses = await service.statusesOf(ctx, "purchasingRfq", input.ids);
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
    const update = await service.updatePurchasingRFQStatus(client, {
      id: rfqId,
      status: "Closed",
      assignee: null,
      updatedBy: ctx.auditUserId
    });
    if (update.error) {
      return ctx.error("internal", "Failed to cancel RFQ", update.error);
    }

    const linked = await service.getLinkedSupplierQuotes(client, rfqId);
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
      service.getPurchasingRFQ(client, rfqId),
      service.getPurchasingRFQLines(client, rfqId)
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

    const finalize = await invokePosting(
      ctx,
      "finalize-purchasing-rfq",
      { rfqId },
      service.finalizePurchasingRfq
    );
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
        ...(await service.interactionAttachments(client, companyId, rfqId)),
        ...(await service.getSupplierInteractionLineAttachments(
          client,
          companyId,
          (lines.data ?? []).flatMap((line) => (line.id ? [line.id] : []))
        ))
      ];
      // Each part's original CAD file: attached while the email stays under the
      // limit, a download link past it.
      const models = await service.getItemModelFiles(
        client,
        ctx.asSystem.pg,
        companyId,
        [
          ...new Set(
            (lines.data ?? []).flatMap((line) =>
              line.itemId ? [line.itemId] : []
            )
          )
        ]
      );
      const documentBytes = attachments.reduce(
        (sum, file) => sum + (file.size ?? 0),
        0
      );
      const split = splitRfqModelAttachments(
        models,
        PO_EMAIL_ATTACHMENT_LIMIT_MB * 1024 * 1024 - documentBytes
      );
      // A model whose attachment link could not be signed goes as a link; one
      // with no link either is named, so the supplier knows to ask for it.
      const attachSigned = await async.map(split.attach, async (model) => ({
        model,
        url: await service.signOriginalModelFile(client, companyId, model, 3600)
      }));
      const modelAttachments = attachSigned.flatMap(({ model, url }) =>
        url ? [{ filename: model.filename, path: url }] : []
      );
      const signedLinks = await async.map(
        [
          ...split.link,
          ...attachSigned.flatMap(({ model, url }) => (url ? [] : [model]))
        ],
        async (model) => ({
          model,
          url: await service.signOriginalModelFile(
            client,
            companyId,
            model,
            RFQ_MODEL_LINK_SECONDS
          )
        })
      );
      const modelLinks = signedLinks.flatMap(({ model, url }) =>
        url ? [{ filename: model.filename, url }] : []
      );
      const missingModels = signedLinks.flatMap(({ model, url }) =>
        url ? [] : [model.filename]
      );
      const missingHtml = missingModels.length
        ? `<br><br>These models could not be included; reply to ask for them: ${missingModels
            .map(escapeHTMLChars)
            .join(", ")}`
        : "";
      const missingText = missingModels.length
        ? `\n\nThese models could not be included; reply to ask for them: ${missingModels.join(", ")}`
        : "";
      const modelLinksHtml = modelLinks.length
        ? `<br><br>Models too large to attach (links valid for 7 days):<br>${modelLinks
            .map(
              (model) =>
                `<a href="${escapeHTMLChars(model.url)}">${escapeHTMLChars(model.filename)}</a>`
            )
            .join("<br>")}${missingHtml}`
        : missingHtml;
      const modelLinksText = modelLinks.length
        ? `\n\nModels too large to attach (links valid for 7 days):\n${modelLinks
            .map((model) => `${model.filename}: ${model.url}`)
            .join("\n")}${missingText}`
        : missingText;
      const notesHtml = tiptapToHTML(
        (rfq.data?.internalNotes ?? {}) as JSONContent
      );

      for (const email of emails) {
        try {
          const link = `${ERP_URL}${path.to.externalSupplierQuote(email.externalLinkId)}`;
          const body = `Hey ${email.firstName},\n\nPlease provide pricing and lead time(s) for the linked quote:`;
          const signature = `Thanks,\n${user.data.firstName} ${user.data.lastName}\n${company.data.name}`;
          await trigger("send-email", {
            document: true,
            to: [user.data.email, email.to],
            from: user.data.email,
            subject: `Supplier Quote ${email.quoteReadableId} from ${company.data.name}`,
            html: [
              body.replace(/\n/g, "<br>"),
              `<br><a href="${link}">${link}</a>`,
              modelLinksHtml,
              notesHtml ? `<br><br>${notesHtml}` : "",
              `<br><br>${signature.replace(/\n/g, "<br>")}`
            ].join(""),
            text: `${body}\n\n${link}${modelLinksText}\n\n${signature}`,
            attachments: [
              ...attachments.map(({ filename, path }) => ({ filename, path })),
              ...modelAttachments
            ],
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
    const statuses = await service.statusesOf(ctx, "supplierQuote", ids);
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

    const quote = await service.getSupplierQuote(client, supplierQuoteId);
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

    const link = await service.supplierQuoteLink(ctx, {
      ...quote.data,
      id: supplierQuoteId
    });
    if (link instanceof CarbonError) return link;

    const finalize = await invokePosting(
      ctx,
      "finalize-supplier-quote",
      { supplierQuoteId },
      service.finalizeSupplierQuote
    );
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

    const quote = await service.getSupplierQuote(client, supplierQuoteId);
    if (quote.error) {
      return ctx.error("internal", "Failed to get supplier quote", quote.error);
    }

    const link = await service.supplierQuoteLink(ctx, {
      ...quote.data,
      id: supplierQuoteId
    });
    if (link instanceof CarbonError) return link;

    const send = await service.sendSupplierQuote(
      client,
      supplierQuoteId,
      userId
    );
    if (send.error) {
      return ctx.error("internal", "Failed to send supplier quote", send.error);
    }

    if (notification !== "Email") return { supplierQuoteId };
    if (!supplierContact) {
      return ctx.error("validation", "Supplier contact is required for email");
    }

    const [company, contact, user, lines] = await Promise.all([
      getCompany(client, companyId),
      service.getSupplierContact(client, supplierContact, companyId),
      getUser(client, userId),
      service.getSupplierQuoteLines(client, supplierQuoteId)
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
        ? await service.interactionAttachments(client, companyId, interactionId)
        : []),
      ...(await service.getSupplierInteractionLineAttachments(
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
        document: true,
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
    const quote = await service.sharedSupplierQuote(ctx, supplierQuoteId);
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
    const quote = await service.sharedSupplierQuote(ctx, supplierQuoteId);
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
    const statuses = await service.statusesOf(ctx, "purchaseReturnOrder", ids);
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
      await service.cancelPurchaseReturnOrder(ctx.asSystem.pg, {
        id: purchaseReturnOrderId,
        companyId: ctx.company.id,
        userId: ctx.auditUserId
      });
    } catch (err) {
      return service.refusedBy(ctx, err, "Failed to update status");
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
      await service.reopenPurchaseReturnOrder(ctx.asSystem.pg, {
        id: purchaseReturnOrderId,
        companyId: ctx.company.id,
        userId: ctx.auditUserId
      });
    } catch (err) {
      return service.refusedBy(ctx, err, "Failed to update status");
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

    const order = await service.getPurchaseReturnOrder(client, orderId);
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

    const created = await service.upsertPurchaseReturnOrderLine(client, {
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
      const returnable = await service.getReturnableEntitiesForReceiptLine(
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
      const set = await service.setPurchaseReturnOrderLineTrackedEntities(
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

    const order = await service.getPurchaseReturnOrder(client, orderId);
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

    const update = await service.upsertPurchaseReturnOrderLine(client, {
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

    const set = await service.setPurchaseReturnOrderLineTrackedEntities(
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
    const refused = await service.postLease(
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
    const refused = await service.postLease(
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
    const refused = await service.postLease(
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
    const refused = await service.postLease(
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
    const refused = await service.postLease(
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
    const refused = await service.writeClassificationOverride(ctx, {
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
    const refused = await service.writeClassificationOverride(ctx, {
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
      const statuses = await service.statusesOf(ctx, "purchaseOrder", ids);
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

    // One transaction: a delete that fails (an invoice line still names the
    // order) must leave its approval requests pending.
    const removed = await ctx
      .transaction(async (tx) => {
        await service.cancelPendingApprovals(tx.asSystem.pg, {
          companyId,
          userId,
          purchaseOrderIds: needsApproval
        });
        await tx.asSystem.pg
          .deleteFrom("purchaseOrder")
          .where("id", "in", ids)
          .where("companyId", "=", companyId)
          .execute();
      })
      .catch((err) =>
        ctx.error("internal", "Failed to delete purchase orders", err)
      );
    if (removed instanceof CarbonError) return removed;
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
      if (latest.error) {
        return ctx.error(
          "internal",
          "Failed to read the approval requests",
          latest.error
        );
      }
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
    // One transaction: a reopen that fails leaves the requests pending.
    const reopened = await ctx
      .transaction(async (tx) => {
        if (currentStatus === "Needs Approval" || currentStatus === "Closed") {
          await service.cancelPendingApprovals(tx.asSystem.pg, {
            companyId,
            userId,
            purchaseOrderIds: [purchaseOrderId]
          });
        }
        if (!createRevision) {
          await service.setPurchaseOrderStatus(tx.asSystem.pg, {
            id: purchaseOrderId,
            companyId,
            status,
            assignee: undefined,
            updatedBy: userId
          });
          return false;
        }
        const rows = await service.reopenPurchaseOrderAsRevision(
          tx.asSystem.pg,
          { id: purchaseOrderId, companyId, updatedBy: userId, status }
        );
        return rows === 0
          ? tx.error(
              "conflict",
              "Only a released purchase order can be revised"
            )
          : true;
      })
      .catch((err) =>
        ctx.error(
          "internal",
          createRevision
            ? "Failed to create revision"
            : "Failed to update purchasing order status",
          err
        )
      );
    if (reopened instanceof CarbonError) return reopened;
    if (reopened.error) return reopened.error;
    if (reopened.data) return { purchaseOrderId, status, revision: true };

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
 * invoiced against it. Its pending approval requests are cancelled. Needs
 * permission to update and to delete purchase orders.
 *
 * @mcp destructive
 */
export const closePurchaseOrderAndApprovals = defineServiceFn({
  input: z.object({ purchaseOrderId: z.string() }),
  // The status write runs as the system: update is what RLS demanded of it.
  permission: { update: "purchasing", delete: "purchasing" },

  async run(ctx, { purchaseOrderId }) {
    const owned = await refuseUnlessOwned(ctx, "purchaseOrder", {
      id: purchaseOrderId
    });
    if (owned) return owned;

    // One transaction: a close that fails leaves the requests pending.
    const closed = await ctx
      .transaction(async (tx) => {
        const requests = await service.cancelPendingApprovals(tx.asSystem.pg, {
          companyId: ctx.company.id,
          userId: ctx.auditUserId,
          purchaseOrderIds: [purchaseOrderId]
        });
        await service.setPurchaseOrderStatus(tx.asSystem.pg, {
          id: purchaseOrderId,
          companyId: ctx.company.id,
          status: "Closed",
          assignee: null,
          updatedBy: ctx.auditUserId
        });
        return requests.length;
      })
      .catch((err) =>
        ctx.error("internal", "Failed to update purchasing order status", err)
      );
    if (closed instanceof CarbonError) return closed;
    if (closed.data) {
      logger.info("Cancelled pending approval requests when closing", {
        companyId: ctx.company.id,
        purchaseOrderId,
        count: closed.data
      });
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
  // Submitting for approval writes as the system: update is what RLS
  // demanded of that status write.
  permission: { create: "purchasing", update: "purchasing" },

  async run(
    ctx,
    { purchaseOrderId, notification, supplierContact, cc, locale }
  ) {
    const system = ctx.asSystem.supabase;
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;

    const purchaseOrder = await service.getPurchaseOrder(
      system,
      purchaseOrderId
    );
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
      const supplier = await service.getSupplier(
        system,
        purchaseOrder.data.supplierId
      );
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

    // The PDF, the email and the prices wait for the approval. The order is
    // never released first: the status and the request are one transaction,
    // so it cannot be left released with no approval.
    if (approvalRequired) {
      const orderDate = datetime
        .today(await getCompanyTimeZone(system, companyId))
        .toString();
      const submitted = await ctx
        .transaction((tx) =>
          service.submitPurchaseOrderForApproval(tx.asSystem.pg, {
            id: purchaseOrderId,
            companyId,
            userId,
            amount,
            orderDate
          })
        )
        .catch((err) =>
          ctx.error(
            "internal",
            "Failed to submit the purchase order for approval",
            err
          )
        );
      if (submitted instanceof CarbonError) return submitted;
      trackWorkEvent(
        "purchase_order_finalized",
        { companyId, userId, purchaseOrderId, stage: "gated" },
        { discriminator: "gated" }
      );

      if (submitted.data) {
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
      return { purchaseOrderId, needsApproval: true };
    }

    const finalize = await service.finalizePurchaseOrder(
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
      { companyId, userId, purchaseOrderId, stage: "committed" },
      { discriminator: "committed" }
    );

    await service.updatePricesOnFinalize(ctx, purchaseOrderId);

    const pdf = await service.attachPurchaseOrderPdf(ctx, {
      purchaseOrder: purchaseOrder.data,
      locale: locale ?? "en-US"
    });
    if (pdf instanceof CarbonError) return pdf;

    if (notification === "Email" && supplierContact) {
      try {
        const email = await service.purchaseOrderEmail(ctx, {
          purchaseOrderId,
          supplierContactId: supplierContact,
          locale: locale ?? "en-US"
        });
        if (email) {
          const interactionId = email.purchaseOrder.supplierInteractionId;
          const defaults = await service.getDefaultAttachmentsForPO(system, {
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
              ? await service.interactionAttachments(
                  system,
                  companyId,
                  interactionId
                )
              : []),
            ...(await service.signedAttachments(
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
            document: true,
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
      await service.releaseApprovedPurchaseOrder(ctx, input);
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

    const order = await service.getPurchaseReturnOrder(
      system,
      purchaseReturnOrderId
    );
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
      await service.confirmPurchaseReturnOrder(
        ctx.asSystem.pg,
        { id: purchaseReturnOrderId, companyId },
        userId
      );
    } catch (err) {
      return service.refusedBy(ctx, err, "Failed to confirm return order");
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
        size: service.kilobytes(pdf.body),
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
 * Existing lines are changed with `purchasing_updatePlanningPurchaseOrderLine` or
 * `purchasing_applyPlanningActions`, never here. Refused when nothing could be
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
          const createPO = await service.insertPurchaseOrder(client, {
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
            const createLine = await service.upsertPurchaseOrderLine(client, {
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
        .upsert(service.deduplicateForecasts(allSupplyForecasts), {
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
      service.promisedDateOf({
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

    const saved = await service.updatePurchaseOrderLineSchedule(
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
        service.promisedDateOf(line) !== null;
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

    let outcome: Awaited<
      ReturnType<typeof service.applyPurchasingPlanningActions>
    >;
    try {
      outcome = await service.applyPurchasingPlanningActions(db, {
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
    return service.worklistChange(
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
    return service.worklistChange(
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
    return service.worklistChange(
      ctx,
      "Assigned",
      result.data?.length ?? 0,
      ids.length
    );
  }
});
/**
 * Convert supplier quote to order
 *
 * @mcp
 */
export const convertSupplierQuoteToOrder = defineServiceFn({
  input: z.looseObject({
    id: z.string(),
    selectedLines: z.record(z.string(), z.unknown())
  }),
  permission: { update: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.convertSupplierQuoteToOrder(
        ctx.asCaller.supabase,
        ctx.asSystem.pg,
        payload(ctx, input).withUser().forUpdate() as never
      )
    );
  }
});

/**
 * Delete purchase order line
 *
 * @mcp destructive
 */
export const deletePurchaseOrderLine = defineServiceFn({
  input: z.looseObject({ purchaseOrderLineId: z.string() }),
  permission: { delete: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deletePurchaseOrderLine(
        ctx.asCaller.supabase,
        input.purchaseOrderLineId as never
      )
    );
  }
});

/**
 * Duplicate purchase order
 *
 * @mcp
 */
export const duplicatePurchaseOrder = defineServiceFn({
  input: z.looseObject({ sourcePurchaseOrderId: z.string() }),
  permission: { create: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.duplicatePurchaseOrder(
        ctx.asCaller.supabase,
        payload(ctx, input).withGroup().withUser().forUpsert() as never
      )
    );
  }
});

/**
 * Delete supplier
 *
 * @mcp destructive
 */
export const deleteSupplier = defineServiceFn({
  input: z.looseObject({ supplierId: z.string() }),
  permission: { delete: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteSupplier(
        ctx.asCaller.supabase,
        input.supplierId as never
      )
    );
  }
});

/**
 * Delete supplier contact
 *
 * @mcp destructive
 */
export const deleteSupplierContact = defineServiceFn({
  input: z.looseObject({
    supplierId: z.string(),
    supplierContactId: z.string()
  }),
  permission: { delete: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteSupplierContact(
        ctx.asCaller.supabase,
        input.supplierId as never,
        input.supplierContactId as never
      )
    );
  }
});

/**
 * Delete supplier location
 *
 * @mcp destructive
 */
export const deleteSupplierLocation = defineServiceFn({
  input: z.looseObject({
    supplierId: z.string(),
    supplierLocationId: z.string()
  }),
  permission: { delete: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteSupplierLocation(
        ctx.asCaller.supabase,
        input.supplierId as never,
        input.supplierLocationId as never
      )
    );
  }
});

/**
 * Delete supplier bank account
 *
 * @mcp destructive
 */
export const deleteSupplierBankAccount = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteSupplierBankAccount(
        ctx.asCaller.supabase,
        input.id as never
      )
    );
  }
});

/**
 * Lists a supplier's bank accounts
 *
 * @mcp read
 */
export const getSupplierBankAccounts = defineServiceFn({
  input: z.looseObject({ supplierId: z.string() }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getSupplierBankAccounts(
        ctx.asCaller.supabase,
        input.supplierId as never
      )
    );
  }
});

/**
 * Create a supplier bank account
 *
 * @remarks
 * Upsert supplier bank account
 *
 * @mcp
 */
export const createSupplierBankAccount = defineServiceFn({
  input: z.looseObject({
    supplierId: z.string().min(1),
    name: z.string().min(1),
    accountHolderName: z.string().optional(),
    bankName: z.string().min(1),
    bankAddress: z.string().min(1),
    countryCode: z.string().min(1),
    currencyCode: z.string().optional(),
    accountNumber: z.string().optional(),
    bankCode: z.string().optional(),
    swiftBic: z.string().optional(),
    notes: z.string().optional(),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "accounting" },
  async run(ctx, input) {
    return await service.upsertSupplierBankAccount(
      ctx.asSystem.pg,
      payload(ctx, input).forCreate() as never
    );
  }
});

/**
 * Update a supplier bank account
 *
 * @remarks
 * Upsert supplier bank account
 *
 * @mcp
 */
export const updateSupplierBankAccount = defineServiceFn({
  input: z
    .looseObject({
      supplierId: z.string().min(1),
      name: z.string().min(1),
      accountHolderName: z.string().optional(),
      bankName: z.string().min(1),
      bankAddress: z.string().min(1),
      countryCode: z.string().min(1),
      currencyCode: z.string().optional(),
      accountNumber: z.string().optional(),
      bankCode: z.string().optional(),
      swiftBic: z.string().optional(),
      notes: z.string().optional(),
      customFields: z.unknown().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "accounting" },
  async run(ctx, input) {
    return await service.upsertSupplierBankAccount(
      ctx.asSystem.pg,
      payload(ctx, input).forUpdate() as never
    );
  }
});

/**
 * Delete supplier process
 *
 * @mcp destructive
 */
export const deleteSupplierProcess = defineServiceFn({
  input: z.looseObject({ supplierProcessId: z.string() }),
  permission: { delete: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteSupplierProcess(
        ctx.asCaller.supabase,
        input.supplierProcessId as never
      )
    );
  }
});

/**
 * Delete supplier quote
 *
 * @mcp destructive
 */
export const deleteSupplierQuote = defineServiceFn({
  input: z.looseObject({ supplierQuoteId: z.string() }),
  permission: { delete: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteSupplierQuote(
        ctx.asCaller.supabase,
        input.supplierQuoteId as never
      )
    );
  }
});

/**
 * Delete supplier quote line
 *
 * @mcp destructive
 */
export const deleteSupplierQuoteLine = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteSupplierQuoteLine(
        ctx.asCaller.supabase,
        input.id as never
      )
    );
  }
});

/**
 * Delete supplier type
 *
 * @mcp destructive
 */
export const deleteSupplierType = defineServiceFn({
  input: z.looseObject({ supplierTypeId: z.string() }),
  permission: { delete: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteSupplierType(
        ctx.asCaller.supabase,
        input.supplierTypeId as never
      )
    );
  }
});

/**
 * Get purchase order
 *
 * @mcp read
 */
export const getPurchaseOrder = defineServiceFn({
  input: z.looseObject({ purchaseOrderId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getPurchaseOrder(
        ctx.asCaller.supabase,
        input.purchaseOrderId as never
      )
    );
  }
});

/**
 * Get purchase orders
 *
 * @mcp read
 */
export const getPurchaseOrders = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional(),
    status: z.enum(purchaseOrderStatusType).nullable().optional(),
    supplierId: z.string().nullable().optional()
  }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getPurchaseOrders(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get purchase order delivery
 *
 * @mcp read
 */
export const getPurchaseOrderDelivery = defineServiceFn({
  input: z.looseObject({ purchaseOrderId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getPurchaseOrderDelivery(
        ctx.asCaller.supabase,
        input.purchaseOrderId as never
      )
    );
  }
});

/**
 * Get purchase order payment
 *
 * @mcp read
 */
export const getPurchaseOrderPayment = defineServiceFn({
  input: z.looseObject({ purchaseOrderId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getPurchaseOrderPayment(
        ctx.asCaller.supabase,
        input.purchaseOrderId as never
      )
    );
  }
});

/**
 * Get purchase order lines
 *
 * @mcp read
 */
export const getPurchaseOrderLines = defineServiceFn({
  input: z.looseObject({ purchaseOrderId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getPurchaseOrderLines(
        ctx.asCaller.supabase,
        input.purchaseOrderId as never
      )
    );
  }
});

/**
 * Get purchase order line
 *
 * @mcp read
 */
export const getPurchaseOrderLine = defineServiceFn({
  input: z.looseObject({ purchaseOrderLineId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getPurchaseOrderLine(
        ctx.asCaller.supabase,
        input.purchaseOrderLineId as never
      )
    );
  }
});

/**
 * Get purchasing documents assigned to me
 *
 * @mcp read
 */
export const getPurchasingDocumentsAssignedToMe = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "purchasing" },
  async run(ctx) {
    return await service.getPurchasingDocumentsAssignedToMe(
      ctx.asCaller.supabase,
      ctx.auditUserId,
      ctx.company.id
    );
  }
});

/**
 * Get purchasing planning
 *
 * @mcp read
 */
export const getPurchasingPlanning = defineServiceFn({
  input: z.looseObject({
    locationId: z.string(),
    periods: z.array(z.string()),
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional(),
    asOf: z.string(),
    actionTypes: z.array(z.string()).optional(),
    actionAssignees: z.array(z.string()).optional()
  }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getPurchasingPlanning(
        ctx.asCaller.supabase,
        input.locationId as never,
        ctx.company.id,
        payload(ctx, input.periods).build() as never,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get supplier
 *
 * @mcp read
 */
export const getSupplier = defineServiceFn({
  input: z.looseObject({ supplierId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getSupplier(
        ctx.asCaller.supabase,
        input.supplierId as never
      )
    );
  }
});

/**
 * Get supplier contact
 *
 * @mcp read
 */
export const getSupplierContact = defineServiceFn({
  input: z.looseObject({ supplierContactId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getSupplierContact(
        ctx.asCaller.supabase,
        input.supplierContactId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get supplier contacts
 *
 * @mcp read
 */
export const getSupplierContacts = defineServiceFn({
  input: z.looseObject({ supplierId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getSupplierContacts(
        ctx.asCaller.supabase,
        input.supplierId as never
      )
    );
  }
});

/**
 * Get supplier interaction
 *
 * @mcp read
 */
export const getSupplierInteraction = defineServiceFn({
  input: z.looseObject({ opportunityId: z.string().nullable() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getSupplierInteraction(
        ctx.asCaller.supabase,
        input.opportunityId as never
      )
    );
  }
});

/**
 * Get supplier interaction documents
 *
 * @mcp read
 */
export const getSupplierInteractionDocuments = defineServiceFn({
  input: z.looseObject({ interactionId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return await service.getSupplierInteractionDocuments(
      ctx.asCaller.supabase,
      ctx.company.id,
      input.interactionId as never
    );
  }
});

/**
 * Get supplier interaction line documents
 *
 * @mcp read
 */
export const getSupplierInteractionLineDocuments = defineServiceFn({
  input: z.looseObject({ lineId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return await service.getSupplierInteractionLineDocuments(
      ctx.asCaller.supabase,
      ctx.company.id,
      input.lineId as never
    );
  }
});

/**
 * Get supplier locations
 *
 * @mcp read
 */
export const getSupplierLocations = defineServiceFn({
  input: z.looseObject({ supplierId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getSupplierLocations(
        ctx.asCaller.supabase,
        input.supplierId as never
      )
    );
  }
});

/**
 * Get supplier location
 *
 * @mcp read
 */
export const getSupplierLocation = defineServiceFn({
  input: z.looseObject({ supplierContactId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getSupplierLocation(
        ctx.asCaller.supabase,
        input.supplierContactId as never
      )
    );
  }
});

/**
 * Get supplier payment
 *
 * @mcp read
 */
export const getSupplierPayment = defineServiceFn({
  input: z.looseObject({ supplierId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getSupplierPayment(
        ctx.asCaller.supabase,
        input.supplierId as never
      )
    );
  }
});

/**
 * Get supplier processes by process
 *
 * @mcp read
 */
export const getSupplierProcessesByProcess = defineServiceFn({
  input: z.looseObject({ processId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getSupplierProcessesByProcess(
        ctx.asCaller.supabase,
        input.processId as never
      )
    );
  }
});

/**
 * Get supplier processes by supplier
 *
 * @mcp read
 */
export const getSupplierProcessesBySupplier = defineServiceFn({
  input: z.looseObject({ supplierId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getSupplierProcessesBySupplier(
        ctx.asCaller.supabase,
        input.supplierId as never
      )
    );
  }
});

/**
 * Get supplier quote
 *
 * @mcp read
 */
export const getSupplierQuote = defineServiceFn({
  input: z.looseObject({ supplierQuoteId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getSupplierQuote(
        ctx.asCaller.supabase,
        input.supplierQuoteId as never
      )
    );
  }
});

/**
 * Get supplier quote by external link id
 *
 * @mcp read
 */
export const getSupplierQuoteByExternalLinkId = defineServiceFn({
  input: z.looseObject({ externalLinkId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getSupplierQuoteByExternalLinkId(
        ctx.asCaller.supabase,
        input.externalLinkId as never
      )
    );
  }
});

/**
 * Get supplier quotes
 *
 * @mcp read
 */
export const getSupplierQuotes = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getSupplierQuotes(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get supplier quote line
 *
 * @mcp read
 */
export const getSupplierQuoteLine = defineServiceFn({
  input: z.looseObject({ supplierQuoteLineId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getSupplierQuoteLine(
        ctx.asCaller.supabase,
        input.supplierQuoteLineId as never
      )
    );
  }
});

/**
 * Get supplier quote lines
 *
 * @mcp read
 */
export const getSupplierQuoteLines = defineServiceFn({
  input: z.looseObject({ supplierQuoteId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getSupplierQuoteLines(
        ctx.asCaller.supabase,
        input.supplierQuoteId as never
      )
    );
  }
});

/**
 * Get supplier quote line prices
 *
 * @mcp read
 */
export const getSupplierQuoteLinePrices = defineServiceFn({
  input: z.looseObject({ supplierQuoteLineId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getSupplierQuoteLinePrices(
        ctx.asCaller.supabase,
        input.supplierQuoteLineId as never
      )
    );
  }
});

/**
 * Get supplier quote line prices by quote id
 *
 * @mcp read
 */
export const getSupplierQuoteLinePricesByQuoteId = defineServiceFn({
  input: z.looseObject({ supplierQuoteId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getSupplierQuoteLinePricesByQuoteId(
        ctx.asCaller.supabase,
        input.supplierQuoteId as never
      )
    );
  }
});

/**
 * Get supplier shipping
 *
 * @mcp read
 */
export const getSupplierShipping = defineServiceFn({
  input: z.looseObject({ supplierId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getSupplierShipping(
        ctx.asCaller.supabase,
        input.supplierId as never
      )
    );
  }
});

/**
 * Get supplier report contacts
 *
 * @mcp read
 */
export const getSupplierReportContacts = defineServiceFn({
  input: z.looseObject({ supplierIds: z.array(z.string()) }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      ...(await service.getSupplierReportContacts(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input.supplierIds).build() as never
      ))
    );
  }
});

/**
 * Get suppliers
 *
 * @mcp read
 */
export const getSuppliers = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional(),
    type: z.string().nullable().optional(),
    status: z.string().nullable().optional()
  }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getSuppliers(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get suppliers list
 *
 * @mcp read
 */
export const getSuppliersList = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "purchasing" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getSuppliersList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get supplier type
 *
 * @mcp read
 */
export const getSupplierType = defineServiceFn({
  input: z.looseObject({ supplierTypeId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getSupplierType(
        ctx.asCaller.supabase,
        input.supplierTypeId as never
      )
    );
  }
});

/**
 * Get supplier types
 *
 * @mcp read
 */
export const getSupplierTypes = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getSupplierTypes(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get supplier types list
 *
 * @mcp read
 */
export const getSupplierTypesList = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "purchasing" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getSupplierTypesList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Insert supplier contact
 *
 * @mcp
 */
export const insertSupplierContact = defineServiceFn({
  input: z.looseObject({
    supplierId: z.string(),
    contact: z.looseObject({
      id: z.string().optional(),
      contactId: z.string().optional(),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      title: z.string().optional(),
      email: z.string().min(1),
      mobilePhone: z.string().optional(),
      homePhone: z.string().optional(),
      workPhone: z.string().optional(),
      notes: z.string().optional(),
      supplierLocationId: z.string().optional()
    }),
    supplierLocationId: z.string().optional(),
    customFields: z.unknown().optional()
  }),
  permission: { create: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.insertSupplierContact(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpsert() as never
      )
    );
  }
});

/**
 * Insert supplier location
 *
 * @mcp
 */
export const insertSupplierLocation = defineServiceFn({
  input: z.looseObject({
    supplierId: z.string(),
    name: z.string(),
    address: z.looseObject({
      addressLine1: z.string().optional(),
      addressLine2: z.string().optional(),
      city: z.string().optional(),
      stateProvince: z.string().optional(),
      postalCode: z.string().optional(),
      countryCode: z.string().optional()
    }),
    customFields: z.unknown().optional()
  }),
  permission: { create: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.insertSupplierLocation(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpsert() as never
      )
    );
  }
});

/**
 * Update purchase order exchange rate
 *
 * @mcp
 */
export const updatePurchaseOrderExchangeRate = defineServiceFn({
  input: z.looseObject({ id: z.string(), exchangeRate: z.number() }),
  permission: { update: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.updatePurchaseOrderExchangeRate(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Mark or unmark a purchase order as one of the caller's favorites.
 *
 * @remarks
 * Changes only the caller's own favorites list; the record is unchanged.
 *
 * @mcp
 */
export const updatePurchaseOrderFavorite = defineServiceFn({
  input: z.looseObject({ id: z.string(), favorite: z.boolean() }),
  permission: { update: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.updatePurchaseOrderFavorite(
        ctx.asCaller.supabase,
        payload(ctx, input).withUser().build() as never
      )
    );
  }
});

/**
 * Update supplier contact
 *
 * @mcp
 */
export const updateSupplierContact = defineServiceFn({
  input: z.looseObject({
    contactId: z.string(),
    contact: z.looseObject({
      id: z.string().optional(),
      contactId: z.string().optional(),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      title: z.string().optional(),
      email: z.string().min(1),
      mobilePhone: z.string().optional(),
      homePhone: z.string().optional(),
      workPhone: z.string().optional(),
      notes: z.string().optional(),
      supplierLocationId: z.string().optional()
    }),
    supplierLocationId: z.string().optional(),
    customFields: z.unknown().optional()
  }),
  permission: { update: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.updateSupplierContact(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Update supplier location
 *
 * @mcp
 */
export const updateSupplierLocation = defineServiceFn({
  input: z.looseObject({
    addressId: z.string(),
    name: z.string(),
    address: z.looseObject({
      addressLine1: z.string().optional(),
      addressLine2: z.string().optional(),
      city: z.string().optional(),
      stateProvince: z.string().optional(),
      countryCode: z.string().optional(),
      postalCode: z.string().optional()
    }),
    customFields: z.unknown().optional()
  }),
  permission: { update: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.updateSupplierLocation(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Update supplier payment
 *
 * @mcp
 */
export const updateSupplierPayment = defineServiceFn({
  input: z.looseObject({
    supplierId: z.string().min(1),
    invoiceSupplierId: z.string().optional(),
    invoiceSupplierLocationId: z.string().optional(),
    invoiceSupplierContactId: z.string().optional(),
    paymentTermId: z.string().optional(),
    customFields: z.unknown().optional()
  }),
  permission: { update: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.updateSupplierPayment(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Update supplier quote exchange rate
 *
 * @mcp
 */
export const updateSupplierQuoteExchangeRate = defineServiceFn({
  input: z.looseObject({ id: z.string(), exchangeRate: z.number() }),
  permission: { update: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.updateSupplierQuoteExchangeRate(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Update supplier quote status
 *
 * @mcp
 */
export const updateSupplierQuoteStatus = defineServiceFn({
  input: z.looseObject({
    id: z.string(),
    status: z.enum(["Draft", "Active", "Expired", "Declined", "Cancelled"]),
    assignee: z.null().optional()
  }),
  permission: { update: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.updateSupplierQuoteStatus(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Update supplier shipping
 *
 * @mcp
 */
export const updateSupplierShipping = defineServiceFn({
  input: z.looseObject({
    supplierId: z.string().min(1),
    shippingSupplierId: z.string().optional(),
    shippingSupplierLocationId: z.string().optional(),
    shippingSupplierContactId: z.string().optional(),
    shippingMethodId: z.string().optional(),
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
  permission: { update: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.updateSupplierShipping(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Get supplier tax
 *
 * @mcp read
 */
export const getSupplierTax = defineServiceFn({
  input: z.looseObject({ supplierId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getSupplierTax(
        ctx.asCaller.supabase,
        input.supplierId as never
      )
    );
  }
});

/**
 * Update supplier tax
 *
 * @mcp
 */
export const updateSupplierTax = defineServiceFn({
  input: z.looseObject({
    supplierId: z.string().min(1),
    taxId: z.string().optional(),
    vatNumber: z.string().optional(),
    eori: z.string().optional(),
    taxExempt: z.boolean().optional(),
    taxExemptionReason: z
      .enum([
        "Resale",
        "Government",
        "Nonprofit",
        "Agriculture",
        "Industrial",
        "Export",
        "Medical",
        "Educational",
        "Religious",
        "Other"
      ])
      .nullable()
      .optional(),
    taxExemptionCertificateNumber: z.string().optional(),
    taxExemptionCertificatePath: z.string().nullable().optional()
  }),
  permission: { update: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.updateSupplierTax(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Create a new purchase order with all business logic - generates sequence, creates supplier interaction, resolves payment/shipping defaults from supplier
 *
 * @remarks
 * Create a new purchase order with all business logic - generates sequence, creates supplier interaction, resolves payment/shipping defaults from supplier. LLM can create a PO with just supplierId.
 *
 * @mcp
 */
export const insertPurchaseOrder = defineServiceFn({
  input: z.looseObject({
    supplierId: z.string(),
    purchaseOrderId: z.string().optional(),
    purchaseOrderType: z
      .enum(["Purchase", "Return", "Outside Processing"])
      .optional(),
    locationId: z.string().optional(),
    status: z
      .enum([
        "Draft",
        "Planned",
        "Needs Approval",
        "To Review",
        "To Receive",
        "To Receive and Invoice",
        "To Invoice",
        "Completed",
        "Rejected",
        "Closed"
      ])
      .optional(),
    currencyCode: z.string().optional(),
    orderDate: z.string().optional(),
    supplierContactId: z.string().optional(),
    supplierLocationId: z.string().optional(),
    supplierQuoteId: z.string().optional(),
    receiptRequestedDate: z.string().optional(),
    supplierReference: z.string().optional(),
    notes: z.unknown().optional(),
    externalNotes: z.unknown().optional(),
    customFields: z.unknown().optional()
  }),
  permission: { create: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.insertPurchaseOrder(
        ctx.asCaller.supabase,
        payload(ctx, input).withGroup().forUpsert() as never
      )
    );
  }
});

/**
 * Update a purchase order's header.
 *
 * @remarks
 * The supplier, its contact and location, the supplier reference, the type,
 * the order date, the currency (its exchange rate is read again), internal
 * notes and custom fields. Refused on a finalized order. The status changes
 * only through finalize, reopen and close.
 *
 * @mcp
 */
export const updatePurchaseOrder = defineServiceFn({
  input: z.object({
    id: z.string(),
    currencyCode: z.string().optional(),
    orderDate: z.string().optional(),
    supplierId: z.string().optional(),
    supplierContactId: z.string().nullable().optional(),
    supplierLocationId: z.string().nullable().optional(),
    supplierReference: z.string().optional(),
    purchaseOrderType: z.enum(["Purchase", "Outside Processing"]).optional(),
    notes: z.string().nullable().optional(),
    customFields: z.record(z.string(), z.unknown()).optional()
  }),
  permission: { update: "purchasing" },
  async run(ctx, { customFields, ...input }) {
    const current = await ctx.asCaller.supabase
      .from("purchaseOrder")
      .select("status")
      .eq("id", input.id)
      .eq("companyId", ctx.company.id)
      .maybeSingle();
    if (current.error) {
      return ctx.error(
        "internal",
        "Failed to read the purchase order",
        current.error
      );
    }
    if (!current.data) return ctx.error("notFound", "Purchase order not found");
    if (isPurchaseOrderLocked(current.data.status)) {
      return ctx.error(
        "rule",
        "Cannot modify a finalized purchase order. To make changes, please cancel this PO and create a new one."
      );
    }
    return unwrap(
      ctx,
      await service.updatePurchaseOrder(ctx.asCaller.supabase, {
        ...input,
        customFields: customFields as Json | undefined,
        updatedBy: ctx.auditUserId
      })
    );
  }
});

/**
 * Upsert purchase order delivery
 *
 * @mcp
 */
export const upsertPurchaseOrderDelivery = defineServiceFn({
  input: z.looseObject({
    id: z.string(),
    locationId: z.string().optional(),
    shippingMethodId: z.string().optional(),
    trackingNumber: z.string(),
    deliveryDate: z.string().optional(),
    receiptRequestedDate: z.string().optional(),
    receiptPromisedDate: z.string().optional(),
    dropShipment: z.boolean().optional(),
    customerId: z.string().optional(),
    customerLocationId: z.string().optional(),
    supplierShippingCost: z.number().optional(),
    notes: z.string().optional(),
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
  permission: { create: "purchasing", update: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertPurchaseOrderDelivery(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Create a purchase order line
 *
 * @remarks
 * Upsert purchase order line
 *
 * @mcp
 */
export const createPurchaseOrderLine = defineServiceFn({
  input: z.looseObject({
    purchaseOrderId: z.string().min(1),
    purchaseOrderLineType: z.enum([
      "Part",
      "Material",
      "Tool",
      "Consumable",
      "Service",
      "Fixture",
      "G/L Account",
      "Fixed Asset"
    ]),
    itemId: z.string().optional(),
    accountId: z.string().optional(),
    costCenterId: z.string().optional(),
    assetId: z.string().optional(),
    conversionFactor: z.number().optional(),
    description: z.string().optional(),
    exchangeRate: z.number().optional(),
    inventoryUnitOfMeasureCode: z.string().optional(),
    jobId: z.string().optional(),
    jobOperationId: z.string().optional(),
    locationId: z.string().optional(),
    promisedDate: z.string().optional(),
    purchaseQuantity: z.number().optional(),
    purchaseUnitOfMeasureCode: z.string().optional(),
    requiredDate: z.string().optional(),
    storageUnitId: z.string().optional(),
    supplierPartId: z.string().optional(),
    supplierShippingCost: z.number().optional(),
    supplierTaxAmount: z.number().optional(),
    supplierUnitPrice: z.number().optional(),
    taxPercent: z
      .number()
      .min(0)
      .max(1)
      .default(0)
      .describe(
        "Applied when creating; on update a field left out keeps its value."
      ),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertPurchaseOrderLine(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

/**
 * Update a purchase order line
 *
 * @remarks
 * Upsert purchase order line
 *
 * @mcp
 */
export const updatePurchaseOrderLine = defineServiceFn({
  input: z
    .looseObject({
      purchaseOrderId: z.string().min(1),
      purchaseOrderLineType: z.enum([
        "Part",
        "Material",
        "Tool",
        "Consumable",
        "Service",
        "Fixture",
        "G/L Account",
        "Fixed Asset"
      ]),
      itemId: z.string().optional(),
      accountId: z.string().optional(),
      costCenterId: z.string().optional(),
      assetId: z.string().optional(),
      conversionFactor: z.number().optional(),
      description: z.string().optional(),
      exchangeRate: z.number().optional(),
      inventoryUnitOfMeasureCode: z.string().optional(),
      jobId: z.string().optional(),
      jobOperationId: z.string().optional(),
      locationId: z.string().optional(),
      promisedDate: z.string().optional(),
      purchaseQuantity: z.number().optional(),
      purchaseUnitOfMeasureCode: z.string().optional(),
      requiredDate: z.string().optional(),
      storageUnitId: z.string().optional(),
      supplierPartId: z.string().optional(),
      supplierShippingCost: z.number().optional(),
      supplierTaxAmount: z.number().optional(),
      supplierUnitPrice: z.number().optional(),
      taxPercent: z
        .number()
        .min(0)
        .max(1)
        .describe(
          "Applied when creating; on update a field left out keeps its value."
        )
        .optional(),
      customFields: z.unknown().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertPurchaseOrderLine(ctx.asCaller.supabase, {
        ...payload(ctx, input).forUpdate(),
        companyId: ctx.company.id
      } as never)
    );
  }
});

/**
 * Update purchase order line order
 *
 * @mcp
 */
export const updatePurchaseOrderLineOrder = defineServiceFn({
  input: z.looseObject({
    purchaseOrderId: z.string(),
    updates: z.array(z.looseObject({ id: z.string(), sortOrder: z.number() }))
  }),
  permission: { update: "purchasing" },
  async run(ctx, input) {
    return await service.updatePurchaseOrderLineOrder(
      ctx.asSystem.pg,
      ctx.company.id,
      ctx.auditUserId,
      input.purchaseOrderId as never,
      payload(ctx, input.updates).forUpdate() as never
    );
  }
});

/**
 * Short-close ("stop receiving") or reopen a purchase order line whose remaining quantity will never arrive
 *
 * @mcp
 */
export const shortClosePurchaseOrderLine = defineServiceFn({
  input: z.looseObject({
    lineId: z.string(),
    purchaseOrderId: z.string(),
    intent: z.enum(["close", "reopen"])
  }),
  permission: { update: "purchasing" },
  async run(ctx, input) {
    return await service.shortClosePurchaseOrderLine(
      ctx.asSystem.pg,
      payload(ctx, input).withUser().build() as never
    );
  }
});

/**
 * Upsert purchase order payment
 *
 * @mcp
 */
export const upsertPurchaseOrderPayment = defineServiceFn({
  input: z.looseObject({
    id: z.string(),
    invoiceSupplierId: z.string().optional(),
    invoiceSupplierLocationId: z.string().optional(),
    invoiceSupplierContactId: z.string().optional(),
    paymentTermId: z.string().optional(),
    customFields: z.unknown().optional()
  }),
  permission: { create: "purchasing", update: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertPurchaseOrderPayment(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Create a supplier
 *
 * @remarks
 * Upsert supplier
 *
 * @mcp
 */
export const createSupplier = defineServiceFn({
  input: z.looseObject({
    readableId: z.string().optional(),
    name: z.string().min(1),
    supplierStatus: z
      .enum(["Active", "Inactive", "Pending", "Rejected"])
      .nullable()
      .optional(),
    supplierTypeId: z.string().optional(),
    accountManagerId: z.string().optional(),
    currencyCode: z.string().optional(),
    purchasingContactId: z.string().optional(),
    website: z.string().optional(),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertSupplier(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

/**
 * Update a supplier
 *
 * @remarks
 * Upsert supplier
 *
 * @mcp
 */
export const updateSupplier = defineServiceFn({
  input: z
    .looseObject({
      readableId: z.string().optional(),
      name: z.string().min(1),
      supplierStatus: z
        .enum(["Active", "Inactive", "Pending", "Rejected"])
        .nullable()
        .optional(),
      supplierTypeId: z.string().optional(),
      accountManagerId: z.string().optional(),
      currencyCode: z.string().optional(),
      purchasingContactId: z.string().optional(),
      website: z.string().optional(),
      customFields: z.unknown().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertSupplier(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Create a supplier process
 *
 * @remarks
 * Upsert supplier process
 *
 * @mcp
 */
export const createSupplierProcess = defineServiceFn({
  input: z.looseObject({
    supplierId: z.string().min(1),
    processId: z.string().min(1),
    minimumCost: z.number().min(0),
    leadTime: z.number().min(0),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertSupplierProcess(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

/**
 * Update a supplier process
 *
 * @remarks
 * Upsert supplier process
 *
 * @mcp
 */
export const updateSupplierProcess = defineServiceFn({
  input: z
    .looseObject({
      supplierId: z.string().min(1),
      processId: z.string().min(1),
      minimumCost: z.number().min(0),
      leadTime: z.number().min(0),
      customFields: z.unknown().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertSupplierProcess(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Create a new supplier quote with all business logic - generates sequence, creates supplier interaction, sets up external link
 *
 * @remarks
 * Create a new supplier quote with all business logic - generates sequence, creates supplier interaction, sets up external link. LLM can create a quote with just supplierId.
 *
 * @mcp
 */
export const insertSupplierQuote = defineServiceFn({
  input: z.looseObject({
    supplierId: z.string(),
    supplierQuoteId: z.string().optional(),
    locationId: z.string().optional(),
    status: z
      .enum(["Draft", "Active", "Expired", "Declined", "Cancelled"])
      .optional(),
    currencyCode: z.string().optional(),
    expirationDate: z.string().optional(),
    supplierContactId: z.string().optional(),
    supplierLocationId: z.string().optional(),
    notes: z.string().optional(),
    customFields: z.unknown().optional(),
    quotedDate: z.string().optional(),
    supplierReference: z.string().optional(),
    supplierQuoteType: z.enum(["Purchase", "Outside Processing"]).optional()
  }),
  permission: { create: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.insertSupplierQuote(
        ctx.asCaller.supabase,
        payload(ctx, input).withGroup().forUpsert() as never
      )
    );
  }
});

/**
 * Update an existing supplier quote - handles exchange rate updates when currency changes
 *
 * @mcp
 */
export const updateSupplierQuote = defineServiceFn({
  input: z.looseObject({
    id: z.string(),
    status: z
      .enum(["Draft", "Active", "Expired", "Declined", "Cancelled"])
      .optional(),
    currencyCode: z.string().optional(),
    expirationDate: z.string().nullable().optional(),
    supplierContactId: z.string().nullable().optional(),
    supplierLocationId: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    customFields: z.unknown().optional()
  }),
  permission: { update: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.updateSupplierQuote(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Create a supplier quote line
 *
 * @remarks
 * Upsert supplier quote line
 *
 * @mcp
 */
export const createSupplierQuoteLine = defineServiceFn({
  input: z.looseObject({
    supplierQuoteId: z.string(),
    supplierQuoteLineType: z.enum([
      "Part",
      "Material",
      "Tool",
      "Consumable",
      "Service",
      "G/L Account"
    ]),
    itemId: z.string().optional(),
    accountId: z.string().optional(),
    costCenterId: z.string().optional(),
    description: z.string().optional(),
    supplierPartId: z.string().optional(),
    inventoryUnitOfMeasureCode: z.string().optional(),
    purchaseUnitOfMeasureCode: z.string().optional(),
    conversionFactor: z.number().optional(),
    requiredDate: z.string().optional(),
    quantity: z.array(z.number().min(0.00001)),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertSupplierQuoteLine(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

/**
 * Update a supplier quote line
 *
 * @remarks
 * Upsert supplier quote line
 *
 * @mcp
 */
export const updateSupplierQuoteLine = defineServiceFn({
  input: z
    .looseObject({
      supplierQuoteId: z.string(),
      supplierQuoteLineType: z.enum([
        "Part",
        "Material",
        "Tool",
        "Consumable",
        "Service",
        "G/L Account"
      ]),
      itemId: z.string().optional(),
      accountId: z.string().optional(),
      costCenterId: z.string().optional(),
      description: z.string().optional(),
      supplierPartId: z.string().optional(),
      inventoryUnitOfMeasureCode: z.string().optional(),
      purchaseUnitOfMeasureCode: z.string().optional(),
      conversionFactor: z.number().optional(),
      requiredDate: z.string().optional(),
      quantity: z.array(z.number().min(0.00001)),
      customFields: z.unknown().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertSupplierQuoteLine(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Update supplier quote line order
 *
 * @mcp
 */
export const updateSupplierQuoteLineOrder = defineServiceFn({
  input: z.looseObject({
    supplierQuoteId: z.string(),
    updates: z.array(z.looseObject({ id: z.string(), sortOrder: z.number() }))
  }),
  permission: { update: "purchasing" },
  async run(ctx, input) {
    return await service.updateSupplierQuoteLineOrder(
      ctx.asSystem.pg,
      ctx.company.id,
      ctx.auditUserId,
      input.supplierQuoteId as never,
      payload(ctx, input.updates).forUpdate() as never
    );
  }
});

/**
 * Create a supplier type
 *
 * @remarks
 * Upsert supplier type
 *
 * @mcp
 */
export const createSupplierType = defineServiceFn({
  input: z.looseObject({
    name: z.string().min(1),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertSupplierType(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

/**
 * Update a supplier type
 *
 * @remarks
 * Upsert supplier type
 *
 * @mcp
 */
export const updateSupplierType = defineServiceFn({
  input: z
    .looseObject({
      name: z.string().min(1),
      customFields: z.unknown().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertSupplierType(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Delete purchasing r f q
 *
 * @mcp destructive
 */
export const deletePurchasingRFQ = defineServiceFn({
  input: z.looseObject({ purchasingRfqId: z.string() }),
  permission: { delete: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deletePurchasingRFQ(
        ctx.asCaller.supabase,
        input.purchasingRfqId as never
      )
    );
  }
});

/**
 * Delete purchasing r f q line
 *
 * @mcp destructive
 */
export const deletePurchasingRFQLine = defineServiceFn({
  input: z.looseObject({ purchasingRfqLineId: z.string() }),
  permission: { delete: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deletePurchasingRFQLine(
        ctx.asCaller.supabase,
        input.purchasingRfqLineId as never
      )
    );
  }
});

/**
 * Get purchasing r f q
 *
 * @mcp read
 */
export const getPurchasingRFQ = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getPurchasingRFQ(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Get purchasing r f qs
 *
 * @mcp read
 */
export const getPurchasingRFQs = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getPurchasingRFQs(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get purchasing r f q line
 *
 * @mcp read
 */
export const getPurchasingRFQLine = defineServiceFn({
  input: z.looseObject({ lineId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getPurchasingRFQLine(
        ctx.asCaller.supabase,
        input.lineId as never
      )
    );
  }
});

/**
 * Get purchasing r f q lines
 *
 * @mcp read
 */
export const getPurchasingRFQLines = defineServiceFn({
  input: z.looseObject({ purchasingRfqId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getPurchasingRFQLines(
        ctx.asCaller.supabase,
        input.purchasingRfqId as never
      )
    );
  }
});

/**
 * Upsert purchasing r f q
 *
 * @mcp
 */
export const upsertPurchasingRFQ = defineServiceFn({
  input: z.looseObject({
    id: z.string().optional(),
    rfqId: z.string(),
    rfqDate: z.string(),
    expirationDate: z.string().optional(),
    locationId: z.string().optional(),
    employeeId: z.string().optional(),
    status: z.enum(["Draft", "Requested", "Closed"]).optional(),
    customFields: z.unknown().optional()
  }),
  permission: { create: "purchasing", update: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertPurchasingRFQ(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpsert() as never
      )
    );
  }
});

/**
 * Create a purchasing rfqline
 *
 * @remarks
 * Upsert purchasing r f q line
 *
 * @mcp
 */
export const createPurchasingRFQLine = defineServiceFn({
  input: z.looseObject({
    purchasingRfqId: z.string(),
    itemId: z.string(),
    description: z.string().optional(),
    quantity: z.array(z.number()),
    purchaseUnitOfMeasureCode: z.string(),
    inventoryUnitOfMeasureCode: z.string(),
    conversionFactor: z.number().optional(),
    order: z.number(),
    customFields: z.unknown().optional()
  }),
  permission: { create: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertPurchasingRFQLine(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

/**
 * Update a purchasing rfqline
 *
 * @remarks
 * Upsert purchasing r f q line
 *
 * @mcp
 */
export const updatePurchasingRFQLine = defineServiceFn({
  input: z.looseObject({
    id: z.string(),
    purchasingRfqId: z.string(),
    itemId: z.string(),
    description: z.string().optional(),
    quantity: z.array(z.number()),
    purchaseUnitOfMeasureCode: z.string(),
    inventoryUnitOfMeasureCode: z.string(),
    conversionFactor: z.number().optional(),
    order: z.number(),
    customFields: z.unknown().optional()
  }),
  permission: { update: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertPurchasingRFQLine(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Update purchasing r f q line order
 *
 * @mcp
 */
export const updatePurchasingRFQLineOrder = defineServiceFn({
  input: z.looseObject({
    purchasingRfqId: z.string(),
    updates: z.array(z.looseObject({ id: z.string(), sortOrder: z.number() }))
  }),
  permission: { update: "purchasing" },
  async run(ctx, input) {
    return await service.updatePurchasingRFQLineOrder(
      ctx.asSystem.pg,
      ctx.company.id,
      ctx.auditUserId,
      input.purchasingRfqId as never,
      payload(ctx, input.updates).forUpdate() as never
    );
  }
});

/**
 * Upsert purchasing r f q suppliers
 *
 * @mcp destructive
 */
export const upsertPurchasingRFQSuppliers = defineServiceFn({
  input: z.looseObject({
    purchasingRfqId: z.string(),
    supplierIds: z.array(z.string())
  }),
  permission: { create: "purchasing", update: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertPurchasingRFQSuppliers(
        ctx.asCaller.supabase,
        input.purchasingRfqId as never,
        payload(ctx, input.supplierIds).forUpsert() as never,
        ctx.company.id,
        ctx.auditUserId
      )
    );
  }
});

/**
 * Update purchasing r f q status
 *
 * @mcp
 */
export const updatePurchasingRFQStatus = defineServiceFn({
  input: z.looseObject({
    id: z.string(),
    status: z.enum(["Draft", "Requested", "Closed"]),
    assignee: z.string().nullable().optional()
  }),
  permission: { update: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.updatePurchasingRFQStatus(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Get linked supplier quotes
 *
 * @mcp read
 */
export const getLinkedSupplierQuotes = defineServiceFn({
  input: z.looseObject({ purchasingRfqId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getLinkedSupplierQuotes(
        ctx.asCaller.supabase,
        input.purchasingRfqId as never
      )
    );
  }
});

/**
 * Get sibling quotes for quote
 *
 * @mcp read
 */
export const getSiblingQuotesForQuote = defineServiceFn({
  input: z.looseObject({ supplierQuoteId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getSiblingQuotesForQuote(
        ctx.asCaller.supabase,
        input.supplierQuoteId as never
      )
    );
  }
});

/**
 * Get supplier quotes for comparison
 *
 * @mcp read
 */
export const getSupplierQuotesForComparison = defineServiceFn({
  input: z.looseObject({ purchasingRfqId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getSupplierQuotesForComparison(
        ctx.asCaller.supabase,
        input.purchasingRfqId as never
      )
    );
  }
});

/**
 * Get purchasing r f q suppliers with links
 *
 * @mcp read
 */
export const getPurchasingRFQSuppliersWithLinks = defineServiceFn({
  input: z.looseObject({ purchasingRfqId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getPurchasingRFQSuppliersWithLinks(
        ctx.asCaller.supabase,
        input.purchasingRfqId as never
      )
    );
  }
});

/**
 * Get default attachments for p o
 *
 * @mcp read
 */
export const getDefaultAttachmentsForPO = defineServiceFn({
  input: z.looseObject({
    supplierId: z.string().nullable(),
    itemIds: z.array(z.string())
  }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return await service.getDefaultAttachmentsForPO(
      ctx.asCaller.supabase,
      payload(ctx, input).build() as never
    );
  }
});

/**
 * Get purchase return orders
 *
 * @mcp read
 */
export const getPurchaseReturnOrders = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    supplierId: z.string().nullable().optional()
  }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getPurchaseReturnOrders(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get purchase return order
 *
 * @mcp read
 */
export const getPurchaseReturnOrder = defineServiceFn({
  input: z.looseObject({ purchaseReturnOrderId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getPurchaseReturnOrder(
        ctx.asCaller.supabase,
        input.purchaseReturnOrderId as never
      )
    );
  }
});

/**
 * Get purchase return order lines
 *
 * @mcp read
 */
export const getPurchaseReturnOrderLines = defineServiceFn({
  input: z.looseObject({ purchaseReturnOrderId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getPurchaseReturnOrderLines(
        ctx.asCaller.supabase,
        input.purchaseReturnOrderId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get purchase return order line
 *
 * @mcp read
 */
export const getPurchaseReturnOrderLine = defineServiceFn({
  input: z.looseObject({ lineId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getPurchaseReturnOrderLine(
        ctx.asCaller.supabase,
        input.lineId as never
      )
    );
  }
});

/**
 * Get purchase return order line tracked entities
 *
 * @mcp read
 */
export const getPurchaseReturnOrderLineTrackedEntities = defineServiceFn({
  input: z.looseObject({ lineIds: z.array(z.string()) }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getPurchaseReturnOrderLineTrackedEntities(
        ctx.asCaller.supabase,
        payload(ctx, input.lineIds).build() as never
      )
    );
  }
});

/**
 * Insert purchase return order
 *
 * @mcp
 */
export const insertPurchaseReturnOrder = defineServiceFn({
  input: z.looseObject({
    supplierId: z.string(),
    purchaseReturnOrderId: z.string().optional(),
    orderDate: z.string(),
    supplierLocationId: z.string().optional(),
    supplierContactId: z.string().optional(),
    supplierReference: z.string().optional(),
    locationId: z.string().optional(),
    purchaseOrderId: z.string().optional(),
    currencyCode: z.string().optional(),
    expirationDate: z.string().optional(),
    assignee: z.string().optional(),
    customFields: z.unknown().optional()
  }),
  permission: { create: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.insertPurchaseReturnOrder(
        ctx.asCaller.supabase,
        payload(ctx, input).withGroup().forUpsert() as never
      )
    );
  }
});

/**
 * Delete purchase return order
 *
 * @mcp destructive
 */
export const deletePurchaseReturnOrder = defineServiceFn({
  input: z.looseObject({ purchaseReturnOrderId: z.string() }),
  permission: { delete: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deletePurchaseReturnOrder(
        ctx.asCaller.supabase,
        input.purchaseReturnOrderId as never
      )
    );
  }
});

/**
 * Delete purchase return order line
 *
 * @mcp destructive
 */
export const deletePurchaseReturnOrderLine = defineServiceFn({
  input: z.looseObject({ lineId: z.string() }),
  permission: { delete: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deletePurchaseReturnOrderLine(
        ctx.asCaller.supabase,
        input.lineId as never
      )
    );
  }
});

/**
 * Get purchase return order shipments
 *
 * @mcp read
 */
export const getPurchaseReturnOrderShipments = defineServiceFn({
  input: z.looseObject({ purchaseReturnOrderId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getPurchaseReturnOrderShipments(
        ctx.asCaller.supabase,
        input.purchaseReturnOrderId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get purchase return order credits
 *
 * @mcp read
 */
export const getPurchaseReturnOrderCredits = defineServiceFn({
  input: z.looseObject({ purchaseReturnOrderId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getPurchaseReturnOrderCredits(
        ctx.asCaller.supabase,
        input.purchaseReturnOrderId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get purchase return order issues
 *
 * @mcp read
 */
export const getPurchaseReturnOrderIssues = defineServiceFn({
  input: z.looseObject({ purchaseReturnOrderId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getPurchaseReturnOrderIssues(
        ctx.asCaller.supabase,
        input.purchaseReturnOrderId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Short-close ("stop expecting") a supplier return line — the shortClosePurchaseOrderLine mechanic
 *
 * @mcp
 */
export const shortClosePurchaseReturnOrderLine = defineServiceFn({
  input: z.looseObject({
    lineId: z.string(),
    purchaseReturnOrderId: z.string(),
    intent: z.enum(["close", "reopen"])
  }),
  permission: { update: "purchasing" },
  async run(ctx, input) {
    return await service.shortClosePurchaseReturnOrderLine(
      ctx.asSystem.pg,
      payload(ctx, input).withUser().build() as never
    );
  }
});

/**
 * Returnable receipt lines for a supplier, searched + paginated in the database via the get_returnable_receipt_lines RPC
 *
 * @mcp read
 */
export const getReturnableLinesForSupplier = defineServiceFn({
  input: z.looseObject({
    supplierId: z.string(),
    purchaseOrderId: z.string().optional(),
    search: z.string().optional(),
    limit: z.number().optional(),
    offset: z.number().optional()
  }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getReturnableLinesForSupplier(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.supplierId as never,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Entity picker source for supplier return lines: serials/batches on hand that were received from this supplier
 *
 * @mcp read
 */
export const getReturnableEntitiesForSupplier = defineServiceFn({
  input: z.looseObject({ supplierId: z.string(), itemId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getReturnableEntitiesForSupplier(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.supplierId as never,
        input.itemId as never
      )
    );
  }
});

/**
 * Per-line creditable pool = shipped − already credited
 *
 * @mcp read
 */
export const getCreditableQuantitiesForPurchaseReturn = defineServiceFn({
  input: z.looseObject({ purchaseReturnOrderId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getCreditableQuantitiesForPurchaseReturn(
        ctx.asCaller.supabase,
        input.purchaseReturnOrderId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Issue supplier credit: one AP memo + per-line purchaseReturnOrderCreditLine breakdown
 *
 * @mcp
 */
export const createPurchaseReturnOrderCredit = defineServiceFn({
  input: z.looseObject({
    purchaseReturnOrderId: z.string(),
    memoDate: z.string(),
    lines: z.array(
      z.looseObject({
        purchaseReturnOrderLineId: z.string(),
        quantity: z.number()
      })
    )
  }),
  permission: { create: "invoicing" },
  async run(ctx, input) {
    return await service.createPurchaseReturnOrderCredit(
      ctx.asCaller.supabase,
      ctx.asSystem.pg,
      payload(ctx, input).withGroup().withUser().forUpsert() as never
    );
  }
});

/**
 * Create a replacement purchase order from a supplier return: a Draft order of
 * the return lines, priced from the linked order line, else the supplier part.
 *
 * @remarks
 * One replacement per return.
 *
 * @mcp
 */
export const createReplacementPurchaseOrder = defineServiceFn({
  input: z.looseObject({ purchaseReturnOrderId: z.string() }),
  permission: { create: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.createReplacementPurchaseOrder(
        ctx.asCaller.supabase,
        payload(ctx, input).withGroup().withUser().forUpsert() as never
      )
    );
  }
});

/**
 * Create a presigned upload URL for a supplier interaction (purchase order/supplier quote/RFQ) document
 *
 * @mcp
 */
export const createSupplierInteractionDocumentUploadUrl = defineServiceFn({
  input: z.looseObject({ interactionId: z.string(), name: z.string() }),
  permission: { create: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.createSupplierInteractionDocumentUploadUrl(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpsert() as never
      )
    );
  }
});

/**
 * Create a presigned upload URL for a supplier interaction LINE document
 *
 * @mcp
 */
export const createSupplierInteractionLineDocumentUploadUrl = defineServiceFn({
  input: z.looseObject({ lineId: z.string(), name: z.string() }),
  permission: { create: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.createSupplierInteractionLineDocumentUploadUrl(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpsert() as never
      )
    );
  }
});

/**
 * Get leases
 *
 * @mcp read
 */
export const getLeases = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getLeases(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get lease
 *
 * @mcp read
 */
export const getLease = defineServiceFn({
  input: z.looseObject({ leaseId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getLease(
        ctx.asCaller.supabase,
        input.leaseId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Create a lease.
 *
 * @remarks
 * The caller supplies `leaseId`, the readable LSE number. The app draws it from
 * the sequence.
 *
 * @mcp
 */
export const insertLease = defineServiceFn({
  input: z.looseObject({
    leaseId: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
    supplierId: z.string().min(1),
    supplierLocationId: z.string().optional(),
    supplierContactId: z.string().optional(),
    locationId: z.string().optional(),
    assignee: z.string().optional(),
    commencementDate: z.string().min(1),
    duration: z
      .enum(["12", "24", "36", "48", "60", "open", "custom"])
      .optional(),
    endDate: z.string().optional(),
    noticeDate: z.string().optional(),
    invoiceFromDate: z.string().optional(),
    paymentFrequency: z.enum(["Monthly", "Quarterly", "Annual"]),
    paymentTiming: z.enum(["Advance", "Arrears"]),
    annualEscalationPercent: z.number().min(0).default(0),
    discountRate: z.number().min(0),
    currencyCode: z.string().min(1),
    customFields: z.unknown().optional()
  }),
  permission: { create: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.insertLease(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpsert() as never
      )
    );
  }
});

/**
 * Update a lease's details.
 *
 * @remarks
 * The details are its name, notes, owner and notice date (`leaseDetailFields`).
 * They stay editable in every status, because nothing is measured from them.
 *
 * @mcp
 */
export const updateLeaseDetails = defineServiceFn({
  input: z.looseObject({
    id: z.string(),
    name: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    assignee: z.string().nullable().optional(),
    noticeDate: z.string().nullable().optional()
  }),
  permission: { update: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.updateLeaseDetails(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Only a Draft lease can be deleted; cancel an active one
 *
 * @mcp destructive
 */
export const deleteLease = defineServiceFn({
  input: z.looseObject({ leaseId: z.string() }),
  permission: { delete: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteLease(
        ctx.asCaller.supabase,
        input.leaseId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * The lease's assets in their order
 *
 * @mcp read
 */
export const getLeaseLines = defineServiceFn({
  input: z.looseObject({ leaseId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getLeaseLines(
        ctx.asCaller.supabase,
        input.leaseId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Every payment row of every asset: a long lease of many assets runs past PostgREST's 1,000-row page
 *
 * @mcp read
 */
export const getLeasePayments = defineServiceFn({
  input: z.looseObject({ leaseId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getLeasePayments(
        ctx.asCaller.supabase,
        input.leaseId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Removes an asset, and its payment rows with it, from a Draft lease
 *
 * @mcp destructive
 */
export const deleteLeaseLine = defineServiceFn({
  input: z.looseObject({ leaseId: z.string(), leaseLineId: z.string() }),
  permission: { delete: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteLeaseLine(
        ctx.asCaller.supabase,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Add or change one payment row of a Draft lease's asset (a rent holiday, an irregular step)
 *
 * @mcp
 */
export const upsertLeasePayment = defineServiceFn({
  input: z.looseObject({
    id: z.string().optional(),
    leaseId: z.string().min(1),
    leaseLineId: z.string().min(1),
    paymentType: z
      .enum(["Rent", "Purchase Option", "Termination Penalty"])
      .optional(),
    periodStart: z.string().min(1),
    periodEnd: z.string().min(1),
    dueDate: z.string().min(1),
    amount: z.number().min(0)
  }),
  permission: { update: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertLeasePayment(
        ctx.asCaller.supabase,
        payload(ctx, input).withUser().forUpdate() as never
      )
    );
  }
});

/**
 * Delete lease payment
 *
 * @mcp destructive
 */
export const deleteLeasePayment = defineServiceFn({
  input: z.looseObject({ leaseId: z.string(), paymentId: z.string() }),
  permission: { delete: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteLeasePayment(
        ctx.asCaller.supabase,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * The monthly schedule of every asset, each line with whether its lease run rows have posted: a long lease of many assets runs past PostgREST's 1,000-row page
 *
 * @mcp read
 */
export const getLeaseSchedule = defineServiceFn({
  input: z.looseObject({ leaseId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getLeaseSchedule(
        ctx.asCaller.supabase,
        input.leaseId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get lease events
 *
 * @mcp read
 */
export const getLeaseEvents = defineServiceFn({
  input: z.looseObject({ leaseId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getLeaseEvents(
        ctx.asCaller.supabase,
        input.leaseId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * The purchase invoices that bill the lease, and the journals that name it
 *
 * @mcp read
 */
export const getLeaseRelatedDocuments = defineServiceFn({
  input: z.looseObject({ leaseId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getLeaseRelatedDocuments(
        ctx.asCaller.supabase,
        input.leaseId as never,
        ctx.company.id
      )
    );
  }
});
