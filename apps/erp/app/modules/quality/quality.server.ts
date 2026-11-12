// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { raisedMessage } from "@carbon/api/errors";
import { rejectInspectionInput } from "@carbon/api/postings";
import { CarbonError, defineServiceFn } from "@carbon/api/service-fn.server";
import { paged, payload, run, unwrap } from "@carbon/api/service-tools.server";
import { getCompanyTimeZone } from "@carbon/database";
import * as engine from "@carbon/database/quality";
import { approvalDecisionValidator } from "@carbon/ee/approvals";
import {
  cancelPendingApprovals,
  decideApprovalRequest
} from "@carbon/ee/approvals/document.server";
import {
  notifyIssueCreated,
  notifyIssueStatusChanged,
  notifyTaskStatusChanged
} from "@carbon/ee/notifications";
import { isUnsafeStoragePath, storage } from "@carbon/files";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import { NotificationEvent } from "@carbon/notifications";
import {
  async,
  datetime,
  EPSILON,
  NOT_APPLIED_CODE,
  pick,
  pluckUnique,
  requireAffected,
  round,
  unchecked
} from "@carbon/utils";
import { z } from "zod";
import { zfd } from "zod-form-data";
import {
  isModelUploadPath,
  updateChangeNotice
} from "~/modules/items/items.service";
import {
  deletePurchaseReturnOrder,
  insertPurchaseReturnOrder,
  setPurchaseReturnOrderLineTrackedEntities,
  upsertPurchaseReturnOrderLine
} from "~/modules/purchasing/purchasing.service";
import { optionalTiptapDoc } from "~/modules/shared/shared.models";
import { refuseUnlessOwned } from "~/modules/shared/shared.service";
import { updateSortOrder } from "~/modules/shared/sort-order";
import { ERP_URL, path } from "~/utils/path";
import {
  disposition,
  inspectionDocumentParametersValidator,
  inspectionDocumentSamplingValidator,
  inspectionSaveAnchorsPayloadValidator,
  inspectionSaveBalloonsGeometryPayloadValidator,
  inspectionSaveBalloonsPayloadValidator,
  inspectionSaveFeaturesPayloadValidator,
  isIssueLocked,
  issueAssociationValidator,
  issueValidator,
  nonConformanceStatus,
  nonConformanceTaskStatus,
  qualityDocumentStatus,
  riskRegisterValidator
} from "./quality.models";
import type {
  InspectionSaveBalloonsGeometryPayload,
  InspectionSaveFeaturesPayload
} from "./quality.service";
import * as service from "./quality.service";

const logger = getLogger("erp", "quality");

// ---------------------------------------------------------------------------
// Operations (`defineServiceFn`): what the routes, the API and MCP all run
// ---------------------------------------------------------------------------

/** Custom field values, as `setCustomFields` reads them off a form. */
const customFieldValues = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean()])
);
// --- Issues -----------------------------------------------------------------

/**
 * Open an issue (non-conformance).
 *
 * @remarks
 * Every record the issue names (location, type, workflow, required actions,
 * items, customer, supplier, `trackedEntityIds`) must be the company's, or nothing is
 * created. The issue is inserted, the tracked entities are linked to it, and
 * an issue filed against a job operation links the lot that operation's make
 * method produced onto the item's disposition row. Each linked unit still in
 * stock goes onto its item's disposition row, so Scrap or Use As Is acts on
 * it. The issue's action and approval
 * tasks are then created; when that fails the issue is deleted again. The
 * company's integrations are told. With `changeOrderId` the new issue is
 * linked onto that change notice; a failed link comes back as `warning`.
 *
 * @mcp
 */
export const createIssue = defineServiceFn({
  input: issueValidator.extend({
    customFields: customFieldValues.optional(),
    trackedEntityIds: z.array(z.string()).optional(),
    changeOrderId: z.string().optional()
  }),
  permission: { create: "quality" },

  async run(ctx, input) {
    const client = ctx.asCaller.supabase;
    const serviceRole = ctx.asSystem.supabase;
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;
    const trackedEntityIds = [
      ...new Set((input.trackedEntityIds ?? []).filter(Boolean))
    ];

    // insertIssue writes through the service role, and every id below comes
    // from the caller — each lands in this company's issue as a reference
    // whose single-column FK accepts another company's row. One scoped read
    // per table; a miss refuses the whole create.
    const refs: [string, string[]][] = [
      ["location", [input.locationId]],
      ["nonConformanceType", [input.nonConformanceTypeId]],
      [
        "nonConformanceWorkflow",
        input.nonConformanceWorkflowId ? [input.nonConformanceWorkflowId] : []
      ],
      [
        "nonConformanceRequiredAction",
        [...new Set(input.requiredActionIds ?? [])]
      ],
      ["item", [...new Set(input.items ?? [])]],
      ["customer", input.customerId ? [input.customerId] : []],
      ["supplier", input.supplierId ? [input.supplierId] : []],
      ["trackedEntity", trackedEntityIds]
    ];
    const owned = await Promise.all(
      refs.map(async ([table, ids]) => {
        if (ids.length === 0) return true;
        const rows = await serviceRole
          .from(table as "location")
          .select("id")
          .in("id", ids)
          .eq("companyId", companyId);
        return !rows.error && (rows.data ?? []).length === ids.length;
      })
    );
    if (owned.some((ok) => !ok)) {
      logger.error("Issue references records outside the company", {
        companyId,
        refs: refs.filter((_, index) => !owned[index])
      });
      return ctx.error("notFound", "Failed to insert issue");
    }

    const created = await service.insertIssue(serviceRole, {
      nonConformanceId: input.nonConformanceId || undefined,
      name: input.name,
      priority: input.priority,
      source: input.source,
      locationId: input.locationId,
      nonConformanceTypeId: input.nonConformanceTypeId,
      openDate: input.openDate,
      description: input.description,
      nonConformanceWorkflowId: input.nonConformanceWorkflowId,
      dueDate: input.dueDate,
      closeDate: input.closeDate,
      quantity: input.quantity,
      requiredActionIds: input.requiredActionIds,
      approvalRequirements: input.approvalRequirements,
      items: input.items,
      jobOperationId: input.jobOperationId,
      customerId: input.customerId,
      supplierId: input.supplierId,
      salesOrderLineId: input.salesOrderLineId,
      operationSupplierProcessId: input.operationSupplierProcessId,
      companyId,
      createdBy: userId,
      customFields: input.customFields
    });
    if (created.error || !created.data) {
      return ctx.error("internal", "Failed to insert issue", created.error);
    }
    const { id: issueId, nonConformanceId } = created.data;

    if (trackedEntityIds.length > 0) {
      try {
        await service.linkIssueTrackedEntities(ctx, {
          nonConformanceId: issueId,
          trackedEntityIds
        });
      } catch (err) {
        const removed = await service.deleteIssue(serviceRole, issueId);
        if (removed.error) {
          logger.error("Failed to remove an issue whose units did not link", {
            companyId,
            issueId,
            error: removed.error
          });
        }
        return ctx.error(
          "internal",
          "Failed to link the tracked entities to the issue",
          err
        );
      }
    }

    // An issue filed against a job operation: surface the tracked entity that
    // operation's make method produced onto a disposition row, so the MRB can
    // scrap / rework / use-as-is it at once.
    if (input.jobOperationId) {
      await service.linkJobOperationLot(ctx, {
        nonConformanceId: issueId,
        jobOperationId: input.jobOperationId
      });
    }

    const tasks = await service.createIssueTasks(ctx, issueId);
    if (tasks.error) {
      await service.deleteIssue(serviceRole, issueId);
      return ctx.error("internal", "Failed to create tasks", tasks.error);
    }

    await service.notifyIssue(
      ctx,
      (integrations) =>
        notifyIssueCreated({ client, serviceRole }, integrations, {
          companyId,
          userId,
          carbonUrl: `${ERP_URL}${path.to.issue(issueId)}`,
          issue: {
            id: issueId,
            nonConformanceId,
            title: input.name,
            description: input.description ?? "",
            severity: input.priority
          }
        }),
      "Failed to send notifications"
    );

    // Created from a change notice's "Linked Issue" combobox: link the new
    // issue back onto it. The caller's client is RLS-scoped, so it only lands
    // if they can edit the change notice.
    let warning: string | null = null;
    if (input.changeOrderId) {
      const linked = await updateChangeNotice(client, {
        id: input.changeOrderId,
        companyId,
        nonConformanceId: issueId,
        updatedBy: userId
      });
      if (linked.error) {
        logger.error("Failed to link the issue to the change notice", {
          error: linked.error
        });
        warning = "Issue created but failed to link to change notice";
      }
    }

    return { id: issueId, nonConformanceId, warning };
  }
});
const issueArrayFields = ["requiredActionIds", "approvalRequirements"] as const;

/**
 * Set one field on one or more issues.
 *
 * @remarks
 * Refused when any of the issues is closed. `requiredActionIds` and
 * `approvalRequirements` take a comma-separated list, which replaces the
 * issue's; the issue's tasks are then reconciled to it (MRB seeds the
 * Engineering and Quality reviewers, removing it deletes them). An empty
 * value clears any other field.
 *
 * @mcp
 */
export const updateIssueField = defineServiceFn({
  input: z.object({
    ids: zfd.repeatableOfType(z.string().min(1)),
    field: z.enum([
      ...issueArrayFields,
      "source",
      "priority",
      "name",
      "description",
      "locationId",
      "nonConformanceTypeId",
      "openDate",
      "dueDate",
      "closeDate",
      "quantity"
    ]),
    // A list field takes a list, or the form's comma-separated text.
    value: z.union([z.string(), z.array(z.string())]).nullish()
  }),
  permission: { update: "quality" },

  async run(ctx, { ids, field, value }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const issues = await client
      .from("nonConformance")
      .select("id, status")
      .in("id", ids)
      .eq("companyId", companyId);
    if (issues.error) {
      return ctx.error("internal", "Failed to update issue", issues.error);
    }
    if (issues.data.some((issue) => isIssueLocked(issue.status))) {
      return ctx.error("rule", service.issueLocked);
    }

    const isArrayField = (issueArrayFields as readonly string[]).includes(
      field
    );
    const update = await client
      .from("nonConformance")
      .update(
        unchecked({
          [field]: isArrayField
            ? Array.isArray(value)
              ? value
              : value
                ? value.split(",")
                : []
            : (Array.isArray(value) ? value.join(",") : value) || null,
          updatedBy: ctx.auditUserId,
          updatedAt: datetime.timestamp()
        })
      )
      .in("id", ids)
      .eq("companyId", companyId);
    if (update.error) {
      return ctx.error("internal", "Failed to update issue", update.error);
    }

    if (isArrayField) {
      // A silent reconcile failure leaves the column and the task list
      // disagreeing. Only the issues the scoped read found are this
      // company's. Bounded: each call takes a pooled connection, and a bulk
      // edit can name hundreds of issues.
      const reconciled = await async.map(
        issues.data,
        ({ id }) => service.createIssueTasks(ctx, id),
        { concurrency: 4 }
      );
      const failed = reconciled.find((r) => r.error)?.error;
      if (failed) {
        return ctx.error("internal", "Failed to update issue tasks", failed);
      }
    }
    return { ids };
  }
});

/**
 * Start an issue (In Progress) or reopen it (Registered).
 *
 * @remarks
 * Closing is `completeIssue`, which posts the dispositions. Reopening a
 * closed issue whose dispositions posted inventory transactions is refused:
 * reversing posted value takes a correcting entry. The company's integrations
 * are told.
 *
 * @mcp
 */
export const setIssueStatus = defineServiceFn({
  input: z.object({
    id: z.string(),
    status: z.enum(nonConformanceStatus).exclude(["Closed"])
  }),
  permission: { update: "quality" },

  async run(ctx, { id, status }) {
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;
    const serviceRole = ctx.asSystem.supabase;

    // Read with the service role: itemLedger SELECT needs inventory or
    // accounting view, which a quality user may lack, so a caller read would
    // fail open.
    const current = await serviceRole
      .from("nonConformance")
      .select("status")
      .eq("id", id)
      .eq("companyId", companyId)
      .maybeSingle();
    if (current.error) {
      return ctx.error(
        "internal",
        "Failed to update issue status",
        current.error
      );
    }
    if (!current.data) return ctx.error("notFound", "Issue not found");
    if (current.data.status === "Closed") {
      const posted = await serviceRole
        .from("itemLedger")
        .select("id")
        .eq("documentType", "Non-Conformance")
        .eq("documentId", id)
        .eq("companyId", companyId)
        .limit(1);
      if (posted.error) {
        return ctx.error(
          "internal",
          "Failed to update issue status",
          posted.error
        );
      }
      if (posted.data.length > 0) {
        return ctx.error(
          "rule",
          "This NCR posted inventory transactions and can't be reopened. Create a correcting entry instead."
        );
      }
    }

    const update = await service.updateIssueStatus(ctx.asCaller.supabase, {
      id,
      companyId,
      status,
      assignee: undefined,
      closeDate: null,
      updatedBy: userId
    });
    if (update.error) {
      const refusal = raisedMessage(update.error);
      if (refusal) return ctx.error("rule", refusal, update.error);
      return ctx.error(
        "internal",
        "Failed to update issue status",
        update.error
      );
    }
    if (update.data.length === 0)
      return ctx.error("notFound", "Issue not found");

    await service.notifyIssue(
      ctx,
      (integrations) =>
        notifyIssueStatusChanged(
          { client: ctx.asCaller.supabase },
          integrations,
          {
            companyId,
            userId,
            carbonUrl: `${ERP_URL}${path.to.issue(id)}`,
            issue: { id, status, nonConformanceId: id, title: "" }
          }
        ),
      "Failed to send notifications"
    );
    return { id, status };
  }
});

/**
 * Complete an issue: post its dispositions and close it.
 *
 * @remarks
 * Every disposition row must be decided (not Pending), and the issue cannot
 * close while a linked supplier return is open. In one transaction the issue
 * is Closed with its close date stamped, the inventory value the dispositions
 * move (scrap and return write-offs, the restore of an inspection lot used as
 * is) posts through `post-nonconformance`, and the units change status; a
 * failure leaves the issue open. An NCR with a Partial receipt lot beside
 * another lot is refused, and so is a Partial untracked lot's NCR with no
 * disposition row for the lot's item. The company's integrations are told.
 *
 * @mcp
 */
export const completeIssue = defineServiceFn({
  input: z.object({ id: z.string() }),
  permission: { update: "quality" },

  async run(ctx, { id }) {
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;
    const result = await service.closeIssue(
      ctx.asSystem.supabase,
      ctx.asSystem.pg,
      {
        nonConformanceId: id,
        companyId,
        userId
      }
    );
    if (result.error) {
      return ctx.error(
        "rule",
        result.error.message ?? "Failed to close NCR",
        result.error
      );
    }

    await service.notifyIssue(
      ctx,
      (integrations) =>
        notifyIssueStatusChanged(
          { client: ctx.asCaller.supabase },
          integrations,
          {
            companyId,
            userId,
            carbonUrl: `${ERP_URL}${path.to.issue(id)}`,
            issue: { id, status: "Closed", nonConformanceId: id, title: "" }
          }
        ),
      "Failed to send close notifications"
    );
    return { id, warning: result.data.warning };
  }
});

const issueTaskType = z.enum(["investigation", "action", "approval", "review"]);

/**
 * Set the status of an issue's task: an action, approval or review.
 *
 * @remarks
 * Completing it stamps today (in the company's timezone) as its completed
 * date. The task is assigned to `assignee`, or to the caller when none is
 * given. The company's integrations are told.
 *
 * @mcp
 */
export const setIssueTaskStatus = defineServiceFn({
  input: z.object({
    id: z.string(),
    status: z.enum(nonConformanceTaskStatus),
    type: issueTaskType,
    assignee: z.string().nullish()
  }),
  permission: { update: "quality" },

  async run(ctx, { id, status, type, assignee }) {
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;
    const update = await service.updateIssueTaskStatus(ctx.asCaller.supabase, {
      id,
      status,
      type,
      assignee,
      userId
    });
    if (update.error) {
      return ctx.error("internal", "Failed to update status", update.error);
    }

    const issueId = update.data?.nonConformanceId;
    if (issueId) {
      await service.notifyIssue(
        ctx,
        (integrations) =>
          notifyTaskStatusChanged(
            { client: ctx.asCaller.supabase },
            integrations,
            {
              companyId,
              userId,
              carbonUrl: `${ERP_URL}${path.to.issue(issueId)}`,
              task: { id, status, issueId, title: "", type }
            }
          ),
        "Failed to sync task to Slack"
      );
    }
    return { id, status };
  }
});

/**
 * Assign an issue's action task to one of the issue's suppliers, or clear it.
 *
 * @remarks
 * The supplier must be the company's. An empty `supplierId` clears it.
 *
 * @mcp
 */
export const setIssueTaskSupplier = defineServiceFn({
  input: z.object({ id: z.string(), supplierId: z.string().nullish() }),
  permission: { update: "quality" },

  async run(ctx, { id, supplierId }) {
    if (supplierId) {
      const owned = await refuseUnlessOwned(ctx, "supplier", {
        id: supplierId
      });
      if (owned) return owned;
    }
    const result = await ctx.asCaller.supabase
      .from("nonConformanceActionTask")
      .update({ supplierId: supplierId || null, updatedBy: ctx.auditUserId })
      .eq("id", id)
      .eq("companyId", ctx.company.id)
      .select("id")
      .maybeSingle();
    if (result.error) {
      return ctx.error(
        "internal",
        "Failed to update task supplier",
        result.error
      );
    }
    if (!result.data) return ctx.error("notFound", "Task not found");
    return { id };
  }
});

/**
 * Set or clear the due date of an issue's action task.
 *
 * @mcp
 */
export const setIssueActionDueDate = defineServiceFn({
  input: z.object({ id: z.string(), dueDate: z.string().nullish() }),
  permission: { update: "quality" },

  async run(ctx, { id, dueDate }) {
    const { error } = await requireAffected(
      ctx.asCaller.supabase
        .from("nonConformanceActionTask")
        .update({ dueDate: dueDate || null })
        .eq("id", id)
        .eq("companyId", ctx.company.id)
        .select("id")
    );
    if (error) return ctx.error("internal", error.message, error);
    return { id };
  }
});

/**
 * Reorder an issue's action tasks: `updates` maps each task id to its new
 * position.
 *
 * @mcp
 */
export const reorderIssueActionTasks = defineServiceFn({
  input: z.object({ updates: z.record(z.string(), z.number()) }),
  permission: { update: "quality" },

  async run(ctx, { updates }) {
    const ids = Object.keys(updates);
    if (ids.length === 0) return { ids };
    const tasks = await ctx.asCaller.supabase
      .from("nonConformanceActionTask")
      .select("nonConformanceId")
      .in("id", ids)
      .eq("companyId", ctx.company.id);
    if (tasks.error) {
      return ctx.error("internal", "Failed to update sort order", tasks.error);
    }
    const [nonConformanceId, ...others] = pluckUnique(
      tasks.data,
      (task) => task.nonConformanceId
    );
    if (
      !nonConformanceId ||
      others.length > 0 ||
      tasks.data.length !== ids.length
    ) {
      return ctx.error("rule", "The tasks must belong to one issue");
    }

    await updateSortOrder(ctx.asSystem.pg, {
      table: "nonConformanceActionTask",
      column: "sortOrder",
      companyId: ctx.company.id,
      userId: ctx.auditUserId,
      parent: { column: "nonConformanceId", id: nonConformanceId },
      updates: Object.entries(updates).map(([id, sortOrder]) => ({
        id,
        sortOrder
      }))
    });
    return { ids };
  }
});

/**
 * Set a disposition row's disposition or quantity on an issue.
 *
 * @remarks
 * Refused when the issue is closed. `disposition` must be one the picker
 * offers. `quantity` must be zero or more, and is a compare-and-set on
 * `expectedQuantity` (the quantity the caller last saw): a stale value
 * changes nothing. A row with tracked-entity links (its quantity is their
 * sum), or on an issue opened from an inspection, refuses a quantity.
 *
 * @mcp
 */
export const updateIssueItemField = defineServiceFn({
  input: z.discriminatedUnion("field", [
    z.object({
      id: z.string(),
      field: z.literal("disposition"),
      value: z.enum(disposition)
    }),
    z.object({
      id: z.string(),
      field: z.literal("quantity"),
      value: z.number().min(0, "Quantity must be zero or more"),
      expectedQuantity: z.number()
    })
  ]),
  permission: { update: "quality" },

  async run(ctx, input) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const parent = await client
      .from("nonConformanceItem")
      .select("nonConformance(status)")
      .eq("id", input.id)
      .eq("companyId", companyId)
      .single();
    // Without this, an update against a missing row matches nothing and
    // still reports success.
    if (parent.error || !parent.data) {
      return ctx.error("notFound", "Issue item not found");
    }
    if (isIssueLocked(parent.data.nonConformance?.status)) {
      return ctx.error("rule", service.issueLocked);
    }

    if (input.field === "quantity") {
      const result = await service.updateIssueItemQuantity(ctx.asSystem.pg, {
        id: input.id,
        companyId,
        userId: ctx.auditUserId,
        quantity: input.value,
        expectedQuantity: input.expectedQuantity
      });
      if (result.error) return ctx.error("rule", result.error.message);
      return { id: input.id };
    }

    const update = await requireAffected(
      client
        .from("nonConformanceItem")
        .update({
          disposition: input.value,
          updatedBy: ctx.auditUserId,
          updatedAt: datetime.timestamp()
        })
        .eq("id", input.id)
        .eq("companyId", companyId)
        .select("id")
    );
    if (update.error) {
      return ctx.error("internal", "Failed to update issue item", update.error);
    }
    return { id: input.id };
  }
});
const associatedRecordTable = {
  items: "item",
  customers: "customer",
  suppliers: "supplier",
  trackedEntities: "trackedEntity"
} as const;

/**
 * Associate a record with an issue: an item, customer, supplier, tracked
 * entity or inspection, or a line of a job (operation), purchase order, sales
 * order, shipment, receipt or return order.
 *
 * @remarks
 * Refused when the issue is closed. A line association needs `lineId`, the
 * line on the document `id`. A job operation also adds the job's item and the
 * tracked entities its make method produced. An inspection links the whole
 * lot (its samples, and every entity of its receipt line) and seeds the
 * item's disposition row with it, under the issue lock.
 *
 * @mcp
 */
export const createIssueAssociation = defineServiceFn({
  input: issueAssociationValidator.safeExtend({ nonConformanceId: z.string() }),
  permission: { update: "quality" },

  async run(ctx, { nonConformanceId, type, id, lineId, quantity }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;
    const failed = (noun: string, cause?: unknown) => {
      logger.error("Failed to create association", { error: cause });
      return ctx.error("internal", `Failed to create issue ${noun}`, cause);
    };

    const issue = await client
      .from("nonConformance")
      .select("status")
      .eq("id", nonConformanceId)
      .eq("companyId", companyId)
      .maybeSingle();
    if (issue.error) return failed("association", issue.error);
    if (!issue.data) return ctx.error("notFound", "Issue not found");
    if (isIssueLocked(issue.data.status)) {
      return ctx.error("rule", service.issueLocked);
    }

    // These link tables' foreign keys take any company's row.
    if (Object.hasOwn(associatedRecordTable, type)) {
      const linked =
        associatedRecordTable[type as keyof typeof associatedRecordTable];
      const owned = await refuseUnlessOwned(ctx, linked, { id });
      if (owned) return owned;
    }

    const audit = { nonConformanceId, companyId, createdBy: userId };

    switch (type) {
      case "items": {
        const { error } = await client
          .from("nonConformanceItem")
          .insert({ ...audit, itemId: id, quantity: quantity ?? 0 });
        if (error) return failed("item", error);
        break;
      }
      case "customers": {
        const { error } = await client
          .from("nonConformanceCustomer")
          .insert({ ...audit, customerId: id });
        if (error) return failed("customer", error);
        break;
      }
      case "suppliers": {
        const { error } = await client
          .from("nonConformanceSupplier")
          .insert({ ...audit, supplierId: id });
        if (error) return failed("supplier", error);
        break;
      }
      case "trackedEntities": {
        const { error } = await client
          .from("nonConformanceTrackedEntity")
          .insert({ ...audit, trackedEntityId: id });
        if (error) return failed("tracked entity");
        break;
      }
      case "inspections": {
        const linked = await service.linkInspectionToIssue(ctx, {
          nonConformanceId,
          inspectionId: id
        });
        if (!linked.ok) {
          return linked.refusal
            ? ctx.error("rule", linked.refusal)
            : failed("inbound inspection");
        }
        break;
      }
      default: {
        const { table, readable, noun } = service.associationHeaders[type];
        let headerQuery = client
          .from(table as "job")
          .select(`id, ${readable}${table === "job" ? ", itemId" : ""}`)
          .eq("id", id);
        // The return orders were the only headers the route scoped; RLS
        // scopes the rest.
        if (table === "salesReturnOrder" || table === "purchaseReturnOrder") {
          headerQuery = headerQuery.eq("companyId", companyId);
        }
        const header = await headerQuery.single();
        if (header.error) return failed(noun, header.error);
        const row = header.data as unknown as Record<string, string | null>;

        const insert = await service.insertLineAssociation(ctx, type, {
          ...audit,
          lineId: lineId!,
          headerId: row.id!,
          readableId: row[readable] ?? null
        });
        if (insert.error) return failed(noun, insert.error);

        if (type === "jobOperations") {
          await service.linkJobOperationContext(ctx, {
            nonConformanceId,
            jobItemId: row.itemId ?? null,
            jobOperationId: lineId!
          });
        }
      }
    }

    return { nonConformanceId, type, id };
  }
});

/**
 * Draft a supplier return from an issue's Return to Supplier rows.
 *
 * @remarks
 * Refused for a closed issue and one with no Return to Supplier row. The
 * supplier is `supplierId`, else the issue's only supplier, else the only
 * supplier of its associated receipts; a tracked entity received from
 * another supplier refuses. Idempotent: quantities a linked return that is
 * not cancelled already covers are left out, and with nothing uncovered no
 * return is drafted (`created` false, `purchaseReturnOrderId` the newest
 * open linked return, if any). Each line is priced from the PO line of the
 * receipt it came in on. Each association row records the quantity it
 * covers, which closing the issue subtracts from its write-off. A failure
 * part-way deletes the draft again.
 *
 * @mcp
 */
export const draftIssueSupplierReturn = defineServiceFn({
  input: z.object({
    nonConformanceId: z.string(),
    supplierId: z.string().nullish()
  }),
  permission: { create: "purchasing" },

  async run(ctx, { nonConformanceId: id, supplierId: explicitSupplierId }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;

    const [issue, itemRows, issueSuppliers, receiptLineAssociations, existing] =
      await Promise.all([
        client
          .from("nonConformance")
          .select("id, nonConformanceId, status, locationId")
          .eq("id", id)
          .eq("companyId", companyId)
          .single(),
        client
          .from("nonConformanceItem")
          .select(
            "id, itemId, quantity, disposition, links:nonConformanceItemTrackedEntity(trackedEntityId, quantity, trackedEntity(id, status, attributes))"
          )
          .eq("nonConformanceId", id)
          .eq("companyId", companyId)
          .order("createdAt", { ascending: true }),
        client
          .from("nonConformanceSupplier")
          .select("supplierId")
          .eq("nonConformanceId", id)
          .eq("companyId", companyId),
        client
          .from("nonConformanceReceiptLine")
          .select("receiptLineId, receiptId")
          .eq("nonConformanceId", id)
          .eq("companyId", companyId),
        client
          .from("nonConformancePurchaseReturnOrderLine")
          .select(
            "quantity, purchaseReturnOrderId, purchaseReturnOrderLine(itemId, purchaseReturnOrder(id, status))"
          )
          .eq("nonConformanceId", id)
          .eq("companyId", companyId)
      ]);

    if (issue.error) {
      return ctx.error("notFound", "Failed to load issue", issue.error);
    }
    if (issue.data.status === "Closed") {
      return ctx.error("rule", "Issue is already closed");
    }

    const returnRows = (itemRows.data ?? []).filter(
      (row) => row.disposition === "Return to Supplier"
    );
    if (returnRows.length === 0) {
      return ctx.error(
        "rule",
        "No disposition rows are set to Return to Supplier"
      );
    }

    // Supplier: explicit choice → the single associated supplier → the
    // single supplier of the associated receipt lines' receipts.
    if (explicitSupplierId) {
      const supplier = await client
        .from("supplier")
        .select("id")
        .eq("id", explicitSupplierId)
        .eq("companyId", companyId)
        .maybeSingle();
      if (!supplier.data) return ctx.error("notFound", "Supplier not found");
    }
    let supplierId = explicitSupplierId ?? null;
    if (!supplierId) {
      const associated = [
        ...new Set((issueSuppliers.data ?? []).map((s) => s.supplierId))
      ];
      if (associated.length === 1) {
        supplierId = associated[0];
      } else if (associated.length === 0) {
        const receiptIds = [
          ...new Set(
            (receiptLineAssociations.data ?? [])
              .map((r) => r.receiptId)
              .filter(Boolean) as string[]
          )
        ];
        if (receiptIds.length > 0) {
          const receipts = await client
            .from("receipt")
            .select("id, supplierId")
            .in("id", receiptIds)
            .eq("companyId", companyId);
          const derived = [
            ...new Set(
              (receipts.data ?? []).map((r) => r.supplierId).filter(Boolean)
            )
          ];
          if (derived.length === 1) supplierId = derived[0];
        }
      }
    }
    if (!supplierId) {
      return ctx.error(
        "rule",
        "Could not resolve a single supplier — select one explicitly"
      );
    }

    // Tracked-entity provenance against the resolved supplier. Provenance is
    // the Receipt attribute (written by receipt tracking) resolved to that
    // receipt's supplier — nothing writes a Supplier attribute directly.
    const provenanceReceiptIds = [
      ...new Set(
        returnRows.flatMap((row) =>
          (row.links ?? [])
            .map(
              (link) =>
                (
                  (link.trackedEntity?.attributes ?? {}) as Record<
                    string,
                    unknown
                  >
                ).Receipt
            )
            .filter((value): value is string => typeof value === "string")
        )
      )
    ];
    if (provenanceReceiptIds.length > 0) {
      const provenanceReceipts = await client
        .from("receipt")
        .select("id, supplierId")
        .in("id", provenanceReceiptIds)
        .eq("companyId", companyId);
      const foreign = (provenanceReceipts.data ?? []).find(
        (receipt) => receipt.supplierId && receipt.supplierId !== supplierId
      );
      if (foreign) {
        return ctx.error(
          "rule",
          "A tracked entity on this issue was received from a different supplier"
        );
      }
    }

    // Idempotent coverage: quantities already owned by linked returns that are
    // not cancelled are left out, allocated per item across rows in createdAt
    // order.
    type CoverageRow = {
      quantity: number | null;
      purchaseReturnOrderId: string | null;
      purchaseReturnOrderLine: {
        itemId: string | null;
        purchaseReturnOrder: { id: string; status: string | null } | null;
      } | null;
    };
    const nonCancelled = ((existing.data ?? []) as CoverageRow[]).filter(
      (row) =>
        row.purchaseReturnOrderLine?.purchaseReturnOrder?.status !== "Cancelled"
    );
    const coverageByItem = new Map<string, number>();
    for (const row of nonCancelled) {
      const itemId = row.purchaseReturnOrderLine?.itemId;
      if (!itemId) continue;
      coverageByItem.set(
        itemId,
        (coverageByItem.get(itemId) ?? 0) + Number(row.quantity ?? 0)
      );
    }
    const coveredEntityIds = new Set<string>();
    const linkedReturnIds = [
      ...new Set(
        nonCancelled
          .map((r) => r.purchaseReturnOrderId)
          .filter(Boolean) as string[]
      )
    ];
    if (linkedReturnIds.length > 0) {
      const lines = await client
        .from("purchaseReturnOrderLine")
        .select("id")
        .in("purchaseReturnOrderId", linkedReturnIds)
        .eq("companyId", companyId);
      const lineIds = (lines.data ?? []).map((l) => l.id);
      if (lineIds.length > 0) {
        const picks = await client
          .from("purchaseReturnOrderLineTrackedEntity")
          .select("trackedEntityId")
          .in("purchaseReturnOrderLineId", lineIds)
          .eq("companyId", companyId);
        for (const p of picks.data ?? []) {
          coveredEntityIds.add(p.trackedEntityId);
        }
      }
    }

    const uncoveredRows: {
      row: (typeof returnRows)[number];
      quantity: number;
      entityIds: string[];
    }[] = [];
    for (const row of returnRows) {
      const coverage = coverageByItem.get(row.itemId) ?? 0;
      const rowQuantity = Number(row.quantity ?? 0);
      const offset = Math.min(rowQuantity, coverage);
      if (offset > 0) coverageByItem.set(row.itemId, coverage - offset);
      const uncovered = rowQuantity - offset;
      if (uncovered <= 0) continue;
      uncoveredRows.push({
        row,
        quantity: uncovered,
        entityIds: (row.links ?? [])
          .map((l) => l.trackedEntityId)
          .filter((entityId) => entityId && !coveredEntityIds.has(entityId))
      });
    }

    if (uncoveredRows.length === 0) {
      const openExisting = nonCancelled.find((r) =>
        ["Draft", "To Ship"].includes(
          r.purchaseReturnOrderLine?.purchaseReturnOrder?.status ?? ""
        )
      );
      return {
        created: false,
        purchaseReturnOrderId:
          openExisting?.purchaseReturnOrderLine?.purchaseReturnOrder?.id ?? null
      };
    }

    // Commercial linkage: receipt lines from this supplier for the uncovered
    // items (physical lineage) and their PO-line pricing.
    const receiptLineIds = [
      ...new Set(
        (receiptLineAssociations.data ?? [])
          .map((r) => r.receiptLineId)
          .filter(Boolean) as string[]
      )
    ];
    // Ordered by receivedQuantity desc, so each item anchors to the receipt
    // line with the most received quantity — the cap-governing link.
    const receiptLineByItem = new Map<
      string,
      { id: string; lineId: string | null }
    >();
    if (receiptLineIds.length > 0) {
      const receiptLines = await client
        .from("receiptLine")
        .select(
          "id, itemId, lineId, receivedQuantity, receipt!inner(supplierId)"
        )
        .in("id", receiptLineIds)
        .eq("companyId", companyId)
        .eq("receipt.supplierId", supplierId)
        .order("receivedQuantity", { ascending: false });
      for (const line of receiptLines.data ?? []) {
        if (line.itemId && !receiptLineByItem.has(line.itemId)) {
          receiptLineByItem.set(line.itemId, {
            id: line.id,
            lineId: line.lineId
          });
        }
      }
    }
    const poLineIds = [
      ...new Set(
        [...receiptLineByItem.values()]
          .map((l) => l.lineId)
          .filter(Boolean) as string[]
      )
    ];
    const poLineById = new Map<
      string,
      { unitPrice: number; conversionFactor: number }
    >();
    if (poLineIds.length > 0) {
      const poLines = await client
        .from("purchaseOrderLine")
        .select("id, supplierUnitPrice, conversionFactor")
        .in("id", poLineIds)
        .eq("companyId", companyId);
      for (const line of poLines.data ?? []) {
        poLineById.set(line.id, {
          // supplier currency — the return + credit memo are priced in it
          unitPrice: Number(line.supplierUnitPrice ?? 0),
          conversionFactor: Number(line.conversionFactor ?? 1)
        });
      }
    }

    // The draft return, its lines and picks, then the per-quantity ownership
    // rows.
    const serviceRole = ctx.asSystem.supabase;
    const orderDate = datetime
      .today(await getCompanyTimeZone(client, companyId))
      .toString();
    const returnOrder = await insertPurchaseReturnOrder(client, {
      supplierId,
      companyId,
      companyGroupId: ctx.company.groupId,
      createdBy: userId,
      orderDate,
      locationId: issue.data.locationId ?? undefined
    });
    if (returnOrder.error || !returnOrder.data) {
      return ctx.error(
        "internal",
        "Failed to create supplier return",
        returnOrder.error
      );
    }
    const purchaseReturnOrderId = returnOrder.data.id;
    const purchaseReturnOrderReadableId =
      returnOrder.data.purchaseReturnOrderId;

    // Compensating rollback for the chained writes below (they cannot share
    // one transaction because insertPurchaseReturnOrder allocates a sequence
    // via RPC). Deleting the order cascades to its lines, picks and coverage
    // rows. The delete's OWN result is checked: an orphan draft that survives
    // a failed rollback must be reported loudly, because its coverage rows
    // would make every later call under-draft.
    const rollback = async (message: string, cause: unknown) => {
      const deleted = await deletePurchaseReturnOrder(
        serviceRole,
        purchaseReturnOrderId
      );
      const suffix = deleted.error
        ? ` The draft return ${purchaseReturnOrderReadableId} could not be removed — delete it manually before retrying.`
        : "";
      return ctx.error("internal", `${message}${suffix}`, cause);
    };

    // Every line and its picks FIRST; the coverage rows LAST, in one batch,
    // once every line landed. A mid-loop failure whose compensating delete
    // also fails leaves a plain orphan draft, never coverage rows for a
    // half-built return — the idempotent re-run reads coverage to decide what
    // is already drafted, so premature coverage would under-draft forever.
    const createdLines: { lineId: string; quantity: number }[] = [];
    for (const { row, quantity, entityIds } of uncoveredRows) {
      const receiptLine = receiptLineByItem.get(row.itemId);
      const poLine = receiptLine?.lineId
        ? poLineById.get(receiptLine.lineId)
        : null;
      const unitPrice = poLine
        ? poLine.unitPrice / (poLine.conversionFactor || 1)
        : 0;

      const line = await upsertPurchaseReturnOrderLine(client, {
        purchaseReturnOrderId,
        itemId: row.itemId,
        quantity,
        unitPrice,
        receiptLineId: receiptLine?.id,
        purchaseOrderLineId: receiptLine?.lineId ?? undefined,
        companyId,
        createdBy: userId
      });
      if (line.error || !line.data) {
        return rollback("Failed to create return line", line.error);
      }

      if (entityIds.length > 0) {
        const picks = await setPurchaseReturnOrderLineTrackedEntities(
          client,
          line.data.id,
          companyId,
          entityIds,
          userId
        );
        if (picks.error) {
          return rollback("Failed to assign tracked entities", picks.error);
        }
      }
      createdLines.push({ lineId: line.data.id, quantity });
    }

    // Written with the service role by design: the bridge runs under
    // purchasing create, and this quality-side link is a system record of it.
    const associations = await serviceRole
      .from("nonConformancePurchaseReturnOrderLine")
      .insert(
        createdLines.map(({ lineId, quantity }) => ({
          nonConformanceId: id,
          purchaseReturnOrderLineId: lineId,
          purchaseReturnOrderId,
          purchaseReturnOrderReadableId,
          quantity,
          companyId,
          createdBy: userId
        }))
      );
    if (associations.error) {
      return rollback("Failed to link the supplier return", associations.error);
    }

    return { created: true, purchaseReturnOrderId };
  }
});

// --- Inspections --------------------------------------------------------------

/**
 * Create an inspection of specific tracked entities.
 *
 * @remarks
 * Every tracked entity must be of one item, Available or On Hold, and in no
 * other open inspection. The lot's size is the number of serials, or the
 * quantity the batches hold; its sampling comes from the inspection plan
 * (`inspectionDocumentId`), else every unit is inspected. Available entities
 * go On Hold until a sample verdict or the lot's disposition releases them
 * (Accept → Available) or rejects them (Reject → Rejected). The work center
 * and assignee say where and by whom it is done; the shop floor lists open
 * inspections by work center.
 *
 * @param trackedEntityIds - The serials or batches to inspect, all of one item.
 * @param inspectionDocumentId - The inspection plan to measure against.
 * @param workCenterId - Where the inspection is done.
 * @param assignee - The user who does it.
 *
 * @mcp
 */
export const createManualInspection = defineServiceFn({
  input: z.object({
    trackedEntityIds: z.array(z.string().min(1)).min(1),
    inspectionDocumentId: z.string().nullish(),
    workCenterId: z.string().nullish(),
    assignee: z.string().nullish(),
    notes: z.string().trim().max(2000).nullish()
  }),
  permission: { create: "quality" },

  async run(ctx, input) {
    const created = await engine.createManualInspection(ctx.asSystem.pg, {
      ...input,
      companyId: ctx.company.id,
      userId: ctx.auditUserId
    });
    if (created.error) {
      return ctx.error("rule", created.error.message, created.error);
    }
    return { id: created.data.id, inspectionId: created.data.inspectionId };
  }
});

/**
 * Delete a manual inspection that recorded nothing.
 *
 * @remarks
 * Refused once the inspection has a sample verdict, a reading, a gauge, a
 * disposition or a linked issue: cancel it instead. Its tracked entities
 * return to the status they had before the inspection.
 *
 * @mcp destructive
 */
export const deleteManualInspection = defineServiceFn({
  input: z.object({ inspectionId: z.string().min(1) }),
  permission: { delete: "quality" },

  async run(ctx, { inspectionId }) {
    const deleted = await engine.deleteManualInspection(ctx.asSystem.pg, {
      inspectionId,
      companyId: ctx.company.id
    });
    if (deleted.error) {
      return ctx.error("rule", deleted.error.message, deleted.error);
    }
    return { id: deleted.data.id };
  }
});

/**
 * Cancel an open manual inspection.
 *
 * @remarks
 * The inspection becomes Cancelled: it leaves the shop floor queue with no
 * verdict, and what it recorded stays as history. Its held tracked entities
 * return to the status they had before the inspection. Receipt and Job
 * Operation lots cannot be cancelled.
 *
 * @mcp
 */
export const cancelManualInspection = defineServiceFn({
  input: z.object({ inspectionId: z.string().min(1) }),
  permission: { update: "quality" },

  async run(ctx, { inspectionId }) {
    const cancelled = await engine.cancelManualInspection(ctx.asSystem.pg, {
      inspectionId,
      companyId: ctx.company.id,
      userId: ctx.auditUserId
    });
    if (cancelled.error) {
      return ctx.error("rule", cancelled.error.message, cancelled.error);
    }
    return { id: cancelled.data.id };
  }
});

/**
 * Reject a receipt or manual inspection lot, and open an issue for it.
 *
 * @remarks
 * Every tracked entity of the lot becomes Rejected and the lot Failed (ISO
 * 9001:2015 §8.7). Only a Receipt or Manual lot: a Job Operation lot is
 * rejected from the shop floor. A non-tracked Inventory lot's value is written off through
 * `post-nonconformance` in the decision's transaction; when the write-off
 * fails the lot is not rejected. With `createNcr` false that is all
 * (`issueId` null). Otherwise an issue opens, of `nonConformanceTypeId`, else a
 * supplier or receiving issue type, else the first, at the receipt line's location, else the caller's default
 * location: its item's disposition row takes the lot quantity and Scrap, the
 * lot's entities and receipt line are linked to it, and its tasks are
 * created. The failed features, with their measured values against spec, and
 * the `reason` go in its description. A failure after the issue was inserted
 * deletes it again; the lot stays rejected. A repeated Reject on a Failed lot
 * posts nothing new and keeps the lot's NCR; it can still open a missing one.
 *
 * @param reason - Why the lot is rejected. Required when no characteristic
 * reached its rejection number and no sample failed (a suspected counterfeit,
 * the wrong part, transit damage); stored as the lot's notes.
 * @param requireOpen - Refuse a lot that is already dispositioned. Left off,
 * rejecting a rejected lot again retries its write-off.
 *
 * @mcp
 */
export const rejectInspection = defineServiceFn({
  // Shared with the `reject-inspection` posting MES sends.
  input: rejectInspectionInput,
  permission: { update: "quality" },

  async run(ctx, { id, nonConformanceTypeId, createNcr, reason, requireOpen }) {
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;

    const rejected = await ctx.transaction(async (tx) => {
      const decided = await engine.dispositionInspection(tx.asSystem.pg, {
        id,
        decision: "Reject",
        reason: reason || undefined,
        companyId,
        dispositionedBy: userId,
        // A Job Operation lot's reject carries its production outcome, which
        // only the shop floor posts.
        requireSource: ["Receipt", "Manual"],
        requireOpen
      });
      if (decided.error) {
        return ctx.error(
          "rule",
          decided.error.message || "Failed to reject lot",
          decided.error
        );
      }

      const writeOff = decided.data?.writeOff;
      if (writeOff) {
        const posted = await run(tx, "post-nonconformance", () =>
          service.postNonconformance(tx, {
            documentType: "Inbound Inspection",
            documentId: id,
            description: "Inbound inspection lot rejected",
            movements: writeOff.stripes.map((stripe) => ({
              itemId: writeOff.itemId,
              locationId: writeOff.locationId,
              storageUnitId: writeOff.storageUnitId,
              trackedEntityId: null,
              projectId: stripe.projectId,
              quantity: stripe.quantity
            }))
          })
        );
        if (posted instanceof CarbonError) {
          return ctx.error(
            posted.category,
            `The lot was not rejected: its inventory write-off could not post. ${posted.message}`,
            posted
          );
        }
      }
      return decided.data;
    });
    if (rejected.error) return rejected.error;

    if (!createNcr) return { id, issueId: null };

    const existingNcr = () =>
      service.getInspectionNcrLink(ctx.asSystem.pg, companyId, id);
    const linked = await existingNcr();
    if (linked) return { id, issueId: linked.nonConformanceId };

    const opened = await service.openInspectionNcr(ctx, {
      id,
      nonConformanceTypeId,
      reason,
      title: "Rejected lot",
      outcome: "Lot rejected",
      quantity: null,
      trackedEntityIds: null
    });
    if (opened instanceof CarbonError) {
      const raced = opened.category === "conflict" && (await existingNcr());
      if (raced) return { id, issueId: raced.nonConformanceId };
      return opened;
    }
    return { id, issueId: opened.issueId, ncrOpened: true };
  }
});
/**
 * Close a receipt inspection lot as Partial: part of it passed, part failed.
 *
 * @remarks
 * Only a Receipt lot. For an untracked (Inventory) part, `acceptedQuantity`
 * is required (more than 0, less than the lot size) and so is an NCR: the rest
 * of the lot stays held, in the location's rejected storage unit when one is
 * set, until that NCR closes. For a serial part every unit that did not fail
 * is accepted, as on Accept, and the failed units move to the rejected
 * storage unit. A batch or non-inventory lot is accepted or rejected as a
 * whole. An NCR opens for the failed part when one is required or `createNcr`
 * is true, and its prerequisites are checked before the lot closes. The
 * accepted part can then be put away. A Partial lot refuses a second decision;
 * a Partial lot whose NCR failed to open gets the NCR when it is marked
 * partial again, and nothing else changes, unless its receipt was voided.
 *
 * @mcp
 */
export const partialInspection = defineServiceFn({
  input: z.object({
    id: z.string(),
    acceptedQuantity: z.number().min(0).nullish(),
    nonConformanceTypeId: z.string().nullish(),
    createNcr: z.boolean().default(true),
    reason: z.string().trim().max(2000).nullish()
  }),
  permission: { update: "quality" },

  async run(
    ctx,
    { id, acceptedQuantity, nonConformanceTypeId, createNcr, reason }
  ) {
    const companyId = ctx.company.id;

    // Check the NCR can open BEFORE the lot closes: an untracked remainder is
    // released only by its NCR, so without one it would stay held for good.
    const lot = await ctx.asSystem.supabase
      .from("inspection")
      .select(
        "lotSize, status, sourceDocument, sourceDocumentId, acceptedQuantity, item(itemTrackingType), nonConformanceInspection(id)"
      )
      .eq("id", id)
      .eq("companyId", companyId)
      .maybeSingle();
    if (lot.error) {
      return ctx.error("internal", "Failed to read the inspection", lot.error);
    }
    if (!lot.data) {
      return ctx.error("notFound", "Inspection not found");
    }
    const trackingType = lot.data.item?.itemTrackingType;
    const untracked = trackingType === "Inventory";
    const tracked = trackingType === "Serial" || trackingType === "Batch";
    const lotSize = Number(lot.data.lotSize);
    const partialWithoutNcr =
      lot.data.sourceDocument === "Receipt" &&
      lot.data.status === "Partial" &&
      (lot.data.nonConformanceInspection ?? []).length === 0;

    let ncrMissing =
      partialWithoutNcr &&
      untracked &&
      lot.data.acceptedQuantity !== null &&
      lotSize - Number(lot.data.acceptedQuantity) > EPSILON;
    if (partialWithoutNcr && tracked && createNcr) {
      const failed = await ctx.asSystem.supabase
        .from("inspectionSample")
        .select("id")
        .eq("inspectionId", id)
        .eq("companyId", companyId)
        .eq("status", "Failed")
        .not("trackedEntityId", "is", null)
        .limit(1);
      if (failed.error) {
        return ctx.error(
          "internal",
          "Failed to read the lot's failed units",
          failed.error
        );
      }
      ncrMissing = (failed.data ?? []).length > 0;
    }
    if (ncrMissing) {
      const receipt = await ctx.asSystem.supabase
        .from("receipt")
        .select("status")
        .eq("id", lot.data.sourceDocumentId ?? "")
        .eq("companyId", companyId)
        .maybeSingle();
      if (receipt.error) {
        return ctx.error(
          "internal",
          "Failed to read the lot's receipt",
          receipt.error
        );
      }
      if (receipt.data?.status === "Voided") {
        return ctx.error("rule", "This lot's receipt was voided.");
      }
    }

    const lotIsOpen =
      lot.data.status === "Pending" || lot.data.status === "In Progress";
    if (
      (untracked &&
        (ncrMissing ||
          (acceptedQuantity !== null &&
            acceptedQuantity !== undefined &&
            acceptedQuantity < lotSize))) ||
      (tracked && createNcr && (ncrMissing || lotIsOpen))
    ) {
      const missing = await service.inspectionNcrPrerequisite(ctx, {
        id,
        nonConformanceTypeId
      });
      if (missing) return ctx.error("rule", missing);
    }

    let rejectedQuantity: number | null;
    if (ncrMissing) {
      rejectedQuantity = untracked
        ? round(lotSize - Number(lot.data.acceptedQuantity))
        : null;
    } else {
      const partial = await engine.dispositionInspection(ctx.asSystem.pg, {
        id,
        decision: "Partial",
        reason: reason || undefined,
        acceptedQuantity: acceptedQuantity ?? undefined,
        companyId,
        dispositionedBy: ctx.auditUserId,
        requireSource: "Receipt"
      });
      if (partial.error || !partial.data) {
        if (lotIsOpen) {
          const now = await ctx.asSystem.pg
            .selectFrom("inspection")
            .select("status")
            .where("id", "=", id)
            .where("companyId", "=", companyId)
            .executeTakeFirst();
          if (now?.status === "Partial") {
            const link = await service.getInspectionNcrLink(
              ctx.asSystem.pg,
              companyId,
              id
            );
            return { id, issueId: link?.nonConformanceId ?? null };
          }
        }
        return ctx.error(
          "rule",
          partial.error?.message ?? "Failed to mark the lot partial",
          partial.error
        );
      }
      rejectedQuantity = partial.data.rejectedQuantity;
    }

    // A tracked lot gets an NCR only when asked, for its failed units.
    const ncrRequired = rejectedQuantity !== null && rejectedQuantity > 0;
    if (!ncrRequired && !createNcr) return { id, issueId: null };

    let trackedEntityIds: string[] | null = null;
    let quantity = rejectedQuantity;
    if (rejectedQuantity === null) {
      const failed = await ctx.asSystem.supabase
        .from("inspectionSample")
        .select("trackedEntityId, trackedEntity(quantity)")
        .eq("inspectionId", id)
        .eq("companyId", companyId)
        .eq("status", "Failed")
        .not("trackedEntityId", "is", null);
      if (failed.error) {
        return ctx.error(
          "internal",
          "Lot marked partial, but failed to read its failed units",
          failed.error
        );
      }
      const failedRows = failed.data ?? [];
      trackedEntityIds = failedRows
        .map((row) => row.trackedEntityId)
        .filter((entityId): entityId is string => !!entityId);
      if (trackedEntityIds.length === 0) return { id, issueId: null };
      quantity = failedRows.reduce(
        (sum, row) => sum + Number(row.trackedEntity?.quantity ?? 1),
        0
      );
    }

    const opened = await service.openInspectionNcr(ctx, {
      id,
      nonConformanceTypeId,
      reason,
      title: "Partly rejected lot",
      outcome: "Lot marked partial",
      quantity,
      trackedEntityIds
    });
    if (opened instanceof CarbonError) {
      if (opened.category === "conflict") {
        const link = await service.getInspectionNcrLink(
          ctx.asSystem.pg,
          companyId,
          id
        );
        if (link) return { id, issueId: link.nonConformanceId };
      }
      return ncrMissing
        ? opened
        : ctx.error(
            opened.category,
            "Lot marked partial, but its NCR did not open. Use Open NCR.",
            opened
          );
    }
    return { id, issueId: opened.issueId, ncrOpened: true };
  }
});
// --- Inspection documents ---------------------------------------------------------

const emptyInspectionSave = { create: [], update: [], delete: [] };
/**
 * Save an inspection plan's characteristics and balloons in one transaction.
 *
 * @remarks
 * `features` and `balloons` are create / update / delete sets. `balloons` may
 * be the legacy shape (balloons carrying their characteristic), which needs
 * `anchors` and is translated into features and balloon geometry; `anchors`
 * alone is translated the same way. Persisted balloon ids sent where a
 * characteristic id belongs are mapped to their characteristic. The default
 * sampling rule (`samplingDefault`) is saved first: a failure after the
 * features were created would leave the editor holding temporary ids, and
 * its retry would create them twice. `parameters`, when sent, is the plan's
 * whole parameter list in order: rows not in it are deleted. Returns the
 * saved rows and the maps from temporary to persisted ids.
 *
 * @mcp
 */
export const saveInspectionDocument = defineServiceFn({
  input: z.object({
    inspectionDocumentId: z.string(),
    pdfUrl: z.string().optional(),
    pageCount: z.number().optional(),
    defaultPageWidth: z.number().optional(),
    defaultPageHeight: z.number().optional(),
    features: inspectionSaveFeaturesPayloadValidator.optional(),
    balloons: z
      .union([
        inspectionSaveBalloonsGeometryPayloadValidator,
        inspectionSaveBalloonsPayloadValidator
      ])
      .optional(),
    anchors: inspectionSaveAnchorsPayloadValidator.optional(),
    samplingDefault: inspectionDocumentSamplingValidator.optional(),
    parameters: inspectionDocumentParametersValidator.optional()
  }),
  permission: { update: "quality" },

  async run(ctx, input) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const id = input.inspectionDocumentId;

    // The drawing is read back through the private bucket, so it must be a
    // file in this company's folder (the editor sends its preview URL).
    const drawingPath = input.pdfUrl?.replace(
      /^\/file\/preview\/private\//,
      ""
    );
    if (
      drawingPath &&
      (!drawingPath.startsWith(`${companyId}/`) ||
        isUnsafeStoragePath(drawingPath))
    ) {
      return ctx.error(
        "validation",
        "The drawing must be a file in this company's storage"
      );
    }

    let features: InspectionSaveFeaturesPayload =
      input.features ?? emptyInspectionSave;
    let balloons: InspectionSaveBalloonsGeometryPayload = emptyInspectionSave;
    const geometry = input.balloons
      ? inspectionSaveBalloonsGeometryPayloadValidator.safeParse(input.balloons)
      : null;
    if (geometry?.success) {
      balloons = geometry.data;
    } else if (input.balloons || input.anchors) {
      if (input.balloons && !input.anchors) {
        return ctx.error(
          "validation",
          "Legacy balloons payload requires anchors"
        );
      }
      const translated = service.translateLegacyInspectionSavePayload(
        input.anchors!,
        input.balloons
          ? inspectionSaveBalloonsPayloadValidator.parse(input.balloons)
          : emptyInspectionSave
      );
      features = service.mergeInspectionFeaturesPayload(
        features,
        translated.features
      );
      balloons = service.mergeInspectionBalloonsPayload(
        balloons,
        translated.balloons
      );
    }

    // Checked once the input is known to be valid. The sampling and parameter
    // writes refuse a locked version themselves, and the RPC refuses one under
    // the plan's row lock; this read refuses it before anything is written.
    const locked = await service.inspectionDocumentLockRefusal(ctx, id);
    if (locked) return locked;

    features = await service.resolveInspectionFeaturePayloadIds(
      client,
      id,
      companyId,
      features
    );

    if (input.samplingDefault) {
      const sampling = await service.updateInspectionDocumentSampling(client, {
        ...input.samplingDefault,
        inspectionDocumentId: id,
        companyId,
        userId: ctx.auditUserId
      });
      if (sampling.error?.code === NOT_APPLIED_CODE) {
        return service.inspectionDocumentWriteRefusal(ctx, id);
      }
      if (sampling.error) {
        return ctx.error(
          "internal",
          "Failed to save default sampling",
          sampling.error
        );
      }
    }

    // The whole list, so the editor's retry after a later failure writes it
    // again unchanged.
    let parameters: Awaited<
      ReturnType<typeof service.replaceInspectionDocumentParameters>
    > | null = null;
    if (input.parameters) {
      try {
        parameters = await service.replaceInspectionDocumentParameters(
          ctx.asSystem.pg,
          {
            inspectionDocumentId: id,
            companyId,
            userId: ctx.auditUserId,
            parameters: input.parameters
          }
        );
      } catch (err) {
        return ctx.error("internal", "Failed to save parameters", err);
      }
      if (!parameters) return service.inspectionDocumentWriteRefusal(ctx, id);
    }

    const saved = await service.saveInspectionDocumentAtomic(client, {
      inspectionDocumentId: id,
      companyId,
      userId: ctx.auditUserId,
      pdfUrl: input.pdfUrl,
      pageCount: input.pageCount,
      defaultPageWidth: input.defaultPageWidth,
      defaultPageHeight: input.defaultPageHeight,
      features,
      balloons
    });
    if (saved.error || !saved.data) {
      return ctx.error(
        "rule",
        service.rpcErrorMessage(saved.error, "Failed to save inspection plan"),
        saved.error
      );
    }
    return {
      ...(saved.data as {
        success: boolean;
        featureIdMap: Record<string, string>;
        balloonAnchorIdMap: Record<string, string>;
        features: Array<Record<string, unknown>>;
        anchors: Array<Record<string, unknown>>;
        balloons: Array<Record<string, unknown>>;
      }),
      parameters
    };
  }
});

/**
 * Set an inspection plan's name; an empty one clears it.
 *
 * @mcp
 */
export const setInspectionDocumentName = defineServiceFn({
  input: z.object({ id: z.string(), name: z.string().nullish() }),
  permission: { update: "quality" },

  async run(ctx, { id, name }) {
    // Only a Draft version is editable.
    const updated = await ctx.asCaller.supabase
      .from("inspectionDocument")
      .update({
        name: name?.trim() || null,
        updatedBy: ctx.auditUserId,
        updatedAt: datetime.timestamp()
      })
      .eq("id", id)
      .eq("companyId", ctx.company.id)
      .eq("status", "Draft")
      .select("id");
    if (updated.error) {
      return ctx.error(
        "internal",
        "Failed to update the inspection name",
        updated.error
      );
    }
    if (updated.data.length === 0) {
      return service.inspectionDocumentWriteRefusal(ctx, id);
    }
    return { id };
  }
});

/**
 * Set an inspection plan's work instructions: the rich text the inspector
 * reads on every lot of the plan.
 *
 * @param workInstruction - Markdown or a Tiptap document; `{}` or an empty
 * string clears it.
 *
 * @mcp
 */
export const setInspectionDocumentWorkInstruction = defineServiceFn({
  input: z.object({ id: z.string(), workInstruction: optionalTiptapDoc }),
  permission: { update: "quality" },

  async run(ctx, { id, workInstruction }) {
    // Only a Draft version is editable.
    const updated = await ctx.asCaller.supabase
      .from("inspectionDocument")
      .update({
        workInstruction: workInstruction ?? null,
        updatedBy: ctx.auditUserId,
        updatedAt: datetime.timestamp()
      })
      .eq("id", id)
      .eq("companyId", ctx.company.id)
      .eq("status", "Draft")
      .select("id");
    if (updated.error) {
      return ctx.error(
        "internal",
        "Failed to update the work instructions",
        updated.error
      );
    }
    if (updated.data.length === 0) {
      return service.inspectionDocumentWriteRefusal(ctx, id);
    }
    return { id };
  }
});

/**
 * Attach a CAD model to an inspection plan that has no drawing.
 *
 * @remarks
 * Stage the file first (`items_createModelUploadUrl`), then pass its
 * `modelId` and `path`. Records the model upload, which starts its
 * processing, and points the plan at it, so the editor and every lot show the
 * model where a PDF drawing would be. Refused when the plan already has a PDF
 * drawing or a model.
 *
 * @param modelId - The staged model's id (the file name without extension).
 * @param path - Where the model was staged in `temp-staging`.
 *
 * @mcp
 */
export const attachInspectionDocumentModel = defineServiceFn({
  input: z.object({
    id: z.string(),
    modelId: z.string().min(1),
    path: z.string().min(1),
    name: z.string().min(1),
    size: z.number().nonnegative()
  }),
  permission: { update: "quality" },

  async run(ctx, { id, modelId, path, name, size }) {
    // The path comes from the caller: it must be the one minted for this
    // model, inside this tenant's storage prefix.
    if (!isModelUploadPath(ctx.company.id, modelId, path)) {
      return ctx.error("rule", "Failed to record the model", {
        message: "Invalid model path"
      });
    }

    // A quality user need not hold parts permissions, and the model belongs to
    // the plan, not to a part: it is recorded as the system, linked to nothing,
    // in the transaction that claims the plan.
    let attached: Awaited<
      ReturnType<typeof service.attachModelToInspectionDocument>
    >;
    try {
      attached = await service.attachModelToInspectionDocument(
        ctx.asSystem.pg,
        {
          id,
          companyId: ctx.company.id,
          userId: ctx.auditUserId,
          modelId,
          path,
          name,
          size
        }
      );
    } catch (error) {
      return ctx.error("internal", "Failed to attach the model", error);
    }
    if (!attached.ok) {
      switch (attached.reason) {
        case "notFound":
          return ctx.error(
            "notFound",
            "The inspection plan could not be found"
          );
        case "locked":
          return ctx.error(
            "rule",
            `This inspection plan version is ${attached.status}. Make a new version to change it.`
          );
        case "hasDrawing":
          return ctx.error(
            "rule",
            "This inspection plan already has a drawing or a model"
          );
      }
    }
    return { id, modelUploadId: modelId };
  }
});

// --- Quality documents --------------------------------------------------------

/**
 * Set one field on one or more quality documents.
 *
 * @remarks
 * `name` and `content` are written as given; `tags` takes the full list.
 * `status` Active publishes a Draft or Archived document, unless an approval
 * rule applies: then each one opens an approval request (its approvers are
 * notified) and waits in Draft — an Archived one moves back to Draft — until
 * it is approved. `status` Archived or Draft withdraws a pending request
 * first; sending one back to Draft is a withdrawal only its requester or an
 * approver may make.
 *
 * @mcp
 */
export const updateQualityDocumentField = defineServiceFn({
  input: z.object({
    ids: zfd.repeatableOfType(z.string().min(1)),
    field: z.enum(["name", "content", "status", "tags"]),
    value: z.union([z.string(), z.array(z.string())]).nullish()
  }),
  permission: { update: "quality" },

  async run(ctx, { ids, field, value }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const audit = {
      updatedBy: ctx.auditUserId,
      updatedAt: datetime.timestamp()
    };
    const written = (result: { error: unknown }) =>
      result.error
        ? ctx.error("internal", "Failed to update the document", result.error)
        : { ids };

    if (field === "tags") {
      const tags = value == null ? [] : Array.isArray(value) ? value : [value];
      return written(
        await client
          .from("qualityDocument")
          .update({ tags, ...audit })
          .in("id", ids)
          .eq("companyId", companyId)
      );
    }

    if (typeof value !== "string") {
      return ctx.error("validation", "Invalid form data");
    }

    if (field === "name" || field === "content") {
      return written(
        await client
          .from("qualityDocument")
          .update(unchecked({ [field]: value, ...audit }))
          .in("id", ids)
          .eq("companyId", companyId)
      );
    }

    const status = value as (typeof qualityDocumentStatus)[number];
    if (!qualityDocumentStatus.includes(status)) {
      return ctx.error("validation", "Invalid status");
    }
    // These documents drive service-role approval writes below — this
    // company's documents only.
    const documents = await client
      .from("qualityDocument")
      .select("id, status")
      .in("id", ids)
      .eq("companyId", companyId);
    if (documents.error) {
      return ctx.error(
        "internal",
        "Failed to load the documents",
        documents.error
      );
    }

    if (status === "Active") {
      return service.activateQualityDocuments(ctx, ids, documents.data);
    }

    if (documents.data.length > 0) {
      const cancelled = await cancelPendingApprovals(ctx.asSystem.supabase, {
        documentType: "qualityDocument",
        documentIds: documents.data.map((doc) => doc.id),
        companyId,
        userId: ctx.auditUserId,
        onlyRequesterOrApprover: status === "Draft"
      });
      if (cancelled.error) {
        return ctx.error("rule", cancelled.error.message, cancelled.error);
      }
    }
    return written(
      await client
        .from("qualityDocument")
        .update({ status, ...audit })
        .in("id", ids)
        .eq("companyId", companyId)
    );
  }
});
/**
 * Approve or reject a quality document's pending approval request.
 *
 * @remarks
 * Only an approver under the document's rule may decide. Approving makes the
 * document Active; rejecting leaves it in Draft. The requester is notified
 * when someone else decided.
 *
 * @mcp
 */
export const decideQualityDocumentApproval = defineServiceFn({
  input: approvalDecisionValidator.extend({ qualityDocumentId: z.string() }),
  permission: { update: "quality" },

  async run(ctx, { qualityDocumentId, approvalRequestId, decision, notes }) {
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;
    const owned = await refuseUnlessOwned(ctx, "qualityDocument", {
      id: qualityDocumentId
    });
    if (owned) return owned;

    const result = await decideApprovalRequest(
      ctx.asSystem.supabase,
      ctx.asSystem.pg,
      {
        documentType: "qualityDocument",
        documentId: qualityDocumentId,
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
        documentId: qualityDocumentId,
        documentType: "qualityDocument",
        recipient: { type: "user", userId: result.requestedBy },
        from: userId
      }).catch((e) =>
        logger.error("Failed to trigger approval decision notification", {
          companyId,
          documentId: qualityDocumentId,
          error: e
        })
      );
    }
    return { qualityDocumentId, decision };
  }
});
/**
 * Load Carbon's template quality documents (the QMS procedures) into a
 * company that has none, with the company's name filled in.
 *
 * @remarks
 * Refused once the company has any quality document.
 *
 * @mcp
 */
export const seedQualityDocuments = defineServiceFn({
  input: z.object({}),
  permission: { create: "quality" },

  async run(ctx) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const [current, company] = await Promise.all([
      client.from("qualityDocument").select("id").eq("companyId", companyId),
      client.from("company").select("name").eq("id", companyId).single()
    ]);
    if (current.error) {
      return ctx.error("internal", current.error.message, current.error);
    }
    if (current.data.length > 0) {
      return ctx.error("rule", "Documents already exist");
    }
    if (company.error || !company.data) {
      return ctx.error("notFound", "Company not found");
    }

    // Loaded here, not at import: the templates are a large literal that
    // only this operation reads.
    const { documents } = await import("./quality-document-templates");
    const inserted = await client.from("qualityDocument").insert(
      documents.map((document) => ({
        ...document,
        content: service.interpolateTemplate(document.content, {
          company: company.data
        }) as typeof document.content,
        companyId,
        createdBy: ctx.auditUserId
      }))
    );
    if (inserted.error) {
      return ctx.error("internal", inserted.error.message, inserted.error);
    }
    return { count: documents.length };
  }
});

// --- Issue workflows ----------------------------------------------------------

/**
 * Rename one or more issue workflows.
 *
 * @remarks
 * Gated on production update, as the route was (nothing in the app posts
 * here). Not published.
 */
export const updateIssueWorkflowField = defineServiceFn({
  input: z.object({
    ids: zfd.repeatableOfType(z.string().min(1)),
    field: z.enum(["name"]),
    value: z.string()
  }),
  permission: { update: "production" },

  async run(ctx, { ids, field, value }) {
    const { error } = await ctx.asCaller.supabase
      .from("nonConformanceWorkflow")
      .update({
        [field]: value,
        updatedBy: ctx.auditUserId,
        updatedAt: datetime.timestamp()
      })
      .in("id", ids)
      .eq("companyId", ctx.company.id);
    if (error) {
      return ctx.error("internal", "Failed to update the workflow", error);
    }
    return { ids };
  }
});

// --- Risks ----------------------------------------------------------------------

const riskInput = riskRegisterValidator
  .omit({ id: true, notes: true, severity: true, likelihood: true })
  .extend({
    // The rich-text body, as the editor's JSON.
    notes: z.record(z.string(), z.unknown()).optional(),
    severity: z.number().int(),
    likelihood: z.number().int()
  });
/**
 * Record a risk or an opportunity.
 *
 * @remarks
 * Any employee of the company may (the register's row-level security). It is
 * assigned to `assignee`, or to the caller; a named assignee is notified.
 * Not published: its gate is company membership, which the API cannot state.
 */
export const createRisk = defineServiceFn({
  input: riskInput,
  permission: {},

  async run(ctx, input) {
    const result = await service.upsertRisk(ctx.asCaller.supabase, {
      ...input,
      notes: input.notes ?? {},
      assignee: input.assignee ?? ctx.auditUserId,
      companyId: ctx.company.id,
      createdBy: ctx.auditUserId
    });
    if (result.error) {
      return ctx.error("internal", "Failed to create risk", result.error);
    }
    if (input.assignee) {
      await service.notifyRiskAssignee(ctx, result.data.id, input.assignee);
    }
    return { id: result.data.id };
  }
});

/**
 * Change a risk or an opportunity.
 *
 * @remarks
 * A new assignee is notified.
 *
 * @mcp
 */
export const updateRisk = defineServiceFn({
  input: riskInput.extend({ id: z.string() }),
  permission: { update: "quality" },

  async run(ctx, { id, ...input }) {
    const client = ctx.asCaller.supabase;
    const previous = await service.getRisk(client, id);
    const result = await service.upsertRisk(client, {
      ...input,
      notes: input.notes ?? {},
      id,
      assignee: input.assignee || undefined,
      companyId: ctx.company.id,
      updatedBy: ctx.auditUserId
    });
    if (result.error) {
      return ctx.error("internal", "Failed to update risk", result.error);
    }
    if (input.assignee && input.assignee !== previous.data?.assignee) {
      await service.notifyRiskAssignee(ctx, id, input.assignee);
    }
    return { id };
  }
});

// --- Supplier corrective action (SCAR) share link -----------------------------------
/**
 * The supplier sets the status of one of their SCAR action tasks, from the
 * share link.
 */
export const setScarTaskStatus = defineServiceFn({
  input: z.object({
    externalLinkId: z.string(),
    taskId: z.string(),
    status: z.enum(nonConformanceTaskStatus)
  }),
  permission: "system",

  async run(ctx, { externalLinkId, taskId, status }) {
    const task = await service.scarTask(ctx, { externalLinkId, taskId });
    if (typeof task !== "string") return task;
    const update = await service.updateIssueTaskStatus(ctx.asSystem.supabase, {
      id: taskId,
      status,
      type: "action"
    });
    if (update.error) {
      return ctx.error(
        "internal",
        "Failed to update task status",
        update.error
      );
    }
    return { taskId, status };
  }
});

/**
 * The supplier writes the notes of one of their SCAR action tasks, from the
 * share link.
 */
export const updateScarTaskNotes = defineServiceFn({
  input: z.object({
    externalLinkId: z.string(),
    taskId: z.string(),
    notes: z.record(z.string(), z.unknown())
  }),
  permission: "system",

  async run(ctx, { externalLinkId, taskId, notes }) {
    const task = await service.scarTask(ctx, { externalLinkId, taskId });
    if (typeof task !== "string") return task;
    const update = await service.updateIssueTaskContent(ctx.asSystem.supabase, {
      id: taskId,
      content: notes,
      type: "action"
    });
    if (update.error) {
      return ctx.error("internal", "Failed to update content", update.error);
    }
    return { taskId };
  }
});
/**
 * Activate gauge
 *
 * @mcp
 */
export const activateGauge = defineServiceFn({
  input: z.looseObject({ gaugeId: z.string() }),
  // The route gated on delete; the write runs under the update policy.
  permission: { update: "quality", delete: "quality" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.activateGauge(ctx.asCaller.supabase, input.gaugeId as never)
    );
  }
});

/**
 * Deactivate gauge
 *
 * @mcp
 */
export const deactivateGauge = defineServiceFn({
  input: z.looseObject({ gaugeId: z.string() }),
  // The route gated on delete; the write runs under the update policy.
  permission: { update: "quality", delete: "quality" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deactivateGauge(
        ctx.asCaller.supabase,
        input.gaugeId as never
      )
    );
  }
});

/**
 * Delete gauge
 *
 * @mcp destructive
 */
export const deleteGauge = defineServiceFn({
  input: z.looseObject({ gaugeId: z.string() }),
  permission: { delete: "quality" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteGauge(ctx.asCaller.supabase, input.gaugeId as never)
    );
  }
});

/**
 * Delete gauge calibration record
 *
 * @mcp destructive
 */
export const deleteGaugeCalibrationRecord = defineServiceFn({
  input: z.looseObject({ gaugeCalibrationRecordId: z.string() }),
  permission: { delete: "quality" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteGaugeCalibrationRecord(
        ctx.asCaller.supabase,
        input.gaugeCalibrationRecordId as never
      )
    );
  }
});

/**
 * Delete gauge type
 *
 * @mcp destructive
 */
export const deleteGaugeType = defineServiceFn({
  input: z.looseObject({ gaugeTypeId: z.string() }),
  permission: { delete: "quality" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteGaugeType(
        ctx.asCaller.supabase,
        input.gaugeTypeId as never
      )
    );
  }
});

/**
 * Delete issue
 *
 * @mcp destructive
 */
export const deleteIssue = defineServiceFn({
  input: z.looseObject({ nonConformanceId: z.string() }),
  permission: { delete: "quality" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteIssue(
        ctx.asCaller.supabase,
        input.nonConformanceId as never
      )
    );
  }
});

/**
 * Delete issue association
 *
 * @mcp destructive
 */
export const deleteIssueAssociation = defineServiceFn({
  input: z.looseObject({ type: z.string(), associationId: z.string() }),
  permission: { delete: "quality" },
  async run(ctx, input) {
    return await service.deleteIssueAssociation(
      ctx.asCaller.supabase,
      input.type as never,
      input.associationId as never
    );
  }
});

/**
 * Delete issue type
 *
 * @mcp destructive
 */
export const deleteIssueType = defineServiceFn({
  input: z.looseObject({ nonConformanceTypeId: z.string() }),
  permission: { delete: "quality" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteIssueType(
        ctx.asCaller.supabase,
        input.nonConformanceTypeId as never
      )
    );
  }
});

/**
 * Delete issue workflow
 *
 * @mcp destructive
 */
export const deleteIssueWorkflow = defineServiceFn({
  input: z.looseObject({ nonConformanceWorkflowId: z.string() }),
  permission: { delete: "quality" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteIssueWorkflow(
        ctx.asCaller.supabase,
        input.nonConformanceWorkflowId as never
      )
    );
  }
});

/**
 * Delete required action
 *
 * @mcp destructive
 */
export const deleteRequiredAction = defineServiceFn({
  input: z.looseObject({ requiredActionId: z.string() }),
  permission: { delete: "quality" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteRequiredAction(
        ctx.asCaller.supabase,
        input.requiredActionId as never
      )
    );
  }
});

/**
 * Delete quality document
 *
 * @mcp destructive
 */
export const deleteQualityDocument = defineServiceFn({
  input: z.looseObject({ qualityDocumentId: z.string() }),
  permission: { delete: "quality" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteQualityDocument(
        ctx.asCaller.supabase,
        input.qualityDocumentId as never
      )
    );
  }
});

/**
 * Delete risk
 *
 * @mcp destructive
 */
export const deleteRisk = defineServiceFn({
  input: z.looseObject({ riskId: z.string() }),
  permission: { delete: "quality" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteRisk(ctx.asCaller.supabase, input.riskId as never)
    );
  }
});

/**
 * Get issue from external link
 *
 * @mcp read
 */
export const getIssueFromExternalLink = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getIssueFromExternalLink(
        ctx.asCaller.supabase,
        input.id as never
      )
    );
  }
});

/**
 * Get gauge
 *
 * @mcp read
 */
export const getGauge = defineServiceFn({
  input: z.looseObject({ gaugeId: z.string() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getGauge(ctx.asCaller.supabase, input.gaugeId as never)
    );
  }
});

/**
 * Get gauges
 *
 * @mcp read
 */
export const getGauges = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getGauges(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get gauges list
 *
 * @mcp read
 */
export const getGaugesList = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "quality" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getGaugesList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get gauge calibration record
 *
 * @mcp read
 */
export const getGaugeCalibrationRecord = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getGaugeCalibrationRecord(
        ctx.asCaller.supabase,
        input.id as never
      )
    );
  }
});

/**
 * Get gauge calibration records
 *
 * @mcp read
 */
export const getGaugeCalibrationRecords = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getGaugeCalibrationRecords(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get gauge calibration records by gauge id
 *
 * @mcp read
 */
export const getGaugeCalibrationRecordsByGaugeId = defineServiceFn({
  input: z.looseObject({ gaugeId: z.string() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getGaugeCalibrationRecordsByGaugeId(
        ctx.asCaller.supabase,
        input.gaugeId as never
      )
    );
  }
});

/**
 * Get gauge types list
 *
 * @mcp read
 */
export const getGaugeTypesList = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "quality" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getGaugeTypesList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get gauge type
 *
 * @mcp read
 */
export const getGaugeType = defineServiceFn({
  input: z.looseObject({ gaugeTypeId: z.string() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getGaugeType(
        ctx.asCaller.supabase,
        input.gaugeTypeId as never
      )
    );
  }
});

/**
 * Get gauge types
 *
 * @mcp read
 */
export const getGaugeTypes = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getGaugeTypes(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get issue
 *
 * @mcp read
 */
export const getIssue = defineServiceFn({
  input: z.looseObject({ nonConformanceId: z.string() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getIssue(
        ctx.asCaller.supabase,
        input.nonConformanceId as never
      )
    );
  }
});

/**
 * Get issues
 *
 * @mcp read
 */
export const getIssues = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getIssues(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get issue workflow
 *
 * @mcp read
 */
export const getIssueWorkflow = defineServiceFn({
  input: z.looseObject({ nonConformanceWorkflowId: z.string() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getIssueWorkflow(
        ctx.asCaller.supabase,
        input.nonConformanceWorkflowId as never
      )
    );
  }
});

/**
 * Get issue action tasks
 *
 * @mcp read
 */
export const getIssueActionTasks = defineServiceFn({
  input: z.looseObject({ id: z.string(), supplierId: z.string().optional() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getIssueActionTasks(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id,
        input.supplierId as never
      )
    );
  }
});

/**
 * Get issue approval tasks
 *
 * @mcp read
 */
export const getIssueApprovalTasks = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getIssueApprovalTasks(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get issue items
 *
 * @mcp read
 */
export const getIssueItems = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getIssueItems(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get issue associations
 *
 * @mcp read
 */
export const getIssueAssociations = defineServiceFn({
  input: z.looseObject({ nonConformanceId: z.string() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return await service.getIssueAssociations(
      ctx.asCaller.supabase,
      input.nonConformanceId as never,
      ctx.company.id
    );
  }
});

/**
 * Get issue reviewers
 *
 * @mcp read
 */
export const getIssueReviewers = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getIssueReviewers(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get issue suppliers
 *
 * @mcp read
 */
export const getIssueSuppliers = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getIssueSuppliers(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get issue type
 *
 * @mcp read
 */
export const getIssueType = defineServiceFn({
  input: z.looseObject({ nonConformanceTypeId: z.string() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getIssueType(
        ctx.asCaller.supabase,
        input.nonConformanceTypeId as never
      )
    );
  }
});

/**
 * Get issue type by name
 *
 * @mcp read
 */
export const getIssueTypeByName = defineServiceFn({
  input: z.looseObject({ name: z.string(), excludeId: z.string().optional() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getIssueTypeByName(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.name as never,
        input.excludeId as never
      )
    );
  }
});

/**
 * Get issue types
 *
 * @mcp read
 */
export const getIssueTypes = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getIssueTypes(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get issue workflows
 *
 * @mcp read
 */
export const getIssueWorkflows = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getIssueWorkflows(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get issue workflows list
 *
 * @mcp read
 */
export const getIssueWorkflowsList = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "quality" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getIssueWorkflowsList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get issue types list
 *
 * @mcp read
 */
export const getIssueTypesList = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "quality" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getIssueTypesList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get quality actions
 *
 * @mcp read
 */
export const getQualityActions = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getQualityActions(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get quality document
 *
 * @mcp read
 */
export const getQualityDocument = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getQualityDocument(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Get quality document versions
 *
 * @mcp read
 */
export const getQualityDocumentVersions = defineServiceFn({
  input: z.looseObject({ name: z.string(), version: z.number() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getQualityDocumentVersions(
        ctx.asCaller.supabase,
        payload(ctx, input).build() as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get quality documents
 *
 * @mcp read
 */
export const getQualityDocuments = defineServiceFn({
  input: z.looseObject({
    search: z.string().nullable().optional(),
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0)
  }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getQualityDocuments(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get quality files
 *
 * @mcp read
 */
export const getQualityFiles = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return await service.getQualityFiles(
      ctx.asCaller.supabase,
      input.id as never,
      ctx.company.id
    );
  }
});

/**
 * Get required actions list
 *
 * @mcp read
 */
export const getRequiredActionsList = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "quality" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getRequiredActionsList(
        ctx.asCaller.supabase,
        ctx.company.id
      )
    );
  }
});

/**
 * Get required actions
 *
 * @mcp read
 */
export const getRequiredActions = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getRequiredActions(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get required action
 *
 * @mcp read
 */
export const getRequiredAction = defineServiceFn({
  input: z.looseObject({ requiredActionId: z.string() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getRequiredAction(
        ctx.asCaller.supabase,
        input.requiredActionId as never
      )
    );
  }
});

/**
 * Get risk
 *
 * @mcp read
 */
export const getRisk = defineServiceFn({
  input: z.looseObject({ riskId: z.string() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getRisk(ctx.asCaller.supabase, input.riskId as never)
    );
  }
});

/**
 * Get risks
 *
 * @mcp read
 */
export const getRisks = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional(),
    status: z
      .array(z.enum(["Open", "Closed", "In Review", "Mitigating", "Accepted"]))
      .nullable()
      .optional(),
    source: z
      .array(
        z.enum([
          "Customer",
          "Supplier",
          "Item",
          "Job",
          "General",
          "Quote Line",
          "Work Center"
        ])
      )
      .nullable()
      .optional(),
    assignee: z.array(z.string()).optional()
  }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getRisks(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Insert issue reviewer
 *
 * @mcp
 */
export const insertIssueReviewer = defineServiceFn({
  input: z.looseObject({
    title: z.string().min(1),
    nonConformanceId: z.string()
  }),
  permission: { create: "quality" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.insertIssueReviewer(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpsert() as never
      )
    );
  }
});

/**
 * Update issue action processes
 *
 * @mcp destructive
 */
export const updateIssueActionProcesses = defineServiceFn({
  input: z.looseObject({
    actionTaskId: z.string(),
    processIds: z.array(z.string())
  }),
  permission: { update: "quality" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.updateIssueActionProcesses(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Insert gauge
 *
 * @mcp
 */
export const insertGauge = defineServiceFn({
  input: z.looseObject({
    gaugeId: z.string().optional(),
    gaugeTypeId: z.string(),
    gaugeRole: z.enum(["Master", "Standard"]),
    gaugeCalibrationStatus: z.enum([
      "Pending",
      "In-Calibration",
      "Out-of-Calibration"
    ]),
    manufacturer: z.string().optional(),
    modelNumber: z.string().optional(),
    serialNumber: z.string().optional(),
    description: z.string().optional(),
    dateAcquired: z.string().optional(),
    lastCalibrationDate: z.string().optional(),
    nextCalibrationDate: z.string().optional(),
    locationId: z.string().optional(),
    storageUnitId: z.string().optional(),
    calibrationIntervalInMonths: z.number().optional(),
    customFields: z.unknown().optional()
  }),
  permission: { create: "quality" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.insertGauge(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpsert() as never
      )
    );
  }
});

/**
 * Update gauge
 *
 * @mcp
 */
export const updateGauge = defineServiceFn({
  input: z.looseObject({
    id: z.string(),
    gaugeId: z.string().optional(),
    gaugeTypeId: z.string().optional(),
    gaugeRole: z.enum(["Master", "Standard"]).optional(),
    gaugeCalibrationStatus: z
      .enum(["Pending", "In-Calibration", "Out-of-Calibration"])
      .optional(),
    manufacturer: z.string().nullable().optional(),
    modelNumber: z.string().nullable().optional(),
    serialNumber: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    dateAcquired: z.string().nullable().optional(),
    lastCalibrationDate: z.string().nullable().optional(),
    nextCalibrationDate: z.string().nullable().optional(),
    locationId: z.string().nullable().optional(),
    storageUnitId: z.string().nullable().optional(),
    calibrationIntervalInMonths: z.number().optional(),
    customFields: z.unknown().optional()
  }),
  permission: { update: "quality" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.updateGauge(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Create a gauge calibration record
 *
 * @remarks
 * Upsert gauge calibration record
 *
 * @mcp
 */
export const createGaugeCalibrationRecord = defineServiceFn({
  input: z.looseObject({
    gaugeId: z.string().min(1),
    supplierId: z.string().optional(),
    dateCalibrated: z.string().min(1),
    requiresAction: z.boolean().optional(),
    requiresAdjustment: z.boolean().optional(),
    requiresRepair: z.boolean().optional(),
    temperature: z.number().min(-200).max(500).optional(),
    humidity: z.number().min(0).max(1).optional(),
    approvedBy: z.string().optional(),
    measurementStandard: z.string().optional(),
    calibrationAttempts: z.array(
      z.looseObject({ reference: z.number(), actual: z.number() })
    ),
    notes: optionalTiptapDoc,
    inspectionStatus: z.enum(["Pass", "Fail"]),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "quality" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertGaugeCalibrationRecord(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

/**
 * Update a gauge calibration record
 *
 * @remarks
 * Upsert gauge calibration record
 *
 * @mcp
 */
export const updateGaugeCalibrationRecord = defineServiceFn({
  input: z
    .looseObject({
      gaugeId: z.string().min(1),
      supplierId: z.string().optional(),
      dateCalibrated: z.string().min(1),
      requiresAction: z.boolean().optional(),
      requiresAdjustment: z.boolean().optional(),
      requiresRepair: z.boolean().optional(),
      temperature: z.number().min(-200).max(500).optional(),
      humidity: z.number().min(0).max(1).optional(),
      approvedBy: z.string().optional(),
      measurementStandard: z.string().optional(),
      calibrationAttempts: z.array(
        z.looseObject({ reference: z.number(), actual: z.number() })
      ),
      notes: optionalTiptapDoc,
      inspectionStatus: z.enum(["Pass", "Fail"]),
      customFields: z.unknown().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  // The route gated on create; the write runs under the update policy.
  permission: { create: "quality", update: "quality" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertGaugeCalibrationRecord(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Create a gauge type
 *
 * @remarks
 * Upsert gauge type
 *
 * @mcp
 */
export const createGaugeType = defineServiceFn({
  input: z.looseObject({
    name: z.string().min(1),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "quality" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertGaugeType(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

/**
 * Update a gauge type
 *
 * @remarks
 * Upsert gauge type
 *
 * @mcp
 */
export const updateGaugeType = defineServiceFn({
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
  permission: { update: "quality" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertGaugeType(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Insert issue
 *
 * @mcp
 */
export const insertIssue = defineServiceFn({
  input: z.looseObject({
    nonConformanceId: z.string().optional(),
    name: z.string(),
    priority: z.enum(["Low", "Medium", "High", "Critical"]),
    source: z.enum(["Internal", "External"]),
    locationId: z.string(),
    nonConformanceTypeId: z.string(),
    openDate: z.string().optional(),
    description: z.string().optional(),
    nonConformanceWorkflowId: z.string().optional(),
    dueDate: z.string().optional(),
    closeDate: z.string().optional(),
    quantity: z.number().optional(),
    requiredActionIds: z.array(z.string()).optional(),
    approvalRequirements: z.array(z.literal("MRB")).optional(),
    items: z.array(z.string()).optional(),
    jobOperationId: z.string().optional(),
    customerId: z.string().optional(),
    salesOrderLineId: z.string().optional(),
    operationSupplierProcessId: z.string().optional(),
    customFields: z.unknown().optional()
  }),
  permission: { create: "quality" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.insertIssue(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpsert() as never
      )
    );
  }
});

/**
 * Update issue
 *
 * @mcp
 */
export const updateIssue = defineServiceFn({
  input: z.looseObject({
    id: z.string(),
    nonConformanceId: z.string().optional(),
    name: z.string().optional(),
    priority: z.enum(["Low", "Medium", "High", "Critical"]).optional(),
    source: z.enum(["Internal", "External"]).optional(),
    locationId: z.string().optional(),
    nonConformanceTypeId: z.string().optional(),
    nonConformanceWorkflowId: z.string().nullable().optional(),
    openDate: z.string().optional(),
    dueDate: z.string().nullable().optional(),
    closeDate: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    quantity: z.number().optional(),
    requiredActionIds: z.array(z.string()).optional(),
    approvalRequirements: z.array(z.literal("MRB")).optional(),
    customFields: z.unknown().optional()
  }),
  permission: { update: "quality" },
  async run(ctx, input) {
    const issue = await ctx.asCaller.supabase
      .from("nonConformance")
      .select("status")
      .eq("id", input.id)
      .eq("companyId", ctx.company.id)
      .maybeSingle();
    if (issue.error) {
      return ctx.error("internal", "Failed to update issue", issue.error);
    }
    if (!issue.data) return ctx.error("notFound", "Issue not found");
    if (isIssueLocked(issue.data.status)) {
      return ctx.error("rule", service.issueLocked);
    }
    return unwrap(
      ctx,
      await service.updateIssue(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Create a issue workflow
 *
 * @remarks
 * Upsert issue workflow
 *
 * @mcp
 */
export const createIssueWorkflow = defineServiceFn({
  input: z.looseObject({
    name: z.string().min(1),
    content: z.string().min(1),
    priority: z.enum(["Low", "Medium", "High", "Critical"]),
    source: z.enum(["Internal", "External"]),
    requiredActionIds: z.string().optional(),
    approvalRequirements: z.array(z.literal("MRB")).optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "quality" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertIssueWorkflow(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

/**
 * Update a issue workflow
 *
 * @remarks
 * Upsert issue workflow
 *
 * @mcp
 */
export const updateIssueWorkflow = defineServiceFn({
  input: z
    .looseObject({
      name: z.string().min(1),
      content: z.string().min(1),
      priority: z.enum(["Low", "Medium", "High", "Critical"]),
      source: z.enum(["Internal", "External"]),
      requiredActionIds: z.string().optional(),
      approvalRequirements: z.array(z.literal("MRB")).optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  // The route gated on create; the write runs under the update policy.
  permission: { create: "quality", update: "quality" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertIssueWorkflow(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Create a issue type
 *
 * @remarks
 * Upsert issue type
 *
 * @mcp
 */
export const createIssueType = defineServiceFn({
  input: z.looseObject({
    name: z.string().min(1),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "quality" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertIssueType(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

/**
 * Update a issue type
 *
 * @remarks
 * Upsert issue type
 *
 * @mcp
 */
export const updateIssueType = defineServiceFn({
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
  permission: { update: "quality" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertIssueType(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Create a required action
 *
 * @remarks
 * Upsert required action
 *
 * @mcp
 */
export const createRequiredAction = defineServiceFn({
  input: z.looseObject({
    name: z.string().min(1),
    active: z.boolean().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "quality" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertRequiredAction(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

/**
 * Update a required action
 *
 * @remarks
 * Upsert required action
 *
 * @mcp
 */
export const updateRequiredAction = defineServiceFn({
  input: z
    .looseObject({
      name: z.string().min(1),
      active: z.boolean().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "quality" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertRequiredAction(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Create a quality document
 *
 * @remarks
 * Upsert quality document
 *
 * @mcp
 */
export const createQualityDocument = defineServiceFn({
  input: z.looseObject({
    name: z.string().min(1),
    version: z.number().min(0),
    content: optionalTiptapDoc,
    copyFromId: z.string().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "quality" },
  // Only these fields: a document's status moves through approvals
  // (`updateQualityDocumentField`), and an id would turn the create into an
  // update.
  async run(ctx, { name, version, content, copyFromId }) {
    return unwrap(
      ctx,
      await service.upsertQualityDocument(ctx.asCaller.supabase, {
        name,
        version,
        content,
        copyFromId,
        companyId: ctx.company.id,
        createdBy: ctx.auditUserId
      })
    );
  }
});

/**
 * Update a quality document
 *
 * @remarks
 * Upsert quality document
 *
 * @mcp
 */
export const updateQualityDocument = defineServiceFn({
  input: z
    .looseObject({
      name: z.string().min(1),
      version: z.number().min(0),
      content: optionalTiptapDoc,
      copyFromId: z.string().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "quality" },
  // Only these fields: a document's status moves through approvals
  // (`updateQualityDocumentField`).
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertQualityDocument(ctx.asCaller.supabase, {
        ...pick(input, ["name", "version", "content"]),
        id: input.id,
        companyId: ctx.company.id,
        updatedBy: ctx.auditUserId
      })
    );
  }
});

/**
 * Get inspections
 *
 * @mcp read
 */
export const getInspections = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    source: z.string().nullable().optional()
  }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getInspections(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get inspection
 *
 * @mcp read
 */
export const getInspection = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return await service.getInspection(
      ctx.asCaller.supabase,
      input.id as never
    );
  }
});

/**
 * Get receipt inspections
 *
 * @mcp read
 */
export const getReceiptInspections = defineServiceFn({
  input: z.looseObject({ receiptId: z.string() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getReceiptInspections(
        ctx.asCaller.supabase,
        input.receiptId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get inspection tracked entities
 *
 * @mcp read
 */
export const getInspectionTrackedEntities = defineServiceFn({
  input: z.looseObject({ receiptLineId: z.string() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getInspectionTrackedEntities(
        ctx.asCaller.supabase,
        input.receiptLineId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get inspection sampling plans
 *
 * @mcp read
 */
export const getInspectionSamplingPlans = defineServiceFn({
  input: z.looseObject({ inspectionId: z.string() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getInspectionSamplingPlans(
        ctx.asCaller.supabase,
        input.inspectionId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get inspection gauges
 *
 * @mcp read
 */
export const getInspectionGauges = defineServiceFn({
  input: z.looseObject({ inspectionId: z.string() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getInspectionGauges(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.inspectionId as never
      )
    );
  }
});

/**
 * Get inspection measurements
 *
 * @mcp read
 */
export const getInspectionMeasurements = defineServiceFn({
  input: z.looseObject({ inspectionId: z.string() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getInspectionMeasurements(
        ctx.asCaller.supabase,
        input.inspectionId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get item inspection document assignments
 *
 * @mcp read
 */
export const getItemInspectionDocumentAssignments = defineServiceFn({
  input: z.looseObject({ itemId: z.string() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getItemInspectionDocumentAssignments(
        ctx.asCaller.supabase,
        input.itemId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Upsert item inspection document assignment
 *
 * @mcp destructive
 */
export const upsertItemInspectionDocumentAssignment = defineServiceFn({
  input: z.looseObject({
    itemId: z.string().min(1),
    usage: z.literal("Receipt"),
    inspectionDocumentId: z.string().optional()
  }),
  permission: { create: "quality", update: "quality" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertItemInspectionDocumentAssignment(
        ctx.asCaller.supabase,
        payload(ctx, input).withUser().forUpsert() as never
      )
    );
  }
});

/**
 * Get inspection documents
 *
 * @mcp read
 */
export const getInspectionDocuments = defineServiceFn({
  input: z.looseObject({
    search: z.string().nullable().optional(),
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0)
  }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getInspectionDocuments(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get inspection documents for item
 *
 * @mcp read
 */
export const getInspectionDocumentsForItem = defineServiceFn({
  input: z.looseObject({ itemId: z.string() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getInspectionDocumentsForItem(
        ctx.asCaller.supabase,
        input.itemId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get inspection document
 *
 * @mcp read
 */
export const getInspectionDocument = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getInspectionDocument(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Upsert inspection document
 *
 * @mcp
 */
export const upsertInspectionDocument = defineServiceFn({
  input: z.looseObject({
    name: z.string().optional(),
    partId: z.string().min(1),
    pdfUrl: z.string().optional(),
    annotations: z.string().optional(),
    features: z.string().optional(),
    id: z.string().optional(),
    pageCount: z.number().optional(),
    defaultPageWidth: z.number().optional(),
    defaultPageHeight: z.number().optional()
  }),
  permission: { create: "quality", update: "quality" },
  async run(ctx, input) {
    const upserted = await service.upsertInspectionDocument(
      ctx.asCaller.supabase,
      payload(ctx, input).forUpsert() as never
    );
    // The update matches only a Draft version.
    if (input.id && !upserted.error && !upserted.data) {
      return service.inspectionDocumentWriteRefusal(ctx, input.id);
    }
    return unwrap(ctx, upserted);
  }
});

/**
 * Delete one version of an inspection plan.
 *
 * @remarks
 * Refused when a lot was inspected against the version: publishing a new
 * version archives it instead.
 * Deleting the first version makes its lowest remaining version the plan's
 * first, so the other versions stay one plan. The drawing file is removed
 * only when no other version holds it.
 *
 * @mcp destructive
 */
export const deleteInspectionDocument = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "quality" },
  async run(ctx, input) {
    let deleted: Awaited<ReturnType<typeof service.deleteInspectionDocument>>;
    try {
      deleted = await service.deleteInspectionDocument(
        ctx.asSystem.pg,
        input.id,
        ctx.company.id
      );
    } catch (err) {
      return ctx.error("internal", "Failed to delete inspection plan", err);
    }
    if (!deleted) {
      return ctx.error("notFound", "Inspection plan not found");
    }
    if ("refused" in deleted) return ctx.error("rule", deleted.refused);
    if (deleted.storagePath) {
      const removed = await storage(ctx.asSystem.supabase)
        .company(ctx.company.id)
        .remove([deleted.storagePath]);
      if (removed.error) {
        logger.error("Failed to remove an inspection plan drawing", {
          companyId: ctx.company.id,
          storagePath: deleted.storagePath,
          error: removed.error
        });
      }
    }
    return { id: input.id };
  }
});

/**
 * Get the versions of an inspection plan
 *
 * @remarks
 * Every version of the plan the id belongs to, newest first, with its status.
 *
 * @mcp read
 */
export const getInspectionDocumentVersions = defineServiceFn({
  input: z.object({ id: z.string() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    const plan = await ctx.asCaller.supabase
      .from("inspectionDocument")
      .select("id, rootInspectionDocumentId")
      .eq("id", input.id)
      .eq("companyId", ctx.company.id)
      .maybeSingle();
    if (plan.error) {
      return ctx.error(
        "internal",
        "Failed to load the inspection plan",
        plan.error
      );
    }
    if (!plan.data) {
      return ctx.error("notFound", "Inspection plan not found");
    }
    return unwrap(
      ctx,
      await service.getInspectionDocumentVersions(
        ctx.asCaller.supabase,
        plan.data,
        ctx.company.id
      )
    );
  }
});

/**
 * Create a new version of an inspection plan
 *
 * @remarks
 * Copies the version `copyFromId` (its characteristics, balloons, parameters,
 * sampling default, drawing and model) into a new Draft numbered one past the
 * plan's highest version. Only a Draft can be edited, so a change to an Active
 * plan starts here; publish the Draft to use it.
 *
 * @mcp
 */
export const createInspectionDocumentVersion = defineServiceFn({
  input: z.object({ copyFromId: z.string() }),
  permission: { create: "quality" },
  async run(ctx, input) {
    let created: Awaited<
      ReturnType<typeof service.copyInspectionDocumentAsVersion>
    >;
    try {
      created = await service.copyInspectionDocumentAsVersion(ctx.asSystem.pg, {
        copyFromId: input.copyFromId,
        companyId: ctx.company.id,
        userId: ctx.auditUserId
      });
    } catch (err) {
      return ctx.error("internal", "Failed to create a new version", err);
    }
    if (!created) {
      return ctx.error("notFound", "Inspection plan not found");
    }
    return created;
  }
});

/**
 * Publish a version of an inspection plan
 *
 * @remarks
 * Makes the version Active and archives the version that was Active. Item
 * receipt assignments and method operations that name another version of the
 * plan move to this one, so the next receipt and new jobs inspect against it.
 * Job operations already made and existing inspections keep their version.
 *
 * @mcp
 */
export const activateInspectionDocumentVersion = defineServiceFn({
  input: z.object({ id: z.string() }),
  permission: { update: "quality" },
  async run(ctx, input) {
    let activated: Awaited<
      ReturnType<typeof service.activateInspectionDocumentVersion>
    >;
    try {
      activated = await service.activateInspectionDocumentVersion(
        ctx.asSystem.pg,
        { id: input.id, companyId: ctx.company.id, userId: ctx.auditUserId }
      );
    } catch (err) {
      return ctx.error("internal", "Failed to publish the version", err);
    }
    if (!activated) {
      return ctx.error("notFound", "Inspection plan not found");
    }
    return activated;
  }
});

/**
 * Get inspection features
 *
 * @mcp read
 */
export const getInspectionFeatures = defineServiceFn({
  input: z.looseObject({ inspectionDocumentId: z.string() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getInspectionFeatures(
        ctx.asCaller.supabase,
        input.inspectionDocumentId as never
      )
    );
  }
});

/**
 * Get balloons
 *
 * @mcp read
 */
export const getBalloons = defineServiceFn({
  input: z.looseObject({ inspectionDocumentId: z.string() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getBalloons(
        ctx.asCaller.supabase,
        input.inspectionDocumentId as never
      )
    );
  }
});

/**
 * Get inspection plan
 *
 * @mcp read
 */
export const getInspectionPlan = defineServiceFn({
  input: z.looseObject({ inspectionDocumentId: z.string() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getInspectionPlan(
        ctx.asCaller.supabase,
        input.inspectionDocumentId as never
      )
    );
  }
});

/**
 * Update inspection document sampling
 *
 * @mcp
 */
export const updateInspectionDocumentSampling = defineServiceFn({
  input: z.looseObject({
    samplingPlanType: z.enum(["All", "First", "Percentage", "AQL"]).nullable(),
    samplingSampleSize: z.number().int().gt(0).nullable(),
    samplingPercentage: z.number().max(100).gt(0).nullable(),
    samplingAql: z.number().gt(0).nullable(),
    samplingInspectionLevel: z
      .enum(["I", "II", "III", "S1", "S2", "S3", "S4"])
      .nullable(),
    samplingSeverity: z.enum(["Normal", "Tightened", "Reduced"]).nullable(),
    inspectionDocumentId: z.string()
  }),
  permission: { update: "quality" },
  async run(ctx, input) {
    const updated = await service.updateInspectionDocumentSampling(
      ctx.asCaller.supabase,
      payload(ctx, input).withUser().forUpdate() as never
    );
    // The update matches only a Draft version.
    if (updated.error?.code === NOT_APPLIED_CODE) {
      return service.inspectionDocumentWriteRefusal(
        ctx,
        input.inspectionDocumentId
      );
    }
    return unwrap(ctx, updated);
  }
});

/**
 * Save inspection document atomic
 *
 * @mcp
 */
export const saveInspectionDocumentAtomic = defineServiceFn({
  input: z.looseObject({
    inspectionDocumentId: z.string(),
    pdfUrl: z.string().nullable().optional(),
    pageCount: z.number().optional(),
    defaultPageWidth: z.number().optional(),
    defaultPageHeight: z.number().optional(),
    features: z.unknown(),
    balloons: z.unknown()
  }),
  permission: { update: "quality" },
  async run(ctx, input) {
    const locked = await service.inspectionDocumentLockRefusal(
      ctx,
      input.inspectionDocumentId
    );
    if (locked) return locked;

    return unwrap(
      ctx,
      await service.saveInspectionDocumentAtomic(
        ctx.asCaller.supabase,
        payload(ctx, input).withUser().build() as never
      )
    );
  }
});
