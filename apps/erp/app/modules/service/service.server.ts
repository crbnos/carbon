// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The operations of field service: service orders and their status, customer
// assets, service templates, charges, visits, billing and the work tree of an
// order or a template. The building blocks they run are in
// `service.service.ts`.
// Spec: .ai/specs/implemented/2026-10-08-field-service.md

import { CarbonError, defineServiceFn } from "@carbon/api/service-fn.server";
import { run } from "@carbon/api/service-tools.server";
import type { Json } from "@carbon/database";
import { storage } from "@carbon/files";
import { z } from "zod";
import {
  buildFromPartValidator,
  logTimeValidator,
  projectElementCommentValidator,
  projectElementCostValidator,
  projectElementFieldUpdateValidator,
  projectElementLaborValidator,
  projectElementMaterialValidator,
  projectElementValidator,
  projectIssueValidator
} from "../projects/projects.models";
import * as projects from "../projects/projects.service";
import { invokePosting } from "../shared/shared.service";
import {
  canMoveServiceOrder,
  coverageOverrideValidator,
  customerAssetUpdateValidator,
  customerAssetValidator,
  serviceBillableItemValidator,
  serviceChargeReversalValidator,
  serviceElementFields,
  serviceExpenseValidator,
  serviceNodeFixedPriceValidator,
  serviceNodeTypes,
  serviceOrderPropertyFields,
  serviceOrderStatusActions,
  serviceOrderTextFields,
  serviceOrderUpdateValidator,
  serviceOrderValidator,
  servicePlanTables,
  serviceTemplateValidator,
  serviceVisitStatuses,
  serviceVisitValidator
} from "./service.models";
import * as service from "./service.service";

/** The largest signature PNG a visit takes. */
const MAX_SIGNATURE_BYTES = 2 * 1024 * 1024;

const SERVICE_ELEMENT_FIELDS = new Set<string>(serviceElementFields);

const orderedIds = z.array(z.object({ id: z.string(), sortOrder: z.number() }));

// --- Service orders --------------------------------------------------------------

/**
 * Create a service order.
 *
 * @remarks
 * A Draft order in one transaction (`createServiceOrder`): checks the subject,
 * creates the order's Service project and, when asked, builds its work tree
 * from a service template, the unit's build history or the item's bill of
 * materials. A refusal about the subject (the unit, the refurbished serial,
 * the coverage contract) is a `rule` error.
 */
export const createServiceOrder = defineServiceFn({
  input: serviceOrderValidator,
  permission: { create: "service" },

  async run(ctx, input) {
    return service.attemptServiceOrder(
      ctx,
      "Failed to create the service order",
      () =>
        service.createServiceOrder(ctx.asCaller.supabase, ctx.asSystem.pg, {
          ...input,
          companyId: ctx.company.id,
          userId: ctx.auditUserId
        })
    );
  }
});

/**
 * Register a customer asset for a unit sold before Carbon.
 *
 * @remarks
 * A Consumed `trackedEntity` for the typed serial and the customer asset
 * (source Manual), in one transaction. A serial Carbon already tracks for the
 * item, or an item that is not serialized, is a `rule` error.
 */
export const registerCustomerAsset = defineServiceFn({
  input: customerAssetValidator,
  permission: { create: "service" },

  async run(ctx, input) {
    return service.attemptServiceOrder(
      ctx,
      "Failed to register the customer asset",
      () =>
        service.registerCustomerAsset(ctx.asSystem.pg, {
          ...input,
          companyId: ctx.company.id,
          userId: ctx.auditUserId
        })
    );
  }
});

/**
 * Save the fields a service manager edits on a customer asset.
 *
 * @remarks
 * The site, the two warranty end dates and the notes.
 */
export const updateCustomerAsset = defineServiceFn({
  input: customerAssetUpdateValidator,
  permission: { update: "service" },

  async run(ctx, input) {
    const update = await service.upsertCustomerAsset(ctx.asCaller.supabase, {
      ...input,
      companyId: ctx.company.id,
      updatedBy: ctx.auditUserId
    });
    if (update.error) {
      return ctx.error("internal", "Failed to update the asset", update.error);
    }
    return { id: input.id };
  }
});

/** Save a customer asset's notes. */
export const updateCustomerAssetNotes = defineServiceFn({
  input: z.object({ id: z.string(), notes: z.custom<Json>() }),
  permission: { update: "service" },

  async run(ctx, { id, notes }) {
    const update = await service.updateCustomerAssetNotes(
      ctx.asCaller.supabase,
      { id, notes, companyId: ctx.company.id, updatedBy: ctx.auditUserId }
    );
    if (update.error) return ctx.error("rule", update.error.message);
    return { id };
  }
});

/** Create a service template: a Draft Service project marked as a template. */
export const createServiceTemplate = defineServiceFn({
  input: serviceTemplateValidator,
  permission: { create: "service" },

  async run(ctx, input) {
    return service.attemptServiceOrder(
      ctx,
      "Failed to create the service template",
      () =>
        service.createServiceTemplate(ctx.asSystem.pg, {
          ...input,
          companyId: ctx.company.id,
          userId: ctx.auditUserId
        })
    );
  }
});

/**
 * Save one field of a service order.
 *
 * @remarks
 * `field` is a property of the Properties panel (its `value` the form's
 * text) or a rich-text field (`problem`, `resolution`; its `value` the
 * document). The coverage contract also moves the Service project's parent
 * and is refused while a Contract charge stands
 * (`updateServiceOrderCoverageContract`); every other field saves through
 * `updateServiceOrder`.
 */
export const updateServiceOrderField = defineServiceFn({
  input: z.object({
    id: z.string(),
    field: z.enum([...serviceOrderPropertyFields, ...serviceOrderTextFields]),
    value: z.unknown()
  }),
  permission: { update: "service" },

  async run(ctx, { id, field, value }) {
    let changes: Record<string, unknown>;
    if ((serviceOrderTextFields as readonly string[]).includes(field)) {
      changes = { [field]: value as Json };
    } else {
      const parsed = serviceOrderUpdateValidator.safeParse({
        id,
        [field]: typeof value === "string" ? value : ""
      });
      if (!parsed.success) return ctx.error("validation", "Invalid value");
      if (field === "customerContractId") {
        return service.attemptServiceOrder(
          ctx,
          "Failed to change the coverage contract",
          async () => {
            await service.updateServiceOrderCoverageContract(ctx.asSystem.pg, {
              companyId: ctx.company.id,
              userId: ctx.auditUserId,
              serviceOrderId: id,
              customerContractId: parsed.data.customerContractId ?? null
            });
            return { id };
          }
        );
      }
      // Only the one field: an absent key would be saved as null.
      changes = {
        [field]: parsed.data[field as keyof typeof parsed.data]
      };
    }

    const update = await service.updateServiceOrder(ctx.asCaller.supabase, {
      id,
      ...changes,
      companyId: ctx.company.id,
      updatedBy: ctx.auditUserId
    });
    if (update.error) return ctx.error("rule", update.error.message);
    return { id };
  }
});

/**
 * Complete a service order through `complete-service-order`.
 *
 * @remarks
 * A Field Visit or Depot Repair order is stamped Completed; a Refurbishment
 * also moves its WIP into the serial's cost and releases the serial. Returns
 * the completion's warnings (no sale price to cap at).
 */
export const completeServiceOrder = defineServiceFn({
  input: service.completeServiceOrderInput,
  permission: service.completeServiceOrderPermission,

  async run(ctx, input) {
    return run(ctx, "complete-service-order", () =>
      service.completeServiceOrder(ctx, input)
    );
  }
});

/**
 * Move a service order to the status the user chose.
 *
 * @remarks
 * Refuses a move `canMoveServiceOrder` does not allow. Completed goes
 * through `completeServiceOrder`; Cancelled through `cancelServiceOrder`,
 * which refuses an order with a charge that is not reversed and releases a
 * Refurbishment's serial; any other status rolls the order up from its
 * visits (`syncServiceOrderStatus`) and sets its work tree's status to match.
 * Returns the status it moved from and the completion's warnings.
 */
export const setServiceOrderStatus = defineServiceFn({
  input: z.object({
    serviceOrderId: z.string(),
    status: z.enum(serviceOrderStatusActions)
  }),
  permission: { update: "service" },

  async run(ctx, { serviceOrderId, status }) {
    const current = await ctx.asCaller.supabase
      .from("serviceOrder")
      .select("status")
      .eq("id", serviceOrderId)
      .eq("companyId", ctx.company.id)
      .single();
    if (current.error) {
      return ctx.error(
        "internal",
        "Failed to load service order",
        current.error
      );
    }
    const from = current.data.status;
    if (!canMoveServiceOrder(from, status)) {
      return ctx.error("rule", `A ${from} service order cannot do that`);
    }

    if (status === "Completed") {
      // A Refurbishment's cost moves into its serial there.
      const completed = await completeServiceOrder(ctx, { serviceOrderId });
      if (completed.error) return completed.error;
      return { from, status, warnings: completed.data.warnings };
    }

    return service.attemptServiceOrder(
      ctx,
      "Failed to update the service order",
      async () => {
        const args = {
          companyId: ctx.company.id,
          serviceOrderId,
          userId: ctx.auditUserId
        };
        if (status === "Cancelled") {
          await service.cancelServiceOrder(ctx.asSystem.pg, args);
        } else {
          await service.syncServiceOrderStatus(ctx.asSystem.pg, {
            ...args,
            status
          });
        }
        return { from, status, warnings: [] as string[] };
      }
    );
  }
});

/**
 * Review one billable item of a service order before it is billed.
 *
 * @remarks
 * A new unit price (the amount follows), a hold or its release, or a
 * write-off with a reason. Refused on a Closed or Cancelled order, for an
 * item of another order, and for an item that is Billed, Written Off or a
 * reversal.
 */
export const updateServiceBillableItem = defineServiceFn({
  input: serviceBillableItemValidator.safeExtend({
    serviceOrderId: z.string()
  }),
  permission: { update: "service" },

  async run(ctx, { serviceOrderId, ...item }) {
    const companyId = ctx.company.id;
    const checked = await service.attemptServiceOrder(
      ctx,
      "Failed to update the item",
      async () => {
        const order = await service.requireOpenServiceOrder(
          ctx.asCaller.supabase,
          { companyId, serviceOrderId }
        );
        await service.requireServiceBillableItem(ctx.asCaller.supabase, {
          companyId,
          projectId: order.projectId,
          projectBillableItemId: item.id
        });
        return order;
      }
    );
    if (checked instanceof CarbonError) return checked;

    const update = await service.updateServiceBillableItem(
      ctx.asCaller.supabase,
      { ...item, companyId, updatedBy: ctx.auditUserId }
    );
    if (update.error) return ctx.error("rule", update.error.message);
    return { id: item.id };
  }
});

/**
 * Draft the invoice of a Completed service order through
 * `create-service-order-invoice`.
 *
 * @remarks
 * One Draft sales invoice of the order's Unbilled items, laid out by its work
 * tree; the order closes. Returns the invoice.
 */
export const createServiceOrderInvoice = defineServiceFn({
  input: service.createServiceOrderInvoiceInput,
  permission: service.createServiceOrderInvoicePermission,

  async run(ctx, input) {
    return run(ctx, "create-service-order-invoice", () =>
      service.createServiceOrderInvoice(ctx, input)
    );
  }
});

// --- Charges ---------------------------------------------------------------------

/**
 * Log time on a service order's node.
 *
 * @remarks
 * A Draft timesheet entry on the node, with the visit
 * (`save-timesheet-entry`), posted at once by `post-timesheet`. A user
 * without `update: "service"` charges only their own open visit. The budget
 * check (Government Contracting 5c) only warns: its text is `warning`.
 */
export const logServiceTime = defineServiceFn({
  input: logTimeValidator.safeExtend({
    serviceOrderId: z.string(),
    serviceVisitId: z.string().nullish()
  }),
  permission: { view: "service" },

  async run(ctx, { serviceOrderId, serviceVisitId, ...time }) {
    return service.attemptServiceOrder(
      ctx,
      "Failed to post the charge",
      async () => {
        const visitId = serviceVisitId || null;
        await service.requireServiceVisitAccess(ctx, {
          serviceOrderId,
          serviceVisitId: visitId
        });
        const order = await service.requireServiceOrderNode(ctx.asSystem.pg, {
          companyId: ctx.company.id,
          serviceOrderId,
          projectElementId: time.projectElementId
        });
        if (order.projectId !== time.projectId) {
          return ctx.error("rule", "The time is not for this service order");
        }

        // Service time posts from Draft: one new entry, posted right after.
        const saved = await invokePosting(
          ctx,
          "save-timesheet-entry",
          {
            mode: "add" as const,
            status: "Draft" as const,
            employeeId: ctx.auditUserId,
            projectId: order.projectId,
            projectElementId: time.projectElementId || null,
            serviceVisitId: visitId,
            laborCategoryId: time.laborCategoryId,
            entryDate: time.entryDate,
            hours: time.hours,
            note: time.note,
            lateReason: time.lateReason
          },
          projects.saveTimesheetEntry
        );
        if (saved.error || !saved.data?.entryId) {
          return ctx.error(
            "rule",
            saved.error?.message || "Failed to log the time",
            saved.error
          );
        }

        // Checked before the entry posts, so its own cost is not counted twice.
        const warning = await projects.timesheetBudgetWarning(
          ctx.asCaller.supabase,
          ctx.asSystem.pg,
          {
            companyId: ctx.company.id,
            projectId: order.projectId,
            projectElementId: time.projectElementId ?? null,
            laborCategoryId: time.laborCategoryId,
            entryDate: time.entryDate,
            hours: time.hours
          }
        );
        const postingError = await projects.postTimesheetEntries(ctx, {
          timesheetEntryIds: [saved.data.entryId]
        });
        if (postingError) {
          return ctx.error(
            "rule",
            `The time is logged but did not post: ${postingError}`
          );
        }
        return { warning };
      }
    );
  }
});

/**
 * Issue a part to a service order's node, or return one, through
 * `post-project-issue`.
 *
 * @remarks
 * A part moves stock, so it also needs `update: "inventory"`. A user without
 * `update: "service"` charges only their own open visit.
 */
export const issueServicePart = defineServiceFn({
  input: projectIssueValidator.safeExtend({
    serviceOrderId: z.string(),
    serviceVisitId: z.string().nullish()
  }),
  permission: { view: "service", update: "inventory" },

  async run(ctx, { serviceOrderId, serviceVisitId, ...issue }) {
    return service.attemptServiceOrder(
      ctx,
      "Failed to post the charge",
      async () => {
        await service.requireServiceVisitAccess(ctx, {
          serviceOrderId,
          serviceVisitId: serviceVisitId || null
        });
        const order = await service.requireServiceOrderNode(ctx.asSystem.pg, {
          companyId: ctx.company.id,
          serviceOrderId,
          projectElementId: issue.projectElementId
        });
        if (order.projectId !== issue.projectId) {
          return ctx.error("rule", "The part is not for this service order");
        }
        const posting = await invokePosting(
          ctx,
          "post-project-issue",
          {
            ...issue,
            projectElementId: issue.projectElementId ?? null,
            storageUnitId: issue.storageUnitId ?? null,
            trackedEntityId: issue.trackedEntityId ?? null
          },
          projects.postProjectIssue
        );
        if (posting.error) {
          return ctx.error(
            "rule",
            posting.error.message || "Failed to issue the material",
            posting.error
          );
        }
        return { serviceOrderId };
      }
    );
  }
});

/**
 * Add an expense to a service order's node.
 *
 * @remarks
 * A `projectExpenseEntry`, posted by `post-project-expense`. The entry stays
 * when the posting fails, and the refusal says it did not post. A user
 * without `update: "service"` charges only their own open visit.
 */
export const addServiceExpense = defineServiceFn({
  input: serviceExpenseValidator.safeExtend({ serviceOrderId: z.string() }),
  permission: { view: "service" },

  async run(ctx, { serviceOrderId, ...expense }) {
    return service.attemptServiceOrder(
      ctx,
      "Failed to post the charge",
      async () => {
        await service.requireServiceVisitAccess(ctx, {
          serviceOrderId,
          serviceVisitId: expense.serviceVisitId || null
        });
        const order = await service.requireServiceOrderNode(ctx.asSystem.pg, {
          companyId: ctx.company.id,
          serviceOrderId,
          projectElementId: expense.projectElementId
        });
        const postingError = await service.addServiceExpense(ctx, {
          ...expense,
          serviceVisitId: expense.serviceVisitId || undefined,
          projectId: order.projectId
        });
        if (postingError) return ctx.error("rule", postingError);
        return { serviceOrderId };
      }
    );
  }
});

/**
 * Move one charge of a service order to another coverage, with a reason,
 * through `reclass-project-coverage`.
 *
 * @remarks
 * Only a user with `update: "service"` changes a coverage.
 */
export const reclassServiceCharge = defineServiceFn({
  input: coverageOverrideValidator.safeExtend({
    serviceOrderId: z.string(),
    projectLedgerId: z.string().min(1, { message: "Choose a charge" })
  }),
  permission: { view: "service" },

  async run(ctx, { serviceOrderId, ...reclass }) {
    if (!ctx.can({ update: "service" })) {
      return ctx.error(
        "forbidden",
        "You do not have permission to change a coverage"
      );
    }
    return service.attemptServiceOrder(
      ctx,
      "Failed to post the charge",
      async () => {
        const order = await service.requireServiceOrderNode(ctx.asSystem.pg, {
          companyId: ctx.company.id,
          serviceOrderId
        });
        const postingError = await service.reclassServiceCharge(ctx, {
          ...reclass,
          projectId: order.projectId
        });
        if (postingError) return ctx.error("rule", postingError);
        return { serviceOrderId };
      }
    );
  }
});

/**
 * Reverse one posted time or expense charge of a service order, with a
 * reason.
 *
 * @remarks
 * Time: a timesheet correction to 0 hours, posted at once by
 * `post-timesheet`. An expense: a reversing `projectExpenseEntry`, posted by
 * `post-project-expense`. Both post at the original's coverage and reverse
 * its billable item. A user without `update: "service"` reverses only the
 * charges of their own open visit.
 */
export const reverseServiceCharge = defineServiceFn({
  input: serviceChargeReversalValidator.safeExtend({
    serviceOrderId: z.string(),
    serviceVisitId: z.string().nullish()
  }),
  permission: { view: "service" },

  async run(ctx, { serviceOrderId, serviceVisitId, ...reversal }) {
    return service.attemptServiceOrder(
      ctx,
      "Failed to post the charge",
      async () => {
        const visitId = serviceVisitId || null;
        const { canUpdateAny } = await service.requireServiceVisitAccess(ctx, {
          serviceOrderId,
          serviceVisitId: visitId
        });
        const order = await service.requireServiceOrderNode(ctx.asSystem.pg, {
          companyId: ctx.company.id,
          serviceOrderId
        });
        const postingError = await service.reverseServiceCharge(ctx, {
          ...reversal,
          projectId: order.projectId,
          onlyVisitId: canUpdateAny ? null : visitId
        });
        if (postingError) return ctx.error("rule", postingError);
        return { serviceOrderId };
      }
    );
  }
});

// --- Visits ----------------------------------------------------------------------

/**
 * Schedule a visit on a service order, or move a scheduled visit's
 * technician and window.
 *
 * @remarks
 * One transaction with the order's status roll-up. A Closed or Cancelled
 * order takes no visit; only a Scheduled visit can be moved.
 */
export const scheduleServiceVisit = defineServiceFn({
  input: serviceVisitValidator,
  permission: { update: "service" },

  async run(ctx, input) {
    return service.attemptServiceOrder(
      ctx,
      "Failed to schedule the visit",
      () =>
        service.scheduleServiceVisit(ctx.asSystem.pg, {
          ...input,
          companyId: ctx.company.id,
          userId: ctx.auditUserId
        })
    );
  }
});

/**
 * Move a visit to its next status.
 *
 * @remarks
 * Stamps when it happened (travel started, arrived, completed); a completing
 * visit's `workComplete` completes the order. Then the order's status rolls
 * up. A user without `update: "service"` moves only a visit they are the
 * technician on.
 */
export const setServiceVisitStatus = defineServiceFn({
  input: z.object({
    serviceOrderId: z.string(),
    serviceVisitId: z.string(),
    status: z.enum(serviceVisitStatuses),
    workComplete: z.boolean()
  }),
  permission: { view: "service" },

  async run(ctx, input) {
    return service.attemptServiceOrder(
      ctx,
      "Failed to update the visit",
      async () => {
        await service.setServiceVisitStatus(ctx.asSystem.pg, {
          ...input,
          companyId: ctx.company.id,
          userId: ctx.auditUserId,
          technicianId: ctx.can({ update: "service" })
            ? undefined
            : ctx.auditUserId
        });
        return { serviceVisitId: input.serviceVisitId };
      }
    );
  }
});

/**
 * Save the customer's signature on a visit.
 *
 * @remarks
 * Uploads the PNG to `${companyId}/service/${orderId}/${visitId}/signature.png`
 * in the company's private bucket, then stores its path and the signer's
 * name. A user without `update: "service"` signs only their own open visit.
 */
export const signServiceVisit = defineServiceFn({
  input: z.object({
    serviceOrderId: z.string(),
    serviceVisitId: z.string(),
    signature: z.instanceof(File),
    signedByName: z.string()
  }),
  permission: { view: "service" },

  async run(ctx, { serviceOrderId, serviceVisitId, signature, signedByName }) {
    if (signature.size === 0) {
      return ctx.error("validation", "Sign before you save");
    }
    if (
      signature.type !== "image/png" ||
      signature.size > MAX_SIGNATURE_BYTES
    ) {
      return ctx.error("validation", "The signature must be a PNG image");
    }
    if (!signedByName.trim()) {
      return ctx.error("validation", "Enter the name of the person who signed");
    }

    const access = await service.attemptServiceOrder(
      ctx,
      "Failed to save the signature",
      () =>
        service.requireServiceVisitAccess(ctx, {
          serviceOrderId,
          serviceVisitId
        })
    );
    if (access instanceof CarbonError) return access;

    const companyId = ctx.company.id;
    const signaturePath = `${companyId}/service/${serviceOrderId}/${serviceVisitId}/signature.png`;
    const upload = await storage(ctx.asCaller.supabase)
      .company(companyId)
      .upload(signaturePath, signature, {
        contentType: "image/png",
        upsert: true
      });
    if (upload.error) {
      return ctx.error(
        "internal",
        "Failed to upload the signature",
        upload.error
      );
    }

    const update = await service.updateServiceVisit(ctx.asCaller.supabase, {
      id: serviceVisitId,
      serviceOrderId,
      companyId,
      updatedBy: ctx.auditUserId,
      signaturePath,
      signedByName: signedByName.trim()
    });
    if (update.error) {
      return ctx.error(
        "internal",
        "Failed to save the signature",
        update.error
      );
    }
    return { serviceVisitId };
  }
});

/**
 * Save a visit's notes.
 *
 * @remarks
 * A user without `update: "service"` saves only their own open visit.
 */
export const updateServiceVisitNotes = defineServiceFn({
  input: z.object({
    serviceOrderId: z.string(),
    serviceVisitId: z.string(),
    notes: z.custom<Json>()
  }),
  permission: { view: "service" },

  async run(ctx, { serviceOrderId, serviceVisitId, notes }) {
    const access = await service.attemptServiceOrder(
      ctx,
      "Failed to save the notes",
      () =>
        service.requireServiceVisitAccess(ctx, {
          serviceOrderId,
          serviceVisitId
        })
    );
    if (access instanceof CarbonError) return access;

    const update = await service.updateServiceVisit(ctx.asCaller.supabase, {
      id: serviceVisitId,
      serviceOrderId,
      companyId: ctx.company.id,
      updatedBy: ctx.auditUserId,
      notes
    });
    if (update.error) {
      return ctx.error("internal", "Failed to save the notes", update.error);
    }
    return { serviceVisitId };
  }
});

// --- Work ------------------------------------------------------------------------

/**
 * Set or remove the fixed price of a node of a service order's work tree.
 *
 * @remarks
 * The invoice bills a fixed-price node as one line at its price. Refused on
 * a Closed or Cancelled order.
 */
export const updateServiceNodeFixedPrice = defineServiceFn({
  input: serviceNodeFixedPriceValidator.safeExtend({
    serviceOrderId: z.string(),
    elementId: z.string()
  }),
  permission: { update: "service" },

  async run(ctx, { serviceOrderId, elementId, fixedPrice }) {
    const order = await service.attemptServiceOrder(
      ctx,
      "Failed to save the fixed price",
      () =>
        service.requireOpenServiceOrder(ctx.asCaller.supabase, {
          companyId: ctx.company.id,
          serviceOrderId
        })
    );
    if (order instanceof CarbonError) return order;

    const update = await service.updateServiceNodeFixedPrice(
      ctx.asCaller.supabase,
      {
        projectId: order.projectId,
        elementId,
        fixedPrice: fixedPrice ?? null,
        companyId: ctx.company.id,
        updatedBy: ctx.auditUserId
      }
    );
    if (update.error) {
      return ctx.error(
        "internal",
        "Failed to save the fixed price",
        update.error
      );
    }
    return { elementId };
  }
});

/**
 * Build a service order's work tree from a template, a serial or an item.
 *
 * @remarks
 * Creates the planned nodes, with their plan lines, under the chosen parent
 * (`buildElementsFromPart`). Refused on a Closed or Cancelled order. Returns
 * how many nodes it created and how many lines it skipped.
 */
export const buildServiceOrderWork = defineServiceFn({
  input: buildFromPartValidator.safeExtend({ serviceOrderId: z.string() }),
  permission: { update: "service" },

  async run(ctx, { serviceOrderId, ...build }) {
    return service.attemptServiceOrder(
      ctx,
      "The elements could not be created",
      async () => {
        const order = await service.requireOpenServiceOrder(
          ctx.asCaller.supabase,
          { companyId: ctx.company.id, serviceOrderId }
        );
        return projects.buildElementsFromPart(
          ctx.asCaller.supabase,
          ctx.asSystem.pg,
          {
            ...service.serviceBuildArgs(build, ctx.company.id, order.projectId),
            includePlanLines: true,
            userId: ctx.auditUserId
          }
        );
      },
      service.serviceWorkRefusal
    );
  }
});

/**
 * Add an element to a service order's or a service template's work.
 *
 * @remarks
 * The service twin of a project's new element, under the service
 * permission: a System or a Task, under a parent of the same work.
 */
export const addServiceWorkElement = defineServiceFn({
  input: projectElementValidator.safeExtend({ projectId: z.string() }),
  permission: { update: "service" },

  async run(ctx, { projectId, id: _id, ...element }) {
    if (!(serviceNodeTypes as readonly string[]).includes(element.type)) {
      return ctx.error("validation", "Add a System or a Task");
    }
    return service.attemptServiceOrder(
      ctx,
      "Failed to add the element",
      async () => {
        await service.requireServiceWork(ctx.asCaller.supabase, {
          companyId: ctx.company.id,
          projectId,
          elementIds: element.parentId ? [element.parentId] : []
        });
        const created = await projects.insertProjectElement(ctx.asSystem.pg, {
          ...element,
          projectId,
          companyId: ctx.company.id,
          userId: ctx.auditUserId
        });
        return { id: created.id, readableId: created.readableId };
      },
      service.serviceWorkRefusal
    );
  }
});

/**
 * Delete an element of a service order's or a service template's work, and
 * everything below it.
 *
 * @remarks
 * An element with charges cannot be deleted. Returns the page the work lives
 * on.
 */
export const deleteServiceWorkElement = defineServiceFn({
  input: z.object({ projectId: z.string(), elementId: z.string() }),
  permission: { update: "service" },

  async run(ctx, { projectId, elementId }) {
    const work = await service.attemptServiceOrder(
      ctx,
      "Failed to delete",
      () =>
        service.requireServiceWork(ctx.asCaller.supabase, {
          companyId: ctx.company.id,
          projectId,
          elementIds: [elementId]
        }),
      service.serviceWorkRefusal
    );
    if (work instanceof CarbonError) return work;

    const result = await projects.deleteProjectElement(
      ctx.asCaller.supabase,
      elementId,
      ctx.company.id
    );
    if (result.error) {
      return ctx.error(
        "rule",
        result.error.message || "Failed to delete",
        result.error
      );
    }
    return { workPath: work.workPath };
  }
});

/**
 * Move an element of a service order's or a service template's work.
 *
 * @remarks
 * Puts `elementId` under `parentId` (null for the top level), after its new
 * last sibling; with `order`, then saves the new siblings' order (a drop
 * between two rows of the tree).
 */
export const moveServiceWorkElement = defineServiceFn({
  input: z.object({
    projectId: z.string(),
    elementId: z.string(),
    parentId: z.string().nullable(),
    order: orderedIds
  }),
  permission: { update: "service" },

  async run(ctx, { projectId, elementId, parentId, order }) {
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;
    return service.attemptServiceOrder(
      ctx,
      "Failed to move the element",
      async () => {
        await service.requireServiceWork(ctx.asCaller.supabase, {
          companyId,
          projectId,
          elementIds: [
            ...new Set([
              elementId,
              ...(parentId ? [parentId] : []),
              ...order.map((u) => u.id)
            ])
          ]
        });
        const sortOrder = await service.nextServiceElementSortOrder(
          ctx.asCaller.supabase,
          { companyId, projectId, parentId }
        );
        await projects.moveProjectElement(ctx.asSystem.pg, {
          companyId,
          userId,
          projectId,
          elementId,
          parentId,
          sortOrder
        });
        if (order.length > 0) {
          await projects.updateProjectElementOrder(
            ctx.asSystem.pg,
            companyId,
            userId,
            projectId,
            order
          );
        }
        return { elementId };
      },
      service.serviceWorkRefusal
    );
  }
});

/** Save the sort order of sibling elements of a service order's or a service template's work. */
export const orderServiceWorkElements = defineServiceFn({
  input: z.object({ projectId: z.string(), updates: orderedIds }),
  permission: { update: "service" },

  async run(ctx, { projectId, updates }) {
    if (updates.length === 0) return { count: 0 };
    return service.attemptServiceOrder(
      ctx,
      "Failed to save the order",
      async () => {
        await service.requireServiceWork(ctx.asCaller.supabase, {
          companyId: ctx.company.id,
          projectId,
          elementIds: updates.map((u) => u.id)
        });
        await projects.updateProjectElementOrder(
          ctx.asSystem.pg,
          ctx.company.id,
          ctx.auditUserId,
          projectId,
          updates
        );
        return { count: updates.length };
      }
    );
  }
});

/**
 * Save one field on one or more elements of a service order's or a service
 * template's work.
 *
 * @remarks
 * The fields a service element shows: no milestone, WBS, budget or flags.
 */
export const updateServiceWorkElements = defineServiceFn({
  input: projectElementFieldUpdateValidator.safeExtend({
    projectId: z.string()
  }),
  permission: { update: "service" },

  async run(ctx, { projectId, ids, field, value }) {
    if (!SERVICE_ELEMENT_FIELDS.has(field)) {
      return ctx.error("validation", "Invalid form data");
    }
    const work = await service.attemptServiceOrder(
      ctx,
      "Failed to save the change",
      () =>
        service.requireServiceWork(ctx.asCaller.supabase, {
          companyId: ctx.company.id,
          projectId,
          elementIds: ids
        })
    );
    if (work instanceof CarbonError) return work;

    const result = await projects.updateProjectElementField(
      ctx.asCaller.supabase,
      {
        ids,
        field,
        value,
        companyId: ctx.company.id,
        updatedBy: ctx.auditUserId
      }
    );
    if (result.error) {
      return ctx.error(
        "rule",
        result.error.message || "Failed to save the change",
        result.error
      );
    }
    return { ids };
  }
});

/** Replace the labels of one element of a service order's or a service template's work. */
export const setServiceWorkElementLabels = defineServiceFn({
  input: z.object({
    projectId: z.string(),
    projectElementId: z.string(),
    labelIds: z.array(z.string())
  }),
  permission: { update: "service" },

  async run(ctx, { projectId, projectElementId, labelIds }) {
    const work = await service.attemptServiceOrder(
      ctx,
      "Failed to save the change",
      () =>
        service.requireServiceWork(ctx.asCaller.supabase, {
          companyId: ctx.company.id,
          projectId,
          elementIds: [projectElementId]
        })
    );
    if (work instanceof CarbonError) return work;

    const result = await projects.setProjectElementLabels(
      ctx.asCaller.supabase,
      {
        projectElementId,
        labelIds,
        companyId: ctx.company.id,
        createdBy: ctx.auditUserId
      }
    );
    if (result.error) {
      return ctx.error("internal", "Failed to save the labels", result.error);
    }
    return { projectElementId };
  }
});

// --- Work plan lines -------------------------------------------------------------

/**
 * Add or edit a part on an element of a service order's or a service
 * template's work.
 *
 * @remarks
 * With an `id`, the line must be on the element. Returns the line's id.
 */
export const upsertServiceWorkMaterial = defineServiceFn({
  input: projectElementMaterialValidator.safeExtend({ projectId: z.string() }),
  permission: { update: "service" },

  async run(ctx, { projectId, id, ...line }) {
    const companyId = ctx.company.id;
    const checked = await service.attemptServiceOrder(
      ctx,
      "Failed to save the part",
      () =>
        service.requireServicePlanLineAccess(ctx.asCaller.supabase, {
          companyId,
          projectId,
          projectElementId: line.projectElementId,
          table: "projectElementMaterial",
          lineId: id
        }),
      service.serviceWorkRefusal
    );
    if (checked instanceof CarbonError) return checked;

    const result = id
      ? await projects.upsertProjectElementMaterial(ctx.asCaller.supabase, {
          ...line,
          id,
          companyId,
          updatedBy: ctx.auditUserId
        })
      : await projects.upsertProjectElementMaterial(ctx.asCaller.supabase, {
          ...line,
          projectId,
          companyId,
          createdBy: ctx.auditUserId
        });
    if (result.error) {
      return ctx.error("internal", "Failed to save the part", result.error);
    }
    return { id: result.data?.id ?? null };
  }
});

/**
 * Add or edit labor on an element of a service order's or a service
 * template's work.
 *
 * @remarks
 * With an `id`, the line must be on the element. Returns the line's id.
 */
export const upsertServiceWorkLabor = defineServiceFn({
  input: projectElementLaborValidator.safeExtend({ projectId: z.string() }),
  permission: { update: "service" },

  async run(ctx, { projectId, id, ...line }) {
    const companyId = ctx.company.id;
    const checked = await service.attemptServiceOrder(
      ctx,
      "Failed to save the labor",
      () =>
        service.requireServicePlanLineAccess(ctx.asCaller.supabase, {
          companyId,
          projectId,
          projectElementId: line.projectElementId,
          table: "projectElementLabor",
          lineId: id
        }),
      service.serviceWorkRefusal
    );
    if (checked instanceof CarbonError) return checked;

    const result = id
      ? await projects.upsertProjectElementLabor(ctx.asCaller.supabase, {
          ...line,
          id,
          companyId,
          updatedBy: ctx.auditUserId
        })
      : await projects.upsertProjectElementLabor(ctx.asCaller.supabase, {
          ...line,
          projectId,
          companyId,
          createdBy: ctx.auditUserId
        });
    if (result.error) {
      return ctx.error("internal", "Failed to save the labor", result.error);
    }
    return { id: result.data?.id ?? null };
  }
});

/**
 * Add or edit an other cost on an element of a service order's or a service
 * template's work.
 *
 * @remarks
 * With an `id`, the line must be on the element. Returns the line's id.
 */
export const upsertServiceWorkCost = defineServiceFn({
  input: projectElementCostValidator.safeExtend({ projectId: z.string() }),
  permission: { update: "service" },

  async run(ctx, { projectId, id, ...line }) {
    const companyId = ctx.company.id;
    const checked = await service.attemptServiceOrder(
      ctx,
      "Failed to save the cost",
      () =>
        service.requireServicePlanLineAccess(ctx.asCaller.supabase, {
          companyId,
          projectId,
          projectElementId: line.projectElementId,
          table: "projectElementCost",
          lineId: id
        }),
      service.serviceWorkRefusal
    );
    if (checked instanceof CarbonError) return checked;

    const result = id
      ? await projects.upsertProjectElementCost(ctx.asCaller.supabase, {
          ...line,
          id,
          companyId,
          updatedBy: ctx.auditUserId
        })
      : await projects.upsertProjectElementCost(ctx.asCaller.supabase, {
          ...line,
          projectId,
          companyId,
          createdBy: ctx.auditUserId
        });
    if (result.error) {
      return ctx.error("internal", "Failed to save the cost", result.error);
    }
    return { id: result.data?.id ?? null };
  }
});

/** Delete a plan line (a part, labor or an other cost) of an element of a service order's or a service template's work. */
export const deleteServiceWorkPlanLine = defineServiceFn({
  input: z.object({
    projectId: z.string(),
    projectElementId: z.string(),
    table: z.enum(servicePlanTables),
    lineId: z.string().min(1, { message: "No line was given" })
  }),
  permission: { update: "service" },

  async run(ctx, { projectId, projectElementId, table, lineId }) {
    const companyId = ctx.company.id;
    const checked = await service.attemptServiceOrder(
      ctx,
      "Failed to delete the line",
      () =>
        service.requireServicePlanLineAccess(ctx.asCaller.supabase, {
          companyId,
          projectId,
          projectElementId,
          table,
          lineId
        }),
      service.serviceWorkRefusal
    );
    if (checked instanceof CarbonError) return checked;

    const remove =
      table === "projectElementMaterial"
        ? projects.deleteProjectElementMaterial
        : table === "projectElementLabor"
          ? projects.deleteProjectElementLabor
          : projects.deleteProjectElementCost;
    const result = await remove(ctx.asCaller.supabase, lineId, companyId);
    if (result.error) {
      return ctx.error("internal", "Failed to delete the line", result.error);
    }
    return { lineId };
  }
});

// --- Work comments ---------------------------------------------------------------

/** Comment on an element of a service order's or a service template's work. */
export const addServiceWorkComment = defineServiceFn({
  input: projectElementCommentValidator,
  permission: { view: "service" },

  async run(ctx, input) {
    const result = await projects.insertProjectElementComment(
      ctx.asCaller.supabase,
      { ...input, companyId: ctx.company.id, createdBy: ctx.auditUserId }
    );
    if (result.error) {
      return ctx.error("internal", "Failed to add the comment", result.error);
    }
    return { projectElementId: input.projectElementId };
  }
});

/** Delete one of the user's own comments on a service element. */
export const deleteServiceWorkComment = defineServiceFn({
  input: z.object({
    id: z.string().min(1, { message: "No comment was given" })
  }),
  permission: { view: "service" },

  async run(ctx, { id }) {
    const result = await projects.deleteProjectElementComment(
      ctx.asCaller.supabase,
      id,
      ctx.company.id,
      ctx.auditUserId
    );
    if (result.error) {
      return ctx.error(
        "rule",
        result.error.message || "Failed to delete",
        result.error
      );
    }
    return { id };
  }
});
