// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { CarbonError, defineServiceFn } from "@carbon/api/service-fn.server";
import { paged, payload, unwrap } from "@carbon/api/service-tools.server";
import type { Json } from "@carbon/database";
import { getQuoteDisplayId } from "@carbon/documents/pdf";
import { insertAuditLogEntries } from "@carbon/ee/audit.server";
import { safeStorageFileName, storage } from "@carbon/files";
import { supportedModelTypes } from "@carbon/files/cad";
import { validator } from "@carbon/form";
import { batchTrigger, trigger } from "@carbon/jobs";
import { checkPartyContactRequirement } from "@carbon/lib/party-contact.server";
import { trackWorkEvent } from "@carbon/lib/telemetry";
import { getLogger } from "@carbon/logger";
import { NotificationEvent } from "@carbon/notifications";
import { getStripeConnectAccountId } from "@carbon/stripe/send-sales-invoice.server";
import {
  breakQuantities,
  datetime,
  getErrorMessage,
  getSalesOrderStatus,
  round,
  suggestContractType,
  textToTiptap,
  unchecked
} from "@carbon/utils";
import { z } from "zod";
import { getExchangeRate } from "~/modules/accounting/accounting.service";
import { upsertDocument } from "~/modules/documents/documents.service";
import { stripeCustomerActions } from "~/modules/invoicing/invoicing.models";
import { linkStripeCustomerForBilling } from "~/modules/invoicing/invoicing.service";
import {
  getUnreleasedChangeOrderIssue,
  resolveItemIdFromExtractedText,
  upsertPart
} from "~/modules/items/items.service";
import { getSupplierPriceBreaksForItems } from "~/modules/items/items.utils";
import { runMRP } from "~/modules/production/production.service";
import {
  deleteIssue,
  getIssueTypesList,
  insertIssue
} from "~/modules/quality/quality.service";
import {
  getCompanySettings,
  getNextSequence as getNextSequenceNumber
} from "~/modules/settings/settings.service";
import {
  getCompanyTimeZone,
  getLocationTimeZone,
  refuseUnlessOwned,
  sendSalesOrderEmail,
  upsertExternalLink
} from "~/modules/shared/shared.service";
import { resolveBuyUnitCost } from "~/modules/shared/shared.utils";
import { getUserDefaults } from "~/modules/users/users.service";
import { stripSpecialCharacters } from "~/utils/string";
import { sanitize } from "~/utils/supabase";
import { invokeCreate, invokePosting } from "../shared/shared.service";
import {
  contractAmendmentChangeValidator,
  contractDurationOf,
  customerContractAmendmentValidator,
  customerContractTypes,
  customerContractValidator,
  invoiceAutomations,
  isQuoteLocked,
  isSalesOrderLocked,
  isSalesReturnOrderLocked,
  isSalesRfqLocked,
  quoteLineValidator,
  quoteMaterialValidator,
  quoteOperationValidator,
  quoteStatusType,
  quoteValidator,
  rentalAgreementLineClassificationValidator,
  rentalAgreementValidator,
  salesOrderLineValidator,
  salesOrderStatusType,
  salesOrderValidator,
  salesReturnOrderLineValidator,
  salesRFQStatusType,
  salesRfqDragValidator,
  salesRfqValidator,
  selectedLinesValidator
} from "./sales.models";
import { renderQuotePdf, renderSalesReturnOrderPdf } from "./sales.pdf";
import type {
  ContractAmendmentPreview,
  ContractCancellationPreview,
  ContractCancellationResult,
  DraftedRentalInvoice,
  QuoteLinePriceRow
} from "./sales.service";
import * as service from "./sales.service";
import * as utils from "./sales.utils";
import { reconcileQuantityBreaks } from "./sales.utils";

const logger = getLogger("erp", "sales-server");
// ---------------------------------------------------------------------------
// Operations (`defineServiceFn`): what the routes, the API and MCP all run
// ---------------------------------------------------------------------------

/** Custom field values, as `setCustomFields` reads them off a form. */
const customFieldValues = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean()])
);
// --- Sales RFQs -------------------------------------------------------------

const salesRfqFields = [
  "customerContactId",
  "customerEngineeringContactId",
  "customerId",
  "customerLocationId",
  "customerReference",
  "expirationDate",
  "locationId",
  "rfqDate",
  "salesPersonId"
] as const;

/**
 * Create a sales RFQ.
 *
 * @remarks
 * Every customer, contact and location id must belong to this company. The
 * RFQ is created with its opportunity. Then, optionally: one line per
 * extracted `lines` entry that has a part number or description (each mapped
 * to an existing item when its text matches one directly), and the file at
 * `documentPath` (an extraction upload) copied onto the opportunity as a
 * document. A failed line or copy does not fail the RFQ.
 *
 * @mcp
 */
export const createSalesRfq = defineServiceFn({
  input: salesRfqValidator.extend({
    customFields: customFieldValues.optional(),
    lines: z
      .array(
        z.object({
          partNumber: z.coerce.string().nullish(),
          description: z.coerce.string().nullish(),
          quantity: z.coerce.number().nullish()
        })
      )
      .default([]),
    documentPath: z.string().optional()
  }),
  permission: { create: "sales" },

  async run(ctx, { lines, documentPath, customFields, ...rfq }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;

    // insertSalesRFQ writes through Kysely, which bypasses RLS.
    const references: [Parameters<typeof refuseUnlessOwned>[1], string?][] = [
      ["customer", rfq.customerId],
      ["customerContact", rfq.customerContactId],
      ["customerContact", rfq.customerEngineeringContactId],
      ["customerLocation", rfq.customerLocationId],
      ["location", rfq.locationId]
    ];
    const refusals = await Promise.all(
      references.map(([table, id]) =>
        id ? refuseUnlessOwned(ctx, table, { id }) : null
      )
    );
    const refused = refusals.find((r) => r !== null);
    if (refused) return refused;

    const result = await service.insertSalesRFQ(client, ctx.asSystem.pg, {
      ...rfq,
      rfqId: rfq.rfqId || undefined,
      companyId,
      createdBy: userId,
      customFields
    });
    if (result.error || !result.data) {
      return ctx.error("internal", "Failed to insert RFQ", result.error);
    }
    const id = result.data.id;

    const extracted = lines.filter(
      (line) => line.partNumber || line.description
    );
    // Map the line up front when the extracted text directly matches an
    // existing record — only lines with no direct match are left unmapped
    // for the review modal.
    const itemIds: (string | null)[] = [];
    for (const line of extracted) {
      itemIds.push(
        await resolveItemIdFromExtractedText(
          client,
          companyId,
          { type: "customer", id: rfq.customerId },
          [line.partNumber, line.description]
        )
      );
    }

    const work: PromiseLike<unknown>[] = [];
    if (extracted.length > 0) {
      work.push(
        client
          .from("salesRfqLine")
          .insert(
            extracted.map((line, index) => ({
              salesRfqId: id,
              customerPartId: line.partNumber || "Unknown",
              itemId: itemIds[index] ?? undefined,
              description: line.description || line.partNumber || "Line Item",
              quantity: [line.quantity || 1],
              unitOfMeasureCode: "EA",
              order: index + 1,
              companyId,
              createdBy: userId,
              customFields: {}
            }))
          )
          .then(({ error }) => {
            if (error) {
              logger.error("Failed to insert extracted RFQ lines", {
                companyId,
                salesRfqId: id,
                error
              });
            }
          })
      );
    }

    if (documentPath) {
      work.push(
        (async () => {
          const created = await service.getSalesRFQ(client, id);
          const opportunityId = created.data?.opportunityId;
          if (!opportunityId) return;
          const basename = documentPath.split("/").pop() || "Extracted_RFQ.pdf";
          const originalFilename = basename.includes("_")
            ? basename.split("_").slice(1).join("_")
            : basename;
          const newStoragePath = `${companyId}/opportunity/${opportunityId}/${stripSpecialCharacters(originalFilename)}`;
          const copied = await storage(client)
            .company(companyId)
            .copy(documentPath, newStoragePath);
          if (copied.error) return;
          await upsertDocument(client, {
            path: newStoragePath,
            name: originalFilename,
            size: 0,
            sourceDocument: "Request for Quote",
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

    return { id, rfqId: result.data.rfqId };
  }
});

/**
 * Set one field on one or more sales RFQs.
 *
 * @remarks
 * Refused when any of the RFQs is locked. An empty value clears the field.
 */
export const updateSalesRfqField = defineServiceFn({
  input: service.fieldUpdate(salesRfqFields),
  permission: { update: "sales" },

  async run(ctx, { ids, field, value }) {
    const client = ctx.asCaller.supabase;
    const rfqs = await client
      .from("salesRfq")
      .select("status")
      .in("id", ids)
      .eq("companyId", ctx.company.id);
    if (rfqs.error) {
      return ctx.error("internal", "Failed to load the RFQs", rfqs.error);
    }
    if (rfqs.data.some((rfq) => isSalesRfqLocked(rfq.status))) {
      return ctx.error("rule", "Cannot modify a locked RFQ.");
    }

    const update = await client
      .from("salesRfq")
      .update(
        unchecked({
          [field]: value || null,
          updatedBy: ctx.auditUserId,
          updatedAt: datetime.timestamp()
        })
      )
      .in("id", ids)
      .eq("companyId", ctx.company.id);
    if (update.error) {
      return ctx.error("internal", "Failed to update the RFQs", update.error);
    }
    return { ids };
  }
});

/**
 * Set a sales RFQ's status.
 *
 * @remarks
 * Ready for Quote first notifies the company's RFQ-ready group (a failed
 * notification leaves the status unchanged). Closed clears the assignee.
 * `noQuoteReasonId` records why it was not quoted.
 *
 * @mcp
 */
export const setSalesRfqStatus = defineServiceFn({
  input: z.object({
    id: z.string(),
    status: z.enum(salesRFQStatusType),
    noQuoteReasonId: z.string().nullish()
  }),
  permission: { update: "sales" },

  async run(ctx, { id, status, noQuoteReasonId }) {
    const client = ctx.asCaller.supabase;
    const refused = await refuseUnlessOwned(ctx, "salesRfq", { id });
    if (refused) return refused;

    if (status === "Ready for Quote") {
      const settings = await getCompanySettings(client, ctx.company.id);
      const groupIds = settings.data?.rfqReadyNotificationGroup;
      if (Array.isArray(groupIds) && groupIds.length > 0) {
        try {
          await trigger("notify", {
            companyId: ctx.company.id,
            documentId: id,
            event: NotificationEvent.SalesRfqReady,
            recipient: { type: "group", groupIds }
          });
        } catch (err) {
          return ctx.error("internal", "Failed to send notification", err);
        }
      }
    }

    const update = await service.updateSalesRFQStatus(client, {
      id,
      status,
      noQuoteReasonId: noQuoteReasonId ?? null,
      assignee: status === "Closed" ? null : undefined,
      updatedBy: ctx.auditUserId
    });
    if (update.error) {
      return ctx.error("internal", "Failed to update RFQ status", update.error);
    }
    return { id, status };
  }
});

/**
 * Convert a sales RFQ to a quote.
 *
 * @remarks
 * First the sales-rule gate: every RFQ line that names an item is checked as
 * a quote line. An error, or a warning not `acknowledged`, returns
 * `violations` and converts nothing. Then the `convert` server function mints
 * the quote, and every new line that has no prices yet is priced for each of
 * its quantities by its method (Make to Order from its cost rollup, Pull from
 * Inventory from the item's price, Purchase to Order from the supplier's).
 *
 * @mcp
 */
export const convertSalesRfq = defineServiceFn({
  input: z.object({ id: z.string(), acknowledged: z.boolean().default(false) }),
  permission: { create: "sales" },

  async run(ctx, { id, acknowledged }) {
    const serviceRole = ctx.asSystem.supabase;
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;

    // No acknowledgment evidence here: the minted quote's own line checks
    // and finalize/convert gates re-evaluate (and record) everything.
    const gate = await service.salesDocumentGate(ctx, {
      documentType: "salesRfq",
      documentId: id,
      acknowledged
    });
    if (gate.blocked) return gate.blocked;

    const convert = await service.convertSalesRfqToQuote(
      serviceRole,
      ctx.asSystem.pg,
      {
        id,
        companyId,
        userId
      }
    );
    if (convert.error || !convert.data?.convertedId) {
      return ctx.error("internal", "Failed to convert RFQ", convert.error);
    }
    const quoteId = convert.data.convertedId;

    // A Make to Order line whose method was copied is priced already;
    // seeding it again was a duplicate insert the database refused.
    const [newLines, priced] = await Promise.all([
      serviceRole
        .from("quoteLine")
        .select("id, methodType, quantity")
        .eq("quoteId", quoteId)
        .eq("companyId", companyId),
      serviceRole
        .from("quoteLinePrice")
        .select("quoteLineId")
        .eq("quoteId", quoteId)
        .eq("companyId", companyId)
    ]);
    const pricedLineIds = new Set(priced.data?.map((p) => p.quoteLineId));
    await Promise.all(
      (newLines.data ?? [])
        .filter((line) => !pricedLineIds.has(line.id))
        .map((line) => {
          const quantities = line.quantity ?? [1];
          if (quantities.length === 0) return null;
          switch (line.methodType) {
            case "Make to Order":
              return service.calculatePricesForQuantities(
                serviceRole,
                ctx.asSystem.pg,
                quoteId,
                line.id,
                quantities,
                userId
              );
            case "Pull from Inventory":
              return service.resolveQuoteLinePrices(
                serviceRole,
                companyId,
                quoteId,
                line.id,
                quantities,
                userId
              );
            case "Purchase to Order":
              return service.resolvePurchaseToOrderPrices(
                serviceRole,
                companyId,
                quoteId,
                line.id,
                quantities,
                userId
              );
            default:
              return null;
          }
        })
    );

    return { quoteId };
  }
});

/**
 * Attach a dropped file to a sales RFQ line.
 *
 * @remarks
 * With no `lineId`, a new line is created for `customerPartId` first. A 3D
 * model is recorded as a model upload on the line, moved to staging and
 * queued for optimisation; any other file moves to the line's documents.
 */
export const attachSalesRfqFile = defineServiceFn({
  input: salesRfqDragValidator,
  permission: { create: "sales" },

  async run(ctx, input) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;

    let lineId = input.lineId;
    if (!lineId) {
      const inserted = await service.upsertSalesRFQLine(client, {
        salesRfqId: input.salesRfqId,
        customerPartId: input.customerPartId,
        quantity: [1],
        unitOfMeasureCode: "EA",
        order: 1,
        description: "",
        companyId,
        createdBy: userId,
        customFields: {}
      });
      if (inserted.error || !inserted.data?.id) {
        return ctx.error(
          "internal",
          "Failed to insert RFQ line",
          inserted.error
        );
      }
      lineId = inserted.data.id;
    }

    const moved = await service.placeDroppedFile(ctx, {
      documentPath: input.path,
      is3DModel: input.is3DModel,
      size: input.size,
      documentFolder: `opportunity-line/${lineId}`,
      setModel: (modelUploadId) =>
        client
          .from("salesRfqLine")
          .update({ modelUploadId })
          .eq("id", lineId)
          .eq("companyId", companyId),
      lineName: "RFQ line"
    });
    if (moved) return moved;
    return { lineId };
  }
});
/**
 * Map a sales RFQ's extracted lines to items.
 *
 * @remarks
 * Each mapping maps its line to `itemId`, creates a Make to Order part named
 * `createName` (or reuses the item with that part number), or is ignored.
 * Every line must be on this RFQ and every item and the customer this
 * company's. A mapped line with a customer part number also records it as
 * the customer's part for the item. A line that cannot be mapped does not
 * stop the others; `failed` counts them.
 *
 * @mcp
 */
export const mapSalesRfqLines = defineServiceFn({
  input: z.object({
    rfqId: z.string(),
    customerId: z.string().optional(),
    mappings: z.array(
      z.object({
        lineId: z.string(),
        action: z.enum(["map", "create", "ignore"]),
        itemId: z.string().nullish(),
        createName: z.string().nullish(),
        customerPartId: z.string().nullish(),
        description: z.string().nullish()
      })
    )
  }),
  permission: { update: "sales" },

  async run(ctx, { rfqId, customerId, mappings }) {
    const serviceRole = ctx.asSystem.supabase;
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;

    // The customerPartToItem upsert runs as the service role keyed on
    // (customerId, itemId): a foreign pair would overwrite another
    // company's mapping.
    const active = mappings.filter((map) => map.action !== "ignore");
    const lineIds = [...new Set(active.map((map) => map.lineId))];
    const itemIds = [
      ...new Set(active.flatMap((map) => (map.itemId ? [map.itemId] : [])))
    ];
    if (lineIds.length > 0) {
      const lines = await serviceRole
        .from("salesRfqLine")
        .select("id")
        .eq("salesRfqId", rfqId)
        .eq("companyId", companyId)
        .in("id", lineIds);
      if (lines.error || lines.data.length !== lineIds.length) {
        logger.error("RFQ lines not found for mapping", {
          companyId,
          rfqId,
          lineIds,
          error: lines.error
        });
        return ctx.error("notFound", "RFQ line not found");
      }
    }
    if (itemIds.length > 0) {
      const items = await serviceRole
        .from("item")
        .select("id")
        .eq("companyId", companyId)
        .in("id", itemIds);
      if (items.error || items.data.length !== itemIds.length) {
        logger.error("Items not found for RFQ line mapping", {
          companyId,
          rfqId,
          itemIds,
          error: items.error
        });
        return ctx.error("notFound", "Item not found");
      }
    }
    if (customerId) {
      const refused = await refuseUnlessOwned(ctx, "customer", {
        id: customerId
      });
      if (refused) return refused;
    }

    const nameOf = (map: (typeof active)[number]) =>
      (map.createName || map.customerPartId || map.description || "").trim();

    // A part is created once per name, or the item that already has that part
    // number is reused rather than failing on the unique constraint.
    const toCreate = new Map<string, string | undefined>();
    for (const map of active) {
      const name = map.action === "create" ? nameOf(map) : "";
      if (name && !toCreate.has(name)) {
        toCreate.set(name, map.description || undefined);
      }
    }
    const itemIdByName = new Map<string, string>();
    if (toCreate.size > 0) {
      const existing = await serviceRole
        .from("item")
        .select("id, readableId")
        .eq("companyId", companyId)
        .in("readableId", [...toCreate.keys()]);
      if (existing.error) {
        return ctx.error("internal", "Failed to load items", existing.error);
      }
      for (const item of existing.data) {
        if (!itemIdByName.has(item.readableId)) {
          itemIdByName.set(item.readableId, item.id);
        }
      }
    }
    for (const [name, description] of toCreate) {
      if (itemIdByName.has(name)) continue;
      // The service role: the sales-scoped client cannot insert items.
      // upsertPart has no batch form.
      const created = await upsertPart(serviceRole, {
        id: name,
        name,
        revision: "0",
        description,
        replenishmentSystem: "Make",
        defaultMethodType: "Make to Order",
        itemTrackingType: "Inventory",
        unitOfMeasureCode: "EA",
        shelfLifeCalculateFromBom: false,
        companyId,
        createdBy: userId
      });
      if (created.error || !created.data?.id) {
        logger.error("Failed to create part for RFQ line", {
          companyId,
          rfqId,
          readableId: name,
          error: created.error
        });
      } else {
        itemIdByName.set(name, created.data.id);
      }
    }

    let failed = 0;
    const itemIdByLine = new Map<string, string>();
    const customerPartByItem = new Map<string, string>();
    for (const map of active) {
      let itemId = map.itemId;
      if (map.action === "create") {
        const name = nameOf(map);
        if (!name) continue;
        const created = itemIdByName.get(name);
        if (created) itemId = created;
        else failed++;
      }
      if (!itemId) continue;
      itemIdByLine.set(map.lineId, itemId);
      if (map.customerPartId)
        customerPartByItem.set(itemId, map.customerPartId);
    }

    try {
      await service.setSalesRfqLineItems(
        ctx.asSystem.pg,
        companyId,
        userId,
        rfqId,
        [...itemIdByLine].map(([lineId, itemId]) => ({ lineId, itemId }))
      );
    } catch (error) {
      logger.error("Failed to map RFQ lines to items", {
        companyId,
        rfqId,
        error
      });
      return { failed: failed + itemIdByLine.size };
    }

    if (customerId && customerPartByItem.size > 0) {
      // customerPartToItem has no audit columns.
      const customerParts = await serviceRole.from("customerPartToItem").upsert(
        [...customerPartByItem].map(([itemId, customerPartId]) => ({
          customerId,
          customerPartId,
          itemId,
          companyId
        })),
        { onConflict: "customerId,itemId" }
      );
      if (customerParts.error) {
        failed += customerPartByItem.size;
        logger.error("Failed to map customer parts to items", {
          companyId,
          customerId,
          error: customerParts.error
        });
      }
    }

    return { failed };
  }
});

// --- Documents (PDF) --------------------------------------------------------
/** How a document is sent once it is issued. */
const documentNotification = {
  notification: z.enum(["Email", "None"]).optional(),
  customerContact: z.string().optional(),
  cc: z.array(z.string()).optional()
};

// --- Quotes -----------------------------------------------------------------

const quoteFields = [
  "customerId",
  "currencyCode",
  "customerContactId",
  "customerEngineeringContactId",
  "customerLocationId",
  "customerReference",
  "dueDate",
  "estimatorId",
  "expirationDate",
  "locationId",
  "salesPersonId"
] as const;
/**
 * Set one field on one or more quotes.
 *
 * @remarks
 * Refused when any of the quotes is locked. A new customer on a single quote
 * brings its currency. A new currency brings today's exchange rate. An empty
 * value clears the field.
 */
export const updateQuoteField = defineServiceFn({
  input: service.fieldUpdate(quoteFields),
  permission: { update: "sales" },

  async run(ctx, { ids, field, value }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const quotes = await client
      .from("quote")
      .select("status")
      .in("id", ids)
      .eq("companyId", companyId);
    if (quotes.error) {
      return ctx.error("internal", "Failed to load the quotes", quotes.error);
    }
    if (quotes.data.some((quote) => isQuoteLocked(quote.status))) {
      return ctx.error("rule", service.quoteLocked);
    }

    let changes: Record<string, string | number | null> = {
      [field]: value || null
    };
    if (field === "customerId") {
      changes = { customerId: value ?? undefined } as typeof changes;
      if (value && ids.length === 1) {
        const customer = await client
          .from("customer")
          .select("currencyCode")
          .eq("id", value)
          .single();
        if (customer.data?.currencyCode) {
          changes.currencyCode = customer.data.currencyCode;
        }
      }
    } else if (field === "currencyCode" && value) {
      const exchangeRate = await getExchangeRate(client, companyId, value);
      if (exchangeRate.error) {
        return ctx.error(
          "internal",
          "Failed to get the exchange rate",
          exchangeRate.error
        );
      }
      changes.exchangeRate = exchangeRate.data;
    }

    const update = await client
      .from("quote")
      .update(
        unchecked({
          ...changes,
          updatedBy: ctx.auditUserId,
          updatedAt: datetime.timestamp()
        })
      )
      .in("id", ids)
      .eq("companyId", companyId);
    if (update.error) {
      return ctx.error("internal", "Failed to update the quotes", update.error);
    }
    return { ids };
  }
});
/**
 * Add a line to a quote.
 *
 * @remarks
 * Refused while the quote is locked. The line is first checked against the
 * sales rules at every quantity break: an error, or a warning not
 * `acknowledged`, returns `violations` and adds nothing. Then the line is
 * priced by its method: Purchase to Order from the supplier's prices, Pull
 * from Inventory from the item's price, Make to Order by copying the item's
 * method and rolling up its cost. When pricing fails the line is kept and
 * `warning` says what failed.
 *
 * @mcp
 */
export const createQuoteLine = defineServiceFn({
  input: quoteLineValidator.extend({
    customFields: customFieldValues.optional(),
    acknowledged: z.boolean().default(false)
  }),
  permission: { create: "sales" },

  async run(ctx, { id: _id, acknowledged, customFields, ...line }) {
    const serviceRole = ctx.asSystem.supabase;
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;
    const quoteId = line.quoteId;

    const quote = await service.unlockedQuote(ctx, quoteId);
    if (quote instanceof Error) return quote;

    const configuration = service.parseConfiguration(line.configuration);
    const target = {
      documentType: "quote" as const,
      documentId: quoteId,
      itemId: line.itemId ?? null
    };
    const gate = await service.salesLineGate(ctx, {
      ...target,
      surface: "quoteLine",
      lineId: null,
      quantities: breakQuantities(line.quantity),
      customerId: quote?.customerId ?? null,
      customerLocationId: quote?.customerLocationId ?? null,
      acknowledged
    });
    if (gate.blocked) return gate.blocked;

    const created = await service.upsertQuoteLine(serviceRole, {
      ...line,
      companyId,
      configuration,
      createdBy: userId,
      customFields
    });
    if (created.error) {
      return ctx.error(
        "internal",
        "Failed to create quote line.",
        created.error
      );
    }
    const quoteLineId = created.data.id;

    // Evidence once the line exists, so it names the line.
    await service.recordSalesLineOutcome(
      ctx,
      { ...target, lineId: quoteLineId },
      "acknowledged",
      gate.check
    );

    const warning = await service.priceNewQuoteLine(ctx, {
      quoteId,
      quoteLineId,
      itemId: line.itemId,
      methodType: line.methodType,
      quantities: line.quantity ?? [1],
      configuration
    });
    return { quoteLineId, warning };
  }
});
/**
 * Change a quote line.
 *
 * @remarks
 * Refused while the quote is locked. The line is first checked against the
 * sales rules at every quantity break (see `createQuoteLine`). Then its
 * quantity breaks are reconciled: a break no longer offered loses its price,
 * and a new break of a Make to Order, Pull from Inventory or Purchase to
 * Order line is priced. The prices are computed before anything is written,
 * and the line and its prices are saved in one transaction.
 *
 * @mcp
 */
export const updateQuoteLine = defineServiceFn({
  input: quoteLineValidator.extend({
    id: z.string(),
    customFields: customFieldValues.optional(),
    acknowledged: z.boolean().default(false)
  }),
  permission: { create: "sales" },

  async run(ctx, { id: lineId, acknowledged, customFields, ...line }) {
    const serviceRole = ctx.asSystem.supabase;
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;
    const quoteId = line.quoteId;

    // The writes below bypass RLS and key on these ids.
    const refused = await refuseUnlessOwned(ctx, "quoteLine", {
      id: lineId,
      quoteId
    });
    if (refused) return refused;
    const quote = await service.unlockedQuote(ctx, quoteId);
    if (quote instanceof Error) return quote;

    const target = {
      documentType: "quote" as const,
      documentId: quoteId,
      lineId,
      itemId: line.itemId ?? null
    };
    const gate = await service.salesLineGate(ctx, {
      ...target,
      surface: "quoteLine",
      quantities: breakQuantities(line.quantity),
      customerId: quote?.customerId ?? null,
      customerLocationId: quote?.customerLocationId ?? null,
      acknowledged
    });
    if (gate.blocked) return gate.blocked;

    const existing = await serviceRole
      .from("quoteLinePrice")
      .select("quantity")
      .eq("quoteLineId", lineId)
      .eq("companyId", companyId);
    if (existing.error) {
      return ctx.error(
        "internal",
        "Failed to read existing quote line prices",
        existing.error
      );
    }

    // Pruning is unconditional: a break removed from any line would
    // otherwise render as a selectable option on the customer share page.
    const { added, removed } = reconcileQuantityBreaks(
      existing.data.map((p) => p.quantity),
      line.quantity ?? []
    );

    let priceRows: QuoteLinePriceRow[] = [];
    if (added.length > 0) {
      // The stored line still holds the old item: pass the new one.
      const built =
        line.methodType === "Make to Order"
          ? await service.buildMakeToOrderPriceRows(
              serviceRole,
              ctx.asSystem.pg,
              quoteId,
              lineId,
              added,
              userId,
              line.itemId
            )
          : line.methodType === "Pull from Inventory"
            ? await service.buildPullFromInventoryPriceRows(
                serviceRole,
                companyId,
                quoteId,
                lineId,
                added,
                userId,
                line.itemId
              )
            : line.methodType === "Purchase to Order"
              ? await service.buildPurchaseToOrderPriceRows(
                  serviceRole,
                  companyId,
                  quoteId,
                  lineId,
                  added,
                  userId,
                  line.itemId
                )
              : null;
      if (built?.error) {
        return ctx.error(
          "internal",
          `Failed to calculate ${line.methodType} prices for new quantities`,
          built.error
        );
      }
      priceRows = built?.rows ?? [];
    }

    try {
      await service.saveQuoteLineWithPrices(ctx.asSystem.pg, {
        companyId,
        quoteId,
        lineId,
        line: {
          ...sanitize({ ...line, updatedBy: userId }),
          customFields
        },
        removedQuantities: removed,
        priceRows
      });
    } catch (err) {
      // A rollback: nothing was written.
      return ctx.error("internal", "Failed to update quote line", err);
    }

    // Evidence only for a change that landed.
    await service.recordSalesLineOutcome(
      ctx,
      target,
      "acknowledged",
      gate.check
    );
    return { quoteLineId: lineId };
  }
});

/**
 * Finalize a quote and send it to the customer.
 *
 * @remarks
 * In order: the customer must have a reachable contact when the company
 * requires one; the sales-rule gate re-checks every line (an error, or a
 * warning not `acknowledged`, returns `violations` and changes nothing); the
 * quote gets its share link; its PDF is filed on the opportunity; the quote
 * is set Sent and its lines Complete. With `notification` Email the PDF is
 * then emailed to `customerContact` (and `cc`); when that fails the quote is
 * still Sent and `warning` says so. `locale` formats the PDF.
 *
 * @mcp
 */
export const finalizeAndSendQuote = defineServiceFn({
  input: z.object({
    quoteId: z.string(),
    acknowledged: z.boolean().default(false),
    ...documentNotification,
    locale: z.string().default("en-US")
  }),
  permission: { create: "sales" },

  async run(ctx, input) {
    const { quoteId, notification, customerContact, cc, locale } = input;
    const serviceRole = ctx.asSystem.supabase;
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;
    if (notification === "Email" && !customerContact) {
      return ctx.error("validation", "Customer contact is required for email");
    }

    const refused = await refuseUnlessOwned(ctx, "quote", { id: quoteId });
    if (refused) return refused;
    const quote = await service.getQuote(serviceRole, quoteId);
    if (quote.error) {
      return ctx.error("internal", "Failed to get quote", quote.error);
    }

    // A customer with no reachable contact cannot be created at a connected
    // platform, so its documents are rejected there long after anyone is
    // watching. Refuse at issue time, while the record can still be fixed.
    const contactRequired = await checkPartyContactRequirement(
      serviceRole,
      companyId,
      { kind: "customer", id: quote.data.customerId }
    );
    if (contactRequired) return ctx.error("rule", contactRequired);

    // Before the share link and the PDF, so a blocked quote produces neither.
    const gate = await service.salesDocumentGate(ctx, {
      documentType: "quote",
      documentId: quoteId,
      acknowledged: input.acknowledged
    });
    if (gate.blocked) return gate.blocked;

    const link = await upsertExternalLink(serviceRole, {
      id: quote.data.externalLinkId ?? undefined,
      documentType: "Quote",
      documentId: quoteId,
      customerId: quote.data.customerId,
      expiresAt: quote.data.expirationDate,
      companyId
    });
    if (link.data && quote.data.externalLinkId !== link.data.id) {
      await serviceRole
        .from("quote")
        .update({
          externalLinkId: link.data.id,
          completedDate: datetime.timestamp()
        })
        .eq("id", quoteId)
        .eq("companyId", companyId);
    }

    const pdf = await renderQuotePdf(ctx.asCaller.supabase, {
      id: quoteId,
      companyId,
      companyGroupId: ctx.company.groupId,
      locale
    })
      .then((rendered) =>
        service.attachDocumentPdf(ctx, {
          pdf: rendered,
          identifier: getQuoteDisplayId(quote.data),
          folder: `opportunity/${quote.data.opportunityId}`,
          sourceDocument: "Quote",
          sourceDocumentId: quoteId
        })
      )
      .catch((err: unknown) =>
        ctx.error("internal", "Failed to generate PDF", err)
      );
    if (pdf instanceof Error) return pdf;

    const finalized = await service.finalizeQuote(
      serviceRole,
      quoteId,
      userId,
      companyId
    );
    if (finalized.error) {
      return ctx.error("internal", "Failed to finalize quote", finalized.error);
    }

    // Evidence only once the finalize has committed.
    await service.recordSalesRuleOutcome(serviceRole, {
      companyId,
      userId,
      documentType: "quote",
      documentId: quoteId,
      outcome: "acknowledged",
      ...gate.check
    });

    if (notification !== "Email" || !customerContact) {
      return { quoteId, warning: null };
    }
    try {
      await service.emailQuote(ctx, {
        quote: quote.data,
        customerContactId: customerContact,
        cc,
        ...pdf
      });
      return { quoteId, warning: null };
    } catch (err) {
      logger.error("Failed to email the finalized quote", {
        companyId,
        quoteId,
        error: err
      });
      return { quoteId, warning: "Failed to send email" };
    }
  }
});
/**
 * Convert a quote to a sales order.
 *
 * @remarks
 * `selectedLines` maps each quote line to the quantity break and prices to
 * order; a line with quantity 0 is not converted. First the sales-rule gate
 * re-checks the lines that convert (an error, or a warning not
 * `acknowledged`, returns `violations` and converts nothing). Then the
 * `convert` server function creates the order with `purchaseOrderNumber`.
 * Its PDF is filed on the opportunity and, with `notification` Email,
 * emailed to `customerContact`; those two never fail the conversion.
 *
 * @mcp
 */
export const convertQuote = defineServiceFn({
  input: z.object({
    quoteId: z.string(),
    selectedLines: selectedLinesValidator,
    purchaseOrderNumber: z.string().optional(),
    acknowledged: z.boolean().default(false),
    ...documentNotification,
    locale: z.string().default("en-US")
  }),
  permission: { create: "sales" },

  async run(ctx, input) {
    const { quoteId, selectedLines, notification, customerContact } = input;
    const serviceRole = ctx.asSystem.supabase;
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;

    const refused = await refuseUnlessOwned(ctx, "quote", { id: quoteId });
    if (refused) return refused;

    // A deselected line never becomes an order line, so its violations
    // neither block nor leave evidence.
    const gate = await service.salesDocumentGate(ctx, {
      documentType: "quote",
      documentId: quoteId,
      acknowledged: input.acknowledged,
      lineIds: service.convertingLineIds(selectedLines)
    });
    if (gate.blocked) return gate.blocked;

    const convert = await service.convertQuoteToOrder(
      serviceRole,
      ctx.asSystem.pg,
      {
        id: quoteId,
        purchaseOrderNumber: input.purchaseOrderNumber ?? "",
        companyId,
        userId,
        selectedLines
      }
    );
    if (convert.error || !convert.data?.convertedId) {
      return ctx.error(
        "internal",
        getErrorMessage(convert.error, "Failed to convert quote to order"),
        convert.error
      );
    }
    const salesOrderId = convert.data.convertedId;

    await service.recordSalesRuleOutcome(serviceRole, {
      companyId,
      userId,
      documentType: "quote",
      documentId: quoteId,
      outcome: "acknowledged",
      ...gate.check
    });

    // Neither the PDF nor the email holds up the new order.
    try {
      const pdf = await service.attachSalesOrderPdf(ctx, {
        salesOrderId,
        locale: input.locale
      });
      if (pdf instanceof Error) throw pdf;
      if (notification === "Email" && customerContact) {
        await sendSalesOrderEmail({
          salesOrderId,
          companyId,
          companyGroupId: ctx.company.groupId,
          userId,
          customerContactId: customerContact,
          cc: input.cc,
          documentFilePath: pdf.documentFilePath,
          fileName: pdf.fileName,
          serviceRole,
          locales: [input.locale]
        });
      }
    } catch (err) {
      logger.error("Failed to generate PDF or send email after conversion", {
        companyId,
        salesOrderId,
        error: err
      });
    }

    return { salesOrderId };
  }
});
/**
 * Configure a Make to Order quote line.
 *
 * @remarks
 * Saves the configuration on the line, clears its prices, copies the item's
 * method for that configuration, then prices its Purchase to Order materials
 * from supplier price breaks (a typed cost is left alone).
 */
export const configureQuoteLine = defineServiceFn({
  input: z.object({
    quoteId: z.string(),
    lineId: z.string(),
    configuration: z.record(z.string(), z.unknown())
  }),
  permission: { update: "production" },

  async run(ctx, { quoteId, lineId, configuration }) {
    const client = ctx.asCaller.supabase;
    const serviceRole = ctx.asSystem.supabase;
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;

    const refused = await refuseUnlessOwned(ctx, "quoteLine", {
      id: lineId,
      quoteId
    });
    if (refused) return refused;

    const [updated, quoteLine] = await Promise.all([
      client
        .from("quoteLine")
        .update({
          configuration: configuration as Json,
          updatedAt: datetime.timestamp(),
          updatedBy: userId
        })
        .eq("id", lineId),
      client.from("quoteLine").select("itemId").eq("id", lineId).single(),
      client.from("quoteLinePrice").delete().eq("quoteLineId", lineId)
    ]);
    if (updated.error) {
      return ctx.error(
        "internal",
        "Failed to update quote line",
        updated.error
      );
    }
    if (quoteLine.error) {
      return ctx.error("internal", "Failed to get quote line", quoteLine.error);
    }

    const method = await service.upsertQuoteLineMethod(
      serviceRole,
      ctx.asSystem.pg,
      {
        quoteId,
        quoteLineId: lineId,
        itemId: quoteLine.data.itemId,
        configuration,
        companyId,
        userId
      }
    );
    if (method.error) {
      return ctx.error(
        "internal",
        "Failed to update quote line method",
        method.error
      );
    }

    const buyMaterials = await serviceRole
      .from("quoteMaterial")
      .select("id, itemId, unitCost, unitCostSource")
      .eq("quoteLineId", lineId)
      .eq("companyId", companyId)
      .eq("methodType", "Purchase to Order");
    const priceMap = await getSupplierPriceBreaksForItems(serviceRole, [
      ...new Set((buyMaterials.data ?? []).map((m) => m.itemId))
    ]);
    const costs = (buyMaterials.data ?? []).flatMap((material) => {
      if (material.unitCostSource === "manual") return [];
      const unitCost = resolveBuyUnitCost(material, 1, priceMap);
      return unitCost === material.unitCost
        ? []
        : [{ id: material.id, unitCost }];
    });
    // The line is configured either way: a cost a refresh misses keeps its
    // last value.
    await service
      .updateQuoteMaterialUnitCosts(ctx.asSystem.pg, companyId, lineId, costs)
      .catch((error: unknown) =>
        logger.error("Failed to refresh quote material costs", {
          companyId,
          quoteLineId: lineId,
          error
        })
      );
    return { lineId };
  }
});

/**
 * Attach a dropped file to a quote line.
 *
 * @remarks
 * With no `lineId`, a Make to Order part is created first, named after the
 * file (its part number and revision read from the name, with a suffix when
 * that revision exists), then a quote line for it with its method. A 3D model
 * becomes the line's (and its item's) model and is queued for optimisation;
 * any other file moves to the line's documents.
 */
export const attachQuoteFile = defineServiceFn({
  input: z.object({
    quoteId: z.string(),
    name: z.string(),
    size: z.number(),
    path: z.string(),
    lineId: z.string().optional()
  }),
  permission: { create: "sales" },

  async run(
    ctx,
    { quoteId, name: fileName, size, path: documentPath, ...input }
  ) {
    const client = ctx.asCaller.supabase;
    const serviceRole = ctx.asSystem.supabase;
    const companyId = ctx.company.id;

    // Lines and parts are created with the service role.
    const refused = await refuseUnlessOwned(ctx, "quote", { id: quoteId });
    if (refused) return refused;

    let lineId = input.lineId;
    let partId: string | undefined;
    if (!lineId) {
      const created = await service.createQuoteLineForFile(ctx, {
        quoteId,
        fileName
      });
      if (created instanceof Error) return created;
      ({ lineId, partId } = created);
    } else {
      const existing = await serviceRole
        .from("quoteLine")
        .select("itemId")
        .eq("id", lineId)
        .eq("quoteId", quoteId)
        .eq("companyId", companyId)
        .single();
      if (existing.error || !existing.data) {
        return ctx.error(
          "notFound",
          "Failed to find quote line",
          existing.error
        );
      }
      partId = existing.data.itemId;
    }

    const extension = fileName.split(".").pop();
    const placed = await service.placeDroppedFile(ctx, {
      documentPath,
      is3DModel: !!extension && supportedModelTypes.includes(extension),
      size,
      documentFolder: `opportunity-line/${lineId}`,
      setModel: async (modelUploadId) => {
        // A failed link is logged; the model is still optimised.
        const [lineUpdate] = await Promise.all([
          client.from("quoteLine").update({ modelUploadId }).eq("id", lineId),
          partId
            ? client
                .from("item")
                .update({ modelUploadId })
                .eq("id", partId)
                .eq("companyId", companyId)
            : null
        ]);
        if (lineUpdate.error) {
          logger.error("Failed to link model to quote line", {
            companyId,
            error: lineUpdate.error
          });
        }
        return { error: null };
      },
      lineName: "quote line"
    });
    if (placed) return placed;
    return { quoteLineId: lineId };
  }
});
// --- Digital quotes (the customer's share link) ------------------------------
/**
 * The customer accepts a sent quote from its share link.
 *
 * @remarks
 * Only while the quote is Sent, with at least one line selected. A sales
 * rule error on a selected line refuses with a neutral message (the customer
 * must never read internal compliance text) and is recorded for the seller;
 * warnings are logged and the order proceeds. The quote converts to a sales
 * order with the customer's name and email, its PDF is filed, the company's
 * digital-quote group is notified, and an attached purchase order file is
 * stored on the opportunity (its name, without `.pdf`, is the PO number).
 */
export const acceptDigitalQuote = defineServiceFn({
  input: z.object({
    quoteId: z.string(),
    selectedLines: selectedLinesValidator,
    acceptedBy: z.string(),
    acceptedByEmail: z.string(),
    purchaseOrderFile: z.instanceof(File).optional()
  }),
  permission: "system",

  async run(
    ctx,
    { quoteId, selectedLines, purchaseOrderFile: file, ...input }
  ) {
    const serviceRole = ctx.asSystem.supabase;
    const companyId = ctx.company.id;
    const quote = await service.sentQuote(ctx, quoteId);
    if (quote instanceof Error) return quote;

    const accepted = service.convertingLineIds(selectedLines);
    if (accepted.size === 0) {
      return ctx.error("rule", "Select at least one item to accept the quote.");
    }

    // The name becomes a storage key segment on an unauthenticated endpoint.
    const uploadFileName = file ? safeStorageFileName(file.name) : null;
    if (file && !uploadFileName) {
      logger.error("Rejected digital quote upload file name", {
        quoteId,
        companyId,
        fileName: file.name
      });
      return ctx.error("validation", "Invalid file name");
    }
    const purchaseOrderNumber =
      file && file.name.toLowerCase().endsWith(".pdf")
        ? file.name.replace(/\.pdf$/i, "")
        : "";

    // Nobody here may acknowledge a warning: errors refuse, warnings pass.
    const gate = await service.salesDocumentGate(ctx, {
      documentType: "quote",
      documentId: quoteId,
      acknowledged: true,
      lineIds: accepted
    });
    if (gate.blocked) {
      logger.error("Digital quote acceptance blocked by sales rules", {
        quoteId,
        companyId,
        violations: gate.blocked.violations
      });
      return ctx.error(
        "rule",
        "This quote can no longer be accepted online. Please contact your sales representative."
      );
    }
    if (gate.check.violations.length > 0) {
      logger.warn("Digital quote accepted with sales rule warnings", {
        quoteId,
        companyId,
        violations: gate.check.violations
      });
    }

    const convert = await service.convertQuoteToOrder(
      serviceRole,
      ctx.asSystem.pg,
      {
        id: quoteId,
        companyId,
        userId: ctx.auditUserId,
        selectedLines,
        digitalQuoteAcceptedBy: input.acceptedBy,
        digitalQuoteAcceptedByEmail: input.acceptedByEmail,
        purchaseOrderNumber
      }
    );
    if (convert.error) {
      return ctx.error(
        "internal",
        "Failed to convert quote to order",
        convert.error
      );
    }

    const salesOrderId = convert.data?.convertedId;
    if (salesOrderId) {
      // The order stands without its PDF.
      const pdf = await service
        .attachSalesOrderPdf(ctx, {
          salesOrderId,
          locale: "en-US"
        })
        .catch((err: unknown) => err);
      if (pdf instanceof Error) {
        logger.error("Failed to generate PDF after digital quote acceptance", {
          companyId,
          salesOrderId,
          error: pdf
        });
      }
    }

    await service.notifyDigitalQuoteResponse(ctx, quoteId);

    if (file && uploadFileName) {
      const purchaseOrderDocumentPath = `${companyId}/opportunity/${quote.opportunityId}/${uploadFileName}`;
      const upload = await storage(serviceRole)
        .company(companyId)
        .upload(purchaseOrderDocumentPath, file);
      if (upload.error) {
        return ctx.error("internal", "Failed to upload file", upload.error);
      }
      const opportunity = await serviceRole
        .from("opportunity")
        .update({ purchaseOrderDocumentPath })
        .eq("id", quote.opportunityId!)
        .eq("companyId", companyId);
      if (opportunity.error) {
        logger.error("Failed to update opportunity", {
          companyId,
          error: opportunity.error
        });
      }
    }

    return { salesOrderId: salesOrderId ?? null };
  }
});

/**
 * The customer rejects a sent quote from its share link.
 *
 * @remarks
 * Only while the quote is Sent: it becomes Lost with the customer's name and
 * email, and the company's digital-quote group is notified.
 */
export const rejectDigitalQuote = defineServiceFn({
  input: z.object({
    quoteId: z.string(),
    rejectedBy: z.string(),
    rejectedByEmail: z.string()
  }),
  permission: "system",

  async run(ctx, { quoteId, rejectedBy, rejectedByEmail }) {
    const quote = await service.sentQuote(ctx, quoteId);
    if (quote instanceof Error) return quote;

    const rejected = await ctx.asSystem.supabase
      .from("quote")
      .update({
        status: "Lost",
        digitalQuoteRejectedBy: rejectedBy,
        digitalQuoteRejectedByEmail: rejectedByEmail
      })
      .eq("id", quoteId)
      .eq("companyId", ctx.company.id);
    if (rejected.error) {
      return ctx.error("internal", "Failed to reject quote", rejected.error);
    }

    await service.notifyDigitalQuoteResponse(ctx, quoteId);
    return { quoteId };
  }
});

// --- Document status ---------------------------------------------------------

/**
 * A status past a document's finalize or confirm gate is checked against the
 * sales rules first: an error-severity rule the document breaks refuses it.
 * Warnings pass (a status change has no acknowledgment step).
 */
const NON_ADVANCING_QUOTE_STATUSES = new Set([
  "Draft",
  "Lost",
  "Cancelled",
  "Expired"
]);
const NON_ADVANCING_SALES_ORDER_STATUSES = new Set([
  "Draft",
  "Needs Approval",
  "Cancelled",
  "Closed"
]);
/**
 * Set a quote's status.
 *
 * @remarks
 * A status past Draft, Lost, Cancelled and Expired is refused when the quote
 * breaks an error-severity sales rule.
 *
 * @mcp
 */
export const setQuoteStatus = defineServiceFn({
  input: z.object({ quoteId: z.string(), status: z.enum(quoteStatusType) }),
  permission: { update: "sales" },

  async run(ctx, { quoteId, status }) {
    const refused = await refuseUnlessOwned(ctx, "quote", { id: quoteId });
    if (refused) return refused;
    if (!NON_ADVANCING_QUOTE_STATUSES.has(status)) {
      const blocked = await service.advancingStatusRefusal(
        ctx,
        "quote",
        quoteId
      );
      if (blocked) return blocked;
    }
    const update = await service.updateQuoteStatus(ctx.asCaller.supabase, {
      id: quoteId,
      status,
      assignee: undefined,
      updatedBy: ctx.auditUserId
    });
    if (update.error) {
      return ctx.error(
        "internal",
        "Failed to update quote status",
        update.error
      );
    }
    return { quoteId, status };
  }
});

/**
 * Update a quote's details.
 *
 * @remarks
 * Refused while the quote is locked. A status past Draft, Lost, Cancelled and
 * Expired is checked against the sales rules as `quote.setStatus` does. A new
 * currency re-reads the exchange rate; a new customer moves the opportunity.
 *
 * @mcp
 */
export const updateQuoteDetails = defineServiceFn({
  input: quoteValidator.safeExtend({
    id: z.string(),
    customFields: customFieldValues.optional()
  }),
  permission: { update: "sales" },

  async run(ctx, { id, customFields, ...quote }) {
    const unlocked = await service.unlockedQuote(ctx, id);
    if (unlocked instanceof CarbonError) return unlocked;
    if (quote.status && !NON_ADVANCING_QUOTE_STATUSES.has(quote.status)) {
      const blocked = await service.advancingStatusRefusal(ctx, "quote", id);
      if (blocked) return blocked;
    }
    const result = await service.updateQuote(ctx.asCaller.supabase, {
      id,
      status: quote.status,
      currencyCode: quote.currencyCode,
      expirationDate: quote.expirationDate || null,
      customerId: quote.customerId,
      customerContactId: quote.customerContactId || null,
      customerLocationId: quote.customerLocationId || null,
      customerEngineeringContactId: quote.customerEngineeringContactId || null,
      customerReference: quote.customerReference || null,
      salesPersonId: quote.salesPersonId || null,
      estimatorId: quote.estimatorId || null,
      locationId: quote.locationId,
      dueDate: quote.dueDate || null,
      digitalQuoteAcceptedBy: quote.digitalQuoteAcceptedBy || null,
      digitalQuoteAcceptedByEmail: quote.digitalQuoteAcceptedByEmail || null,
      notes: quote.notes,
      customFields: customFields as Json | undefined,
      updatedBy: ctx.auditUserId
    });
    if (result.error) {
      return ctx.error("internal", "Failed to update quote", result.error);
    }
    return { quoteId: id };
  }
});

/**
 * Set a sales order's status.
 *
 * @remarks
 * Cancelling cancels the order through `cancelSalesOrder`: with `cancelJobIds`
 * only those jobs are cancelled (an empty list cancels none), without it every
 * open job of the order. A status past Draft, Needs Approval, Cancelled and
 * Closed is refused when the order breaks an error-severity sales rule.
 * Closing an order clears its assignee.
 *
 * @mcp
 */
export const setSalesOrderStatus = defineServiceFn({
  input: z.object({
    salesOrderId: z.string(),
    status: z.enum(salesOrderStatusType),
    cancelJobIds: z.array(z.string()).optional()
  }),
  permission: { update: "sales" },

  async run(ctx, { salesOrderId, status, cancelJobIds }) {
    const refused = await refuseUnlessOwned(ctx, "salesOrder", {
      id: salesOrderId
    });
    if (refused) return refused;

    if (status === "Cancelled") {
      const result = await service.cancelSalesOrder(ctx.asCaller.supabase, {
        id: salesOrderId,
        userId: ctx.auditUserId,
        jobs: cancelJobIds
      });
      if (!result.success) return ctx.error("rule", result.message);
      return { salesOrderId, status, message: result.message };
    }

    if (!NON_ADVANCING_SALES_ORDER_STATUSES.has(status)) {
      const blocked = await service.advancingStatusRefusal(
        ctx,
        "salesOrder",
        salesOrderId
      );
      if (blocked) return blocked;
    }
    const update = await service.updateSalesOrderStatus(ctx.asCaller.supabase, {
      id: salesOrderId,
      status,
      assignee: status === "Closed" ? null : undefined,
      updatedBy: ctx.auditUserId
    });
    if (update.error) {
      return ctx.error(
        "internal",
        "Failed to update sales order status",
        update.error
      );
    }
    return { salesOrderId, status, message: "Updated sales order status" };
  }
});

// --- Sales orders -------------------------------------------------------------

const salesOrderFields = [
  "customerId",
  "currencyCode",
  "customerContactId",
  "customerEngineeringContactId",
  "customerLocationId",
  "customerReference",
  "exchangeRate",
  "expirationDate",
  "locationId",
  "orderDate",
  "salesPersonId",
  "receiptPromisedDate",
  "receiptRequestedDate"
] as const;

/**
 * Set one field on one or more sales orders.
 *
 * @remarks
 * Refused once any of the orders is confirmed. A new customer on a single
 * order brings its currency and today's exchange rate; so does a new
 * currency. The requested and promised dates are the shipment's. An empty
 * value clears the field.
 */
export const updateSalesOrderField = defineServiceFn({
  input: service.fieldUpdate(salesOrderFields),
  permission: { update: "sales" },

  async run(ctx, { ids, field, value }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const orders = await client
      .from("salesOrder")
      .select("status")
      .in("id", ids)
      .eq("companyId", companyId);
    if (orders.error) {
      return ctx.error("internal", "Failed to load the orders", orders.error);
    }
    if (orders.data.some((order) => isSalesOrderLocked(order.status))) {
      return ctx.error("rule", "Cannot modify a confirmed sales order.");
    }

    const audit = {
      updatedBy: ctx.auditUserId,
      updatedAt: datetime.timestamp()
    };
    const withRate = async (currencyCode: string) => {
      const rate = await getExchangeRate(client, companyId, currencyCode);
      return rate.error
        ? ctx.error("internal", "Failed to get the exchange rate", rate.error)
        : { currencyCode, exchangeRate: rate.data };
    };

    let table: "salesOrder" | "salesOrderShipment" = "salesOrder";
    let changes: Record<string, unknown> = { [field]: value || null };
    if (field === "customerId") {
      changes = { customerId: value ?? undefined };
      if (value && ids.length === 1) {
        const customer = await client
          .from("customer")
          .select("currencyCode")
          .eq("id", value)
          .single();
        if (customer.data?.currencyCode) {
          const currency = await withRate(customer.data.currencyCode);
          if (currency instanceof Error) return currency;
          changes = { ...changes, ...currency };
        }
      }
    } else if (field === "currencyCode" && value) {
      const currency = await withRate(value);
      if (currency instanceof Error) return currency;
      changes = currency;
    } else if (
      field === "receiptPromisedDate" ||
      field === "receiptRequestedDate"
    ) {
      table = "salesOrderShipment";
    }

    const update = await client
      .from(table)
      .update(unchecked({ ...changes, ...audit }))
      .in("id", ids)
      .eq("companyId", companyId);
    if (update.error) {
      return ctx.error("internal", "Failed to update the orders", update.error);
    }
    return { ids };
  }
});

/**
 * Confirm a sales order.
 *
 * @remarks
 * In order: the customer must have a reachable contact when the company
 * requires one; the sales-rule gate re-checks every line (an error, or a
 * warning not `acknowledged`, returns `violations` and confirms nothing);
 * the order's PDF is filed; with `notification` Email it is sent to
 * `customerContact` (and `cc`). Only then does the order take its status
 * from its lines, with today as the order date when it had none. MRP then
 * plans it. A failed PDF or email leaves the order unconfirmed.
 *
 * @mcp
 */
export const confirmSalesOrder = defineServiceFn({
  input: z.object({
    salesOrderId: z.string(),
    acknowledged: z.boolean().default(false),
    ...documentNotification,
    locale: z.string().default("en-US")
  }),
  permission: { create: "sales" },

  async run(ctx, input) {
    const { salesOrderId, notification, customerContact } = input;
    const client = ctx.asCaller.supabase;
    const serviceRole = ctx.asSystem.supabase;
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;

    const refused = await refuseUnlessOwned(ctx, "salesOrder", {
      id: salesOrderId
    });
    if (refused) return refused;
    const order = await service.getSalesOrder(serviceRole, salesOrderId);
    if (order.error) {
      return ctx.error("internal", "Failed to get sales order", order.error);
    }

    // Off by default: only for a company that asked for the policy.
    const contactRequired = await checkPartyContactRequirement(
      client,
      companyId,
      { kind: "customer", id: order.data.customerId }
    );
    if (contactRequired) return ctx.error("rule", contactRequired);

    // Before the PDF, so a blocked order does not get one.
    const gate = await service.salesDocumentGate(ctx, {
      documentType: "salesOrder",
      documentId: salesOrderId,
      acknowledged: input.acknowledged
    });
    if (gate.blocked) return gate.blocked;

    const pdf = await service
      .attachSalesOrderPdf(ctx, {
        salesOrderId,
        locale: input.locale
      })
      .catch((err: unknown) =>
        ctx.error("internal", "Failed to generate PDF", err)
      );
    if (pdf instanceof Error) {
      return ctx.error("internal", "Failed to generate PDF", pdf);
    }

    if (notification === "Email") {
      if (!customerContact) {
        return ctx.error("validation", "Customer contact is required");
      }
      const sent = await sendSalesOrderEmail({
        salesOrderId,
        companyId,
        companyGroupId: ctx.company.groupId,
        userId,
        customerContactId: customerContact,
        cc: input.cc,
        documentFilePath: pdf.documentFilePath,
        fileName: pdf.fileName,
        serviceRole,
        locales: [input.locale]
      }).catch((err: unknown) => ({
        success: false,
        message: undefined,
        error: err
      }));
      if (!sent.success) {
        return ctx.error("internal", sent.message ?? "Failed to send email");
      }
    }

    const lines = await service.getSalesOrderLines(serviceRole, salesOrderId);
    const { status } = getSalesOrderStatus(lines.data || []);
    const confirmed = await client
      .from("salesOrder")
      .update({
        status,
        orderDate:
          order.data.orderDate ??
          datetime
            .today(await getCompanyTimeZone(client, companyId))
            .toString(),
        updatedAt: datetime.timestamp(),
        updatedBy: userId
      })
      .eq("id", salesOrderId);
    if (confirmed.error) {
      return ctx.error(
        "internal",
        "Failed to confirm sales order",
        confirmed.error
      );
    }

    // Evidence only once the confirm has committed.
    await service.recordSalesRuleOutcome(serviceRole, {
      companyId,
      userId,
      documentType: "salesOrder",
      documentId: salesOrderId,
      outcome: "acknowledged",
      ...gate.check
    });

    await runMRP(serviceRole, ctx.asSystem.pg, {
      type: "salesOrder",
      id: salesOrderId,
      companyId,
      userId
    });

    trackWorkEvent("sales_order_confirmed", {
      companyId,
      userId,
      salesOrderId,
      lineCount: lines.data?.length ?? 0,
      derivedStatus: status,
      emailed: notification === "Email"
    });
    return { salesOrderId, status };
  }
});
/**
 * Update a sales order's details.
 *
 * @remarks
 * Refused while the order is locked. A status past Draft, Needs Approval,
 * Cancelled and Closed is checked against the sales rules as
 * `order.setStatus` does. A new currency re-reads the exchange rate; a new
 * customer moves the opportunity.
 *
 * @mcp
 */
export const updateSalesOrderDetails = defineServiceFn({
  input: salesOrderValidator.safeExtend({
    id: z.string(),
    customFields: customFieldValues.optional()
  }),
  permission: { update: "sales" },

  async run(ctx, { id, customFields, ...order }) {
    const locked = await service.unlockedSalesOrder(
      ctx,
      id,
      "Cannot modify a locked sales order. Reopen it first."
    );
    if (locked) return locked;
    if (order.status && !NON_ADVANCING_SALES_ORDER_STATUSES.has(order.status)) {
      const blocked = await service.advancingStatusRefusal(
        ctx,
        "salesOrder",
        id
      );
      if (blocked) return blocked;
    }
    const result = await service.updateSalesOrder(ctx.asCaller.supabase, {
      id,
      status: order.status,
      currencyCode: order.currencyCode,
      orderDate: order.orderDate,
      customerId: order.customerId,
      customerContactId: order.customerContactId || null,
      customerLocationId: order.customerLocationId || null,
      notes: order.notes,
      customFields: customFields as Json | undefined,
      updatedBy: ctx.auditUserId
    });
    if (result.error) {
      return ctx.error("internal", "Failed to update order", result.error);
    }
    return { salesOrderId: id };
  }
});
const salesOrderLineInput = salesOrderLineValidator.safeExtend({
  customFields: customFieldValues.optional(),
  acknowledged: z.boolean().default(false)
});

/**
 * Add a line to a sales order.
 *
 * @remarks
 * Refused while the order is locked, and for an item a change notice still
 * holds (an unreleased revision cannot be ordered). A line with an item is
 * first checked against the sales rules at the order's ship-to: an error,
 * or a warning not `acknowledged`, returns `violations` and adds nothing.
 *
 * @mcp
 */
export const createSalesOrderLine = defineServiceFn({
  input: salesOrderLineInput,
  permission: { create: "sales" },

  async run(ctx, { id: _id, acknowledged, customFields, ...input }) {
    const companyId = ctx.company.id;
    const line = service.withLineTarget(input);
    const locked = await service.unlockedSalesOrder(
      ctx,
      line.salesOrderId,
      "Cannot add lines to a locked sales order. Reopen it first."
    );
    if (locked) return locked;

    // Checked here rather than only in the picker: the API reaches this too.
    if (line.itemId) {
      const unreleased = await getUnreleasedChangeOrderIssue(
        ctx.asSystem.supabase,
        { itemId: line.itemId, companyId }
      );
      if (unreleased) {
        return ctx.error("rule", `${unreleased} It cannot be ordered.`);
      }
    }

    const gate = await service.salesOrderLineGate(ctx, {
      salesOrderId: line.salesOrderId,
      lineId: null,
      itemId: line.itemId,
      quantity: line.saleQuantity,
      acknowledged
    });
    if (gate.blocked) return gate.blocked;

    const created = await service.upsertSalesOrderLine(ctx.asCaller.supabase, {
      ...line,
      companyId,
      createdBy: ctx.auditUserId,
      customFields
    });
    if (created.error) {
      return ctx.error(
        "internal",
        "Failed to create sales order line.",
        created.error
      );
    }

    await service.recordSalesLineOutcome(
      ctx,
      {
        documentType: "salesOrder",
        documentId: line.salesOrderId,
        lineId: created.data.id,
        itemId: line.itemId ?? null
      },
      "acknowledged",
      gate.check
    );
    return { salesOrderLineId: created.data.id };
  }
});

/**
 * Change a sales order line.
 *
 * @remarks
 * Refused while the order is locked. A line with an item is first checked
 * against the sales rules (see `createSalesOrderLine`).
 *
 * @mcp
 */
export const updateSalesOrderLine = defineServiceFn({
  input: salesOrderLineInput.safeExtend({ id: z.string() }),
  permission: { create: "sales" },

  async run(ctx, { id, acknowledged, customFields, ...input }) {
    const line = service.withLineTarget(input);
    // The line must be on the order whose lock state is checked.
    const refused = await refuseUnlessOwned(ctx, "salesOrderLine", {
      id,
      salesOrderId: line.salesOrderId
    });
    if (refused) return refused;
    const locked = await service.unlockedSalesOrder(
      ctx,
      line.salesOrderId,
      "Cannot modify a locked sales order. Reopen it first."
    );
    if (locked) return locked;

    const gate = await service.salesOrderLineGate(ctx, {
      salesOrderId: line.salesOrderId,
      lineId: id,
      itemId: line.itemId,
      quantity: line.saleQuantity,
      acknowledged
    });
    if (gate.blocked) return gate.blocked;

    const updated = await service.upsertSalesOrderLine(ctx.asCaller.supabase, {
      id,
      ...line,
      updatedBy: ctx.auditUserId,
      customFields
    });
    if (updated.error) {
      return ctx.error(
        "internal",
        "Failed to update sales order line",
        updated.error
      );
    }

    await service.recordSalesLineOutcome(
      ctx,
      {
        documentType: "salesOrder",
        documentId: line.salesOrderId,
        lineId: id,
        itemId: line.itemId ?? null
      },
      "acknowledged",
      gate.check
    );
    return { salesOrderLineId: id };
  }
});

/**
 * Create a shipment for one sales order line.
 *
 * @remarks
 * The line needs a location; the shipment is created there through the
 * `create` server function.
 *
 * @mcp
 */
export const shipSalesOrderLine = defineServiceFn({
  input: z.object({ salesOrderLineId: z.string() }),
  permission: { create: "inventory" },

  async run(ctx, { salesOrderLineId }) {
    const companyId = ctx.company.id;
    const line = await service.getSalesOrderLine(
      ctx.asSystem.supabase,
      salesOrderLineId
    );
    if (line.error || line.data.companyId !== companyId) {
      return ctx.error(
        "notFound",
        "Failed to get sales order line",
        line.error
      );
    }
    if (!line.data.locationId) {
      return ctx.error(
        "rule",
        "Set a location on this sales order line before creating a shipment"
      );
    }

    const shipment = await invokeCreate(
      { db: ctx.asSystem.pg, companyId, userId: ctx.auditUserId },
      {
        type: "shipmentFromSalesOrderLine",
        locationId: line.data.locationId,
        salesOrderLineId
      }
    );
    if (!shipment.data || shipment.error) {
      return ctx.error("internal", "Failed to create shipment", shipment.error);
    }
    return { shipmentId: shipment.data.id };
  }
});

// --- Sales return orders (RMAs) ---------------------------------------------------

const salesReturnOrderFields = [
  "customerId",
  "currencyCode",
  "salesOrderId",
  "customerContactId",
  "customerLocationId",
  "customerReference",
  "expirationDate",
  "locationId",
  "orderDate"
] as const;

/**
 * Set one field on one or more sales return orders.
 *
 * @remarks
 * Refused when any of them is completed or cancelled. A new customer on a
 * single return order brings its currency and today's exchange rate; so does
 * a new currency (a missing rate refuses rather than writing a stale one). An
 * empty value clears the field.
 */
export const updateSalesReturnOrderField = defineServiceFn({
  input: service.fieldUpdate(salesReturnOrderFields),
  permission: { update: "sales" },

  async run(ctx, { ids, field, value }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const orders = await client
      .from("salesReturnOrder")
      .select("status")
      .in("id", ids)
      .eq("companyId", companyId);
    if (orders.error) {
      return ctx.error(
        "internal",
        "Failed to load the return orders",
        orders.error
      );
    }
    if (orders.data.some((order) => isSalesReturnOrderLocked(order.status))) {
      return ctx.error(
        "rule",
        "Cannot modify a completed or cancelled return order."
      );
    }

    const withRate = async (currencyCode: string) => {
      const rate = await getExchangeRate(client, companyId, currencyCode);
      return rate.error
        ? ctx.error("internal", "Failed to get the exchange rate", rate.error)
        : { currencyCode, exchangeRate: rate.data };
    };

    let changes: Record<string, unknown> = { [field]: value || null };
    if (field === "customerId") {
      changes = { customerId: value ?? undefined };
      if (value && ids.length === 1) {
        const customer = await client
          .from("customer")
          .select("currencyCode")
          .eq("id", value)
          .single();
        if (customer.data?.currencyCode) {
          const currency = await withRate(customer.data.currencyCode);
          if (currency instanceof Error) return currency;
          changes = { ...changes, ...currency };
        }
      }
    } else if (field === "currencyCode" && value) {
      const currency = await withRate(value);
      if (currency instanceof Error) return currency;
      changes = currency;
    }

    const update = await client
      .from("salesReturnOrder")
      .update(
        unchecked({
          ...changes,
          updatedBy: ctx.auditUserId,
          updatedAt: datetime.timestamp()
        })
      )
      .in("id", ids)
      .eq("companyId", companyId);
    if (update.error) {
      return ctx.error(
        "internal",
        "Failed to update the return orders",
        update.error
      );
    }
    return { ids };
  }
});

/**
 * Confirm a sales return order (RMA).
 *
 * @remarks
 * Authorizes the customer to return the goods on its lines: each line's
 * quantity is checked, under row locks, against what its source document can
 * still take back, and a line over that refuses the whole confirm. Then the
 * RMA's PDF is filed on it; when that fails the RMA is still confirmed and
 * `warning` says so. `locale` formats the PDF.
 *
 * @mcp
 */
export const confirmReturnOrder = defineServiceFn({
  input: z.object({
    salesReturnOrderId: z.string(),
    locale: z.string().default("en-US")
  }),
  permission: { update: "sales" },

  async run(ctx, { salesReturnOrderId: id, locale }) {
    const companyId = ctx.company.id;
    const order = await service.getSalesReturnOrder(ctx.asSystem.supabase, id);
    if (order.error || !order.data) {
      return ctx.error(
        "internal",
        "Failed to load sales return order",
        order.error
      );
    }
    if (order.data.companyId !== companyId) {
      return ctx.error(
        "forbidden",
        "You are not authorized to confirm this return order"
      );
    }

    try {
      await service.confirmSalesReturnOrder(
        ctx.asSystem.pg,
        { id, companyId },
        ctx.auditUserId
      );
    } catch (err) {
      // Its refusals (a quantity over the source's cap) are thrown.
      return ctx.error(
        "rule",
        err instanceof Error ? err.message : "Failed to confirm return order",
        err
      );
    }

    // The RMA is confirmed: a failed PDF does not undo it.
    // Render inside the chain, so a failed render is caught like a failed
    // upload.
    const pdf = await renderSalesReturnOrderPdf(ctx.asCaller.supabase, {
      id,
      companyId,
      companyGroupId: ctx.company.groupId,
      locale
    })
      .then((rendered) =>
        service.attachDocumentPdf(ctx, {
          pdf: rendered,
          identifier: order.data.salesReturnOrderId ?? "",
          folder: `sales-return-order/${id}`,
          sourceDocument: "Sales Return Order",
          sourceDocumentId: id
        })
      )
      .catch((err: unknown) =>
        ctx.error("internal", "Failed to generate PDF", err)
      );
    if (pdf instanceof Error) {
      logger.error("Failed to file the confirmed RMA's PDF", {
        companyId,
        salesReturnOrderId: id,
        error: pdf
      });
      return {
        salesReturnOrderId: id,
        warning: "Return order confirmed, but the PDF could not be generated"
      };
    }
    return { salesReturnOrderId: id, warning: null };
  }
});

/**
 * Add a line to a sales return order (RMA).
 *
 * @remarks
 * Only while the RMA is Draft: its quantities are checked against their
 * sources at Confirm, so a later line would skip that check. A line from a
 * sales order links the RMA to that order when it has none yet (the first
 * line's order wins; a link someone set is never replaced).
 *
 * @mcp
 */
export const createReturnOrderLine = defineServiceFn({
  input: salesReturnOrderLineValidator.extend({
    customFields: customFieldValues.optional()
  }),
  permission: { create: "sales" },

  async run(ctx, { id: _id, customFields, ...line }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const orderId = line.salesReturnOrderId;

    const refused = await refuseUnlessOwned(ctx, "salesReturnOrder", {
      id: orderId
    });
    if (refused) return refused;
    const order = await service.getSalesReturnOrder(client, orderId);
    if (isSalesReturnOrderLocked(order.data?.status)) {
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

    const created = await service.upsertSalesReturnOrderLine(client, {
      ...line,
      companyId,
      createdBy: ctx.auditUserId,
      customFields
    });
    if (created.error || !created.data) {
      return ctx.error(
        "internal",
        "Failed to create return order line",
        created.error
      );
    }

    // Best-effort: a failure leaves the manual link available.
    if (!order.data?.salesOrderId && line.salesOrderLineId) {
      const salesOrderLine = await client
        .from("salesOrderLine")
        .select("salesOrderId")
        .eq("id", line.salesOrderLineId)
        .eq("companyId", companyId)
        .maybeSingle();
      if (salesOrderLine.data?.salesOrderId) {
        await client
          .from("salesReturnOrder")
          .update({
            salesOrderId: salesOrderLine.data.salesOrderId,
            updatedBy: ctx.auditUserId
          })
          .eq("id", orderId)
          .eq("companyId", companyId);
      }
    }
    return { salesReturnOrderLineId: created.data.id };
  }
});

/**
 * Escalate a sales return order line to a quality Issue.
 *
 * @remarks
 * Scrap and Rework are quality decisions, so the line gets an Issue for its
 * received quantity, linked to the line and to its returned entities still
 * On Hold (expected serials or batches, and those received blind against the
 * line), and the line records the disposition. Needs a received quantity, an
 * Issue Type and a location (the RMA's, else the user's). When the line has
 * an open Issue already, only the disposition changes and that Issue is
 * returned (`created` false), so changing the choice never opens a second
 * Issue for the same goods. A failure after the Issue is created deletes it
 * again; a failed disposition write keeps it and `warning` says so.
 *
 * @mcp
 */
export const escalateReturnOrderLine = defineServiceFn({
  input: z.object({
    salesReturnOrderId: z.string(),
    lineId: z.string(),
    disposition: z.enum(["Scrap", "Rework"])
  }),
  permission: { create: "quality", update: "sales" },

  async run(ctx, { salesReturnOrderId: id, lineId, disposition }) {
    const client = ctx.asCaller.supabase;
    const serviceRole = ctx.asSystem.supabase;
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;

    const [order, line] = await Promise.all([
      service.getSalesReturnOrder(client, id),
      service.getSalesReturnOrderLine(client, lineId)
    ]);
    if (order.error || !order.data) {
      return ctx.error("internal", "Failed to load return order", order.error);
    }
    if (line.error || !line.data) {
      return ctx.error(
        "internal",
        "Failed to load return order line",
        line.error
      );
    }
    if (
      line.data.salesReturnOrderId !== id ||
      order.data.companyId !== companyId
    ) {
      return ctx.error(
        "notFound",
        "This line does not belong to this return order"
      );
    }
    const quantityReceived = Number(line.data.quantityReceived ?? 0);
    if (quantityReceived <= 0) {
      return ctx.error(
        "rule",
        "Cannot set a disposition before any quantity is received"
      );
    }

    const entityIds = await service.returnedOnHoldEntityIds(ctx, {
      id,
      lineId
    });

    const [userDefaults, issueTypes, item, returnReason] = await Promise.all([
      getUserDefaults(client, userId, companyId),
      getIssueTypesList(client, companyId),
      client
        .from("item")
        .select("readableIdWithRevision")
        .eq("id", line.data.itemId)
        .eq("companyId", companyId)
        .single(),
      line.data.returnReasonId
        ? client
            .from("returnReason")
            .select("name")
            .eq("id", line.data.returnReasonId)
            .single()
        : Promise.resolve({ data: null, error: null })
    ]);
    const issueType = issueTypes.data?.[0];
    const locationId =
      order.data.locationId ?? userDefaults.data?.locationId ?? null;
    if (!issueType || !locationId) {
      return ctx.error(
        "rule",
        "Configure at least one Issue Type and a location to escalate this line to an Issue"
      );
    }

    // The disposition select posts on every change: without this, Scrap ->
    // Rework -> Scrap left several open Issues each carrying the full
    // received quantity, written off once per Issue.
    const existingLink = await serviceRole
      .from("nonConformanceSalesReturnOrderLine")
      .select("nonConformanceId, nonConformance(id, nonConformanceId, status)")
      .eq("salesReturnOrderLineId", lineId)
      .eq("companyId", companyId);
    if (existingLink.error) {
      return ctx.error(
        "internal",
        "Failed to check for an existing Issue",
        existingLink.error
      );
    }
    const openLink = existingLink.data.find((row) => {
      const nc = row.nonConformance as { status?: string | null } | null;
      return nc && nc.status !== "Closed";
    });
    if (openLink) {
      await serviceRole
        .from("salesReturnOrderLine")
        .update({
          disposition,
          updatedBy: userId,
          updatedAt: datetime.timestamp()
        })
        .eq("id", lineId)
        .eq("companyId", companyId);
      return {
        issueId: openLink.nonConformanceId,
        created: false,
        warning: null
      };
    }

    const rmaReadableId = order.data.salesReturnOrderId ?? "";
    const itemReadableId =
      item.data?.readableIdWithRevision ?? line.data.itemId;
    const created = await insertIssue(serviceRole, {
      name: [
        "Returned goods",
        rmaReadableId,
        itemReadableId && `— ${itemReadableId}`
      ]
        .filter(Boolean)
        .join(" "),
      description: [
        `Auto-created from sales return order ${rmaReadableId} line ${line.data.lineNumber}.`,
        `Requested disposition: ${disposition}.`,
        returnReason.data?.name
          ? `Return reason: ${returnReason.data.name}.`
          : null
      ]
        .filter(Boolean)
        .join(" "),
      priority: "Medium",
      source: "Internal",
      locationId,
      nonConformanceTypeId: issueType.id,
      openDate: datetime
        .today(await getLocationTimeZone(client, locationId, companyId))
        .toString(),
      quantity: quantityReceived,
      items: [line.data.itemId],
      companyId,
      createdBy: userId
    });
    if (created.error || !created.data) {
      return ctx.error("internal", "Failed to create Issue", created.error);
    }
    const issueId = created.data.id;

    // From here a failure deletes the Issue again: an orphan with no RMA
    // link and a line still Pending is worse than a clean retry.
    const linked = await service.linkIssueToReturnLine(ctx, {
      issueId,
      salesReturnOrderId: id,
      rmaReadableId,
      lineId,
      itemId: line.data.itemId,
      entityIds,
      quantityReceived,
      disposition
    });
    if (linked) {
      await deleteIssue(serviceRole, issueId);
      return linked;
    }

    const tasks = await invokeCreate(
      { db: ctx.asSystem.pg, companyId, userId },
      { type: "nonConformanceTasks", id: issueId }
    );
    if (tasks.error) {
      await deleteIssue(serviceRole, issueId);
      return ctx.error("internal", "Failed to create Issue tasks", tasks.error);
    }

    const recorded = await service.setSalesReturnOrderLineDisposition(
      client,
      ctx.asSystem.pg,
      { lineId, companyId, disposition, userId }
    );
    return {
      issueId,
      created: true,
      warning: recorded.error
        ? "Issue created, but failed to update the line's disposition"
        : null
    };
  }
});
/**
 * Change a sales return order (RMA) line.
 *
 * @remarks
 * Refused when the RMA is completed or cancelled, and for a line of another
 * RMA. Once the RMA is confirmed, its quantity, item, unit price, restocking
 * fee, unit of measure and source links are locked: they were checked
 * against their sources at Confirm. A field that is sent unchanged, or not
 * sent, is no change.
 *
 * @mcp
 */
export const updateReturnOrderLine = defineServiceFn({
  input: salesReturnOrderLineValidator.extend({
    id: z.string(),
    customFields: customFieldValues.optional()
  }),
  permission: { update: "sales" },

  async run(ctx, { id: lineId, customFields, ...line }) {
    const client = ctx.asCaller.supabase;
    const orderId = line.salesReturnOrderId;

    const order = await service.getSalesReturnOrder(client, orderId);
    if (isSalesReturnOrderLocked(order.data?.status)) {
      return ctx.error(
        "rule",
        "Cannot modify a completed or cancelled return order."
      );
    }

    const existing = await client
      .from("salesReturnOrderLine")
      .select(
        "salesReturnOrderId, quantity, itemId, unitPrice, restockFeePercent, unitOfMeasureCode, salesOrderLineId, shipmentLineId, salesInvoiceLineId"
      )
      .eq("id", lineId)
      .eq("companyId", ctx.company.id)
      .single();
    if (existing.error || existing.data.salesReturnOrderId !== orderId) {
      return ctx.error(
        "notFound",
        "This line does not belong to this return order"
      );
    }

    if (order.data?.status !== "Draft") {
      const current = existing.data;
      const locked: [string, unknown, unknown][] = [
        ["Quantity", Number(line.quantity), Number(current.quantity)],
        ["Item", line.itemId, current.itemId],
        ["Unit price", Number(line.unitPrice), Number(current.unitPrice)],
        [
          "Restocking fee",
          line.restockFeePercent === undefined
            ? undefined
            : Number(line.restockFeePercent),
          Number(current.restockFeePercent)
        ],
        [
          "Unit of measure",
          line.unitOfMeasureCode,
          current.unitOfMeasureCode ?? undefined
        ],
        [
          "Sales order line link",
          line.salesOrderLineId,
          current.salesOrderLineId ?? undefined
        ],
        [
          "Shipment line link",
          line.shipmentLineId,
          current.shipmentLineId ?? undefined
        ],
        [
          "Invoice line link",
          line.salesInvoiceLineId,
          current.salesInvoiceLineId ?? undefined
        ]
      ];
      const changed = locked.find(
        ([, next, now]) => next !== undefined && next !== now
      );
      if (changed) {
        return ctx.error("rule", `${changed[0]} is locked after confirmation`);
      }
    }

    const updated = await service.upsertSalesReturnOrderLine(client, {
      ...line,
      id: lineId,
      updatedBy: ctx.auditUserId,
      customFields
    });
    if (updated.error) {
      return ctx.error(
        "internal",
        "Failed to update return order line",
        updated.error
      );
    }
    return { salesReturnOrderLineId: lineId };
  }
});

// --- Quote methods: materials and operations ---------------------------------

/** Which parts of a method a copy brings. */
const methodParts = z.object({
  billOfMaterial: z.boolean().default(true),
  billOfProcess: z.boolean().default(true),
  parameters: z.boolean().default(true),
  tools: z.boolean().default(true),
  steps: z.boolean().default(true),
  workInstructions: z.boolean().default(true)
});
/**
 * Copy an item's method onto a quote line.
 *
 * @remarks
 * The parts chosen in `parts` replace the line's method (with a
 * configuration, the item's configured method), then the line's quantities
 * are repriced from it.
 *
 * @mcp
 */
export const copyItemMethodToQuoteLine = defineServiceFn({
  input: z.object({
    quoteId: z.string().min(1),
    quoteLineId: z.string().min(1),
    itemId: z.string(),
    parts: methodParts.default(methodParts.parse({})),
    configuration: z.record(z.string(), z.unknown()).optional()
  }),
  permission: { update: "sales" },

  async run(ctx, { quoteId, quoteLineId, itemId, parts, configuration }) {
    // The method is written with the service role.
    const refused = await refuseUnlessOwned(ctx, "quoteLine", {
      id: quoteLineId,
      quoteId
    });
    if (refused) return refused;

    const method = await service.upsertQuoteLineMethod(
      ctx.asSystem.supabase,
      ctx.asSystem.pg,
      {
        itemId,
        quoteId,
        quoteLineId,
        companyId: ctx.company.id,
        userId: ctx.auditUserId,
        parts,
        ...(configuration !== undefined ? { configuration } : {})
      }
    );
    if (method.error) {
      return ctx.error(
        "internal",
        "Failed to get quote line method",
        method.error
      );
    }
    const priced = await service.repriceQuoteLine(ctx, {
      quoteId,
      quoteLineId
    });
    if (priced?.error) {
      return ctx.error("internal", "Failed to recalculate quote line prices");
    }
    return { quoteLineId };
  }
});

/**
 * Copy another quote line's method onto a quote line.
 *
 * @remarks
 * `sourceId` and `targetId` are both `quoteId:quoteLineId`. The parts chosen
 * in `parts` are copied, then the target line is repriced with its pricing
 * rules and configuration prices on top of the copied cost.
 *
 * @mcp
 */
export const copyQuoteLineMethod = defineServiceFn({
  input: z.object({
    sourceId: z.string(),
    targetId: z.string(),
    parts: methodParts.default(methodParts.parse({}))
  }),
  permission: { update: "sales" },

  async run(ctx, { sourceId, targetId, parts }) {
    const [quoteId, quoteLineId] = targetId.split(":");
    if (!quoteId || !quoteLineId) {
      return ctx.error("validation", "targetId must be quoteId:quoteLineId");
    }
    const refused = await refuseUnlessOwned(ctx, "quoteLine", {
      id: quoteLineId,
      quoteId
    });
    if (refused) return refused;

    const copied = await service.copyQuoteLine(
      ctx.asSystem.supabase,
      ctx.asSystem.pg,
      {
        type: "quoteLine",
        sourceId,
        targetId,
        ...parts,
        companyId: ctx.company.id,
        userId: ctx.auditUserId
      }
    );
    if (copied.error) {
      return ctx.error("internal", "Failed to copy quote line", copied.error);
    }
    const priced = await service.repriceQuoteLine(ctx, {
      quoteId,
      quoteLineId
    });
    if (priced?.error) {
      return ctx.error("internal", "Failed to recalculate quote line prices");
    }
    return { quoteLineId };
  }
});

/**
 * Copy an item's method onto a quote material's make method.
 *
 * @remarks
 * `targetId` is the material's make method. The parts chosen in `parts`
 * replace it (with a configuration, the item's configured method).
 *
 * @mcp
 */
export const copyItemMethodToQuoteMaterial = defineServiceFn({
  input: z.object({
    sourceId: z.string(),
    targetId: z.string(),
    parts: methodParts.default(methodParts.parse({})),
    configuration: z.record(z.string(), z.unknown()).optional()
  }),
  permission: { update: "sales" },

  async run(ctx, { sourceId, targetId, parts, configuration }) {
    const method = await service.upsertQuoteMaterialMakeMethod(
      ctx.asSystem.supabase,
      ctx.asSystem.pg,
      {
        sourceId,
        targetId,
        companyId: ctx.company.id,
        userId: ctx.auditUserId,
        parts,
        ...(configuration !== undefined ? { configuration } : {})
      }
    );
    if (method.error) {
      return ctx.error(
        "internal",
        "Failed to insert quote material make method",
        method.error
      );
    }
    return { quoteMaterialMakeMethodId: targetId };
  }
});

const quoteMaterialInput = z.object({
  ...quoteMaterialValidator.shape,
  kit: z.boolean().default(false),
  quoteId: z.string(),
  quoteLineId: z.string(),
  customFields: customFieldValues.optional()
});

/**
 * Add a material to a quote line's method.
 *
 * @remarks
 * The line, its make method and the operation it is issued to must be this
 * company's and the line's. A Make to Order material gets the item's method
 * (when that fails the material is kept and `warning` says so). Then the
 * line is repriced.
 *
 * @mcp
 */
export const createQuoteMaterial = defineServiceFn({
  input: quoteMaterialInput,
  permission: { create: "sales" },

  async run(ctx, { customFields, ...material }) {
    const serviceRole = ctx.asSystem.supabase;
    const { quoteId, quoteLineId } = material;
    const refused = await service.refuseUnlessQuoteMethodRows(ctx, {
      quoteId,
      quoteLineId,
      quoteMakeMethodId: material.quoteMakeMethodId,
      quoteOperationId: material.quoteOperationId
    });
    if (refused) return refused;

    const inserted = await service.upsertQuoteMaterial(serviceRole, {
      ...material,
      companyId: ctx.company.id,
      createdBy: ctx.auditUserId,
      customFields
    });
    if (inserted.error || !inserted.data?.id) {
      return ctx.error(
        "internal",
        "Failed to insert quote material",
        inserted.error
      );
    }
    const id = inserted.data.id;

    let warning: string | null = null;
    if (material.methodType === "Make to Order") {
      const withMethod = await serviceRole
        .from("quoteMaterialWithMakeMethodId")
        .select("*")
        .eq("id", id)
        .eq("companyId", ctx.company.id)
        .single();
      if (withMethod.error) {
        return ctx.error(
          "internal",
          "Failed to get material make method",
          withMethod.error
        );
      }
      const method = await service.upsertQuoteMaterialMakeMethod(
        serviceRole,
        ctx.asSystem.pg,
        {
          sourceId: material.itemId,
          targetId: withMethod.data.quoteMaterialMakeMethodId!,
          companyId: ctx.company.id,
          userId: ctx.auditUserId
        }
      );
      if (method.error) {
        warning = "Failed to insert quote material make method";
      }
    }

    // A failed method skipped the reprice, as it always has.
    if (!warning) await service.repriceQuoteLine(ctx, { quoteId, quoteLineId });
    return { id, warning };
  }
});

/**
 * Change a material on a quote line's method.
 *
 * @remarks
 * The material, its line and the operation it is issued to must be this
 * company's and the line's. A material never moves to another line. Then the
 * line is repriced.
 *
 * @mcp
 */
export const updateQuoteMaterial = defineServiceFn({
  input: quoteMaterialInput,
  permission: { create: "sales" },

  async run(ctx, { customFields, ...material }) {
    const { quoteId, quoteLineId } = material;
    const refused =
      (await refuseUnlessOwned(ctx, "quoteMaterial", {
        id: material.id,
        quoteLineId
      })) ??
      (await service.refuseUnlessQuoteMethodRows(ctx, {
        quoteId,
        quoteLineId,
        quoteOperationId: material.quoteOperationId
      }));
    if (refused) return refused;

    const updated = await service.upsertQuoteMaterial(ctx.asSystem.supabase, {
      ...material,
      companyId: ctx.company.id,
      updatedBy: ctx.auditUserId,
      customFields
    });
    if (updated.error || !updated.data?.id) {
      return ctx.error(
        "internal",
        "Failed to update quote material",
        updated.error
      );
    }
    await service.repriceQuoteLine(ctx, { quoteId, quoteLineId });
    return { id: updated.data.id, methodType: updated.data.methodType };
  }
});

/**
 * Remove a material from a quote line's method, then reprice the line.
 *
 * @mcp destructive
 */
export const deleteQuoteMaterialAndReprice = defineServiceFn({
  input: z.object({
    quoteId: z.string(),
    quoteLineId: z.string(),
    id: z.string()
  }),
  permission: { delete: "sales" },

  async run(ctx, { quoteId, quoteLineId, id }) {
    const refused =
      (await refuseUnlessOwned(ctx, "quoteLine", {
        id: quoteLineId,
        quoteId
      })) ??
      (await refuseUnlessOwned(ctx, "quoteMaterial", { id, quoteLineId }));
    if (refused) return refused;

    const deleted = await service.deleteQuoteMaterial(
      ctx.asCaller.supabase,
      id
    );
    if (deleted.error) {
      return ctx.error(
        "internal",
        "Failed to delete quote material",
        deleted.error
      );
    }
    await service.repriceQuoteLine(ctx, { quoteId, quoteLineId });
    return { id };
  }
});
const quoteOperationInput = quoteOperationValidator.safeExtend({
  quoteId: z.string(),
  quoteLineId: z.string(),
  customFields: customFieldValues.optional()
});

/**
 * Add an operation to a quote line's method, then reprice the line.
 *
 * @remarks
 * The line and its make method must be this company's and the line's.
 *
 * @mcp
 */
export const createQuoteOperation = defineServiceFn({
  input: quoteOperationInput,
  permission: { create: "sales" },

  async run(ctx, { customFields, ...operation }) {
    const { quoteId, quoteLineId } = operation;
    const refused = await service.refuseUnlessQuoteMethodRows(ctx, {
      quoteId,
      quoteLineId,
      quoteMakeMethodId: operation.quoteMakeMethodId
    });
    if (refused) return refused;

    const inserted = await service.upsertQuoteOperation(ctx.asCaller.supabase, {
      ...operation,
      companyId: ctx.company.id,
      createdBy: ctx.auditUserId,
      customFields
    });
    if (inserted.error || !inserted.data?.id) {
      return ctx.error(
        "internal",
        "Failed to insert quote operation",
        inserted.error
      );
    }
    await service.repriceQuoteLine(ctx, { quoteId, quoteLineId });
    return { id: inserted.data.id };
  }
});

/**
 * Change an operation on a quote line's method, then reprice the line.
 *
 * @mcp
 */
export const updateQuoteOperation = defineServiceFn({
  input: quoteOperationInput,
  permission: { create: "sales" },

  async run(ctx, { customFields, ...operation }) {
    const { quoteId, quoteLineId } = operation;
    const refused =
      (await refuseUnlessOwned(ctx, "quoteLine", {
        id: quoteLineId,
        quoteId
      })) ??
      (await refuseUnlessOwned(ctx, "quoteOperation", {
        id: operation.id,
        quoteLineId
      }));
    if (refused) return refused;

    const updated = await service.upsertQuoteOperation(ctx.asCaller.supabase, {
      ...operation,
      companyId: ctx.company.id,
      updatedBy: ctx.auditUserId,
      customFields
    });
    if (updated.error || !updated.data?.id) {
      return ctx.error(
        "internal",
        "Failed to update quote operation",
        updated.error
      );
    }
    await service.repriceQuoteLine(ctx, { quoteId, quoteLineId });
    return { id: updated.data.id };
  }
});

/**
 * Remove an operation from a quote line's method, then reprice its line.
 *
 * @mcp destructive
 */
export const deleteQuoteOperationAndReprice = defineServiceFn({
  input: z.object({ id: z.string() }),
  permission: { delete: "sales" },

  async run(ctx, { id }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const operation = await client
      .from("quoteOperation")
      .select("quoteId, quoteLineId")
      .eq("id", id)
      .eq("companyId", companyId)
      .single();

    const deleted = await client
      .from("quoteOperation")
      .delete()
      .eq("id", id)
      .eq("companyId", companyId);
    if (deleted.error) {
      return ctx.error(
        "internal",
        "Failed to delete quote operation",
        deleted.error
      );
    }
    if (operation.data) await service.repriceQuoteLine(ctx, operation.data);
    return { id };
  }
});

// --- Contracts --------------------------------------------------------------
/**
 * Create a Draft contract.
 *
 * @remarks
 * The contract type, when not sent, is suggested from the customer's other
 * contracts. The bill-to, invoice contact and address, ship-to and payment
 * terms the input leaves out come from the customer's invoicing and shipping
 * defaults. The exchange rate is today's for the currency. The contract is
 * then set up from its products step.
 *
 * @mcp
 */
export const createContract = defineServiceFn({
  input: customerContractValidator.safeExtend({
    customFields: customFieldValues.optional()
  }),
  permission: { create: "sales" },

  async run(ctx, input) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const {
      id: _id,
      customerContractId: _customerContractId,
      customFields,
      ...data
    } = input;

    let contractType = data.contractType;
    if (!contractType) {
      const previous = await service.getCustomerContractStatuses(
        client,
        companyId,
        data.customerId
      );
      if (previous.error) {
        return ctx.error(
          "internal",
          "Failed to read the customer's contracts",
          previous.error
        );
      }
      contractType = suggestContractType(previous.data ?? []);
    }

    const defaults = await service.contractInvoicingDefaults(
      client,
      companyId,
      data.customerId
    );
    const sequence = await getNextSequenceNumber(
      client,
      "customerContract",
      companyId
    );
    if (sequence.error || !sequence.data) {
      return ctx.error(
        "internal",
        "Failed to get the next contract number",
        sequence.error
      );
    }
    // Looked up, never assumed 1.
    const exchangeRate = await getExchangeRate(
      client,
      companyId,
      data.currencyCode
    );
    if (exchangeRate.error || !exchangeRate.data) {
      return ctx.error(
        "internal",
        "Failed to get the exchange rate",
        exchangeRate.error
      );
    }

    const contract = await service.insertContract(client, {
      ...data,
      invoiceCustomerId: data.invoiceCustomerId ?? defaults.invoiceCustomerId,
      invoiceCustomerContactId:
        data.invoiceCustomerContactId ?? defaults.invoiceCustomerContactId,
      invoiceCustomerLocationId:
        data.invoiceCustomerLocationId ?? defaults.invoiceCustomerLocationId,
      shipToCustomerLocationId:
        data.shipToCustomerLocationId ?? defaults.shipToCustomerLocationId,
      paymentTermId: data.paymentTermId ?? defaults.paymentTermId,
      exchangeRate: Number(exchangeRate.data),
      contractType,
      customerContractId: sequence.data,
      companyId,
      createdBy: ctx.auditUserId,
      customFields
    });
    if (contract.error || !contract.data) {
      return ctx.error("internal", "Failed to create contract", contract.error);
    }
    return { id: contract.data.id };
  }
});

/**
 * Save a Draft contract's terms from its setup.
 *
 * @remarks
 * Refused once the contract is not a Draft. A new customer brings its own
 * bill-to, invoice contact and address, ship-to and payment terms; a new
 * currency brings today's exchange rate. Custom fields the input leaves out
 * are kept.
 *
 * @mcp
 */
export const updateContractTerms = defineServiceFn({
  input: customerContractValidator.safeExtend({
    id: z.string(),
    customFields: customFieldValues.optional()
  }),
  permission: { update: "sales" },

  async run(ctx, input) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const {
      id,
      customerContractId: _customerContractId,
      customFields,
      ...data
    } = input;

    const current = await service.getContract(client, id, companyId);
    if (current.error || current.data?.companyId !== companyId) {
      return ctx.error("notFound", "Contract not found", current.error);
    }

    const invoicing = await service.contractCustomerChange(client, companyId, {
      from: current.data.customerId,
      to: data.customerId
    });

    let exchangeRate: number | undefined;
    if (data.currencyCode !== current.data.currencyCode) {
      const rate = await getExchangeRate(client, companyId, data.currencyCode);
      if (rate.error || !rate.data) {
        return ctx.error(
          "internal",
          "Failed to get the exchange rate",
          rate.error
        );
      }
      exchangeRate = Number(rate.data);
    }

    // Refuses a contract that is no longer a Draft.
    const update = await service.updateContract(client, {
      ...data,
      ...(invoicing ?? {}),
      ...(exchangeRate !== undefined ? { exchangeRate } : {}),
      id,
      updatedBy: ctx.auditUserId,
      customFields: {
        ...((current.data.customFields ?? {}) as Record<string, unknown>),
        ...customFields
      } as Json
    });
    if (update.error) {
      return ctx.error(
        "rule",
        update.error.message || "Failed to update contract",
        update.error
      );
    }
    return { id };
  }
});

/** The terms one contract field can change from its properties panel. */
const contractTermFields = [
  "name",
  "customerId",
  "invoiceCustomerId",
  "invoiceCustomerContactId",
  "invoiceCustomerLocationId",
  "shipToCustomerLocationId",
  "salesPersonId",
  "projectId",
  "customerReference",
  "closeDate",
  "startDate",
  "duration",
  "endDate",
  "renewal",
  "renewalUplift",
  "billingFrequency",
  "billingAlignment",
  "billingTiming",
  "firstInvoiceDate",
  "billedThrough",
  "recognizeRevenueFrom",
  "paymentTermId",
  "currencyCode",
  "notes"
] as const;

/**
 * Set one term of a contract.
 *
 * @remarks
 * A Draft's terms are checked as a whole (an end date on or after the start,
 * a custom duration needs an end date), so the stored terms are read, the
 * one field is swapped in and the whole set is validated and saved. A new
 * customer brings its own invoicing defaults; a new bill-to clears the
 * invoice contact and address; an end date makes the term custom; a new
 * currency brings today's rate. `notes` is plain text. An Active contract
 * changes its terms with Amend: only its notes are set here.
 *
 * @mcp
 */
export const setContractTerm = defineServiceFn({
  input: z.object({
    id: z.string(),
    field: z.enum(contractTermFields),
    value: z.string().nullish()
  }),
  permission: { update: "sales" },

  async run(ctx, { id, field, value }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;

    const current = await service.getContract(client, id, companyId);
    if (current.error || current.data?.companyId !== companyId) {
      logger.error("contract not found for update", {
        companyId,
        id,
        error: current.error
      });
      return ctx.error("notFound", "Contract not found");
    }
    const contract = current.data;
    const notesDoc = value ? textToTiptap(value) : null;

    if (contract.status !== "Draft") {
      if (field !== "notes") {
        return ctx.error(
          "rule",
          "Only a Draft contract's terms can be edited — use Amend"
        );
      }
      // Notes are not a term: they stay editable after Confirm.
      const update = await service.updateContractNotes(client, {
        id,
        companyId,
        notes: notesDoc,
        updatedBy: userId
      });
      if (update.error) {
        return ctx.error(
          "rule",
          update.error.message || "Failed to update notes",
          update.error
        );
      }
      return { id };
    }

    const terms: Record<(typeof contractTermFields)[number], unknown> = {
      name: contract.name,
      customerId: contract.customerId,
      invoiceCustomerId: contract.invoiceCustomerId,
      invoiceCustomerContactId: contract.invoiceCustomerContactId,
      invoiceCustomerLocationId: contract.invoiceCustomerLocationId,
      shipToCustomerLocationId: contract.shipToCustomerLocationId,
      salesPersonId: contract.salesPersonId,
      projectId: contract.projectId,
      customerReference: contract.customerReference,
      closeDate: contract.closeDate,
      startDate: contract.startDate,
      duration: contractDurationOf({
        endDate: contract.endDate,
        termMonths: contract.termMonths
      }),
      endDate: contract.endDate,
      renewal: contract.renewal,
      // Stored as a fraction; the terms speak percent points.
      renewalUplift: round(Number(contract.renewalUplift ?? 0) * 100),
      billingFrequency: contract.billingFrequency,
      billingAlignment: contract.billingAlignment,
      billingTiming: contract.billingTiming,
      firstInvoiceDate: contract.firstInvoiceDate,
      billedThrough: contract.billedThrough,
      recognizeRevenueFrom: contract.recognizeRevenueFrom,
      paymentTermId: contract.paymentTermId,
      currencyCode: contract.currencyCode,
      // The stored document, re-encoded so the validator keeps it as is.
      notes: contract.notes ? JSON.stringify(contract.notes) : null
    };
    terms[field] =
      field === "notes"
        ? notesDoc
          ? JSON.stringify(notesDoc)
          : null
        : value || null;
    if (field === "endDate") terms.duration = "custom";
    if (field === "customerId") {
      const invoicing = await service.contractCustomerChange(
        client,
        companyId,
        {
          from: contract.customerId,
          to: value ?? null
        }
      );
      if (invoicing) Object.assign(terms, invoicing);
    }
    if (field === "invoiceCustomerId" && value !== contract.invoiceCustomerId) {
      terms.invoiceCustomerContactId = null;
      terms.invoiceCustomerLocationId = null;
    }

    // The same form the new contract form posts, so the same coercion runs.
    const merged = new FormData();
    for (const key of contractTermFields) {
      const term = terms[key];
      if (term !== null && term !== undefined && term !== "") {
        merged.append(key, String(term));
      }
    }
    // Not a term, but the terms service writes it: carried so saving a term
    // never resets the contract to the company's invoicing setting.
    if (contract.invoiceAutomation) {
      merged.append("invoiceAutomation", contract.invoiceAutomation);
    }
    if (field === "currencyCode" && value && value !== contract.currencyCode) {
      const rate = await getExchangeRate(client, companyId, value);
      if (rate.error) {
        return ctx.error(
          "internal",
          "Failed to get the exchange rate",
          rate.error
        );
      }
      merged.append("exchangeRate", String(rate.data));
    }

    const validation = await validator(customerContractValidator).validate(
      merged
    );
    if (validation.error) {
      return ctx.error(
        "validation",
        Object.values(validation.error.fieldErrors)[0] ??
          "These terms are not valid"
      );
    }
    const {
      id: _id,
      customerContractId: _customerContractId,
      ...data
    } = validation.data;

    const update = await service.updateContract(client, {
      ...data,
      // Not a term: an omitted type is kept.
      contractType: undefined,
      id,
      updatedBy: userId,
      customFields: contract.customFields ?? undefined
    });
    if (update.error) {
      logger.error("contract term update failed", {
        companyId,
        id,
        field,
        error: update.error
      });
      return ctx.error(
        "rule",
        update.error.message || "Failed to update contract",
        update.error
      );
    }
    return { id };
  }
});

/**
 * Set a contract's type.
 *
 * @remarks
 * Stays editable while the contract is Active.
 *
 * @mcp
 */
export const setContractType = defineServiceFn({
  input: z.object({
    id: z.string(),
    contractType: z.enum(customerContractTypes)
  }),
  permission: { update: "sales" },

  async run(ctx, { id, contractType }) {
    const update = await service.updateContractType(ctx.asCaller.supabase, {
      id,
      companyId: ctx.company.id,
      contractType,
      updatedBy: ctx.auditUserId
    });
    if (update.error) {
      return ctx.error(
        "rule",
        update.error.message || "Failed to update contract type",
        update.error
      );
    }
    return { id };
  }
});

/**
 * Set how a contract's invoices are posted and sent.
 *
 * @remarks
 * Null is the company's setting. Stripe needs Stripe connected. On a
 * confirmed contract, a mode that posts (anything but Draft Only, the
 * company's setting included) needs the invoicing create permission as well,
 * as confirming does. Post and Email needs an invoice contact email.
 *
 * @mcp
 */
export const setContractInvoiceAutomation = defineServiceFn({
  input: z.object({
    id: z.string(),
    invoiceAutomation: z.enum(invoiceAutomations).nullable()
  }),
  permission: { update: "sales" },

  async run(ctx, { id, invoiceAutomation }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    if (
      invoiceAutomation === "Post and Send via Stripe" &&
      !(await getStripeConnectAccountId(ctx.asSystem.supabase, companyId))
    ) {
      return ctx.error("rule", "Connect Stripe in Integrations first");
    }

    if (invoiceAutomation !== "Draft Only") {
      const current = await service.getContract(client, id, companyId);
      if (current.error || current.data?.companyId !== companyId) {
        return ctx.error("notFound", "Contract not found");
      }
      if (current.data.status !== "Draft") {
        // An unreadable company setting is treated as posting.
        const effective =
          invoiceAutomation ??
          (await getCompanySettings(client, companyId)).data?.invoiceAutomation;
        if (
          effective !== "Draft Only" &&
          !ctx.can({ update: "sales", create: "invoicing" })
        ) {
          return service.forbidden(ctx);
        }
      }
    }

    const update = await service.updateContractInvoiceAutomation(client, {
      id,
      companyId,
      invoiceAutomation,
      updatedBy: ctx.auditUserId
    });
    if (update.error) {
      return ctx.error(
        "rule",
        update.error.message || "Failed to update invoicing",
        update.error
      );
    }
    return { id };
  }
});

/**
 * Confirm a Draft contract.
 *
 * @remarks
 * A contract whose invoices post on their own (any mode but Draft Only)
 * needs the invoicing create permission as well. Under Post and Send via
 * Stripe a billing customer with no Stripe customer is linked first, as
 * `stripeCustomerAction` says. The `post-customer-contract` server function
 * then checks the lines, fixes the invoice schedule and revenue plan and
 * makes the contract Active.
 *
 * @mcp
 */
export const confirmContract = defineServiceFn({
  input: z.object({
    id: z.string(),
    stripeCustomerAction: z.enum(stripeCustomerActions).optional(),
    stripeCustomerId: z.string().optional(),
    stripeContactEmail: z.string().email().optional()
  }),
  permission: { update: "sales" },

  async run(ctx, { id, stripeCustomerAction, ...stripe }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const contract = await service.getContract(client, id, companyId);
    if (contract.error || contract.data?.companyId !== companyId) {
      return ctx.error("notFound", "Contract not found", contract.error);
    }
    if (contract.data.status !== "Draft") {
      return ctx.error("conflict", "Only a Draft contract can be confirmed");
    }
    const mode = contract.data.effectiveInvoiceAutomation;
    if (
      mode !== "Draft Only" &&
      !ctx.can({ update: "sales", create: "invoicing" })
    ) {
      return service.forbidden(ctx);
    }

    // The server function re-checks the mapping inside its transaction.
    const billingCustomerId =
      contract.data.invoiceCustomerId ?? contract.data.customerId;
    if (
      mode === "Post and Send via Stripe" &&
      stripeCustomerAction &&
      billingCustomerId
    ) {
      let message: string | null = null;
      try {
        const linked = await linkStripeCustomerForBilling({
          serviceRole: ctx.asSystem.supabase,
          db: ctx.asSystem.pg,
          companyId,
          userId: ctx.auditUserId,
          billingCustomerId,
          customerContactId: contract.data.invoiceCustomerContactId,
          action: stripeCustomerAction,
          stripeCustomerId: stripe.stripeCustomerId,
          contactEmail: stripe.stripeContactEmail
        });
        if (!linked.ok) message = linked.message;
      } catch (err) {
        logger.error("Failed to link the Stripe customer", {
          companyId,
          customerContractId: id,
          billingCustomerId,
          error: err
        });
        message = getErrorMessage(
          err,
          "the Stripe customer could not be linked"
        );
      }
      if (message) {
        return ctx.error("rule", `Contract not confirmed — ${message}`);
      }
    }

    const result = await service.postContract(ctx, {
      type: "confirm",
      customerContractId: id,
      asOf: await service.companyToday(ctx)
    });
    if (result.error) {
      return ctx.error(
        "rule",
        getErrorMessage(result.error, "Failed to confirm the contract"),
        result.error
      );
    }
    return { id };
  }
});

const contractAmendment = customerContractAmendmentValidator.extend({
  changes: z
    .array(contractAmendmentChangeValidator)
    .min(1, { message: "Change at least one line" })
});

/**
 * Preview an amendment to an Active contract.
 *
 * @remarks
 * Runs the amendment the way `sales.contract.amend` would and rolls it
 * back: the adjustments, the next two invoices and the suggested contract
 * type.
 *
 * @mcp
 */
export const previewContractAmendment = defineServiceFn({
  input: contractAmendment.omit({ reason: true, contractType: true }),
  permission: { update: "sales" },

  async run(ctx, { customerContractId, amendmentDate, effect, changes }) {
    const result = await service.postContract(ctx, {
      type: "amend",
      customerContractId,
      asOf: await service.companyToday(ctx),
      amendmentDate,
      effect,
      // Neither changes what the amendment does; both are recorded only.
      contractType: "Existing",
      reason: "Preview",
      changes,
      preview: true
    });
    if (result.error) {
      return ctx.error(
        "rule",
        getErrorMessage(result.error, "Failed to preview the amendment"),
        result.error
      );
    }
    return result.data as ContractAmendmentPreview;
  }
});

/**
 * Amend an Active contract.
 *
 * @remarks
 * Changes, adds or ends lines from `amendmentDate`, recorded with its type
 * and reason. The `post-customer-contract` server function owns every guard
 * and re-plans the schedule and revenue from the effective date; its
 * refusal is the message.
 *
 * @mcp
 */
export const amendContract = defineServiceFn({
  input: contractAmendment,
  permission: { update: "sales" },

  async run(ctx, input) {
    const result = await service.postContract(ctx, {
      type: "amend",
      asOf: await service.companyToday(ctx),
      ...input
    });
    if (result.error) {
      return ctx.error(
        "rule",
        getErrorMessage(result.error, "Failed to amend the contract"),
        result.error
      );
    }
    return { id: input.customerContractId };
  }
});

/**
 * Preview cancelling an Active contract.
 *
 * @remarks
 * Runs the cancellation and rolls it back: the credit available for the
 * unused time after `endDate`.
 *
 * @mcp
 */
export const previewContractCancellation = defineServiceFn({
  input: z.object({ customerContractId: z.string(), endDate: z.string() }),
  permission: { update: "sales" },

  async run(ctx, { customerContractId, endDate }) {
    const result = await service.postContract(ctx, {
      type: "cancel",
      customerContractId,
      asOf: await service.companyToday(ctx),
      endDate,
      // Recorded only; the preview's credit does not depend on either.
      reason: "Preview",
      creditUnusedTime: false,
      preview: true
    });
    if (result.error) {
      return ctx.error(
        "rule",
        getErrorMessage(result.error, "Failed to preview the cancellation"),
        result.error
      );
    }
    const preview = result.data;
    if (
      typeof preview !== "object" ||
      preview === null ||
      !("creditAvailable" in preview) ||
      !("credit" in preview)
    ) {
      return ctx.error("internal", "Failed to preview the cancellation");
    }
    return preview as ContractCancellationPreview;
  }
});

/**
 * Cancel an Active contract.
 *
 * @remarks
 * Ends it at `endDate`. With `creditUnusedTime` a Draft credit memo is
 * drafted for the unused time, which needs the invoicing create permission
 * as well; `memoReadableId` names it.
 *
 * @mcp
 */
export const cancelContract = defineServiceFn({
  input: z.object({
    customerContractId: z.string(),
    endDate: z.string(),
    reason: z.string().trim().min(1),
    creditUnusedTime: z.boolean().default(false)
  }),
  permission: { update: "sales" },

  async run(ctx, input) {
    if (
      input.creditUnusedTime &&
      !ctx.can({ update: "sales", create: "invoicing" })
    ) {
      return service.forbidden(ctx);
    }
    const result = await service.postContract(ctx, {
      type: "cancel",
      asOf: await service.companyToday(ctx),
      ...input
    });
    if (result.error) {
      return ctx.error(
        "rule",
        getErrorMessage(result.error, "Failed to cancel the contract"),
        result.error
      );
    }
    const cancelled = result.data as Partial<ContractCancellationResult> | null;
    return {
      id: input.customerContractId,
      memoReadableId: cancelled?.memoReadableId ?? null
    };
  }
});

/**
 * Revert a contract's cancellation.
 *
 * @remarks
 * Restores the lines, end date and renewal it changed. When the
 * cancellation drafted a credit memo, it is deleted, which needs the
 * invoicing delete permission as well (a failed check for one asks for it).
 *
 * @mcp
 */
export const revertContractCancellation = defineServiceFn({
  input: z.object({ customerContractId: z.string() }),
  permission: { update: "sales" },

  async run(ctx, { customerContractId }) {
    const memoRows = await ctx.asCaller.supabase
      .from("customerContractInvoiceLine")
      .select("id")
      .eq("customerContractId", customerContractId)
      .eq("companyId", ctx.company.id)
      .not("memoId", "is", null)
      .limit(1);
    if (
      (memoRows.error || memoRows.data.length > 0) &&
      !ctx.can({ update: "sales", delete: "invoicing" })
    ) {
      return service.forbidden(ctx);
    }

    const result = await service.postContract(ctx, {
      type: "revert-cancellation",
      customerContractId,
      asOf: await service.companyToday(ctx)
    });
    if (result.error) {
      return ctx.error(
        "rule",
        getErrorMessage(result.error, "Failed to revert the cancellation"),
        result.error
      );
    }
    return { id: customerContractId };
  }
});

// --- Rental agreements ------------------------------------------------------
const rentalAgreementInput = rentalAgreementValidator.safeExtend({
  ownershipTransfers: z.boolean().default(false),
  specializedAsset: z.boolean().default(false),
  purchaseOptionReasonablyCertain: z.boolean().default(false),
  customFields: customFieldValues.optional()
});

/**
 * Create a Draft rental agreement.
 *
 * @remarks
 * Takes the next agreement number. With `fixedAssetId` (the fleet's Rent)
 * the unit is added at its monthly rate on file; when that fails the
 * agreement is kept and `warning` says so. The agreement is then set up
 * from its units step.
 *
 * @mcp
 */
export const createRentalAgreement = defineServiceFn({
  input: rentalAgreementInput.safeExtend({
    fixedAssetId: z.string().optional()
  }),
  permission: { create: "sales" },

  async run(ctx, input) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const {
      id: _id,
      rentalAgreementId: _rentalAgreementId,
      fixedAssetId,
      customFields,
      ...data
    } = input;

    const sequence = await getNextSequenceNumber(
      client,
      "rentalAgreement",
      companyId
    );
    if (sequence.error || !sequence.data) {
      return ctx.error(
        "internal",
        "Failed to get the next rental agreement number",
        sequence.error
      );
    }
    const agreement = await service.insertRentalAgreement(client, {
      ...data,
      rentalAgreementId: sequence.data,
      companyId,
      createdBy: ctx.auditUserId,
      customFields
    });
    if (agreement.error || !agreement.data) {
      return ctx.error(
        "internal",
        "Failed to create rental agreement",
        agreement.error
      );
    }
    const id = agreement.data.id;

    if (fixedAssetId) {
      const line = await service.upsertRentalAgreementLine(client, {
        rentalAgreementId: id,
        fixedAssetId,
        // The planner can change the frequency and rate on the unit.
        rateUnit: "Month",
        companyId,
        createdBy: ctx.auditUserId
      });
      if (line.error) {
        logger.error("Failed to add the unit to a new rental agreement", {
          companyId,
          rentalAgreementId: id,
          error: line.error
        });
        return {
          id,
          warning: "Agreement created, but the unit could not be added"
        };
      }
    }
    return { id, warning: null };
  }
});

const rentalTermFields = [
  "customerId",
  "customerLocationId",
  "customerContactId",
  "salesPersonId",
  "locationId",
  "startDate",
  "endDate",
  "billingCycle",
  "billingTiming",
  "paymentTermId",
  "currencyCode",
  "depositAmount",
  "taxPercent",
  "discountRate",
  "ownershipTransfers",
  "specializedAsset",
  "purchaseOptionAmount",
  "purchaseOptionReasonablyCertain",
  "notes"
] as const;

const rentalBooleanTerms = new Set<string>([
  "ownershipTransfers",
  "specializedAsset",
  "purchaseOptionReasonablyCertain"
]);

/**
 * Set one term of a Draft rental agreement.
 *
 * @remarks
 * The terms are checked as a whole (an end date after the start, a purchase
 * option reasonably certain needs an end date), so the stored terms are
 * read, the one field is swapped in and the whole set is validated and
 * saved. A new customer clears the site and contact; a new currency brings
 * today's rate. The yes/no terms take `true` or `on`.
 *
 * @mcp
 */
export const setRentalAgreementTerm = defineServiceFn({
  input: z.object({
    id: z.string(),
    field: z.enum(rentalTermFields),
    value: z.string().nullish()
  }),
  permission: { update: "sales" },

  async run(ctx, { id, field, value }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const agreement = await service.ownRentalAgreement(ctx, id);
    if (agreement instanceof Error) return agreement;
    if (agreement.status !== "Draft") {
      return ctx.error(
        "rule",
        "Only a Draft rental agreement's terms can be edited"
      );
    }

    const terms: Record<(typeof rentalTermFields)[number], unknown> = {
      customerId: agreement.customerId,
      customerLocationId: agreement.customerLocationId,
      customerContactId: agreement.customerContactId,
      salesPersonId: agreement.salesPersonId,
      locationId: agreement.locationId,
      startDate: agreement.startDate,
      endDate: agreement.endDate,
      billingCycle: agreement.billingCycle,
      billingTiming: agreement.billingTiming,
      paymentTermId: agreement.paymentTermId,
      currencyCode: agreement.currencyCode,
      depositAmount: agreement.depositAmount,
      taxPercent: agreement.taxPercent,
      discountRate: agreement.discountRate,
      ownershipTransfers: agreement.ownershipTransfers,
      specializedAsset: agreement.specializedAsset,
      purchaseOptionAmount: agreement.purchaseOptionAmount,
      purchaseOptionReasonablyCertain:
        agreement.purchaseOptionReasonablyCertain,
      notes: agreement.notes
    };
    terms[field] = rentalBooleanTerms.has(field)
      ? value === "on" || value === "true"
      : value || null;
    // A site and contact belong to one customer.
    if (field === "customerId" && value !== agreement.customerId) {
      terms.customerLocationId = null;
      terms.customerContactId = null;
    }

    // The same form the terms form posts, so the same coercion runs.
    const merged = new FormData();
    for (const key of rentalTermFields) {
      const term = terms[key];
      if (rentalBooleanTerms.has(key)) {
        if (term) merged.append(key, "on");
      } else if (term !== null && term !== undefined && term !== "") {
        merged.append(key, String(term));
      }
    }
    if (field === "currencyCode" && value && value !== agreement.currencyCode) {
      const rate = await getExchangeRate(client, companyId, value);
      if (rate.error) {
        return ctx.error(
          "internal",
          "Failed to get the exchange rate",
          rate.error
        );
      }
      merged.append("exchangeRate", String(rate.data));
    }

    const validation = await validator(rentalAgreementValidator).validate(
      merged
    );
    if (validation.error) {
      return ctx.error(
        "validation",
        Object.values(validation.error.fieldErrors)[0] ??
          "These terms are not valid"
      );
    }
    const {
      id: _id,
      rentalAgreementId: _rentalAgreementId,
      ...data
    } = validation.data;

    const update = await service.updateRentalAgreement(client, {
      ...data,
      id,
      companyId,
      updatedBy: ctx.auditUserId,
      customFields: agreement.customFields ?? undefined
    });
    if (update.error) {
      logger.error("rental agreement term update failed", {
        companyId,
        id,
        field,
        error: update.error
      });
      return ctx.error(
        "rule",
        update.error.message || "Failed to update rental agreement",
        update.error
      );
    }
    return { id };
  }
});

/**
 * Set how a rental agreement's invoices are posted and sent.
 *
 * @remarks
 * Null is the company's setting. Stays editable while the agreement is
 * Active. Stripe needs Stripe connected; Post and Email needs a contact
 * email.
 *
 * @mcp
 */
export const setRentalInvoiceAutomation = defineServiceFn({
  input: z.object({
    id: z.string(),
    invoiceAutomation: z.enum(invoiceAutomations).nullable()
  }),
  permission: { update: "sales" },

  async run(ctx, { id, invoiceAutomation }) {
    if (
      invoiceAutomation === "Post and Send via Stripe" &&
      !(await getStripeConnectAccountId(ctx.asSystem.supabase, ctx.company.id))
    ) {
      return ctx.error("rule", "Connect Stripe in Integrations first");
    }
    const update = await service.updateRentalAgreementInvoiceAutomation(
      ctx.asCaller.supabase,
      {
        id,
        companyId: ctx.company.id,
        invoiceAutomation,
        updatedBy: ctx.auditUserId
      }
    );
    if (update.error) {
      return ctx.error(
        "rule",
        update.error.message || "Failed to update invoicing",
        update.error
      );
    }
    return { id };
  }
});

/**
 * Activate a Draft rental agreement.
 *
 * @remarks
 * Needs at least one unit. The `post-rental-agreement` server function then
 * checks every unit, classifies each line (rental or sale), books a sale's
 * commencement and cuts the first billing periods, in one transaction; its
 * refusal is the message.
 *
 * @mcp
 */
export const activateRentalAgreement = defineServiceFn({
  input: z.object({ id: z.string() }),
  permission: { update: "sales" },

  async run(ctx, { id }) {
    const agreement = await service.ownRentalAgreement(ctx, id);
    if (agreement instanceof Error) return agreement;
    if (agreement.status !== "Draft") {
      return ctx.error(
        "conflict",
        "Only a Draft rental agreement can be activated"
      );
    }
    if (!agreement.lineCount) {
      return ctx.error("rule", "Add a unit before activating");
    }

    const result = await invokePosting(
      ctx,
      "post-rental-agreement",
      {
        type: "activate",
        rentalAgreementId: id
      },
      service.postRentalAgreement
    );
    if (result.error) {
      return ctx.error(
        "rule",
        getErrorMessage(result.error, "Failed to activate rental agreement"),
        result.error
      );
    }
    return { id };
  }
});

/**
 * Close or cancel a rental agreement.
 *
 * @remarks
 * Close needs every unit back and every period and charge invoiced, and no
 * open rental shipment or receipt. Cancel needs nothing on rent, sold,
 * invoiced or recognized, and deletes the Pending lines. The
 * `post-rental-agreement` server function owns the checks; its refusal is
 * the message.
 *
 * @mcp
 */
export const setRentalAgreementStatus = defineServiceFn({
  input: z.object({ id: z.string(), intent: z.enum(["close", "cancel"]) }),
  permission: { update: "sales" },

  async run(ctx, { id, intent }) {
    const agreement = await service.ownRentalAgreement(ctx, id);
    if (agreement instanceof Error) return agreement;

    const result = await invokePosting(
      ctx,
      "post-rental-agreement",
      {
        type: intent,
        rentalAgreementId: id
      },
      service.postRentalAgreement
    );
    if (result.error) {
      return ctx.error(
        "rule",
        getErrorMessage(
          result.error,
          intent === "close"
            ? "Failed to close rental agreement"
            : "Failed to cancel rental agreement"
        ),
        result.error
      );
    }
    return { id, intent };
  }
});

/**
 * Release a Pending unit that never left the yard.
 *
 * @remarks
 * Its billing stops at `returnedAt` and the line is Returned. Refused for a
 * future date, a line that is not Pending, a unit treated as a sale, and a
 * unit on an open rental shipment or receipt.
 *
 * @mcp
 */
export const releaseRentalUnit = defineServiceFn({
  input: z.object({
    rentalAgreementId: z.string(),
    rentalAgreementLineId: z.string(),
    returnedAt: z.string().min(1)
  }),
  permission: { update: "sales" },

  async run(ctx, input) {
    const result = await invokePosting(
      ctx,
      "post-rental-agreement",
      {
        type: "release",
        ...input
      },
      service.postRentalAgreement
    );
    if (result.error) {
      return ctx.error(
        "rule",
        getErrorMessage(result.error, "Failed to release the unit"),
        result.error
      );
    }
    return { rentalAgreementLineId: input.rentalAgreementLineId };
  }
});

/**
 * Put a rental unit on a shipment to deliver it.
 *
 * @remarks
 * Adds the unit to the agreement's Draft rental shipment (or creates one);
 * the shipment is posted from inventory. Only on an Active agreement.
 *
 * @mcp
 */
export const deliverRentalUnit = defineServiceFn({
  input: z.object({
    rentalAgreementId: z.string(),
    rentalAgreementLineId: z.string()
  }),
  permission: { update: "sales", create: "inventory" },

  async run(ctx, input) {
    const result = await invokeCreate(
      {
        db: ctx.asSystem.pg,
        companyId: ctx.company.id,
        userId: ctx.auditUserId
      },
      { type: "shipmentFromRentalAgreement", ...input }
    );
    if (result.error || !result.data) {
      return ctx.error(
        "rule",
        getErrorMessage(result.error, "Failed to create the shipment"),
        result.error
      );
    }
    return { shipmentId: result.data.id };
  }
});

/**
 * Put a rental unit on a receipt to return it.
 *
 * @remarks
 * Adds the unit to the agreement's Draft rental receipt (or creates one);
 * the receipt is posted from inventory. Only on an Active agreement.
 *
 * @mcp
 */
export const returnRentalUnit = defineServiceFn({
  input: z.object({
    rentalAgreementId: z.string(),
    rentalAgreementLineId: z.string()
  }),
  permission: { update: "sales", create: "inventory" },

  async run(ctx, input) {
    const result = await invokeCreate(
      {
        db: ctx.asSystem.pg,
        companyId: ctx.company.id,
        userId: ctx.auditUserId
      },
      { type: "receiptFromRentalAgreement", ...input }
    );
    if (result.error || !result.data) {
      return ctx.error(
        "rule",
        getErrorMessage(result.error, "Failed to create the receipt"),
        result.error
      );
    }
    return { receiptId: result.data.id };
  }
});

/**
 * Override how a Draft rental agreement's unit is accounted for.
 *
 * @remarks
 * Rental or Sale, with a reason, while the agreement is Draft (activation
 * fixes the treatment). Read and written with the service role, since an
 * accountant may not see sales; an audit entry is written best-effort.
 *
 * @mcp
 */
export const classifyRentalUnit = defineServiceFn({
  input: rentalAgreementLineClassificationValidator.extend({
    rentalAgreementId: z.string(),
    rentalAgreementLineId: z.string()
  }),
  permission: { update: "accounting" },

  async run(
    ctx,
    {
      rentalAgreementId: id,
      rentalAgreementLineId: lineId,
      classification,
      reason
    }
  ) {
    const serviceRole = ctx.asSystem.supabase;
    const companyId = ctx.company.id;
    const fixed = "The classification is fixed once the agreement is activated";

    const [agreement, line] = await Promise.all([
      serviceRole
        .from("rentalAgreement")
        .select("id, status")
        .eq("id", id)
        .eq("companyId", companyId)
        .maybeSingle(),
      serviceRole
        .from("rentalAgreementLine")
        .select(
          "id, lessorClassification, classificationOverride, classificationOverrideReason"
        )
        .eq("id", lineId)
        .eq("rentalAgreementId", id)
        .eq("companyId", companyId)
        .maybeSingle()
    ]);
    if (agreement.error || !agreement.data || line.error || !line.data) {
      return ctx.error(
        "notFound",
        "This unit does not belong to this rental agreement",
        agreement.error ?? line.error
      );
    }
    if (agreement.data.status !== "Draft") return ctx.error("rule", fixed);

    // Activation stamps `classificationInputs`: an agreement activated since
    // the read above matches no row.
    const update = await serviceRole
      .from("rentalAgreementLine")
      .update({
        lessorClassification: classification,
        classificationOverride: true,
        classificationOverrideReason: reason,
        updatedBy: ctx.auditUserId,
        updatedAt: datetime.timestamp()
      })
      .eq("id", lineId)
      .eq("companyId", companyId)
      .is("classificationInputs", null)
      .select("id")
      .maybeSingle();
    if (update.error) {
      return ctx.error(
        "internal",
        "Failed to override the classification",
        update.error
      );
    }
    if (!update.data) return ctx.error("conflict", fixed);

    // Best-effort: a failed audit write never undoes the override.
    try {
      await insertAuditLogEntries(serviceRole, companyId, [
        {
          tableName: "rentalAgreementLine",
          entityType: "rentalAgreement",
          entityId: id,
          recordId: lineId,
          operation: "UPDATE",
          actorId: ctx.auditUserId,
          diff: {
            lessorClassification: {
              old: line.data.lessorClassification,
              new: classification
            },
            classificationOverride: {
              old: line.data.classificationOverride,
              new: true
            },
            classificationOverrideReason: {
              old: line.data.classificationOverrideReason,
              new: reason
            }
          }
        }
      ]);
    } catch (err) {
      logger.warn("audit write skipped for a classification override", {
        error: err
      });
    }
    return { rentalAgreementLineId: lineId, classification };
  }
});

/**
 * Sell a rental unit to its customer: exercise the purchase option.
 *
 * @remarks
 * Only for a unit treated as a sale, on rent under an Active agreement with
 * a purchase option, once per unit, and not before the end of the term
 * (ending a sale early is a manual journal). Bills the option as a Purchase
 * Option charge dated today and drafts its invoice; posting that invoice
 * transfers the unit. An invoice the automation may post is queued for it.
 *
 * @mcp
 */
export const sellRentalUnit = defineServiceFn({
  input: z.object({
    rentalAgreementId: z.string(),
    rentalAgreementLineId: z.string()
  }),
  permission: { create: ["sales", "invoicing"], update: "sales" },

  async run(ctx, { rentalAgreementId: id, rentalAgreementLineId: lineId }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;

    const [agreement, line] = await Promise.all([
      service.getRentalAgreement(client, id, companyId),
      service.getRentalAgreementLine(client, lineId, companyId)
    ]);
    if (
      agreement.error ||
      agreement.data?.companyId !== companyId ||
      line.error ||
      line.data.rentalAgreementId !== id
    ) {
      return ctx.error(
        "notFound",
        "This unit does not belong to this rental agreement"
      );
    }

    const amount = agreement.data.purchaseOptionAmount;
    if (
      agreement.data.status !== "Active" ||
      line.data.lessorClassification !== "Sale" ||
      line.data.status !== "On Rent" ||
      !amount
    ) {
      return ctx.error(
        "rule",
        "Only a unit treated as a sale, on rent under an agreement with a purchase option, can be sold"
      );
    }

    const billed = "The purchase option has already been billed";
    const existing = await client
      .from("rentalAgreementCharge")
      .select("id")
      .eq("rentalAgreementLineId", lineId)
      .eq("companyId", companyId)
      .eq("chargeType", "Purchase Option")
      .limit(1);
    if (existing.error) {
      return ctx.error(
        "internal",
        "Failed to check the purchase option",
        existing.error
      );
    }
    if (existing.data.length > 0) return ctx.error("conflict", billed);

    const today = await service.companyToday(ctx);
    // The schedule and the remaining rent run to the end date.
    const endDate = agreement.data.endDate;
    if (endDate && today < endDate) {
      return ctx.error(
        "rule",
        `The purchase option is exercised at the end of the term (${endDate}); ending a rental treated as a sale early is a manual journal`
      );
    }

    const charge = await service.insertRentalPurchaseOptionCharge(client, {
      rentalAgreementLineId: lineId,
      amount,
      chargeDate: today,
      description: "Purchase option exercised",
      taxPercent: agreement.data.taxPercent ?? 0,
      companyId,
      createdBy: ctx.auditUserId
    });
    if (charge.error) {
      // 23505: a concurrent request billed it first.
      return charge.error.code === "23505"
        ? ctx.error("conflict", billed)
        : ctx.error(
            "internal",
            "Failed to bill the purchase option",
            charge.error
          );
    }

    let invoices: DraftedRentalInvoice[];
    try {
      ({ invoices } = await service.generateRentalInvoicesNow(ctx.asSystem.pg, {
        companyId,
        asOf: today,
        rentalAgreementId: id,
        userId: ctx.auditUserId
      }));
    } catch (err) {
      return ctx.error(
        "internal",
        err instanceof Error
          ? `The purchase option was billed but its invoice was not drafted: ${err.message}`
          : "The purchase option was billed but its invoice was not drafted",
        err
      );
    }

    // Normally on a held charges invoice; anything automatable posts in the
    // background.
    const toAutomate = invoices.filter(
      (invoice) => invoice.mode !== "Draft Only" && !invoice.holdReason
    );
    if (toAutomate.length > 0) {
      await batchTrigger(
        "invoice-automate",
        toAutomate.map((invoice) => ({
          payload: { companyId, invoiceId: invoice.invoiceId }
        }))
      );
    }
    return { invoiceIds: invoices.map((invoice) => invoice.invoiceId) };
  }
});
/**
 * Copy quote
 *
 * @mcp
 */
export const copyQuote = defineServiceFn({
  input: z.looseObject({ sourceId: z.string(), targetId: z.string() }),
  permission: { create: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.copyQuote(
        ctx.asCaller.supabase,
        ctx.asSystem.pg,
        payload(ctx, input).withUser().forUpsert() as never
      )
    );
  }
});

/**
 * Create pricing rule
 *
 * @mcp
 */
export const createPricingRule = defineServiceFn({
  input: z.looseObject({
    id: z.string().optional(),
    name: z.string().min(1),
    ruleType: z.enum(["Discount", "Markup", "Configuration"]),
    amountType: z.enum(["Percentage", "Fixed"]),
    amount: z.number().min(0),
    minQuantity: z.number().min(0).optional(),
    maxQuantity: z.number().min(0).optional(),
    customerIds: z.array(z.string()).default([]),
    customerTypeIds: z.array(z.string()).default([]),
    itemIds: z.array(z.string()).nullable().default([]),
    itemId: z.string().optional(),
    itemPostingGroupId: z.string().optional(),
    validFrom: z.string().optional(),
    validTo: z.string().optional(),
    priority: z.number().int().min(0).default(0),
    active: z.boolean().optional(),
    configurationPrices: z
      .array(
        z.looseObject({
          key: z.string().min(1),
          value: z.string().nullable(),
          amount: z.number(),
          label: z.string().optional()
        })
      )
      .optional()
  }),
  permission: { create: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.createPricingRule(
        ctx.asCaller.supabase,
        ctx.company.id,
        ctx.auditUserId,
        payload(ctx, input).forUpsert() as never
      )
    );
  }
});

/**
 * Delete customer
 *
 * @mcp destructive
 */
export const deleteCustomer = defineServiceFn({
  input: z.looseObject({ customerId: z.string() }),
  permission: { delete: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteCustomer(
        ctx.asCaller.supabase,
        input.customerId as never
      )
    );
  }
});

/**
 * Delete customer bank account
 *
 * @mcp destructive
 */
export const deleteCustomerBankAccount = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteCustomerBankAccount(
        ctx.asCaller.supabase,
        input.id as never
      )
    );
  }
});

/**
 * Lists a customer's bank accounts
 *
 * @mcp read
 */
export const getCustomerBankAccounts = defineServiceFn({
  input: z.looseObject({ customerId: z.string() }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getCustomerBankAccounts(
        ctx.asCaller.supabase,
        input.customerId as never
      )
    );
  }
});

/**
 * Create a customer bank account
 *
 * @remarks
 * Upsert customer bank account
 *
 * @mcp
 */
export const createCustomerBankAccount = defineServiceFn({
  input: z.looseObject({
    customerId: z.string().min(1),
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
    return await service.upsertCustomerBankAccount(
      ctx.asSystem.pg,
      payload(ctx, input).forCreate() as never
    );
  }
});

/**
 * Update a customer bank account
 *
 * @remarks
 * Upsert customer bank account
 *
 * @mcp
 */
export const updateCustomerBankAccount = defineServiceFn({
  input: z
    .looseObject({
      customerId: z.string().min(1),
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
    return await service.upsertCustomerBankAccount(
      ctx.asSystem.pg,
      payload(ctx, input).forUpdate() as never
    );
  }
});

/**
 * Delete customer contact
 *
 * @mcp destructive
 */
export const deleteCustomerContact = defineServiceFn({
  input: z.looseObject({
    customerId: z.string(),
    customerContactId: z.string()
  }),
  permission: { delete: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteCustomerContact(
        ctx.asCaller.supabase,
        input.customerId as never,
        input.customerContactId as never
      )
    );
  }
});

/**
 * Delete customer location
 *
 * @mcp destructive
 */
export const deleteCustomerLocation = defineServiceFn({
  input: z.looseObject({
    customerId: z.string(),
    customerLocationId: z.string()
  }),
  permission: { delete: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteCustomerLocation(
        ctx.asCaller.supabase,
        input.customerId as never,
        input.customerLocationId as never
      )
    );
  }
});

/**
 * Delete customer status
 *
 * @mcp destructive
 */
export const deleteCustomerStatus = defineServiceFn({
  input: z.looseObject({ customerStatusId: z.string() }),
  permission: { delete: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteCustomerStatus(
        ctx.asCaller.supabase,
        input.customerStatusId as never
      )
    );
  }
});

/**
 * Delete customer type
 *
 * @mcp destructive
 */
export const deleteCustomerType = defineServiceFn({
  input: z.looseObject({ customerTypeId: z.string() }),
  permission: { delete: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteCustomerType(
        ctx.asCaller.supabase,
        input.customerTypeId as never
      )
    );
  }
});

/**
 * Delete no quote reason
 *
 * @mcp destructive
 */
export const deleteNoQuoteReason = defineServiceFn({
  input: z.looseObject({ noQuoteReasonId: z.string() }),
  permission: { delete: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteNoQuoteReason(
        ctx.asCaller.supabase,
        input.noQuoteReasonId as never
      )
    );
  }
});

/**
 * Delete pricing rule
 *
 * @mcp destructive
 */
export const deletePricingRule = defineServiceFn({
  input: z.looseObject({ pricingRuleId: z.string() }),
  permission: { delete: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deletePricingRule(
        ctx.asCaller.supabase,
        input.pricingRuleId as never
      )
    );
  }
});

/**
 * Delete quote
 *
 * @mcp destructive
 */
export const deleteQuote = defineServiceFn({
  input: z.looseObject({ quoteId: z.string() }),
  permission: { delete: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteQuote(ctx.asCaller.supabase, input.quoteId as never)
    );
  }
});

/**
 * Delete quote line
 *
 * @mcp destructive
 */
export const deleteQuoteLine = defineServiceFn({
  input: z.looseObject({ quoteLineId: z.string() }),
  permission: { delete: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteQuoteLine(
        ctx.asCaller.supabase,
        input.quoteLineId as never
      )
    );
  }
});

/**
 * Delete quote operation step
 *
 * @mcp destructive
 */
export const deleteQuoteOperationStep = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteQuoteOperationStep(
        ctx.asCaller.supabase,
        input.id as never
      )
    );
  }
});

/**
 * Delete quote operation parameter
 *
 * @mcp destructive
 */
export const deleteQuoteOperationParameter = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteQuoteOperationParameter(
        ctx.asCaller.supabase,
        input.id as never
      )
    );
  }
});

/**
 * Delete quote operation tool
 *
 * @mcp destructive
 */
export const deleteQuoteOperationTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteQuoteOperationTool(
        ctx.asCaller.supabase,
        input.id as never
      )
    );
  }
});

/**
 * Delete sales order
 *
 * @mcp destructive
 */
export const deleteSalesOrder = defineServiceFn({
  input: z.looseObject({ salesOrderId: z.string() }),
  permission: { delete: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteSalesOrder(
        ctx.asCaller.supabase,
        input.salesOrderId as never
      )
    );
  }
});

/**
 * Delete sales order line
 *
 * @mcp destructive
 */
export const deleteSalesOrderLine = defineServiceFn({
  input: z.looseObject({ salesOrderLineId: z.string() }),
  permission: { delete: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteSalesOrderLine(
        ctx.asCaller.supabase,
        input.salesOrderLineId as never
      )
    );
  }
});

/**
 * Delete sales r f q
 *
 * @mcp destructive
 */
export const deleteSalesRFQ = defineServiceFn({
  input: z.looseObject({ salesRfqId: z.string() }),
  permission: { delete: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteSalesRFQ(
        ctx.asCaller.supabase,
        input.salesRfqId as never
      )
    );
  }
});

/**
 * Delete sales r f q line
 *
 * @mcp destructive
 */
export const deleteSalesRFQLine = defineServiceFn({
  input: z.looseObject({ salesRFQLineId: z.string() }),
  permission: { delete: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteSalesRFQLine(
        ctx.asCaller.supabase,
        input.salesRFQLineId as never
      )
    );
  }
});

/**
 * Duplicate pricing rule
 *
 * @mcp
 */
export const duplicatePricingRule = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { create: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.duplicatePricingRule(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id,
        ctx.auditUserId
      )
    );
  }
});

/**
 * Get configuration parameters by quote line id
 *
 * @mcp read
 */
export const getConfigurationParametersByQuoteLineId = defineServiceFn({
  input: z.looseObject({ quoteLineId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return await service.getConfigurationParametersByQuoteLineId(
      ctx.asCaller.supabase,
      input.quoteLineId as never,
      ctx.company.id
    );
  }
});

/**
 * Get customer
 *
 * @mcp read
 */
export const getCustomer = defineServiceFn({
  input: z.looseObject({ customerId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getCustomer(
        ctx.asCaller.supabase,
        input.customerId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get customer contact
 *
 * @mcp read
 */
export const getCustomerContact = defineServiceFn({
  input: z.looseObject({ customerContactId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getCustomerContact(
        ctx.asCaller.supabase,
        input.customerContactId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get customer contacts
 *
 * @mcp read
 */
export const getCustomerContacts = defineServiceFn({
  input: z.looseObject({ customerId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getCustomerContacts(
        ctx.asCaller.supabase,
        input.customerId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get customer item price override
 *
 * @mcp read
 */
export const getCustomerItemPriceOverride = defineServiceFn({
  input: z.looseObject({
    customerId: z.string(),
    itemId: z.string(),
    quantity: z.number().optional(),
    date: z.string().optional()
  }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getCustomerItemPriceOverride(
        ctx.asCaller.supabase,
        input.customerId as never,
        input.itemId as never,
        ctx.company.id,
        input.quantity as never,
        input.date as never
      )
    );
  }
});

/**
 * Get customer location
 *
 * @mcp read
 */
export const getCustomerLocation = defineServiceFn({
  input: z.looseObject({ customerLocationId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getCustomerLocation(
        ctx.asCaller.supabase,
        input.customerLocationId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get customer locations
 *
 * @mcp read
 */
export const getCustomerLocations = defineServiceFn({
  input: z.looseObject({ customerId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getCustomerLocations(
        ctx.asCaller.supabase,
        input.customerId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get customer payment
 *
 * @mcp read
 */
export const getCustomerPayment = defineServiceFn({
  input: z.looseObject({ customerId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getCustomerPayment(
        ctx.asCaller.supabase,
        input.customerId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get customer shipping
 *
 * @mcp read
 */
export const getCustomerShipping = defineServiceFn({
  input: z.looseObject({ customerId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getCustomerShipping(
        ctx.asCaller.supabase,
        input.customerId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get customer tax
 *
 * @mcp read
 */
export const getCustomerTax = defineServiceFn({
  input: z.looseObject({ customerId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getCustomerTax(
        ctx.asCaller.supabase,
        input.customerId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get customers
 *
 * @mcp read
 */
export const getCustomers = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getCustomers(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get customers list
 *
 * @mcp read
 */
export const getCustomersList = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "sales" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getCustomersList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get customer status
 *
 * @mcp read
 */
export const getCustomerStatus = defineServiceFn({
  input: z.looseObject({ customerStatusId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getCustomerStatus(
        ctx.asCaller.supabase,
        input.customerStatusId as never
      )
    );
  }
});

/**
 * Get customer statuses
 *
 * @mcp read
 */
export const getCustomerStatuses = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getCustomerStatuses(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get customer statuses list
 *
 * @mcp read
 */
export const getCustomerStatusesList = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "sales" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getCustomerStatusesList(
        ctx.asCaller.supabase,
        ctx.company.id
      )
    );
  }
});

/**
 * Get customer type
 *
 * @mcp read
 */
export const getCustomerType = defineServiceFn({
  input: z.looseObject({ customerTypeId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getCustomerType(
        ctx.asCaller.supabase,
        input.customerTypeId as never
      )
    );
  }
});

/**
 * Get customer types
 *
 * @mcp read
 */
export const getCustomerTypes = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getCustomerTypes(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get customer types list
 *
 * @mcp read
 */
export const getCustomerTypesList = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "sales" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getCustomerTypesList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get external sales order lines
 *
 * @mcp read
 */
export const getExternalSalesOrderLines = defineServiceFn({
  input: z.looseObject({
    customerId: z.string(),
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getExternalSalesOrderLines(
        ctx.asCaller.supabase,
        input.customerId as never,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get model by quote line id
 *
 * @mcp read
 */
export const getModelByQuoteLineId = defineServiceFn({
  input: z.looseObject({ quoteLineId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return await service.getModelByQuoteLineId(
      ctx.asCaller.supabase,
      input.quoteLineId as never
    );
  }
});

/**
 * Get no quote reason
 *
 * @mcp read
 */
export const getNoQuoteReason = defineServiceFn({
  input: z.looseObject({ noQuoteReasonId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getNoQuoteReason(
        ctx.asCaller.supabase,
        input.noQuoteReasonId as never
      )
    );
  }
});

/**
 * Get no quote reasons
 *
 * @mcp read
 */
export const getNoQuoteReasons = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getNoQuoteReasons(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get opportunity
 *
 * @mcp read
 */
export const getOpportunity = defineServiceFn({
  input: z.looseObject({ opportunityId: z.string().nullable() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getOpportunity(
        ctx.asCaller.supabase,
        input.opportunityId as never
      )
    );
  }
});

/**
 * Get opportunity documents
 *
 * @mcp read
 */
export const getOpportunityDocuments = defineServiceFn({
  input: z.looseObject({ opportunityId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return await service.getOpportunityDocuments(
      ctx.asCaller.supabase,
      ctx.company.id,
      input.opportunityId as never
    );
  }
});

/**
 * Get opportunity line documents
 *
 * @mcp read
 */
export const getOpportunityLineDocuments = defineServiceFn({
  input: z.looseObject({
    lineId: z.string(),
    itemId: z.string().nullable().optional()
  }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return await service.getOpportunityLineDocuments(
      ctx.asCaller.supabase,
      ctx.company.id,
      input.lineId as never,
      input.itemId as never
    );
  }
});

/**
 * Get pricing rule
 *
 * @mcp read
 */
export const getPricingRule = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getPricingRule(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Get pricing rules
 *
 * @mcp read
 */
export const getPricingRules = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().optional()
  }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getPricingRules(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get quote
 *
 * @mcp read
 */
export const getQuote = defineServiceFn({
  input: z.looseObject({ quoteId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getQuote(ctx.asCaller.supabase, input.quoteId as never)
    );
  }
});

/**
 * Get quotes
 *
 * @mcp read
 */
export const getQuotes = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getQuotes(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get quotes list
 *
 * @mcp read
 */
export const getQuotesList = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "sales" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getQuotesList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get quote customer details
 *
 * @mcp read
 */
export const getQuoteCustomerDetails = defineServiceFn({
  input: z.looseObject({ quoteId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getQuoteCustomerDetails(
        ctx.asCaller.supabase,
        input.quoteId as never
      )
    );
  }
});

/**
 * Get quote line
 *
 * @mcp read
 */
export const getQuoteLine = defineServiceFn({
  input: z.looseObject({ quoteLineId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getQuoteLine(
        ctx.asCaller.supabase,
        input.quoteLineId as never
      )
    );
  }
});

/**
 * Get quote lines list
 *
 * @mcp read
 */
export const getQuoteLinesList = defineServiceFn({
  input: z.looseObject({ quoteId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getQuoteLinesList(
        ctx.asCaller.supabase,
        input.quoteId as never
      )
    );
  }
});

/**
 * Get quote make method
 *
 * @mcp read
 */
export const getQuoteMakeMethod = defineServiceFn({
  input: z.looseObject({ quoteMakeMethodId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getQuoteMakeMethod(
        ctx.asCaller.supabase,
        input.quoteMakeMethodId as never
      )
    );
  }
});

/**
 * Get root quote make method
 *
 * @mcp read
 */
export const getRootQuoteMakeMethod = defineServiceFn({
  input: z.looseObject({ quoteLineId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getRootQuoteMakeMethod(
        ctx.asCaller.supabase,
        input.quoteLineId as never
      )
    );
  }
});

/**
 * Get quote method trees
 *
 * @mcp read
 */
export const getQuoteMethodTrees = defineServiceFn({
  input: z.looseObject({ quoteId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getQuoteMethodTrees(
        ctx.asCaller.supabase,
        input.quoteId as never
      )
    );
  }
});

/**
 * Get quote lines
 *
 * @mcp read
 */
export const getQuoteLines = defineServiceFn({
  input: z.looseObject({ quoteId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await utils.getQuoteLines(ctx.asCaller.supabase, input.quoteId as never)
    );
  }
});

/**
 * Get quote by external id
 *
 * @mcp read
 */
export const getQuoteByExternalId = defineServiceFn({
  input: z.looseObject({ externalId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getQuoteByExternalId(
        ctx.asCaller.supabase,
        input.externalId as never
      )
    );
  }
});

/**
 * Get quote line prices
 *
 * @mcp read
 */
export const getQuoteLinePrices = defineServiceFn({
  input: z.looseObject({ quoteLineId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getQuoteLinePrices(
        ctx.asCaller.supabase,
        input.quoteLineId as never
      )
    );
  }
});

/**
 * Get quote line prices by quote id
 *
 * @mcp read
 */
export const getQuoteLinePricesByQuoteId = defineServiceFn({
  input: z.looseObject({ quoteId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await utils.getQuoteLinePricesByQuoteId(
        ctx.asCaller.supabase,
        input.quoteId as never
      )
    );
  }
});

/**
 * Get quote materials by method id
 *
 * @mcp read
 */
export const getQuoteMaterialsByMethodId = defineServiceFn({
  input: z.looseObject({ quoteMakeMethodId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getQuoteMaterialsByMethodId(
        ctx.asCaller.supabase,
        input.quoteMakeMethodId as never
      )
    );
  }
});

/**
 * Get quote operations by line
 *
 * @mcp read
 */
export const getQuoteOperationsByLine = defineServiceFn({
  input: z.looseObject({ quoteLineId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getQuoteOperationsByLine(
        ctx.asCaller.supabase,
        input.quoteLineId as never
      )
    );
  }
});

/**
 * Get quote operations by method id
 *
 * @mcp read
 */
export const getQuoteOperationsByMethodId = defineServiceFn({
  input: z.looseObject({ quoteMakeMethodId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getQuoteOperationsByMethodId(
        ctx.asCaller.supabase,
        input.quoteMakeMethodId as never
      )
    );
  }
});

/**
 * Get quote payment
 *
 * @mcp read
 */
export const getQuotePayment = defineServiceFn({
  input: z.looseObject({ quoteId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getQuotePayment(
        ctx.asCaller.supabase,
        input.quoteId as never
      )
    );
  }
});

/**
 * Get quote shipment
 *
 * @mcp read
 */
export const getQuoteShipment = defineServiceFn({
  input: z.looseObject({ quoteId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getQuoteShipment(
        ctx.asCaller.supabase,
        input.quoteId as never
      )
    );
  }
});

/**
 * Get related prices for quote line
 *
 * @mcp read
 */
export const getRelatedPricesForQuoteLine = defineServiceFn({
  input: z.looseObject({ itemId: z.string(), quoteId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return await service.getRelatedPricesForQuoteLine(
      ctx.asCaller.supabase,
      input.itemId as never,
      input.quoteId as never
    );
  }
});

/**
 * Get sales documents assigned to me
 *
 * @mcp read
 */
export const getSalesDocumentsAssignedToMe = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "sales" },
  async run(ctx) {
    return await service.getSalesDocumentsAssignedToMe(
      ctx.asCaller.supabase,
      ctx.auditUserId,
      ctx.company.id
    );
  }
});

/**
 * Get sales order
 *
 * @mcp read
 */
export const getSalesOrder = defineServiceFn({
  input: z.looseObject({ salesOrderId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getSalesOrder(
        ctx.asCaller.supabase,
        input.salesOrderId as never
      )
    );
  }
});

/**
 * Get sales order related items
 *
 * @mcp read
 */
export const getSalesOrderRelatedItems = defineServiceFn({
  input: z.looseObject({ salesOrderId: z.string(), opportunityId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return await service.getSalesOrderRelatedItems(
      ctx.asCaller.supabase,
      input.salesOrderId as never,
      input.opportunityId as never
    );
  }
});

/**
 * Get sales orders
 *
 * @mcp read
 */
export const getSalesOrders = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    customerId: z.string().nullable().optional()
  }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getSalesOrders(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get sales orders list
 *
 * @mcp read
 */
export const getSalesOrdersList = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "sales" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getSalesOrdersList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get sales order payment
 *
 * @mcp read
 */
export const getSalesOrderPayment = defineServiceFn({
  input: z.looseObject({ salesOrderId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getSalesOrderPayment(
        ctx.asCaller.supabase,
        input.salesOrderId as never
      )
    );
  }
});

/**
 * Get sales terms
 *
 * @mcp read
 */
export const getSalesTerms = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "sales" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getSalesTerms(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get sales order shipment
 *
 * @mcp read
 */
export const getSalesOrderShipment = defineServiceFn({
  input: z.looseObject({ salesOrderId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getSalesOrderShipment(
        ctx.asCaller.supabase,
        input.salesOrderId as never
      )
    );
  }
});

/**
 * Get sales order lines
 *
 * @mcp read
 */
export const getSalesOrderLines = defineServiceFn({
  input: z.looseObject({ salesOrderId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getSalesOrderLines(
        ctx.asCaller.supabase,
        input.salesOrderId as never
      )
    );
  }
});

/**
 * Get sales order invoice lines
 *
 * @mcp read
 */
export const getSalesOrderInvoiceLines = defineServiceFn({
  input: z.looseObject({ salesOrderId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getSalesOrderInvoiceLines(
        ctx.asCaller.supabase,
        input.salesOrderId as never
      )
    );
  }
});

/**
 * Get sales order invoices by ids
 *
 * @mcp read
 */
export const getSalesOrderInvoicesByIds = defineServiceFn({
  input: z.looseObject({ invoiceIds: z.array(z.string()) }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getSalesOrderInvoicesByIds(
        ctx.asCaller.supabase,
        payload(ctx, input.invoiceIds).build() as never
      )
    );
  }
});

/**
 * Get sales order invoice payments by ids
 *
 * @mcp read
 */
export const getSalesOrderInvoicePaymentsByIds = defineServiceFn({
  input: z.looseObject({ invoiceIds: z.array(z.string()) }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getSalesOrderInvoicePaymentsByIds(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input.invoiceIds).build() as never
      )
    );
  }
});

/**
 * Sales order lines a job can link to: lines for the job's item on sales
 * orders that are still open (not Completed, Invoiced, Cancelled or Closed).
 *
 * @mcp read
 */
export const getOpenSalesOrderLinesForItem = defineServiceFn({
  input: z.looseObject({ itemId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getOpenSalesOrderLinesForItem(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.itemId as never
      )
    );
  }
});

/**
 * Get sales order line
 *
 * @mcp read
 */
export const getSalesOrderLine = defineServiceFn({
  input: z.looseObject({ salesOrderLineId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getSalesOrderLine(
        ctx.asCaller.supabase,
        input.salesOrderLineId as never
      )
    );
  }
});

/**
 * Get sales order line shipments
 *
 * @mcp read
 */
export const getSalesOrderLineShipments = defineServiceFn({
  input: z.looseObject({ salesOrderLineId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getSalesOrderLineShipments(
        ctx.asCaller.supabase,
        input.salesOrderLineId as never
      )
    );
  }
});

/**
 * Get sales r f q
 *
 * @mcp read
 */
export const getSalesRFQ = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getSalesRFQ(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Get sales r f qs
 *
 * @mcp read
 */
export const getSalesRFQs = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getSalesRFQs(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get sales r f q line
 *
 * @mcp read
 */
export const getSalesRFQLine = defineServiceFn({
  input: z.looseObject({ lineId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getSalesRFQLine(
        ctx.asCaller.supabase,
        input.lineId as never
      )
    );
  }
});

/**
 * Get sales r f q lines
 *
 * @mcp read
 */
export const getSalesRFQLines = defineServiceFn({
  input: z.looseObject({ salesRfqId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getSalesRFQLines(
        ctx.asCaller.supabase,
        input.salesRfqId as never
      )
    );
  }
});

/**
 * Insert customer contact
 *
 * @mcp
 */
export const insertCustomerContact = defineServiceFn({
  input: z.looseObject({
    customerId: z.string(),
    contact: z.looseObject({
      id: z.string().optional(),
      contactId: z.string().optional(),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      title: z.string().optional(),
      email: z.string().min(1).optional(),
      mobilePhone: z.string().optional(),
      homePhone: z.string().optional(),
      workPhone: z.string().optional(),
      notes: z.string().optional(),
      customerLocationId: z.string().optional()
    }),
    customerLocationId: z.string().optional(),
    customFields: z.unknown().optional()
  }),
  permission: { create: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.insertCustomerContact(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpsert() as never
      )
    );
  }
});

/**
 * Insert customer location
 *
 * @mcp
 */
export const insertCustomerLocation = defineServiceFn({
  input: z.looseObject({
    customerId: z.string(),
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
  permission: { create: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.insertCustomerLocation(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpsert() as never
      )
    );
  }
});

/**
 * Resolve price
 *
 * @mcp
 */
export const resolvePrice = defineServiceFn({
  input: z.looseObject({
    customerId: z.string().optional(),
    customerTypeId: z.string().optional(),
    itemId: z.string(),
    itemPostingGroupId: z.string().optional(),
    quantity: z.number(),
    date: z.string().optional(),
    existingBasePrice: z.number().optional(),
    configuration: z.record(z.string(), z.unknown()).nullable().optional()
  }),
  permission: { update: "sales" },
  async run(ctx, input) {
    return await service.resolvePrice(
      ctx.asCaller.supabase,
      ctx.company.id,
      payload(ctx, input).build() as never
    );
  }
});

/**
 * Resolve price list
 *
 * @mcp
 */
export const resolvePriceList = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    customerId: z.string().optional(),
    customerTypeId: z.string().optional(),
    search: z.string().optional(),
    quantity: z.number().optional()
  }),
  permission: { update: "sales" },
  async run(ctx, input) {
    return await service.resolvePriceList(
      ctx.asCaller.supabase,
      ctx.company.id,
      payload(ctx, input).build() as never
    );
  }
});

/**
 * Get base catalog
 *
 * @mcp read
 */
export const getBaseCatalog = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().optional()
  }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return await service.getBaseCatalog(
      ctx.asCaller.supabase,
      ctx.company.id,
      payload(ctx, input).build() as never
    );
  }
});

/**
 * Create a customer
 *
 * @remarks
 * Upsert customer
 *
 * @mcp
 */
export const createCustomer = defineServiceFn({
  input: z.looseObject({
    readableId: z.string().optional(),
    name: z.string().min(1),
    customerStatusId: z.string().optional(),
    customerTypeId: z.string().optional(),
    accountManagerId: z.string().optional(),
    currencyCode: z.string().optional(),
    taxPercent: z.number().min(0).max(1),
    salesContactId: z.string().optional(),
    website: z.string().optional(),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertCustomer(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

/**
 * Update a customer
 *
 * @remarks
 * Upsert customer
 *
 * @mcp
 */
export const updateCustomer = defineServiceFn({
  input: z
    .looseObject({
      readableId: z.string().optional(),
      name: z.string().min(1),
      customerStatusId: z.string().optional(),
      customerTypeId: z.string().optional(),
      accountManagerId: z.string().optional(),
      currencyCode: z.string().optional(),
      taxPercent: z.number().min(0).max(1),
      salesContactId: z.string().optional(),
      website: z.string().optional(),
      customFields: z.unknown().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertCustomer(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Upsert customer item price override
 *
 * @mcp destructive
 */
export const upsertCustomerItemPriceOverride = defineServiceFn({
  input: z.looseObject({
    id: z.string().optional(),
    customerId: z.string().optional(),
    customerTypeId: z.string().optional(),
    itemId: z.string(),
    breaks: z.array(
      z.looseObject({
        id: z.string().optional(),
        quantity: z.number(),
        overridePrice: z.number(),
        active: z.boolean()
      })
    ),
    active: z.boolean(),
    applyRulesOnTop: z.boolean(),
    notes: z.string().optional(),
    validFrom: z.string().optional(),
    validTo: z.string().optional()
  }),
  permission: { create: "sales", update: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertCustomerItemPriceOverride(
        ctx.asSystem.pg,
        ctx.company.id,
        ctx.auditUserId,
        payload(ctx, input).forUpsert() as never
      )
    );
  }
});

/**
 * Delete customer item price override
 *
 * @mcp destructive
 */
export const deleteCustomerItemPriceOverride = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteCustomerItemPriceOverride(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get customer item price override by id
 *
 * @mcp read
 */
export const getCustomerItemPriceOverrideById = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getCustomerItemPriceOverrideById(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Update customer contact
 *
 * @mcp
 */
export const updateCustomerContact = defineServiceFn({
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
      customerLocationId: z.string().optional()
    }),
    customerLocationId: z.string().optional(),
    customFields: z.unknown().optional()
  }),
  permission: { update: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.updateCustomerContact(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Update customer location
 *
 * @mcp
 */
export const updateCustomerLocation = defineServiceFn({
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
  permission: { update: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.updateCustomerLocation(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Update customer payment
 *
 * @mcp
 */
export const updateCustomerPayment = defineServiceFn({
  input: z.looseObject({
    customerId: z.string().min(1),
    invoiceCustomerId: z.string().optional(),
    invoiceCustomerLocationId: z.string().optional(),
    invoiceCustomerContactId: z.string().optional(),
    paymentTermId: z.string().optional()
  }),
  permission: { update: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.updateCustomerPayment(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Update customer shipping
 *
 * @mcp
 */
export const updateCustomerShipping = defineServiceFn({
  input: z.looseObject({
    customerId: z.string().min(1),
    shippingCustomerId: z.string().optional(),
    shippingCustomerLocationId: z.string().optional(),
    shippingCustomerContactId: z.string().optional(),
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
    incotermLocation: z.string().optional()
  }),
  permission: { update: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.updateCustomerShipping(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Update customer tax
 *
 * @mcp
 */
export const updateCustomerTax = defineServiceFn({
  input: z.looseObject({
    customerId: z.string().min(1),
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
  permission: { update: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.updateCustomerTax(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Update pricing rule
 *
 * @mcp
 */
export const updatePricingRule = defineServiceFn({
  input: z.looseObject({
    id: z.string(),
    data: z.looseObject({
      id: z.string().optional(),
      name: z.string().min(1).optional(),
      ruleType: z.enum(["Discount", "Markup", "Configuration"]).optional(),
      amountType: z.enum(["Percentage", "Fixed"]).optional(),
      amount: z.number().min(0).optional(),
      minQuantity: z.number().min(0).optional(),
      maxQuantity: z.number().min(0).optional(),
      customerIds: z.array(z.string()).optional(),
      customerTypeIds: z.array(z.string()).optional(),
      itemIds: z.array(z.string()).nullable().optional(),
      itemId: z.string().optional(),
      itemPostingGroupId: z.string().optional(),
      validFrom: z.string().optional(),
      validTo: z.string().optional(),
      priority: z.number().int().min(0).optional(),
      active: z.boolean().optional(),
      configurationPrices: z
        .array(
          z.looseObject({
            key: z.string().min(1),
            value: z.string().nullable(),
            amount: z.number(),
            label: z.string().optional()
          })
        )
        .optional()
    })
  }),
  permission: { update: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.updatePricingRule(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.auditUserId,
        payload(ctx, input.data).forUpdate() as never
      )
    );
  }
});

/**
 * Create a customer status
 *
 * @remarks
 * Upsert customer status
 *
 * @mcp
 */
export const createCustomerStatus = defineServiceFn({
  input: z.looseObject({
    name: z.string().min(1),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertCustomerStatus(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

/**
 * Update a customer status
 *
 * @remarks
 * Upsert customer status
 *
 * @mcp
 */
export const updateCustomerStatus = defineServiceFn({
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
  permission: { update: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertCustomerStatus(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Create a customer type
 *
 * @remarks
 * Upsert customer type
 *
 * @mcp
 */
export const createCustomerType = defineServiceFn({
  input: z.looseObject({
    name: z.string().min(1),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertCustomerType(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

/**
 * Update a customer type
 *
 * @remarks
 * Upsert customer type
 *
 * @mcp
 */
export const updateCustomerType = defineServiceFn({
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
  permission: { update: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertCustomerType(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Create a no quote reason
 *
 * @remarks
 * Upsert no quote reason
 *
 * @mcp
 */
export const createNoQuoteReason = defineServiceFn({
  input: z.looseObject({
    name: z.string().min(1),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertNoQuoteReason(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

/**
 * Update a no quote reason
 *
 * @remarks
 * Upsert no quote reason
 *
 * @mcp
 */
export const updateNoQuoteReason = defineServiceFn({
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
  permission: { update: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertNoQuoteReason(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Update quote exchange rate
 *
 * @mcp
 */
export const updateQuoteExchangeRate = defineServiceFn({
  input: z.looseObject({ id: z.string(), exchangeRate: z.number() }),
  permission: { update: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.updateQuoteExchangeRate(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Update quote line precision
 *
 * @mcp
 */
export const updateQuoteLinePrecision = defineServiceFn({
  input: z.looseObject({
    quoteId: z.string(),
    lineId: z.string(),
    precision: z.number()
  }),
  permission: { update: "sales" },
  async run(ctx, input) {
    return await service.updateQuoteLinePrecision(
      ctx.asSystem.pg,
      ctx.company.id,
      input.quoteId as never,
      input.lineId as never,
      input.precision as never
    );
  }
});

/**
 * Update sales order exchange rate
 *
 * @mcp
 */
export const updateSalesOrderExchangeRate = defineServiceFn({
  input: z.looseObject({ id: z.string(), exchangeRate: z.number() }),
  permission: { update: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.updateSalesOrderExchangeRate(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Update quote material order
 *
 * @mcp
 */
export const updateQuoteMaterialOrder = defineServiceFn({
  input: z.looseObject({
    updates: z.array(z.looseObject({ id: z.string(), order: z.number() }))
  }),
  permission: { update: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      ...(await service.updateQuoteMaterialOrder(
        ctx.asCaller.supabase,
        payload(ctx, input.updates).forUpdate() as never
      ))
    );
  }
});

/**
 * Update quote operation order
 *
 * @mcp
 */
export const updateQuoteOperationOrder = defineServiceFn({
  input: z.looseObject({
    updates: z.array(z.looseObject({ id: z.string(), order: z.number() }))
  }),
  permission: { update: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      ...(await service.updateQuoteOperationOrder(
        ctx.asCaller.supabase,
        payload(ctx, input.updates).forUpdate() as never
      ))
    );
  }
});

/**
 * Upsert make method from quote line
 *
 * @mcp
 */
export const upsertMakeMethodFromQuoteLine = defineServiceFn({
  input: z.looseObject({
    itemId: z.string(),
    quoteId: z.string(),
    quoteLineId: z.string(),
    parts: z
      .looseObject({
        billOfMaterial: z.boolean(),
        billOfProcess: z.boolean(),
        parameters: z.boolean(),
        tools: z.boolean(),
        steps: z.boolean(),
        workInstructions: z.boolean()
      })
      .optional()
  }),
  permission: { create: "sales", update: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertMakeMethodFromQuoteLine(
        ctx.asCaller.supabase,
        ctx.asSystem.pg,
        payload(ctx, input).withUser().forUpsert() as never
      )
    );
  }
});

/**
 * Upsert make method from quote method
 *
 * @mcp
 */
export const upsertMakeMethodFromQuoteMethod = defineServiceFn({
  input: z.looseObject({
    sourceId: z.string(),
    targetId: z.string(),
    parts: z
      .looseObject({
        billOfMaterial: z.boolean(),
        billOfProcess: z.boolean(),
        parameters: z.boolean(),
        tools: z.boolean(),
        steps: z.boolean(),
        workInstructions: z.boolean()
      })
      .optional()
  }),
  permission: { create: "sales", update: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertMakeMethodFromQuoteMethod(
        ctx.asCaller.supabase,
        ctx.asSystem.pg,
        payload(ctx, input).withUser().forUpsert() as never
      )
    );
  }
});

/**
 * Create a new quote with all business logic - generates sequence, creates opportunity, resolves payment/shipping defaults from customer
 *
 * @remarks
 * Create a new quote with all business logic - generates sequence, creates opportunity, resolves payment/shipping defaults from customer. LLM can create a quote with just customerId.
 *
 * @mcp
 */
export const insertQuote = defineServiceFn({
  input: z.looseObject({
    customerId: z.string(),
    quoteId: z.string().optional(),
    locationId: z.string().optional(),
    status: z
      .enum([
        "Draft",
        "Sent",
        "Ordered",
        "Partial",
        "Lost",
        "Cancelled",
        "Expired"
      ])
      .optional(),
    currencyCode: z.string().optional(),
    expirationDate: z.string().optional(),
    customerContactId: z.string().optional(),
    customerLocationId: z.string().optional(),
    customerEngineeringContactId: z.string().optional(),
    customerReference: z.string().optional(),
    salesPersonId: z.string().optional(),
    estimatorId: z.string().optional(),
    dueDate: z.string().optional(),
    opportunityId: z.string().optional(),
    notes: z.string().optional(),
    customFields: z.unknown().optional()
  }),
  permission: { create: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.insertQuote(
        ctx.asCaller.supabase,
        payload(ctx, input).withGroup().forUpsert() as never
      )
    );
  }
});

/**
 * Update quote line order
 *
 * @mcp
 */
export const updateQuoteLineOrder = defineServiceFn({
  input: z.looseObject({
    quoteId: z.string(),
    updates: z.array(z.looseObject({ id: z.string(), sortOrder: z.number() }))
  }),
  permission: { update: "sales" },
  async run(ctx, input) {
    return await service.updateQuoteLineOrder(
      ctx.asSystem.pg,
      ctx.company.id,
      ctx.auditUserId,
      input.quoteId as never,
      payload(ctx, input.updates).forUpdate() as never
    );
  }
});

/**
 * Upsert quote line additional charges
 *
 * @mcp
 */
export const upsertQuoteLineAdditionalCharges = defineServiceFn({
  input: z.looseObject({
    lineId: z.string(),
    update: z.looseObject({
      additionalCharges: z.record(z.string(), z.unknown())
    })
  }),
  permission: { create: "sales", update: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertQuoteLineAdditionalCharges(
        ctx.asCaller.supabase,
        input.lineId as never,
        payload(ctx, input.update).withoutCompany().forUpdate() as never
      )
    );
  }
});

/**
 * Upsert quote line prices
 *
 * @mcp destructive
 */
export const upsertQuoteLinePrices = defineServiceFn({
  input: z.looseObject({
    quoteId: z.string(),
    lineId: z.string(),
    quoteLinePrices: z.array(
      z.looseObject({
        quoteLineId: z.string(),
        unitPrice: z.number(),
        quantity: z.number(),
        leadTime: z.number().optional(),
        discountPercent: z.number().optional(),
        shippingCost: z.number().optional(),
        categoryMarkups: z.record(z.string(), z.unknown()).optional(),
        priceSource: z.enum(["system", "manual"]).optional(),
        priceTrace: z
          .array(
            z.looseObject({
              step: z.string(),
              source: z.string(),
              amount: z.number(),
              adjustment: z.number().optional(),
              ruleId: z.string().optional(),
              label: z.string().optional()
            })
          )
          .nullable()
          .optional()
      })
    )
  }),
  permission: { create: "sales", update: "sales" },
  async run(ctx, input) {
    return await service.upsertQuoteLinePrices(
      ctx.asSystem.pg,
      ctx.company.id,
      input.quoteId as never,
      input.lineId as never,
      payload(ctx, input.quoteLinePrices).forUpsert() as never
    );
  }
});

/**
 * Explains each quantity's price on a quote line
 *
 * @mcp read
 */
export const getQuoteLinePriceTraces = defineServiceFn({
  input: z.looseObject({ quoteId: z.string(), quoteLineId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getQuoteLinePriceTraces(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.quoteId as never,
        input.quoteLineId as never
      )
    );
  }
});

/**
 * Reprices a quote line's system rows to what today's rules give — the `currentTrace` getQuoteLinePriceTraces shows — storing that trace with the price
 *
 * @mcp
 */
export const repriceQuoteLineFromRules = defineServiceFn({
  input: z.looseObject({ quoteId: z.string(), quoteLineId: z.string() }),
  permission: { update: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.repriceQuoteLineFromRules(
        ctx.asCaller.supabase,
        ctx.asSystem.pg,
        ctx.company.id,
        input.quoteId as never,
        input.quoteLineId as never,
        ctx.auditUserId
      )
    );
  }
});

/**
 * Create a quote operation step
 *
 * @remarks
 * Upsert quote operation step
 *
 * @mcp
 */
export const createQuoteOperationStep = defineServiceFn({
  input: z.looseObject({
    operationId: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1),
    type: z.enum([
      "Task",
      "Value",
      "Measurement",
      "Checkbox",
      "Timestamp",
      "Person",
      "List",
      "File",
      "Inspection"
    ]),
    unitOfMeasureCode: z.string().optional(),
    minValue: z.number().nullable().optional(),
    maxValue: z.number().nullable().optional(),
    listValues: z.array(z.string()).optional(),
    sortOrder: z.number().min(0).optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional(),
    updatedAt: z.string().optional()
  }),
  permission: { create: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertQuoteOperationStep(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

/**
 * Update a quote operation step
 *
 * @remarks
 * Upsert quote operation step
 *
 * @mcp
 */
export const updateQuoteOperationStep = defineServiceFn({
  input: z
    .looseObject({
      operationId: z.string().min(1),
      name: z.string().min(1),
      description: z.string().min(1),
      type: z.enum([
        "Task",
        "Value",
        "Measurement",
        "Checkbox",
        "Timestamp",
        "Person",
        "List",
        "File",
        "Inspection"
      ]),
      unitOfMeasureCode: z.string().optional(),
      minValue: z.number().nullable().optional(),
      maxValue: z.number().nullable().optional(),
      listValues: z.array(z.string()).optional(),
      sortOrder: z.number().min(0).optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional(),
      updatedAt: z.string().optional()
    })
    .required({ id: true }),
  permission: { update: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertQuoteOperationStep(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Create a quote operation parameter
 *
 * @remarks
 * Upsert quote operation parameter
 *
 * @mcp
 */
export const createQuoteOperationParameter = defineServiceFn({
  input: z.looseObject({
    operationId: z.string().min(1),
    key: z.string().min(1),
    value: z.string().min(1),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional(),
    updatedAt: z.string().optional()
  }),
  permission: { create: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertQuoteOperationParameter(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

/**
 * Update a quote operation parameter
 *
 * @remarks
 * Upsert quote operation parameter
 *
 * @mcp
 */
export const updateQuoteOperationParameter = defineServiceFn({
  input: z
    .looseObject({
      operationId: z.string().min(1),
      key: z.string().min(1),
      value: z.string().min(1),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional(),
      updatedAt: z.string().optional()
    })
    .required({ id: true }),
  permission: { update: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertQuoteOperationParameter(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Create a quote operation tool
 *
 * @remarks
 * Upsert quote operation tool
 *
 * @mcp
 */
export const createQuoteOperationTool = defineServiceFn({
  input: z.looseObject({
    operationId: z.string().min(1),
    toolId: z.string().min(1),
    quantity: z.number().min(0.000001),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional(),
    updatedAt: z.string().optional()
  }),
  permission: { create: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertQuoteOperationTool(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

/**
 * Update a quote operation tool
 *
 * @remarks
 * Upsert quote operation tool
 *
 * @mcp
 */
export const updateQuoteOperationTool = defineServiceFn({
  input: z
    .looseObject({
      operationId: z.string().min(1),
      toolId: z.string().min(1),
      quantity: z.number().min(0.000001),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional(),
      updatedAt: z.string().optional()
    })
    .required({ id: true }),
  permission: { update: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertQuoteOperationTool(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Upsert quote payment
 *
 * @mcp
 */
export const upsertQuotePayment = defineServiceFn({
  input: z.looseObject({
    id: z.string(),
    invoiceCustomerId: z.string().optional(),
    invoiceCustomerLocationId: z.string().optional(),
    invoiceCustomerContactId: z.string().optional(),
    paymentTermId: z.string().optional(),
    customFields: z.unknown().optional()
  }),
  permission: { create: "sales", update: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertQuotePayment(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Upsert quote shipment
 *
 * @mcp
 */
export const upsertQuoteShipment = defineServiceFn({
  input: z.looseObject({
    id: z.string(),
    locationId: z.string().optional(),
    shippingMethodId: z.string().optional(),
    receiptRequestedDate: z.string().optional(),
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
    incotermLocation: z.string().optional()
  }),
  permission: { create: "sales", update: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertQuoteShipment(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Create a new sales order with all business logic - generates sequence, creates opportunity, resolves payment/shipping defaults from customer
 *
 * @remarks
 * Create a new sales order with all business logic - generates sequence, creates opportunity, resolves payment/shipping defaults from customer. LLM can create a sales order with just customerId.
 *
 * @mcp
 */
export const insertSalesOrder = defineServiceFn({
  input: z.looseObject({
    customerId: z.string(),
    salesOrderId: z.string().optional(),
    locationId: z.string().optional(),
    status: z
      .enum([
        "Draft",
        "In Progress",
        "Needs Approval",
        "To Ship and Invoice",
        "To Ship",
        "To Invoice",
        "Completed",
        "Cancelled",
        "Closed"
      ])
      .optional(),
    currencyCode: z.string().optional(),
    orderDate: z.string().optional(),
    customerContactId: z.string().optional(),
    customerLocationId: z.string().optional(),
    quoteId: z.string().optional(),
    opportunityId: z.string().optional(),
    requestedDate: z.string().optional(),
    promisedDate: z.string().optional(),
    notes: z.string().optional(),
    customerReference: z.string().optional(),
    customerEngineeringContactId: z.string().optional(),
    salesPersonId: z.string().optional(),
    customFields: z.unknown().optional()
  }),
  permission: { create: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.insertSalesOrder(
        ctx.asCaller.supabase,
        payload(ctx, input).withGroup().forUpsert() as never
      )
    );
  }
});

/**
 * Upsert sales order shipment
 *
 * @mcp
 */
export const upsertSalesOrderShipment = defineServiceFn({
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
    supplierId: z.string().optional(),
    supplierLocationId: z.string().optional(),
    shippingCost: z.number().optional(),
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
  permission: { create: "sales", update: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertSalesOrderShipment(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Update sales order line order
 *
 * @mcp
 */
export const updateSalesOrderLineOrder = defineServiceFn({
  input: z.looseObject({
    salesOrderId: z.string(),
    updates: z.array(z.looseObject({ id: z.string(), sortOrder: z.number() }))
  }),
  permission: { update: "sales" },
  async run(ctx, input) {
    return await service.updateSalesOrderLineOrder(
      ctx.asSystem.pg,
      ctx.company.id,
      ctx.auditUserId,
      input.salesOrderId as never,
      payload(ctx, input.updates).forUpdate() as never
    );
  }
});

/**
 * Upsert sales order payment
 *
 * @mcp
 */
export const upsertSalesOrderPayment = defineServiceFn({
  input: z.looseObject({
    id: z.string(),
    invoiceCustomerId: z.string().optional(),
    invoiceCustomerLocationId: z.string().optional(),
    invoiceCustomerContactId: z.string().optional(),
    paymentTermId: z.string().optional(),
    paymentComplete: z.boolean().optional(),
    currencyCode: z
      .enum([
        "AFN",
        "AFA",
        "ALL",
        "ALK",
        "DZD",
        "ADP",
        "AOA",
        "AOK",
        "AON",
        "AOR",
        "ARA",
        "ARS",
        "ARM",
        "ARP",
        "ARL",
        "AMD",
        "AWG",
        "AUD",
        "ATS",
        "AZN",
        "AZM",
        "BSD",
        "BHD",
        "BDT",
        "BBD",
        "BYN",
        "BYB",
        "BYR",
        "BEF",
        "BEC",
        "BEL",
        "BZD",
        "BMD",
        "BTN",
        "BOB",
        "BOL",
        "BOV",
        "BOP",
        "BAM",
        "BAD",
        "BAN",
        "BWP",
        "BRC",
        "BRZ",
        "BRE",
        "BRR",
        "BRN",
        "BRB",
        "BRL",
        "GBP",
        "BND",
        "BGL",
        "BGN",
        "BGO",
        "BGM",
        "BUK",
        "BIF",
        "XPF",
        "KHR",
        "CAD",
        "CVE",
        "KYD",
        "XAF",
        "CLE",
        "CLP",
        "CLF",
        "CNX",
        "CNY",
        "CNH",
        "COP",
        "COU",
        "KMF",
        "CDF",
        "CRC",
        "HRD",
        "HRK",
        "CUC",
        "CUP",
        "CYP",
        "CZK",
        "CSK",
        "DKK",
        "DJF",
        "DOP",
        "NLG",
        "XCD",
        "DDM",
        "ECS",
        "ECV",
        "EGP",
        "GQE",
        "ERN",
        "EEK",
        "ETB",
        "EUR",
        "XBA",
        "XEU",
        "XBB",
        "XBC",
        "XBD",
        "FKP",
        "FJD",
        "FIM",
        "FRF",
        "XFO",
        "XFU",
        "GMD",
        "GEK",
        "GEL",
        "DEM",
        "GHS",
        "GHC",
        "GIP",
        "XAU",
        "GRD",
        "GTQ",
        "GWP",
        "GNF",
        "GNS",
        "GYD",
        "HTG",
        "HNL",
        "HKD",
        "HUF",
        "IMP",
        "ISK",
        "ISJ",
        "INR",
        "IDR",
        "IRR",
        "IQD",
        "IEP",
        "ILS",
        "ILP",
        "ILR",
        "ITL",
        "JMD",
        "JPY",
        "JOD",
        "KZT",
        "KES",
        "KWD",
        "KGS",
        "LAK",
        "LVL",
        "LVR",
        "LBP",
        "LSL",
        "LRD",
        "LYD",
        "LTL",
        "LTT",
        "LUL",
        "LUC",
        "LUF",
        "MOP",
        "MKD",
        "MKN",
        "MGA",
        "MGF",
        "MWK",
        "MYR",
        "MVR",
        "MVP",
        "MLF",
        "MTL",
        "MTP",
        "MRU",
        "MRO",
        "MUR",
        "MXV",
        "MXN",
        "MXP",
        "MDC",
        "MDL",
        "MCF",
        "MNT",
        "MAD",
        "MAF",
        "MZE",
        "MZN",
        "MZM",
        "MMK",
        "NAD",
        "NPR",
        "ANG",
        "TWD",
        "NZD",
        "NIO",
        "NIC",
        "NGN",
        "KPW",
        "NOK",
        "OMR",
        "PKR",
        "XPD",
        "PAB",
        "PGK",
        "PYG",
        "PEI",
        "PEN",
        "PES",
        "PHP",
        "XPT",
        "PLN",
        "PLZ",
        "PTE",
        "GWE",
        "QAR",
        "XRE",
        "RHD",
        "RON",
        "ROL",
        "RUB",
        "RUR",
        "RWF",
        "SVC",
        "WST",
        "SAR",
        "RSD",
        "CSD",
        "SCR",
        "SLL",
        "XAG",
        "SGD",
        "SKK",
        "SIT",
        "SBD",
        "SOS",
        "ZAR",
        "ZAL",
        "KRH",
        "KRW",
        "KRO",
        "SSP",
        "SUR",
        "ESP",
        "ESA",
        "ESB",
        "XDR",
        "LKR",
        "SHP",
        "XSU",
        "SDD",
        "SDG",
        "SDP",
        "SRD",
        "SRG",
        "SZL",
        "SEK",
        "CHF",
        "SYP",
        "STN",
        "STD",
        "TVD",
        "TJR",
        "TJS",
        "TZS",
        "XTS",
        "THB",
        "XXX",
        "TPE",
        "TOP",
        "TTD",
        "TND",
        "TRY",
        "TRL",
        "TMT",
        "TMM",
        "USD",
        "USN",
        "USS",
        "UGX",
        "UGS",
        "UAH",
        "UAK",
        "AED",
        "UYW",
        "UYU",
        "UYP",
        "UYI",
        "UZS",
        "VUV",
        "VES",
        "VEB",
        "VEF",
        "VND",
        "VNN",
        "CHE",
        "CHW",
        "XOF",
        "YDD",
        "YER",
        "YUN",
        "YUD",
        "YUM",
        "YUR",
        "ZWN",
        "ZRN",
        "ZRZ",
        "ZMW",
        "ZMK",
        "ZWD",
        "ZWR",
        "ZWL",
        "XUA"
      ])
      .optional(),
    customFields: z.unknown().optional()
  }),
  permission: { create: "sales", update: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertSalesOrderPayment(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Create a sales rfq
 *
 * @remarks
 * Upsert sales r f q
 *
 * @mcp
 */
export const createSalesRFQ = defineServiceFn({
  input: z.looseObject({
    customerLocationId: z.string().optional(),
    customerContactId: z.string().optional(),
    customerEngineeringContactId: z.string().optional(),
    customerId: z.string().min(1),
    customerReference: z.string().optional(),
    expirationDate: z.string().optional(),
    externalNotes: z.string().optional(),
    internalNotes: z.string().optional(),
    locationId: z.string().optional(),
    rfqDate: z.string().min(1),
    status: z.enum(["Draft", "Ready for Quote", "Quoted", "Closed"]).optional(),
    salesPersonId: z.string().optional(),
    rfqId: z.string(),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertSalesRFQ(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

/**
 * Update a sales rfq
 *
 * @remarks
 * Upsert sales r f q
 *
 * @mcp
 */
export const updateSalesRFQ = defineServiceFn({
  input: z
    .looseObject({
      customerLocationId: z.string().optional(),
      customerContactId: z.string().optional(),
      customerEngineeringContactId: z.string().optional(),
      customerId: z.string().min(1),
      customerReference: z.string().optional(),
      expirationDate: z.string().optional(),
      externalNotes: z.string().optional(),
      internalNotes: z.string().optional(),
      locationId: z.string().optional(),
      rfqDate: z.string().min(1),
      status: z
        .enum(["Draft", "Ready for Quote", "Quoted", "Closed"])
        .optional(),
      salesPersonId: z.string().optional(),
      rfqId: z.string(),
      customFields: z.unknown().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertSalesRFQ(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Create a sales rfqline
 *
 * @remarks
 * Upsert sales r f q line
 *
 * @mcp
 */
export const createSalesRFQLine = defineServiceFn({
  input: z.looseObject({
    salesRfqId: z.string().min(1),
    customerPartId: z.string().min(1),
    customerPartRevision: z.string().optional(),
    itemId: z.string().optional(),
    description: z.string().optional(),
    quantity: z.array(z.number().min(0.00001)),
    unitOfMeasureCode: z.string().min(1),
    order: z.number().min(0),
    modelUploadId: z.string().optional(),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertSalesRFQLine(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

/**
 * Update a sales rfqline
 *
 * @remarks
 * Upsert sales r f q line
 *
 * @mcp
 */
export const updateSalesRFQLine = defineServiceFn({
  input: z
    .looseObject({
      salesRfqId: z.string().min(1),
      customerPartId: z.string().min(1),
      customerPartRevision: z.string().optional(),
      itemId: z.string().optional(),
      description: z.string().optional(),
      quantity: z.array(z.number().min(0.00001)),
      unitOfMeasureCode: z.string().min(1),
      order: z.number().min(0),
      modelUploadId: z.string().optional(),
      customFields: z.unknown().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertSalesRFQLine(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Update sales r f q line order
 *
 * @mcp
 */
export const updateSalesRFQLineOrder = defineServiceFn({
  input: z.looseObject({
    salesRfqId: z.string(),
    updates: z.array(z.looseObject({ id: z.string(), sortOrder: z.number() }))
  }),
  permission: { update: "sales" },
  async run(ctx, input) {
    return await service.updateSalesRFQLineOrder(
      ctx.asSystem.pg,
      ctx.company.id,
      ctx.auditUserId,
      input.salesRfqId as never,
      payload(ctx, input.updates).forUpdate() as never
    );
  }
});

/**
 * Get return reasons
 *
 * @mcp read
 */
export const getReturnReasons = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getReturnReasons(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get return reasons list
 *
 * @mcp read
 */
export const getReturnReasonsList = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "sales" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getReturnReasonsList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get return reason
 *
 * @mcp read
 */
export const getReturnReason = defineServiceFn({
  input: z.looseObject({ returnReasonId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getReturnReason(
        ctx.asCaller.supabase,
        input.returnReasonId as never
      )
    );
  }
});

/**
 * Create a return reason
 *
 * @remarks
 * Upsert return reason
 *
 * @mcp
 */
export const createReturnReason = defineServiceFn({
  input: z.looseObject({
    name: z.string().min(1),
    inventoryValueZero: z.boolean().optional(),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertReturnReason(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

/**
 * Update a return reason
 *
 * @remarks
 * Upsert return reason
 *
 * @mcp
 */
export const updateReturnReason = defineServiceFn({
  input: z
    .looseObject({
      name: z.string().min(1),
      inventoryValueZero: z.boolean().optional(),
      customFields: z.unknown().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertReturnReason(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Delete return reason
 *
 * @mcp destructive
 */
export const deleteReturnReason = defineServiceFn({
  input: z.looseObject({ returnReasonId: z.string() }),
  permission: { delete: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteReturnReason(
        ctx.asCaller.supabase,
        input.returnReasonId as never
      )
    );
  }
});

/**
 * Get sales return orders
 *
 * @mcp read
 */
export const getSalesReturnOrders = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    customerId: z.string().nullable().optional()
  }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getSalesReturnOrders(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get sales return order
 *
 * @mcp read
 */
export const getSalesReturnOrder = defineServiceFn({
  input: z.looseObject({ salesReturnOrderId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getSalesReturnOrder(
        ctx.asCaller.supabase,
        input.salesReturnOrderId as never
      )
    );
  }
});

/**
 * Get sales return order lines
 *
 * @mcp read
 */
export const getSalesReturnOrderLines = defineServiceFn({
  input: z.looseObject({ salesReturnOrderId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getSalesReturnOrderLines(
        ctx.asCaller.supabase,
        input.salesReturnOrderId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get sales return order line
 *
 * @mcp read
 */
export const getSalesReturnOrderLine = defineServiceFn({
  input: z.looseObject({ lineId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getSalesReturnOrderLine(
        ctx.asCaller.supabase,
        input.lineId as never
      )
    );
  }
});

/**
 * Insert sales return order
 *
 * @mcp
 */
export const insertSalesReturnOrder = defineServiceFn({
  input: z.looseObject({
    customerId: z.string(),
    salesReturnOrderId: z.string().optional(),
    orderDate: z.string(),
    customerLocationId: z.string().optional(),
    customerContactId: z.string().optional(),
    customerReference: z.string().optional(),
    locationId: z.string().optional(),
    salesOrderId: z.string().optional(),
    currencyCode: z.string().optional(),
    expirationDate: z.string().optional(),
    assignee: z.string().optional(),
    customFields: z.unknown().optional()
  }),
  permission: { create: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.insertSalesReturnOrder(
        ctx.asCaller.supabase,
        payload(ctx, input).withGroup().forUpsert() as never
      )
    );
  }
});

/**
 * Delete sales return order
 *
 * @mcp destructive
 */
export const deleteSalesReturnOrder = defineServiceFn({
  input: z.looseObject({ salesReturnOrderId: z.string() }),
  permission: { delete: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteSalesReturnOrder(
        ctx.asCaller.supabase,
        input.salesReturnOrderId as never
      )
    );
  }
});

/**
 * Delete sales return order line
 *
 * @mcp destructive
 */
export const deleteSalesReturnOrderLine = defineServiceFn({
  input: z.looseObject({ lineId: z.string() }),
  permission: { delete: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteSalesReturnOrderLine(
        ctx.asCaller.supabase,
        input.lineId as never
      )
    );
  }
});

/**
 * Get sales return order receipts
 *
 * @mcp read
 */
export const getSalesReturnOrderReceipts = defineServiceFn({
  input: z.looseObject({ salesReturnOrderId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getSalesReturnOrderReceipts(
        ctx.asCaller.supabase,
        input.salesReturnOrderId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get sales return order credits
 *
 * @mcp read
 */
export const getSalesReturnOrderCredits = defineServiceFn({
  input: z.looseObject({ salesReturnOrderId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getSalesReturnOrderCredits(
        ctx.asCaller.supabase,
        input.salesReturnOrderId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get sales return order issues
 *
 * @mcp read
 */
export const getSalesReturnOrderIssues = defineServiceFn({
  input: z.looseObject({ salesReturnOrderId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getSalesReturnOrderIssues(
        ctx.asCaller.supabase,
        input.salesReturnOrderId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Reopen an RMA to Draft so its lines can be edited again
 *
 * @mcp
 */
export const reopenSalesReturnOrder = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { update: "sales" },
  async run(ctx, input) {
    return await service.reopenSalesReturnOrder(
      ctx.asSystem.pg,
      payload(ctx, input).withUser().build() as never
    );
  }
});

/**
 * Cancel sales return order
 *
 * @mcp
 */
export const cancelSalesReturnOrder = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { update: "sales" },
  async run(ctx, input) {
    return await service.cancelSalesReturnOrder(
      ctx.asSystem.pg,
      payload(ctx, input).withUser().build() as never
    );
  }
});

/**
 * Short-close ("stop expecting") an RMA line — the shortClosePurchaseOrderLine mechanic
 *
 * @mcp
 */
export const shortCloseSalesReturnOrderLine = defineServiceFn({
  input: z.looseObject({
    lineId: z.string(),
    salesReturnOrderId: z.string(),
    intent: z.enum(["close", "reopen"])
  }),
  permission: { update: "sales" },
  async run(ctx, input) {
    return await service.shortCloseSalesReturnOrderLine(
      ctx.asSystem.pg,
      payload(ctx, input).withUser().build() as never
    );
  }
});

/**
 * Returnable shipment lines for a customer, searched + paginated in the database via the get_returnable_shipment_lines RPC
 *
 * @mcp read
 */
export const getReturnableLinesForCustomer = defineServiceFn({
  input: z.looseObject({
    customerId: z.string(),
    salesOrderId: z.string().optional(),
    search: z.string().optional(),
    limit: z.number().optional(),
    offset: z.number().optional()
  }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getReturnableLinesForCustomer(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.customerId as never,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Serials and batches shipped to a customer, for the lines of a return:
 * consumed tracked entities tagged with one of its posted shipments.
 *
 * @mcp read
 */
export const getShippedTrackedEntitiesForCustomer = defineServiceFn({
  input: z.looseObject({ customerId: z.string(), itemId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getShippedTrackedEntitiesForCustomer(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.customerId as never,
        input.itemId as never
      )
    );
  }
});

/**
 * Per-line creditable pool = received − already credited
 *
 * @mcp read
 */
export const getCreditableQuantities = defineServiceFn({
  input: z.looseObject({ salesReturnOrderId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getCreditableQuantities(
        ctx.asCaller.supabase,
        input.salesReturnOrderId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Issue Credit: one AR memo (direction Credit, linked via memo.salesReturnOrderId) + per-line salesReturnOrderCreditLine breakdown
 *
 * @mcp
 */
export const createSalesReturnOrderCredit = defineServiceFn({
  input: z.looseObject({
    salesReturnOrderId: z.string(),
    memoDate: z.string(),
    lines: z.array(
      z.looseObject({
        salesReturnOrderLineId: z.string(),
        quantity: z.number()
      })
    )
  }),
  permission: { create: "invoicing" },
  async run(ctx, input) {
    return await service.createSalesReturnOrderCredit(
      ctx.asCaller.supabase,
      ctx.asSystem.pg,
      payload(ctx, input).withGroup().withUser().forUpsert() as never
    );
  }
});

/**
 * Create a replacement sales order from a return: a Draft order of the return
 * lines at their resolved prices, which the user can change (to zero for a
 * warranty).
 *
 * @remarks
 * One replacement per return: calling it again returns the existing order.
 *
 * @mcp
 */
export const createReplacementSalesOrder = defineServiceFn({
  input: z.looseObject({ salesReturnOrderId: z.string() }),
  permission: { create: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.createReplacementSalesOrder(
        ctx.asCaller.supabase,
        payload(ctx, input).withGroup().withUser().forUpsert() as never
      )
    );
  }
});

/**
 * Set an RMA line's disposition
 *
 * @mcp
 */
export const setSalesReturnOrderLineDisposition = defineServiceFn({
  input: z.looseObject({
    lineId: z.string(),
    disposition: z.enum([
      "Conditional Acceptance",
      "Deviation Accepted",
      "Hold",
      "No Action Required",
      "Pending",
      "Quarantine",
      "Repair",
      "Return to Supplier",
      "Rework",
      "Scrap",
      "Use As Is",
      "Return to Customer"
    ])
  }),
  permission: { update: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.setSalesReturnOrderLineDisposition(
        ctx.asCaller.supabase,
        ctx.asSystem.pg,
        payload(ctx, input).withUser().forUpdate() as never
      )
    );
  }
});

/**
 * Create a presigned upload URL for an opportunity (quote/sales order/RFQ/sales invoice) document
 *
 * @mcp
 */
export const createOpportunityDocumentUploadUrl = defineServiceFn({
  input: z.looseObject({ opportunityId: z.string(), name: z.string() }),
  permission: { create: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.createOpportunityDocumentUploadUrl(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpsert() as never
      )
    );
  }
});

/**
 * Create a presigned upload URL for an opportunity LINE document
 *
 * @mcp
 */
export const createOpportunityLineDocumentUploadUrl = defineServiceFn({
  input: z.looseObject({ lineId: z.string(), name: z.string() }),
  permission: { create: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.createOpportunityLineDocumentUploadUrl(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpsert() as never
      )
    );
  }
});

/**
 * Get rental agreements
 *
 * @mcp read
 */
export const getRentalAgreements = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getRentalAgreements(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get rental agreement
 *
 * @mcp read
 */
export const getRentalAgreement = defineServiceFn({
  input: z.looseObject({ rentalAgreementId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getRentalAgreement(
        ctx.asCaller.supabase,
        input.rentalAgreementId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Only a Draft agreement can be deleted — an activated one has billing periods and possibly invoices; it is cancelled or closed instead
 *
 * @mcp destructive
 */
export const deleteRentalAgreement = defineServiceFn({
  input: z.looseObject({ rentalAgreementId: z.string() }),
  permission: { delete: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteRentalAgreement(
        ctx.asCaller.supabase,
        input.rentalAgreementId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get rental agreement lines
 *
 * @mcp read
 */
export const getRentalAgreementLines = defineServiceFn({
  input: z.looseObject({ rentalAgreementId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getRentalAgreementLines(
        ctx.asCaller.supabase,
        input.rentalAgreementId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get rental agreement line
 *
 * @mcp read
 */
export const getRentalAgreementLine = defineServiceFn({
  input: z.looseObject({ rentalAgreementLineId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getRentalAgreementLine(
        ctx.asCaller.supabase,
        input.rentalAgreementLineId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Create a rental agreement line
 *
 * @remarks
 * The line's item and serial always come from its fleet unit, never the form, so a line cannot name one unit and bill another's rates
 *
 * @mcp
 */
export const createRentalAgreementLine = defineServiceFn({
  input: z.looseObject({
    rentalAgreementId: z.string().min(1),
    fixedAssetId: z.string().min(1),
    rateUnit: z.enum(["Day", "Week", "Month"]),
    rate: z.number().min(0).optional(),
    fairValue: z.number().min(0).optional(),
    economicLifeMonths: z.number().int().gt(0).optional(),
    guaranteedResidualValue: z.number().min(0).optional(),
    unguaranteedResidualValue: z.number().min(0).optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertRentalAgreementLine(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

/**
 * Update a rental agreement line
 *
 * @remarks
 * The line's item and serial always come from its fleet unit, never the form, so a line cannot name one unit and bill another's rates
 *
 * @mcp
 */
export const updateRentalAgreementLine = defineServiceFn({
  input: z
    .looseObject({
      rentalAgreementId: z.string().min(1),
      fixedAssetId: z.string().min(1),
      rateUnit: z.enum(["Day", "Week", "Month"]),
      rate: z.number().min(0).optional(),
      fairValue: z.number().min(0).optional(),
      economicLifeMonths: z.number().int().gt(0).optional(),
      guaranteedResidualValue: z.number().min(0).optional(),
      unguaranteedResidualValue: z.number().min(0).optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertRentalAgreementLine(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Only from a Draft agreement — an activated line has billing periods behind it; return the unit or cancel the agreement instead
 *
 * @mcp destructive
 */
export const deleteRentalAgreementLine = defineServiceFn({
  input: z.looseObject({ rentalAgreementLineId: z.string() }),
  permission: { delete: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteRentalAgreementLine(
        ctx.asCaller.supabase,
        input.rentalAgreementLineId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Every charge on the agreement's lines, with the line's fleet unit
 *
 * @mcp read
 */
export const getRentalAgreementCharges = defineServiceFn({
  input: z.looseObject({ rentalAgreementId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getRentalAgreementCharges(
        ctx.asCaller.supabase,
        input.rentalAgreementId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Create a rental agreement charge
 *
 * @remarks
 * A variable charge (damage, delivery, overage) on one unit of an open agreement
 *
 * @mcp
 */
export const createRentalAgreementCharge = defineServiceFn({
  input: z.looseObject({
    rentalAgreementLineId: z.string().min(1),
    chargeDate: z.string().min(1),
    description: z.string().min(1),
    amount: z.number(),
    taxPercent: z.number().min(0).max(1),
    invoiceSeparately: z.boolean().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertRentalAgreementCharge(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

/**
 * Update a rental agreement charge
 *
 * @remarks
 * A variable charge (damage, delivery, overage) on one unit of an open agreement
 *
 * @mcp
 */
export const updateRentalAgreementCharge = defineServiceFn({
  input: z
    .looseObject({
      rentalAgreementLineId: z.string().min(1),
      chargeDate: z.string().min(1),
      description: z.string().min(1),
      amount: z.number(),
      taxPercent: z.number().min(0).max(1),
      invoiceSeparately: z.boolean().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertRentalAgreementCharge(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Delete a rental agreement charge.
 *
 * @remarks
 * Only an open (Draft or Active) agreement's charges can be removed. A charge
 * that has been invoiced stays: void or delete the invoice first.
 *
 * @mcp destructive
 */
export const deleteRentalAgreementCharge = defineServiceFn({
  input: z.looseObject({ rentalAgreementChargeId: z.string() }),
  permission: { delete: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteRentalAgreementCharge(
        ctx.asCaller.supabase,
        input.rentalAgreementChargeId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Every billing period of the agreement's lines, oldest first
 *
 * @mcp read
 */
export const getRentalBillingPeriods = defineServiceFn({
  input: z.looseObject({ rentalAgreementId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getRentalBillingPeriods(
        ctx.asCaller.supabase,
        input.rentalAgreementId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Fleet units free to put on a new line
 *
 * @mcp read
 */
export const getRentableFleetAssets = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "sales" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getRentableFleetAssets(
        ctx.asCaller.supabase,
        ctx.company.id
      )
    );
  }
});

/**
 * Get item rental rate
 *
 * @mcp read
 */
export const getItemRentalRate = defineServiceFn({
  input: z.looseObject({ itemId: z.string(), currencyCode: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getItemRentalRate(
        ctx.asCaller.supabase,
        input.itemId as never,
        ctx.company.id,
        input.currencyCode as never
      )
    );
  }
});

/**
 * One ladder per item and currency: an existing row is replaced in place
 *
 * @mcp
 */
export const upsertItemRentalRate = defineServiceFn({
  input: z.looseObject({
    itemId: z.string().min(1),
    currencyCode: z.string().min(1),
    dayRate: z.number().min(0).optional(),
    weekRate: z.number().min(0).optional(),
    monthRate: z.number().min(0).optional()
  }),
  permission: { create: "sales", update: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertItemRentalRate(
        ctx.asCaller.supabase,
        payload(ctx, input).withUser().forUpsert() as never
      )
    );
  }
});

/**
 * The rate each item starts at on a rental line for this customer, per
 * frequency: the customer's own rate, else its customer type's, else the
 * item's, in effect on `asOf`. Keyed by item id.
 *
 * @mcp read
 */
export const getDefaultRentalRates = defineServiceFn({
  input: z.looseObject({
    customerId: z.string(),
    currencyCode: z.string(),
    asOf: z.string(),
    itemIds: z.array(z.string())
  }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await utils.getDefaultRentalRates(
        ctx.asCaller.supabase,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get customer item rental rates
 *
 * @mcp read
 */
export const getCustomerItemRentalRates = defineServiceFn({
  input: z.looseObject({ itemId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getCustomerItemRentalRates(
        ctx.asCaller.supabase,
        input.itemId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get customer item rental rate
 *
 * @mcp read
 */
export const getCustomerItemRentalRate = defineServiceFn({
  input: z.looseObject({ customerItemRentalRateId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getCustomerItemRentalRate(
        ctx.asCaller.supabase,
        input.customerItemRentalRateId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * One row per customer (or customer type), item and currency — a second row for the same scope is refused by the unique index (23505)
 *
 * @mcp
 */
export const upsertCustomerItemRentalRate = defineServiceFn({
  input: z.looseObject({
    id: z.string().optional(),
    itemId: z.string().min(1),
    currencyCode: z.string().min(1),
    customerId: z.string().optional(),
    customerTypeId: z.string().optional(),
    dayRate: z.number().min(0).optional(),
    weekRate: z.number().min(0).optional(),
    monthRate: z.number().min(0).optional(),
    validFrom: z.string().optional(),
    validTo: z.string().optional(),
    notes: z.string().optional()
  }),
  permission: { create: "sales", update: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertCustomerItemRentalRate(
        ctx.asCaller.supabase,
        payload(ctx, input).withUser().forUpsert() as never
      )
    );
  }
});

/**
 * Delete customer item rental rate
 *
 * @mcp destructive
 */
export const deleteCustomerItemRentalRate = defineServiceFn({
  input: z.looseObject({ customerItemRentalRateId: z.string() }),
  permission: { delete: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteCustomerItemRentalRate(
        ctx.asCaller.supabase,
        input.customerItemRentalRateId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Customer payments held against the agreement — deposits and refunds
 *
 * @mcp read
 */
export const getRentalAgreementDeposits = defineServiceFn({
  input: z.looseObject({ rentalAgreementId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getRentalAgreementDeposits(
        ctx.asCaller.supabase,
        input.rentalAgreementId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get rental agreement related documents
 *
 * @mcp read
 */
export const getRentalAgreementRelatedDocuments = defineServiceFn({
  input: z.looseObject({ rentalAgreementId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getRentalAgreementRelatedDocuments(
        ctx.asCaller.supabase,
        input.rentalAgreementId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Lists contracts with their customer, value invoiced to date and next invoice date
 *
 * @mcp read
 */
export const getContracts = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getContracts(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Gets one contract with its customer, value invoiced to date and next invoice date
 *
 * @mcp read
 */
export const getContract = defineServiceFn({
  input: z.looseObject({ customerContractId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getContract(
        ctx.asCaller.supabase,
        input.customerContractId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Lists a contract's lines with their service items
 *
 * @mcp read
 */
export const getContractLines = defineServiceFn({
  input: z.looseObject({ customerContractId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getContractLines(
        ctx.asCaller.supabase,
        input.customerContractId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Gets one contract line with its service item
 *
 * @mcp read
 */
export const getContractLine = defineServiceFn({
  input: z.looseObject({ customerContractLineId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getContractLine(
        ctx.asCaller.supabase,
        input.customerContractLineId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Gets a contract's persisted invoice schedule: planned invoices with their lines, and the cancellation credits that sit on a memo instead of an invoice
 *
 * @mcp read
 */
export const getContractInvoiceSchedule = defineServiceFn({
  input: z.looseObject({ customerContractId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getContractInvoiceSchedule(
        ctx.asCaller.supabase,
        input.customerContractId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Lists a contract's amendments, oldest first, with the lines each one added or replaced
 *
 * @mcp read
 */
export const getContractAmendments = defineServiceFn({
  input: z.looseObject({ customerContractId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getContractAmendments(
        ctx.asCaller.supabase,
        input.customerContractId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Lists the statuses of a customer's contracts, from which a new contract's type is suggested
 *
 * @mcp read
 */
export const getCustomerContractStatuses = defineServiceFn({
  input: z.looseObject({ customerId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getCustomerContractStatuses(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.customerId as never
      )
    );
  }
});

/**
 * Create a contract line
 *
 * @remarks
 * Adds or changes a line on a Draft contract; the item must be a Service item
 *
 * @mcp
 */
export const createContractLine = defineServiceFn({
  input: z.looseObject({
    customerContractId: z.string().min(1),
    revenueType: z.enum(["One-time", "Recurring"]),
    itemId: z.string().min(1),
    description: z.string().optional(),
    quantity: z.number().gt(0),
    rate: z.number().min(0),
    rateUnit: z.enum(["Day", "Week", "Month", "Quarter", "Year"]).optional(),
    discountPercent: z.number().min(0).max(100),
    discountEndsOn: z.string().optional(),
    taxPercent: z.number().min(0).max(100),
    startDate: z.string().min(1),
    endDate: z.string().optional(),
    goLiveDate: z.string().optional(),
    revenueMethod: z.enum(["Daily", "Even Period"]),
    revenueStartDate: z.string().optional(),
    revenueEndDate: z.string().optional(),
    projectId: z.string().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertContractLine(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

/**
 * Update a contract line
 *
 * @remarks
 * Adds or changes a line on a Draft contract; the item must be a Service item
 *
 * @mcp
 */
export const updateContractLine = defineServiceFn({
  input: z
    .looseObject({
      customerContractId: z.string().min(1),
      revenueType: z.enum(["One-time", "Recurring"]),
      itemId: z.string().min(1),
      description: z.string().optional(),
      quantity: z.number().gt(0),
      rate: z.number().min(0),
      rateUnit: z.enum(["Day", "Week", "Month", "Quarter", "Year"]).optional(),
      discountPercent: z.number().min(0).max(100),
      discountEndsOn: z.string().optional(),
      taxPercent: z.number().min(0).max(100),
      startDate: z.string().min(1),
      endDate: z.string().optional(),
      goLiveDate: z.string().optional(),
      revenueMethod: z.enum(["Daily", "Even Period"]),
      revenueStartDate: z.string().optional(),
      revenueEndDate: z.string().optional(),
      projectId: z.string().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertContractLine(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});
