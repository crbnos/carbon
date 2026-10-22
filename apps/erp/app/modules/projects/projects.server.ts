// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  postTimesheetInput,
  saveTimesheetEntryInput
} from "@carbon/api/postings";
import { CarbonError, defineServiceFn } from "@carbon/api/service-fn.server";
import { paged, payload, run, unwrap } from "@carbon/api/service-tools.server";
import { Constants } from "@carbon/database";
import {
  approveRequest,
  canApproveRequest,
  cancelApprovalRequest,
  createApprovalRequest,
  getApprovalRuleByAmount,
  getApproverUserIdsForRule,
  getLatestApprovalRequestForDocument,
  isApprovalRequired,
  rejectRequest
} from "@carbon/ee/approvals.server";
import { EntitlementError } from "@carbon/ee/entitlements.server";
import {
  indirectBaseTypes,
  indirectPoolAccountValidator,
  indirectPoolTypes,
  indirectRateEntryValidator,
  indirectRatesFieldErrors
} from "@carbon/ee/indirect-rates";
import {
  deleteIndirectPool as eeDeleteIndirectPool,
  deleteIndirectPoolAccount as eeDeleteIndirectPoolAccount,
  runFinalTrueUp as eeRunFinalTrueUp,
  runIndirectRatePeriod as eeRunIndirectRatePeriod,
  setIndirectRate as eeSetIndirectRate,
  upsertIndirectPool as eeUpsertIndirectPool,
  upsertIndirectPoolAccount as eeUpsertIndirectPoolAccount
} from "@carbon/ee/indirect-rates.server";
import * as pegging from "@carbon/ee/pegging.server";
import { upsertPlanningGroup as eeUpsertPlanningGroup } from "@carbon/ee/pegging.server";
import {
  elementEarnedValueValidator,
  projectControlSettingsValidator,
  stopWorkValidator
} from "@carbon/ee/project-control";
import {
  resumeWork,
  stopWork,
  updateProjectControlSettings as updateControlSettings,
  updateElementEarnedValue
} from "@carbon/ee/project-control.server";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import { NotificationEvent } from "@carbon/notifications";
import {
  applyRate,
  datetime,
  formatDate,
  getErrorMessage,
  round,
  SCALE,
  taxableBase
} from "@carbon/utils";
import { z } from "zod";
import {
  invokeAssetTransfer,
  upsertReportPin
} from "~/modules/accounting/accounting.service";
import { jobCreationRefusal } from "~/modules/items/items.service";
import { getSupplierPartPricing } from "~/modules/items/items.utils";
import { insertJob } from "~/modules/production/production.service";
import {
  insertPurchaseOrder,
  upsertPurchaseOrderLine
} from "~/modules/purchasing/purchasing.service";
import { getCompanySettings } from "~/modules/settings/settings.service";
import { resolveSupplierPrice } from "~/modules/shared/shared.utils";
import {
  billableItemActionValidator,
  buildFromPartValidator,
  COST_OBJECTIVE_REQUIRED,
  canChangeProjectStatus,
  createJobFromMaterialValidator,
  createPurchaseOrderLineFromMaterialValidator,
  isPlanLayerField,
  isProjectReportKey,
  laborCategoryRateValidator,
  laborCategoryValidator,
  logTimeValidator,
  manualPegSupplyTypes,
  NEW_PURCHASE_ORDER,
  placeInServiceValidator,
  planningGroupExcessRules,
  planningGroupPriorityRules,
  projectBaselineValidator,
  projectBorrowStatuses,
  projectChangeRequestCommentValidator,
  projectChangeRequestIntentFrom,
  projectChangeRequestStatusValidator,
  projectChangeRequestValidator,
  projectCostTypes,
  projectElementCommentValidator,
  projectElementCostValidator,
  projectElementFieldUpdateValidator,
  projectElementLaborValidator,
  projectElementLinkValidator,
  projectElementMaterialValidator,
  projectElementTypes,
  projectElementValidator,
  projectExpenseValidator,
  projectIssueValidator,
  projectLabelValidator,
  projectMemberValidator,
  projectMilestoneValidator,
  projectPlanTables,
  projectStateGroups,
  projectStateValidator,
  projectStatuses,
  projectStockTransferActions,
  projectStockTransferLineValidator,
  projectStockTransferValidator,
  projectValidator,
  rdActivityRoles,
  stopWorkStatusRefusal,
  timesheetCorrectionValidator,
  timesheetReviewAcceptValidator,
  toStockOwner
} from "./projects.models";
import * as service from "./projects.service";
import * as utils from "./projects.utils";

const logger = getLogger("erp", "projects");

// --- Projects, states, labels, milestones, members, costs ----------------------

// --- Projects ----------------------------------------------------------------

/**
 * Get a project.
 *
 * @remarks
 * Gets one project of the company, with every column.
 *
 * @mcp read
 */
export const getProject = defineServiceFn({
  input: z.object({ projectId: z.string() }),
  permission: { view: "projects" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getProject(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.projectId
      )
    );
  }
});

/**
 * Get the projects the project switcher lists.
 *
 * @remarks
 * The projects the project workspace's switcher lists: id, identifier and
 * name of the active Standard projects that are not templates, by
 * identifier, at most 200.
 *
 * @mcp read
 */
export const getProjectSwitcherOptions = defineServiceFn({
  input: z.object({}),
  permission: { view: "projects" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getProjectSwitcherOptions(
        ctx.asCaller.supabase,
        ctx.company.id
      )
    );
  }
});

/**
 * Get the company's projects.
 *
 * @remarks
 * Lists the active Standard projects of the company. A Service project
 * belongs to its service order and is listed in Service.
 *
 * @param search - Matches the name, identifier or description.
 * @param status - Only projects in these statuses.
 * @param costTreatment - Only projects with these cost treatments.
 * @param ownerId - Only projects this user owns.
 *
 * @mcp read
 */
export const getProjects = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().default(null),
    status: z
      .array(z.enum(Constants.public.Enums.projectStatus))
      .nullable()
      .optional(),
    costTreatment: z
      .array(z.enum(Constants.public.Enums.projectCostTreatment))
      .nullable()
      .optional(),
    ownerId: z.string().nullable().optional()
  }),
  permission: { view: "projects" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getProjects(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Create a project.
 *
 * @remarks
 * Creates a Draft project in one transaction: from scratch, as a copy of
 * `sourceProjectId` (its milestones, elements, labels, links and plan lines),
 * or with the elements of the MIL-STD-881F template `wbsTemplateKey`. Under
 * DCAA timekeeping every project needs a cost objective.
 */
export const createProject = defineServiceFn({
  input: projectValidator.safeExtend({
    sourceProjectId: z.string().optional(),
    wbsTemplateKey: z.string().optional()
  }),
  permission: { create: "projects" },
  async run(ctx, input) {
    const companyId = ctx.company.id;
    const { id: _id, sourceProjectId, wbsTemplateKey, ...project } = input;

    // DCAA timekeeping: every project needs a cost objective.
    if (!project.costObjective) {
      const settings = await getCompanySettings(
        ctx.asCaller.supabase,
        companyId
      );
      if (settings.data?.timekeepingControls === "DCAA") {
        return ctx.error("validation", COST_OBJECTIVE_REQUIRED);
      }
    }

    try {
      const projectId = sourceProjectId
        ? await service.copyProject(ctx.asSystem.pg, {
            ...project,
            companyId,
            userId: ctx.auditUserId,
            sourceProjectId
          })
        : await service.createProject(ctx.asSystem.pg, {
            ...project,
            companyId,
            userId: ctx.auditUserId,
            wbsTemplateKey
          });
      return { projectId };
    } catch (err) {
      return ctx.error(
        "internal",
        "Failed to create the project. Check that its identifier is not in use.",
        err
      );
    }
  }
});

/**
 * Create or update a project.
 *
 * @remarks
 * Creates or updates a project. A project created here gets no states; the
 * app creates projects with `createProject`, which seeds them. With `id` it
 * updates that project, else it creates one.
 *
 * @mcp
 */
export const upsertProject = defineServiceFn({
  input: projectValidator,
  permission: { create: "projects", update: "projects" },
  async run(ctx, { id, ...project }) {
    if (id) {
      return unwrap(
        ctx,
        await service.upsertProject(
          ctx.asCaller.supabase,
          payload(ctx, { ...project, id }).forUpdate() as never
        )
      );
    }
    return unwrap(
      ctx,
      await service.upsertProject(
        ctx.asCaller.supabase,
        payload(ctx, project).forCreate() as never
      )
    );
  }
});

/**
 * Update the details of a project.
 *
 * @remarks
 * Saves the project's fields; the identifier is fixed once the project
 * exists. Under DCAA timekeeping every project needs a cost objective. The
 * lock milestone must be one of the project's milestones. Project stock is
 * chosen while Draft only. Only a project with project stock may join a
 * planning group, and only a group at the project's location. A released
 * project that becomes Capitalize gets its assets under construction; when
 * that fails the project is saved and `warning` says so.
 *
 * @mcp
 */
export const updateProject = defineServiceFn({
  input: projectValidator.safeExtend({ id: z.string() }),
  permission: { update: "projects" },
  async run(ctx, input) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const projectId = input.id;
    // The identifier is fixed once the project exists: every element's
    // stored readable id starts with it.
    const { id: _id, identifier: _identifier, ...fields } = input;

    // DCAA timekeeping: every project needs a cost objective.
    if (!fields.costObjective) {
      const settings = await getCompanySettings(client, companyId);
      if (settings.data?.timekeepingControls === "DCAA") {
        return ctx.error("validation", COST_OBJECTIVE_REQUIRED);
      }
    }

    // The lock milestone must be one of this project's milestones.
    if (fields.lockPlanAfterMilestoneId) {
      const milestone = await client
        .from("projectMilestone")
        .select("id")
        .eq("id", fields.lockPlanAfterMilestoneId)
        .eq("projectId", projectId)
        .eq("companyId", companyId)
        .maybeSingle();
      if (milestone.error || !milestone.data) {
        return ctx.error("validation", "Choose a milestone of this project");
      }
    }

    // Project stock is chosen while Draft only: after that the switch is
    // disabled, so its absent value never turns it off.
    const current = await service.getProject(client, companyId, projectId);
    if (current.error) {
      return ctx.error("internal", "Failed to load the project", current.error);
    }
    const { projectStock, planningGroupId, planningPriority, ...rest } = fields;

    // Planning group (Projects Phase 3): only a project with project stock
    // may join, and only a group at the project's location. Joining or
    // leaving changes planning only; open stock stays in the project's stripe.
    const hasProjectStock =
      current.data.status === "Draft"
        ? (projectStock ?? false)
        : current.data.projectStock;
    if (planningGroupId) {
      if (!hasProjectStock) {
        return ctx.error(
          "validation",
          "Only a project with project stock can join a group"
        );
      }
      const group = await client
        .from("planningGroup")
        .select("id, locationId")
        .eq("id", planningGroupId)
        .eq("companyId", companyId)
        .maybeSingle();
      if (group.error || !group.data) {
        return ctx.error("validation", "Choose a planning group");
      }
      if (group.data.locationId !== fields.locationId) {
        return ctx.error(
          "validation",
          "The group must be at the project's location"
        );
      }
    }

    const update = await service.updateProject(client, {
      ...rest,
      ...(current.data.status === "Draft"
        ? { projectStock: projectStock ?? false }
        : {}),
      planningGroupId: hasProjectStock
        ? (planningGroupId ?? undefined)
        : undefined,
      ...(planningPriority !== undefined ? { planningPriority } : {}),
      id: projectId,
      companyId,
      updatedBy: ctx.auditUserId
    });
    if (update.error) {
      return ctx.error(
        "internal",
        "Failed to update the project",
        update.error
      );
    }

    // A released project that becomes Capitalize needs its assets under
    // construction before it takes charges.
    if (
      fields.costTreatment === "Capitalize" &&
      current.data.status !== "Draft"
    ) {
      try {
        await service.ensureCapitalAssets(ctx.asSystem.pg, {
          companyId,
          userId: ctx.auditUserId,
          projectId
        });
      } catch (err) {
        logger.error("Failed to create the capital assets", {
          companyId,
          projectId,
          error: err
        });
        return {
          id: projectId,
          warning: "Failed to create the assets under construction"
        };
      }
    }

    return { id: projectId, warning: null };
  }
});

/**
 * Mark a project as a template, or unmark it.
 *
 * @remarks
 * A template is listed first in the new project form's Copy from.
 */
export const updateProjectTemplate = defineServiceFn({
  input: z.object({ projectId: z.string(), isTemplate: z.boolean() }),
  permission: { update: "projects" },
  async run(ctx, input) {
    const result = await service.updateProjectTemplate(ctx.asCaller.supabase, {
      id: input.projectId,
      companyId: ctx.company.id,
      isTemplate: input.isTemplate,
      updatedBy: ctx.auditUserId
    });
    if (result.error) {
      return ctx.error(
        "internal",
        "Failed to change the template flag",
        result.error
      );
    }
    return { id: input.projectId };
  }
});

/**
 * Change the status of a project.
 *
 * @remarks
 * Refuses any status but On Hold while the project has a stop-work order
 * (use Resume), and a change the project's current status does not allow.
 * Releasing a capital project first creates its assets under construction.
 * Closing refuses while the project has an open purchase order line or an
 * open job.
 *
 * @mcp
 */
export const updateProjectStatus = defineServiceFn({
  input: z.object({
    projectId: z.string(),
    status: z.enum(projectStatuses)
  }),
  permission: { update: "projects" },
  async run(ctx, { projectId, status }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;

    const project = await service.getProject(client, companyId, projectId);
    if (project.error || !project.data) {
      return ctx.error("internal", "Failed to load project", project.error);
    }

    // C16: the building block refuses this too. Asking first means a stopped
    // project creates no capital assets below.
    const stopped = stopWorkStatusRefusal(project.data.stopWorkDate, status);
    if (stopped) return ctx.error("rule", stopped);

    if (!canChangeProjectStatus(project.data.status, status)) {
      return ctx.error(
        "rule",
        `A ${project.data.status} project cannot change to ${status}`
      );
    }

    // A capital project needs its assets under construction before it takes
    // charges. Create them before the status changes: the call is safe to
    // repeat, so a failed status change leaves nothing wrong behind.
    if (status === "Released") {
      try {
        await service.ensureCapitalAssets(ctx.asSystem.pg, {
          companyId,
          userId: ctx.auditUserId,
          projectId
        });
      } catch (err) {
        return ctx.error(
          "internal",
          "Failed to create the assets under construction",
          err
        );
      }
    }

    const update = await service.updateProjectStatus(client, {
      id: projectId,
      companyId,
      status,
      updatedBy: ctx.auditUserId
    });
    if (update.error) {
      // A refusal of the building block has a message and no code.
      return "code" in update.error && update.error.code
        ? ctx.error(
            "internal",
            update.error.message ?? "Failed to update the project status",
            update.error
          )
        : ctx.error("rule", update.error.message);
    }
    return { projectId, status };
  }
});

/**
 * Deactivate a project.
 *
 * @remarks
 * Deactivates a project. The row stays so its history still resolves.
 *
 * @mcp destructive
 */
export const deleteProject = defineServiceFn({
  input: z.object({ projectId: z.string() }),
  permission: { delete: "projects" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteProject(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.projectId,
        ctx.auditUserId
      )
    );
  }
});

// --- Stop work (Government Contracting 5c) ------------------------------------

/**
 * Issue a stop-work order on a project.
 *
 * @remarks
 * FAR 52.242-15: sets a Released Direct project On Hold with the order
 * date. Government Contracting is a commercial feature: without it the call
 * is refused.
 */
export const stopProjectWork = defineServiceFn({
  input: stopWorkValidator,
  permission: { update: "projects" },
  async run(ctx, input) {
    try {
      const result = await stopWork(ctx.asCaller.supabase, {
        companyId: ctx.company.id,
        userId: ctx.auditUserId,
        projectId: input.projectId,
        orderDate: input.orderDate
      });
      if (result.error) {
        return "code" in result.error && result.error.code
          ? ctx.error(
              "internal",
              result.error.message ?? "Failed to stop work",
              result.error
            )
          : ctx.error("rule", result.error.message ?? "Failed to stop work");
      }
      return { projectId: input.projectId };
    } catch (err) {
      if (err instanceof EntitlementError) {
        return ctx.error("entitlement", err.message);
      }
      throw err;
    }
  }
});

/**
 * Resume work on a project with a stop-work order.
 *
 * @remarks
 * Returns the project to Released and clears the order. Not gated, so a
 * company that loses Government Contracting can still release a stopped
 * project.
 */
export const resumeProjectWork = defineServiceFn({
  input: z.object({ projectId: z.string() }),
  permission: { update: "projects" },
  async run(ctx, input) {
    const result = await resumeWork(ctx.asCaller.supabase, {
      companyId: ctx.company.id,
      userId: ctx.auditUserId,
      projectId: input.projectId
    });
    if (result.error) {
      return "code" in result.error && result.error.code
        ? ctx.error(
            "internal",
            result.error.message ?? "Failed to resume work",
            result.error
          )
        : ctx.error("rule", result.error.message ?? "Failed to resume work");
    }
    return { projectId: input.projectId };
  }
});

/**
 * Save the project control settings of a project.
 *
 * @remarks
 * Budget control, its tolerance and the material measurement point
 * (Government Contracting 5c). A commercial feature: without it the call is
 * refused.
 */
export const updateProjectControlSettings = defineServiceFn({
  input: projectControlSettingsValidator,
  permission: { update: "projects" },
  async run(ctx, input) {
    try {
      const result = await updateControlSettings(ctx.asCaller.supabase, {
        ...input,
        companyId: ctx.company.id,
        userId: ctx.auditUserId
      });
      if (result.error) {
        return ctx.error(
          "internal",
          "Failed to save the control settings",
          result.error
        );
      }
      return { projectId: input.projectId };
    } catch (err) {
      if (err instanceof EntitlementError) {
        return ctx.error("entitlement", err.message);
      }
      throw err;
    }
  }
});

// --- Members -----------------------------------------------------------------

/**
 * Get a project's members.
 *
 * @remarks
 * Lists the members of a project: the employees who may charge time to it
 * when it restricts charging.
 *
 * @mcp read
 */
export const getProjectMembers = defineServiceFn({
  input: z.object({ projectId: z.string() }),
  permission: { view: "projects" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getProjectMembers(
        ctx.asCaller.supabase,
        input.projectId,
        ctx.company.id
      )
    );
  }
});

/**
 * Add an employee to a project's members.
 *
 * @remarks
 * The member must be an employee of the company. Adding a member twice
 * changes nothing.
 *
 * @param userId - The employee's user id.
 *
 * @mcp
 */
export const addProjectMember = defineServiceFn({
  input: projectMemberValidator,
  permission: { update: "projects" },
  async run(ctx, input) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;

    // A member must be an employee of this company.
    const employee = await client
      .from("employee")
      .select("id")
      .eq("id", input.userId)
      .eq("companyId", companyId)
      .maybeSingle();
    if (employee.error || !employee.data) {
      return ctx.error("validation", "Choose an employee of this company");
    }

    const result = await service.addProjectMember(client, {
      projectId: input.projectId,
      userId: input.userId,
      companyId,
      createdBy: ctx.auditUserId
    });
    if (result.error) {
      return ctx.error("internal", "Failed to add the member", result.error);
    }
    return { projectId: input.projectId, userId: input.userId };
  }
});

/**
 * Remove an employee from a project's members.
 *
 * @param userId - The employee's user id.
 *
 * @mcp destructive
 */
export const removeProjectMember = defineServiceFn({
  input: projectMemberValidator,
  permission: { update: "projects" },
  async run(ctx, input) {
    const result = await service.removeProjectMember(ctx.asCaller.supabase, {
      projectId: input.projectId,
      userId: input.userId,
      companyId: ctx.company.id
    });
    if (result.error) {
      return ctx.error("internal", "Failed to remove the member", result.error);
    }
    return { projectId: input.projectId, userId: input.userId };
  }
});

// --- Charge numbers ----------------------------------------------------------

/**
 * Get the charge numbers a user can charge.
 *
 * @remarks
 * Lists what a user can charge: each Released project, and each chargeable
 * element of a Released project whose state is Unstarted or Started. When
 * the company requires an element, the project-only rows are left out.
 *
 * @mcp read
 */
export const getChargeNumbers = defineServiceFn({
  input: z.object({}),
  permission: { view: "projects" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getChargeNumbers(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

// --- States (Settings → Projects) --------------------------------------------

/**
 * Get the company's project states.
 *
 * @remarks
 * Lists the company's project states in board order. States are
 * company-wide: every project and service order uses them.
 *
 * @mcp read
 */
export const getProjectStates = defineServiceFn({
  input: z.object({}),
  permission: { view: "projects" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getProjectStates(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Create or update a project state.
 *
 * @remarks
 * Creates or updates a project state of the company. A new state goes after
 * the last state. With `id` it updates that state, else it creates one.
 *
 * @mcp
 */
export const upsertProjectState = defineServiceFn({
  input: projectStateValidator,
  permission: { update: "settings" },
  async run(ctx, { id, ...state }) {
    const result = id
      ? await service.upsertProjectState(ctx.asCaller.supabase, {
          ...state,
          id,
          companyId: ctx.company.id,
          updatedBy: ctx.auditUserId
        })
      : await service.upsertProjectState(ctx.asCaller.supabase, {
          ...state,
          companyId: ctx.company.id,
          createdBy: ctx.auditUserId
        });
    if (result.error) {
      return result.error.code === "23505"
        ? ctx.error("conflict", "A state with this name already exists")
        : ctx.error("internal", "Failed to save the state", result.error);
    }
    return result.data;
  }
});

/**
 * Delete a project state.
 *
 * @remarks
 * Deletes a project state of the company. Refuses when an element of any
 * project uses the state or when it is the last state of its group. When the
 * state is its group's default, the next state of the group becomes the
 * default.
 *
 * @mcp destructive
 */
export const deleteProjectState = defineServiceFn({
  input: z.object({ id: z.string() }),
  permission: { update: "settings" },
  async run(ctx, input) {
    const result = await service.deleteProjectState(ctx.asSystem.pg, {
      companyId: ctx.company.id,
      id: input.id
    });
    if (result.error) return ctx.error("rule", result.error.message);
    return result.data;
  }
});

/**
 * Make a project state the default of its group.
 *
 * @remarks
 * Makes a state the default of its group, in one transaction. The group's
 * previous default stops being the default. A new element of the group's
 * kind takes the default state.
 *
 * @mcp
 */
export const setProjectStateDefault = defineServiceFn({
  input: z.object({ id: z.string() }),
  permission: { update: "settings" },
  async run(ctx, input) {
    const result = await service.setProjectStateDefault(ctx.asSystem.pg, {
      companyId: ctx.company.id,
      id: input.id,
      updatedBy: ctx.auditUserId
    });
    if (result.error) return ctx.error("rule", result.error.message);
    return result.data;
  }
});

// --- Labels (Settings → Projects) --------------------------------------------

/**
 * Get the company's project labels.
 *
 * @remarks
 * Lists the company's project labels. Labels are company-wide.
 *
 * @mcp read
 */
export const getProjectLabels = defineServiceFn({
  input: z.object({}),
  permission: { view: "projects" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getProjectLabels(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Create or update a project label.
 *
 * @remarks
 * Creates or updates a project label of the company. With `id` it updates
 * that label, else it creates one.
 *
 * @mcp
 */
export const upsertProjectLabel = defineServiceFn({
  input: projectLabelValidator,
  permission: { update: "settings" },
  async run(ctx, { id, ...label }) {
    const result = id
      ? await service.upsertProjectLabel(ctx.asCaller.supabase, {
          ...label,
          id,
          companyId: ctx.company.id,
          updatedBy: ctx.auditUserId
        })
      : await service.upsertProjectLabel(ctx.asCaller.supabase, {
          ...label,
          companyId: ctx.company.id,
          createdBy: ctx.auditUserId
        });
    if (result.error) {
      return result.error.code === "23505"
        ? ctx.error("conflict", "A label with this name already exists")
        : ctx.error("internal", "Failed to save the label", result.error);
    }
    return result.data;
  }
});

/**
 * Delete a project label.
 *
 * @remarks
 * Deletes a project label of the company. Its element links go with it.
 *
 * @mcp destructive
 */
export const deleteProjectLabel = defineServiceFn({
  input: z.object({ id: z.string() }),
  permission: { update: "settings" },
  async run(ctx, input) {
    const result = await service.deleteProjectLabel(
      ctx.asCaller.supabase,
      input.id,
      ctx.company.id
    );
    if (result.error) {
      return ctx.error("internal", "Failed to delete the label", result.error);
    }
    return { id: input.id };
  }
});

// --- Milestones --------------------------------------------------------------

/**
 * Get a project's milestones.
 *
 * @remarks
 * Lists the milestones of a project by date.
 *
 * @mcp read
 */
export const getProjectMilestones = defineServiceFn({
  input: z.object({ projectId: z.string() }),
  permission: { view: "projects" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getProjectMilestones(
        ctx.asCaller.supabase,
        input.projectId,
        ctx.company.id
      )
    );
  }
});

/**
 * Create or update a project milestone.
 *
 * @remarks
 * Creates or updates a milestone of a project. With `id` it updates that
 * milestone, else it creates one on `projectId`.
 *
 * @mcp
 */
export const upsertProjectMilestone = defineServiceFn({
  input: projectMilestoneValidator.safeExtend({ projectId: z.string() }),
  permission: { update: "projects" },
  async run(ctx, { id, projectId, ...milestone }) {
    const result = id
      ? await service.upsertProjectMilestone(ctx.asCaller.supabase, {
          ...milestone,
          id,
          companyId: ctx.company.id,
          updatedBy: ctx.auditUserId
        })
      : await service.upsertProjectMilestone(ctx.asCaller.supabase, {
          ...milestone,
          projectId,
          companyId: ctx.company.id,
          createdBy: ctx.auditUserId
        });
    if (result.error) {
      return ctx.error(
        "internal",
        "Failed to save the milestone",
        result.error
      );
    }
    return result.data;
  }
});

/**
 * Complete a project milestone, or reopen it.
 *
 * @remarks
 * Completes a milestone now, or reopens it when `completed` is false. A
 * completed milestone writes a baseline of the plan layer. The milestone is
 * already saved then, so a failed baseline only sets `baselineFailed`.
 *
 * @mcp
 */
export const completeProjectMilestone = defineServiceFn({
  input: z.object({ id: z.string(), completed: z.boolean() }),
  permission: { update: "projects" },
  async run(ctx, input) {
    const companyId = ctx.company.id;
    const result = await service.completeProjectMilestone(
      ctx.asCaller.supabase,
      {
        id: input.id,
        companyId,
        completed: input.completed,
        updatedBy: ctx.auditUserId
      }
    );
    if (result.error) {
      return ctx.error(
        "internal",
        "Failed to update the milestone",
        result.error
      );
    }
    if (!input.completed) return { ...result.data, baselineFailed: false };

    try {
      await service.createProjectBaseline(ctx.asSystem.pg, {
        companyId,
        userId: ctx.auditUserId,
        projectId: result.data.projectId,
        name: `${result.data.name} (completed)`,
        source: "Milestone",
        milestoneId: result.data.id
      });
    } catch (err) {
      logger.error("Failed to write the milestone baseline", {
        err,
        milestoneId: result.data.id
      });
      return { ...result.data, baselineFailed: true };
    }
    return { ...result.data, baselineFailed: false };
  }
});

/**
 * Delete a project milestone.
 *
 * @remarks
 * Deletes a milestone of a project. Elements on it lose the milestone.
 *
 * @mcp destructive
 */
export const deleteProjectMilestone = defineServiceFn({
  input: z.object({ id: z.string() }),
  permission: { update: "projects" },
  async run(ctx, input) {
    const result = await service.deleteProjectMilestone(
      ctx.asCaller.supabase,
      input.id,
      ctx.company.id
    );
    if (result.error) {
      return ctx.error(
        "internal",
        "Failed to delete the milestone",
        result.error
      );
    }
    return { id: input.id };
  }
});

// --- Ledger, costs and reports -----------------------------------------------

/**
 * Get a project's ledger rows.
 *
 * @remarks
 * Lists project ledger rows, newest posting first. Filters are the project,
 * element ids and cost type.
 *
 * @mcp read
 */
export const getProjectLedger = defineServiceFn({
  input: z.looseObject({
    projectId: z.string(),
    projectElementIds: z.array(z.string()).nullable().optional(),
    costType: z.enum(projectCostTypes).nullable().optional(),
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0)
  }),
  permission: { view: "projects" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getProjectLedger(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get the budget and estimate of every element of a project.
 *
 * @remarks
 * Lists every element of a project with its budget and estimate at
 * completion, for the Costs tab. Pages through the rows.
 *
 * @mcp read
 */
export const getProjectElementCosts = defineServiceFn({
  input: z.object({ projectId: z.string() }),
  permission: { view: "projects" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getProjectElementCosts(
        ctx.asCaller.supabase,
        input.projectId,
        ctx.company.id
      )
    );
  }
});

/**
 * Get a project's timesheet entries that are not posted.
 *
 * @remarks
 * Lists the timesheet entries of a project that are not Posted yet, newest
 * first (at most 500).
 *
 * @mcp read
 */
export const getProjectOpenTimesheetEntries = defineServiceFn({
  input: z.object({ projectId: z.string() }),
  permission: { view: "projects" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getProjectOpenTimesheetEntries(
        ctx.asCaller.supabase,
        input.projectId,
        ctx.company.id
      )
    );
  }
});

/**
 * Get a project's cost summary.
 *
 * @remarks
 * Gets plan, committed, actual and hours per element of a project, plus one
 * row with no element for charges to the project itself.
 *
 * @mcp read
 */
export const getProjectCostSummary = defineServiceFn({
  input: z.object({ projectId: z.string() }),
  permission: { view: "projects" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getProjectCostSummary(
        ctx.asCaller.supabase,
        input.projectId,
        ctx.company.id
      )
    );
  }
});

/**
 * Get a project's burden summary.
 *
 * @remarks
 * Gets the burden of a project per element and indirect pool, with its
 * unallowable part (government contracting Phase 5b). Empty for a project
 * the burden run never burdened.
 *
 * @mcp read
 */
export const getProjectBurdenSummary = defineServiceFn({
  input: z.object({ projectId: z.string() }),
  permission: { view: "projects" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getProjectBurdenSummary(
        ctx.asCaller.supabase,
        input.projectId,
        ctx.company.id
      )
    );
  }
});

/**
 * Get the company's business components.
 *
 * @remarks
 * The business components of the company (R&D tax): id, readable id, name,
 * component type and software type.
 *
 * @mcp read
 */
export const getRdComponents = defineServiceFn({
  input: z.object({}),
  permission: { view: "projects" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getRdComponents(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Pin a project report for the caller, or unpin it.
 *
 * @remarks
 * The pins share `reportPin` with the accounting reports, so a project
 * report's key is stored with the `projects:` prefix to keep the two sets
 * apart. Refuses a key that names no project report.
 */
export const upsertProjectReportPin = defineServiceFn({
  input: z.object({ reportKey: z.string().min(1), pinned: z.boolean() }),
  permission: { view: "projects" },
  async run(ctx, input) {
    if (!isProjectReportKey(input.reportKey)) {
      return ctx.error("notFound", "The report could not be found");
    }
    const result = await upsertReportPin(ctx.asCaller.supabase, {
      reportKey: `projects:${input.reportKey}`,
      pinned: input.pinned,
      userId: ctx.auditUserId,
      companyId: ctx.company.id
    });
    if (result.error) {
      return ctx.error("internal", "Failed to update pin", result.error);
    }
    return { reportKey: input.reportKey, pinned: input.pinned };
  }
});

// --- Change requests, baselines, WBS -------------------------------------------

// --- Baselines ---------------------------------------------------------------

/**
 * Get a project's baselines.
 *
 * @remarks
 * Lists the baselines of a project, newest first, without their snapshots.
 *
 * @mcp read
 */
export const getProjectBaselines = defineServiceFn({
  input: z.object({ projectId: z.string() }),
  permission: { view: "projects" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getProjectBaselines(
        ctx.asCaller.supabase,
        input.projectId,
        ctx.company.id
      )
    );
  }
});

/**
 * Get a project baseline.
 *
 * @remarks
 * Loads one baseline with its plan snapshot.
 *
 * @mcp read
 */
export const getProjectBaseline = defineServiceFn({
  input: z.object({ id: z.string() }),
  permission: { view: "projects" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getProjectBaseline(
        ctx.asCaller.supabase,
        input.id,
        ctx.company.id
      )
    );
  }
});

/**
 * Take a baseline of a project's plan.
 *
 * @remarks
 * Snapshots the plan layer (elements, links and plan lines) as a Manual
 * baseline, numbered from the project's next baseline sequence, in one
 * transaction.
 */
export const createProjectBaseline = defineServiceFn({
  input: projectBaselineValidator.extend({ projectId: z.string() }),
  permission: { update: "projects" },
  async run(ctx, input) {
    try {
      return await service.createProjectBaseline(ctx.asSystem.pg, {
        companyId: ctx.company.id,
        userId: ctx.auditUserId,
        projectId: input.projectId,
        name: input.name,
        source: "Manual"
      });
    } catch (err) {
      return ctx.error("internal", "Failed to take the baseline", err);
    }
  }
});

// --- Change requests -----------------------------------------------------------

/**
 * Get a project's change requests.
 *
 * @remarks
 * Lists the change requests of a project, newest first, with their item
 * counts.
 *
 * @mcp read
 */
export const getProjectChangeRequests = defineServiceFn({
  input: z.object({ projectId: z.string() }),
  permission: { view: "projects" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getProjectChangeRequests(
        ctx.asCaller.supabase,
        input.projectId,
        ctx.company.id
      )
    );
  }
});

/**
 * Get a project change request.
 *
 * @remarks
 * Loads one change request with its title, reason, status and decision.
 *
 * @mcp read
 */
export const getProjectChangeRequest = defineServiceFn({
  input: z.object({ id: z.string() }),
  permission: { view: "projects" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getProjectChangeRequest(
        ctx.asCaller.supabase,
        input.id,
        ctx.company.id
      )
    );
  }
});

/**
 * Open a change request on a project.
 *
 * @remarks
 * Creates a Draft change request with the next `<identifier>-CR-<n>` id and
 * a baseline of the plan it starts from, in one transaction. A Closed
 * project cannot change.
 */
export const createProjectChangeRequest = defineServiceFn({
  input: projectChangeRequestValidator.extend({ projectId: z.string() }),
  permission: { update: "projects" },
  async run(ctx, input) {
    const companyId = ctx.company.id;
    const project = await service.getProject(
      ctx.asCaller.supabase,
      companyId,
      input.projectId
    );
    if (project.error || !project.data) {
      return ctx.error("notFound", "Failed to load the project", project.error);
    }
    if (project.data.status === "Closed") {
      return ctx.error("rule", "A Closed project cannot change");
    }

    try {
      return await service.createChangeRequest(ctx.asSystem.pg, {
        companyId,
        userId: ctx.auditUserId,
        projectId: input.projectId,
        title: input.title,
        reason: input.reason
      });
    } catch (err) {
      return ctx.error("internal", "Failed to open the change request", err);
    }
  }
});

/**
 * Move a change request through its lifecycle.
 *
 * @remarks
 * `intent` picks the step:
 * - `submit` (Draft → In Review) refuses an empty change request, opens an
 *   approval request when a rule applies and notifies its approvers;
 * - `approve` and `reject` decide through the approval request when one is
 *   pending (only its approvers may), else directly; an approval then
 *   applies the change request to the live plan. An apply the live plan
 *   changed under is refused and the change request stays Approved;
 * - `cancel` (Draft or In Review → Cancelled) cancels a pending approval
 *   request;
 * - `reopen` (Rejected, or Approved after a conflict → Draft) drops the
 *   changes that no longer fit the current plan.
 * Returns the message to show.
 */
export const updateProjectChangeRequestStatus = defineServiceFn({
  input: projectChangeRequestStatusValidator.extend({
    projectId: z.string(),
    changeRequestId: z.string()
  }),
  permission: { update: "projects" },
  async run(ctx, input) {
    const { projectId, changeRequestId, intent, notes } = input;
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;
    const client = ctx.asCaller.supabase;
    const serviceRole = ctx.asSystem.supabase;
    const db = ctx.asSystem.pg;

    const changeRequest = await service.getProjectChangeRequest(
      client,
      changeRequestId,
      companyId
    );
    if (changeRequest.error || changeRequest.data.projectId !== projectId) {
      return ctx.error(
        "notFound",
        "The change request does not exist",
        changeRequest.error
      );
    }
    const { status, readableId } = changeRequest.data;
    if (!projectChangeRequestIntentFrom[intent].includes(status)) {
      return ctx.error(
        "conflict",
        `A ${status} change request cannot ${intent}`
      );
    }

    const scope = { companyId, userId, projectId, changeRequestId };
    // The notification carries the project too, so its link can open the page.
    const notificationDocumentId = `${projectId}:${changeRequestId}`;

    // The pending approval request of this change request, proven to be this
    // company's: the service role reads it by an id the caller sent.
    const latest =
      intent === "reopen"
        ? null
        : await getLatestApprovalRequestForDocument(
            serviceRole,
            "projectChangeRequest",
            changeRequestId
          );
    const pendingApproval =
      latest?.data && latest.data.companyId === companyId ? latest.data : null;

    switch (intent) {
      case "submit": {
        const items = await service.countChangeRequestItems(
          client,
          changeRequestId,
          companyId
        );
        if (items.error) {
          return ctx.error("internal", "Failed to submit", items.error);
        }
        if ((items.count ?? 0) === 0) {
          return ctx.error("rule", "Change the plan before you submit");
        }

        if (
          !pendingApproval &&
          (await isApprovalRequired(
            serviceRole,
            "projectChangeRequest",
            companyId
          ))
        ) {
          const created = await createApprovalRequest(serviceRole, {
            documentType: "projectChangeRequest",
            documentId: changeRequestId,
            companyId,
            requestedBy: userId,
            createdBy: userId
          });
          if (created.error) {
            return ctx.error(
              "internal",
              "Failed to request approval",
              created.error
            );
          }
          const rule = await getApprovalRuleByAmount(
            serviceRole,
            "projectChangeRequest",
            companyId
          );
          const approverIds = rule.data
            ? await getApproverUserIdsForRule(serviceRole, rule.data)
            : [];
          if (approverIds.length > 0) {
            try {
              await trigger("notify", {
                event: NotificationEvent.ApprovalRequested,
                companyId,
                documentId: notificationDocumentId,
                documentType: "projectChangeRequest",
                recipient: { type: "users", userIds: approverIds },
                from: userId
              });
            } catch (e) {
              logger.error("Failed to trigger approval notification", {
                error: e
              });
            }
          }
        }

        const moved = await service.setChangeRequestStatus(db, {
          ...scope,
          from: ["Draft"],
          to: "In Review",
          set: { submittedAt: true }
        });
        if (!moved) return ctx.error("conflict", "Failed to submit");
        return { message: `${readableId} submitted for review` };
      }

      case "approve":
      case "reject": {
        const approved = intent === "approve";
        if (pendingApproval?.id) {
          const canApprove = await canApproveRequest(
            serviceRole,
            {
              amount: pendingApproval.amount,
              documentType: pendingApproval.documentType,
              companyId: pendingApproval.companyId
            },
            userId
          );
          if (!canApprove) {
            return ctx.error(
              "forbidden",
              "You do not have permission to approve this request"
            );
          }
          // The approvals engine moves the change request to Approved or
          // Rejected in its own transaction.
          const result = approved
            ? await approveRequest(
                db,
                pendingApproval.id,
                userId,
                notes || undefined
              )
            : await rejectRequest(
                db,
                pendingApproval.id,
                userId,
                notes || undefined
              );
          if (result.error) {
            return ctx.error(
              "rule",
              result.error.message ?? "Failed to record the decision",
              result.error
            );
          }
          if (
            pendingApproval.requestedBy &&
            pendingApproval.requestedBy !== userId
          ) {
            try {
              await trigger("notify", {
                event: approved
                  ? NotificationEvent.ApprovalApproved
                  : NotificationEvent.ApprovalRejected,
                companyId,
                documentId: notificationDocumentId,
                documentType: "projectChangeRequest",
                recipient: {
                  type: "user",
                  userId: pendingApproval.requestedBy
                },
                from: userId
              });
            } catch (e) {
              logger.error("Failed to trigger approval decision notification", {
                error: e
              });
            }
          }
        } else {
          // No approval rule applies: a user with `update: projects` decides.
          const moved = await service.setChangeRequestStatus(db, {
            ...scope,
            from: ["In Review"],
            to: approved ? "Approved" : "Rejected",
            set: { decided: true, decisionNotes: notes ?? null }
          });
          if (!moved) {
            return ctx.error("conflict", "Failed to record the decision");
          }
        }
        if (!approved) return { message: `${readableId} rejected` };

        // Applies the Approved change request. A conflict keeps it Approved
        // and lists the rows the live plan changed; the author reopens it.
        try {
          const { applied } = await service.applyChangeRequest(db, {
            companyId,
            userId,
            changeRequestId
          });
          return {
            message: applied
              ? `${readableId} applied`
              : `${readableId} approved`
          };
        } catch (err) {
          if (err instanceof service.ProjectChangeConflictError) {
            return ctx.error(
              "conflict",
              `${readableId} is approved but cannot apply: the current plan changed under ${err.conflicts.length} of its rows. Reopen it to fix them.`,
              err
            );
          }
          if (err instanceof service.ProjectChangeRequestError) {
            return ctx.error(
              "rule",
              `${readableId} is approved but cannot apply: ${err.message}`,
              err
            );
          }
          return ctx.error(
            "internal",
            `${readableId} is approved but failed to apply`,
            err
          );
        }
      }

      case "cancel": {
        if (pendingApproval?.id) {
          const cancelled = await cancelApprovalRequest(
            serviceRole,
            pendingApproval.id,
            userId
          );
          if (cancelled.error) {
            return ctx.error("rule", cancelled.error.message, cancelled.error);
          }
        }
        const moved = await service.setChangeRequestStatus(db, {
          ...scope,
          from: ["Draft", "In Review"],
          to: "Cancelled"
        });
        if (!moved) return ctx.error("conflict", "Failed to cancel");
        return { message: `${readableId} cancelled` };
      }

      case "reopen": {
        try {
          const { dropped } = await service.reopenChangeRequest(db, scope);
          return {
            message:
              dropped > 0
                ? `${readableId} reopened. ${dropped} change(s) no longer fit the current plan and were removed.`
                : `${readableId} reopened`
          };
        } catch (err) {
          if (err instanceof service.ProjectChangeRequestError) {
            return ctx.error("rule", err.message, err);
          }
          return ctx.error(
            "internal",
            err instanceof Error ? err.message : "Failed to reopen",
            err
          );
        }
      }
    }
  }
});

/**
 * Comment on a change request.
 *
 * @remarks
 * On the change request, on an element (`targetTable` + `targetId`) or on
 * one changed field of it (`field`).
 */
export const createProjectChangeRequestComment = defineServiceFn({
  input: projectChangeRequestCommentValidator.extend({
    projectId: z.string(),
    changeRequestId: z.string()
  }),
  permission: { view: "projects" },
  async run(ctx, input) {
    const changeRequest = await service.getProjectChangeRequest(
      ctx.asCaller.supabase,
      input.changeRequestId,
      ctx.company.id
    );
    if (
      changeRequest.error ||
      changeRequest.data.projectId !== input.projectId
    ) {
      return ctx.error(
        "notFound",
        "The change request does not exist",
        changeRequest.error
      );
    }
    const inserted = await service.insertProjectChangeRequestComment(
      ctx.asCaller.supabase,
      {
        companyId: ctx.company.id,
        userId: ctx.auditUserId,
        changeRequestId: input.changeRequestId,
        comment: input.comment,
        targetTable: input.targetTable,
        targetId: input.targetId,
        field: input.field
      }
    );
    if (inserted.error) {
      return ctx.error("internal", "Failed to comment", inserted.error);
    }
    return { changeRequestId: input.changeRequestId };
  }
});

/**
 * Resolve a comment of a change request.
 *
 * @remarks
 * Any reviewer who may change the project resolves a comment, not only its
 * author.
 */
export const resolveProjectChangeRequestComment = defineServiceFn({
  input: z.object({
    projectId: z.string(),
    changeRequestId: z.string(),
    id: z.string().min(1, { message: "No comment" })
  }),
  permission: { update: "projects" },
  async run(ctx, input) {
    const changeRequest = await service.getProjectChangeRequest(
      ctx.asCaller.supabase,
      input.changeRequestId,
      ctx.company.id
    );
    if (
      changeRequest.error ||
      changeRequest.data.projectId !== input.projectId
    ) {
      return ctx.error(
        "notFound",
        "The change request does not exist",
        changeRequest.error
      );
    }
    const resolved = await service.resolveProjectChangeRequestComment(
      ctx.asSystem.pg,
      {
        companyId: ctx.company.id,
        userId: ctx.auditUserId,
        changeRequestId: input.changeRequestId,
        id: input.id
      }
    );
    if (!resolved) {
      return ctx.error("notFound", "Failed to resolve the comment");
    }
    return { id: input.id };
  }
});

/**
 * Delete your own comment of a change request.
 *
 * @remarks
 * Only the comment's author deletes it.
 */
export const deleteProjectChangeRequestComment = defineServiceFn({
  input: z.object({
    projectId: z.string(),
    changeRequestId: z.string(),
    id: z.string().min(1, { message: "No comment" })
  }),
  permission: { view: "projects" },
  async run(ctx, input) {
    const changeRequest = await service.getProjectChangeRequest(
      ctx.asCaller.supabase,
      input.changeRequestId,
      ctx.company.id
    );
    if (
      changeRequest.error ||
      changeRequest.data.projectId !== input.projectId
    ) {
      return ctx.error(
        "notFound",
        "The change request does not exist",
        changeRequest.error
      );
    }
    const deleted = await service.deleteProjectChangeRequestComment(
      ctx.asCaller.supabase,
      {
        companyId: ctx.company.id,
        userId: ctx.auditUserId,
        changeRequestId: input.changeRequestId,
        id: input.id
      }
    );
    if (deleted.error) {
      return ctx.error("internal", "Failed to delete", deleted.error);
    }
    return { id: input.id };
  }
});

/**
 * Mark a changed row of a change request viewed, or clear the mark.
 *
 * @remarks
 * The mark is the user's own. A later change of the row makes it stale (the
 * review compares `viewedAt` with the items' last change).
 */
export const updateProjectChangeRequestView = defineServiceFn({
  input: z.object({
    changeRequestId: z.string(),
    targetTable: z.enum(projectPlanTables),
    targetId: z.string().min(1),
    viewed: z.boolean()
  }),
  permission: { view: "projects" },
  async run(ctx, input) {
    const result = await service.setProjectChangeRequestView(
      ctx.asCaller.supabase,
      { ...input, companyId: ctx.company.id, userId: ctx.auditUserId }
    );
    if (result.error) {
      return ctx.error("internal", "Failed to save the mark", result.error);
    }
    return { viewed: input.viewed };
  }
});

// --- WBS -----------------------------------------------------------------------

/**
 * Import a WBS CSV into a project.
 *
 * @remarks
 * `rows` are the CSV's rows, keyed by column header. With `apply` false it
 * reads them and writes nothing, returning what each row would do and its
 * errors; with `apply` true it creates, updates and links in one transaction
 * when no row has an error. Never deletes. Refused on a Closed project and
 * on a locked plan: import is a setup step. At most 5000 rows.
 */
export const importProjectWbs = defineServiceFn({
  input: z.object({
    projectId: z.string(),
    rows: z.array(z.record(z.string(), z.string().optional())),
    apply: z.boolean()
  }),
  // A row without an Element ID creates an element, as New element does.
  permission: { create: "projects", update: "projects" },
  async run(ctx, input) {
    const companyId = ctx.company.id;
    const client = ctx.asCaller.supabase;
    const project = await service.getProject(
      client,
      companyId,
      input.projectId
    );
    if (project.error || !project.data) {
      return ctx.error("notFound", "Failed to load the project", project.error);
    }
    if (project.data.status === "Closed") {
      return ctx.error("rule", "A Closed project cannot change");
    }

    const locked = await service.requireProjectPlanEditable(client, {
      projectId: input.projectId,
      companyId,
      changeRequestId: null
    });
    if (locked) return ctx.error("rule", locked);

    if (input.rows.length === 0) {
      return ctx.error("validation", "The file has no rows");
    }
    // The largest file the import reads.
    if (input.rows.length > 5000) {
      return ctx.error("validation", "The file has more than 5000 rows");
    }

    try {
      return await service.importProjectWbs(ctx.asSystem.pg, {
        companyId,
        userId: ctx.auditUserId,
        projectId: input.projectId,
        rows: input.rows,
        apply: input.apply
      });
    } catch (err) {
      return ctx.error(
        "internal",
        err instanceof Error ? err.message : "Failed to import the WBS",
        err
      );
    }
  }
});

/**
 * Pin a project's WBS codes.
 *
 * @remarks
 * Pins every derived WBS code of the project, as a contractor does at award:
 * afterwards a move keeps each element's code. Refuses while 2 elements have
 * the same code, and on a locked plan. Returns how many codes it pinned.
 */
export const pinProjectWbsCodes = defineServiceFn({
  input: z.object({ projectId: z.string() }),
  permission: { update: "projects" },
  async run(ctx, input) {
    const companyId = ctx.company.id;
    const locked = await service.requireProjectPlanEditable(
      ctx.asCaller.supabase,
      { projectId: input.projectId, companyId, changeRequestId: null }
    );
    if (locked) return ctx.error("rule", locked);

    try {
      const count = await service.pinProjectWbsCodes(ctx.asSystem.pg, {
        companyId,
        userId: ctx.auditUserId,
        projectId: input.projectId
      });
      return { count };
    } catch (err) {
      return ctx.error("internal", "Failed to pin the WBS codes", err);
    }
  }
});

/**
 * Unpin the WBS codes of an element and its subtree.
 *
 * @remarks
 * Clears the pinned WBS codes of the element and its descendants, so they
 * derive from the tree again. Refused on a locked plan. Returns how many
 * codes it unpinned.
 */
export const renumberProjectWbsSubtree = defineServiceFn({
  input: z.object({
    projectId: z.string(),
    elementId: z.string().min(1, { message: "Choose an element" })
  }),
  permission: { update: "projects" },
  async run(ctx, input) {
    const companyId = ctx.company.id;
    const locked = await service.requireProjectPlanEditable(
      ctx.asCaller.supabase,
      { projectId: input.projectId, companyId, changeRequestId: null }
    );
    if (locked) return ctx.error("rule", locked);

    try {
      const count = await service.renumberWbsSubtree(ctx.asSystem.pg, {
        companyId,
        userId: ctx.auditUserId,
        projectId: input.projectId,
        elementId: input.elementId
      });
      return { count };
    } catch (err) {
      return ctx.error("internal", "Failed to renumber the WBS", err);
    }
  }
});

// --- Elements, links, comments -------------------------------------------------

/** The Draft change request a plan-layer write goes into; null writes live. */
const changeRequestIdField = z
  .string()
  .nullish()
  .describe(
    "A Draft change request of the project: the change goes into it instead of the live plan. Required to change a locked plan."
  );

/** A drag-sort order of sibling elements. */
const sortOrderUpdates = z.array(
  z.object({ id: z.string().min(1), sortOrder: z.number() })
);

// --- Elements -----------------------------------------------------------------

/**
 * Get a project's elements.
 *
 * @remarks
 * Lists every element of a project with its state and label ids. Pages
 * through the rows, because a project can have more than 1000 elements.
 *
 * @param projectId - The project.
 * @param search - Matches the element's name or readable id.
 * @mcp read
 */
export const getProjectElements = defineServiceFn({
  input: z.object({
    projectId: z.string(),
    type: z.array(z.enum(projectElementTypes)).nullish(),
    stateGroup: z.array(z.enum(projectStateGroups)).nullish(),
    ownerId: z.array(z.string()).nullish(),
    milestoneId: z.array(z.string()).nullish(),
    labelId: z.array(z.string()).nullish(),
    search: z.string().nullish()
  }),
  permission: { view: "projects" },
  async run(ctx, { projectId, ...filters }) {
    return unwrap(
      ctx,
      await service.getProjectElements(
        ctx.asCaller.supabase,
        projectId,
        ctx.company.id,
        filters
      )
    );
  }
});

/**
 * Get the descriptions of a project's elements.
 *
 * @remarks
 * The descriptions of every element of a project, for the Reader. The list
 * query leaves them out, because a description can be large.
 *
 * @mcp read
 */
export const getProjectElementDescriptions = defineServiceFn({
  input: z.object({ projectId: z.string() }),
  permission: { view: "projects" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getProjectElementDescriptions(
        ctx.asCaller.supabase,
        input.projectId,
        ctx.company.id
      )
    );
  }
});

/**
 * Get a project element.
 *
 * @remarks
 * Gets one element with its state, owner, milestone, labels and parent.
 *
 * @mcp read
 */
export const getProjectElement = defineServiceFn({
  input: z.object({ id: z.string() }),
  permission: { view: "projects" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getProjectElement(
        ctx.asCaller.supabase,
        input.id,
        ctx.company.id
      )
    );
  }
});

/**
 * Create a project element.
 *
 * @remarks
 * The project's sequence gives the element its readable id. An empty state
 * takes the default Unstarted state; an absent `isChargeable` the type's
 * default. With a change request the element goes into it, and its readable
 * id stays empty until the change request is applied. A locked plan takes a
 * new element only through a change request; a Closed project takes none.
 */
export const createProjectElement = defineServiceFn({
  input: projectElementValidator.safeExtend({
    projectId: z.string(),
    changeRequestId: changeRequestIdField
  }),
  permission: { create: "projects" },
  async run(ctx, input) {
    const { id: _id, projectId, changeRequestId, ...element } = input;
    // A locked plan takes plan-layer changes only through a change request.
    const locked = await service.requireProjectPlanEditable(
      ctx.asCaller.supabase,
      {
        projectId,
        companyId: ctx.company.id,
        changeRequestId: changeRequestId ?? null
      }
    );
    if (locked) return ctx.error("rule", locked);

    const project = await service.requireOpenProject(
      ctx,
      projectId,
      "A Closed project cannot take new elements"
    );
    if (project instanceof CarbonError) return project;

    return run(ctx, "createProjectElement", () =>
      changeRequestId
        ? service.addElementToChangeRequest(ctx.asSystem.pg, {
            companyId: ctx.company.id,
            userId: ctx.auditUserId,
            projectId,
            changeRequestId,
            element
          })
        : service.insertProjectElement(ctx.asSystem.pg, {
            ...element,
            projectId,
            companyId: ctx.company.id,
            userId: ctx.auditUserId
          })
    );
  }
});

/**
 * Set one field on project elements.
 *
 * @remarks
 * Sets one field on one or more elements. Moving into a Completed state
 * stamps `completedAt`; moving to any other state clears it. A change to a
 * field in `suspectLinkFields` makes the incoming trace links suspect. With a
 * change request a plan-layer field goes into it; a progress field always
 * writes live. A locked plan takes a plan-layer field only through a change
 * request. A new final asset on a released project gets its asset under
 * construction.
 */
export const updateProjectElementField = defineServiceFn({
  input: projectElementFieldUpdateValidator.safeExtend({
    projectId: z.string(),
    changeRequestId: changeRequestIdField
  }),
  permission: { update: "projects" },
  async run(ctx, input) {
    const { ids, field, value, projectId } = input;
    const project = await service.requireOpenProject(ctx, projectId);
    if (project instanceof CarbonError) return project;

    const planLayer = isPlanLayerField("projectElement", field);
    const changeRequestId = input.changeRequestId ?? null;
    if (planLayer) {
      // A locked plan takes plan-layer changes only through a change request.
      const locked = await service.requireProjectPlanEditable(
        ctx.asCaller.supabase,
        { projectId, companyId: ctx.company.id, changeRequestId }
      );
      if (locked) return ctx.error("rule", locked);
    }
    if (changeRequestId && planLayer) {
      const queued = await run(ctx, "updateProjectElementField", () =>
        service.updateElementFieldInChangeRequest(ctx.asSystem.pg, {
          companyId: ctx.company.id,
          userId: ctx.auditUserId,
          projectId,
          changeRequestId,
          ids,
          field,
          value
        })
      );
      if (queued instanceof CarbonError) return queued;
      return { ids };
    }

    const updated = unwrap(
      ctx,
      await service.updateProjectElementField(ctx.asCaller.supabase, {
        ids,
        field,
        value,
        companyId: ctx.company.id,
        updatedBy: ctx.auditUserId
      })
    );
    if (updated instanceof CarbonError) return updated;

    // A new final asset on a released project gets its asset under
    // construction now, so its costs can post.
    if (
      field === "isFinalAsset" &&
      (value === "true" || value === "on") &&
      project.status !== "Draft"
    ) {
      const assets = await run(ctx, "updateProjectElementField", () =>
        service.ensureCapitalAssets(ctx.asSystem.pg, {
          companyId: ctx.company.id,
          userId: ctx.auditUserId,
          projectId
        })
      );
      if (assets instanceof CarbonError) return assets;
    }
    return { ids };
  }
});

/**
 * Make project elements billing elements, or stop them being one.
 *
 * @remarks
 * A billing element is the element a Time & Materials or Cost Plus contract
 * line bills, with its subtree. Only a Contract project has billing
 * elements. A branch has one billing element, and an element a contract line
 * bills stays one. The flag is not a plan-layer field: it always writes live.
 *
 * @mcp
 */
export const updateProjectElementBilling = defineServiceFn({
  input: z.object({
    projectId: z.string(),
    ids: z.array(z.string().min(1)).min(1, { message: "Choose an element" }),
    isBilling: z.boolean()
  }),
  permission: { update: "projects" },
  async run(ctx, input) {
    const project = await service.requireOpenProject(ctx, input.projectId);
    if (project instanceof CarbonError) return project;
    if (input.isBilling && project.costTreatment !== "Contract") {
      return ctx.error("rule", "Only a Contract project has billing elements");
    }
    const updated = unwrap(
      ctx,
      await service.updateProjectElementBilling(ctx.asCaller.supabase, {
        ids: input.ids,
        isBilling: input.isBilling,
        companyId: ctx.company.id,
        updatedBy: ctx.auditUserId
      })
    );
    if (updated instanceof CarbonError) return updated;
    return { ids: input.ids };
  }
});

/**
 * Replace the labels of a project element.
 *
 * @remarks
 * Replaces the labels of an element with the given set: labels not in it are
 * removed. A Closed project cannot change.
 *
 * @mcp destructive
 */
export const setProjectElementLabels = defineServiceFn({
  input: z.object({
    projectId: z.string(),
    projectElementId: z.string(),
    labelIds: z.array(z.string())
  }),
  permission: { update: "projects" },
  async run(ctx, input) {
    const project = await service.requireOpenProject(ctx, input.projectId);
    if (project instanceof CarbonError) return project;
    return unwrap(
      ctx,
      await service.setProjectElementLabels(ctx.asCaller.supabase, {
        projectElementId: input.projectElementId,
        labelIds: input.labelIds,
        companyId: ctx.company.id,
        createdBy: ctx.auditUserId
      })
    );
  }
});

/**
 * Move a project element under a new parent.
 *
 * @remarks
 * Puts the element under `parentId` (the top level when empty), after its
 * new last sibling; with `order`, then saves the new siblings' order (a drop
 * between two rows of the tree). Refuses a parent in the element's own
 * subtree and a Parameter parent for another type. With a change request the
 * move goes into it. A locked plan moves only through a change request.
 */
export const moveProjectElement = defineServiceFn({
  input: z.object({
    projectId: z.string(),
    elementId: z.string().min(1, { message: "No element was given" }),
    parentId: z.string().nullish(),
    order: sortOrderUpdates.default([]),
    changeRequestId: changeRequestIdField
  }),
  permission: { update: "projects" },
  async run(ctx, input) {
    const { projectId, elementId, order } = input;
    const parentId = input.parentId || null;
    const changeRequestId = input.changeRequestId ?? null;
    const project = await service.requireOpenProject(ctx, projectId);
    if (project instanceof CarbonError) return project;
    // A locked plan takes plan-layer changes only through a change request.
    const locked = await service.requireProjectPlanEditable(
      ctx.asCaller.supabase,
      { projectId, companyId: ctx.company.id, changeRequestId }
    );
    if (locked) return ctx.error("rule", locked);

    const write = {
      companyId: ctx.company.id,
      userId: ctx.auditUserId,
      projectId
    };
    if (changeRequestId) {
      const queued = await run(ctx, "moveProjectElement", async () => {
        await service.moveElementInChangeRequest(ctx.asSystem.pg, {
          ...write,
          changeRequestId,
          elementId,
          parentId
        });
        if (order.length > 0) {
          await service.orderElementsInChangeRequest(ctx.asSystem.pg, {
            ...write,
            changeRequestId,
            updates: order
          });
        }
      });
      if (queued instanceof CarbonError) return queued;
      return { elementId };
    }

    const sortOrder = unwrap(
      ctx,
      await service.getNextElementSortOrder(ctx.asCaller.supabase, {
        projectId,
        companyId: ctx.company.id,
        parentId
      })
    );
    if (sortOrder instanceof CarbonError) return sortOrder;

    const moved = await run(ctx, "moveProjectElement", async () => {
      await service.moveProjectElement(ctx.asSystem.pg, {
        ...write,
        elementId,
        parentId,
        sortOrder: sortOrder ?? 1
      });
      if (order.length > 0) {
        await service.updateProjectElementOrder(
          ctx.asSystem.pg,
          ctx.company.id,
          ctx.auditUserId,
          projectId,
          order
        );
      }
    });
    if (moved instanceof CarbonError) return moved;
    return { elementId };
  }
});

/**
 * Save the order of sibling project elements.
 *
 * @remarks
 * Saves the drag-sort order of sibling elements. With a change request the
 * order goes into it. A locked plan takes a new order only through a change
 * request.
 *
 * @mcp
 */
export const updateProjectElementOrder = defineServiceFn({
  input: z.object({
    projectId: z.string(),
    updates: sortOrderUpdates,
    changeRequestId: changeRequestIdField
  }),
  permission: { update: "projects" },
  async run(ctx, input) {
    const { projectId, updates } = input;
    const changeRequestId = input.changeRequestId ?? null;
    const project = await service.requireOpenProject(ctx, projectId);
    if (project instanceof CarbonError) return project;
    // A locked plan takes plan-layer changes only through a change request.
    const locked = await service.requireProjectPlanEditable(
      ctx.asCaller.supabase,
      { projectId, companyId: ctx.company.id, changeRequestId }
    );
    if (locked) return ctx.error("rule", locked);
    if (updates.length === 0) return { count: 0 };

    const saved = await run(ctx, "updateProjectElementOrder", async () => {
      if (changeRequestId) {
        await service.orderElementsInChangeRequest(ctx.asSystem.pg, {
          companyId: ctx.company.id,
          userId: ctx.auditUserId,
          projectId,
          changeRequestId,
          updates
        });
        return;
      }
      await service.updateProjectElementOrder(
        ctx.asSystem.pg,
        ctx.company.id,
        ctx.auditUserId,
        projectId,
        updates
      );
    });
    if (saved instanceof CarbonError) return saved;
    return { count: updates.length };
  }
});

/**
 * Delete a project element and its descendants.
 *
 * @remarks
 * Refuses when the element or a descendant has a project ledger row, a
 * timesheet entry, a job, a purchase order line or an earned value snapshot,
 * or is the base of an Apportioned element outside the subtree. With a
 * change request the delete goes into it, and the apply step refuses it on
 * the same grounds. A locked plan deletes only through a change request.
 *
 * @mcp destructive
 */
export const deleteProjectElement = defineServiceFn({
  input: z.object({
    projectId: z.string(),
    elementId: z.string(),
    changeRequestId: changeRequestIdField
  }),
  permission: { delete: "projects" },
  async run(ctx, input) {
    const { projectId, elementId } = input;
    const changeRequestId = input.changeRequestId ?? null;
    const project = await service.requireOpenProject(ctx, projectId);
    if (project instanceof CarbonError) return project;
    // A locked plan takes plan-layer changes only through a change request.
    const locked = await service.requireProjectPlanEditable(
      ctx.asCaller.supabase,
      { projectId, companyId: ctx.company.id, changeRequestId }
    );
    if (locked) return ctx.error("rule", locked);

    if (changeRequestId) {
      const queued = await run(ctx, "deleteProjectElement", () =>
        service.deleteElementInChangeRequest(ctx.asSystem.pg, {
          companyId: ctx.company.id,
          userId: ctx.auditUserId,
          projectId,
          changeRequestId,
          elementId
        })
      );
      if (queued instanceof CarbonError) return queued;
      return { elementId, changeRequestId };
    }

    const deleted = unwrap(
      ctx,
      await service.deleteProjectElement(
        ctx.asCaller.supabase,
        elementId,
        ctx.company.id
      )
    );
    if (deleted instanceof CarbonError) return deleted;
    return { elementId, changeRequestId: null };
  }
});

/**
 * Save the earned value fields of a project element.
 *
 * @remarks
 * Government Contracting: the control account flag, its manager, and the
 * earned value technique of a work package. A refusal of the fields (no
 * control account above, not chargeable) is a `validation` refusal.
 */
export const updateProjectElementEarnedValue = defineServiceFn({
  input: elementEarnedValueValidator.safeExtend({ projectId: z.string() }),
  permission: { update: "projects" },
  async run(ctx, { projectId, ...fields }) {
    const project = await service.requireOpenProject(ctx, projectId);
    if (project instanceof CarbonError) return project;
    try {
      const result = await updateElementEarnedValue(ctx.asCaller.supabase, {
        ...fields,
        companyId: ctx.company.id,
        userId: ctx.auditUserId
      });
      if (result.error) {
        // A database failure stays one; the ee function's own refusals
        // carry no code.
        if ("code" in result.error && result.error.code) {
          return unwrap(ctx, result);
        }
        return ctx.error(
          "validation",
          result.error.message ?? "Failed to save the earned value fields"
        );
      }
      return { elementId: fields.elementId };
    } catch (err) {
      if (err instanceof EntitlementError) {
        return ctx.error("entitlement", err.message, err);
      }
      throw err;
    }
  }
});

// --- Trace links ----------------------------------------------------------------

/**
 * Get a project's trace links.
 *
 * @remarks
 * Lists every trace link of a project. Pages through the rows, because a
 * large project can have more than 1000 links.
 *
 * @mcp read
 */
export const getProjectElementLinks = defineServiceFn({
  input: z.object({ projectId: z.string() }),
  permission: { view: "projects" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getProjectElementLinks(
        ctx.asCaller.supabase,
        input.projectId,
        ctx.company.id
      )
    );
  }
});

/**
 * Add a trace link between two project elements.
 *
 * @remarks
 * Both elements must be in the project, and `canLink` decides with the
 * project's links: a `feeds` link is refused, because only a formula save
 * writes them. With a change request the link goes into it. A locked plan
 * takes a new link only through a change request.
 *
 * @mcp
 */
export const upsertProjectElementLink = defineServiceFn({
  input: projectElementLinkValidator.safeExtend({
    projectId: z.string(),
    changeRequestId: changeRequestIdField
  }),
  permission: { update: "projects" },
  async run(ctx, input) {
    const { projectId, changeRequestId: crId, ...link } = input;
    const changeRequestId = crId ?? null;
    const project = await service.requireOpenProject(ctx, projectId);
    if (project instanceof CarbonError) return project;
    // A locked plan takes link changes only through a change request.
    const locked = await service.requireProjectPlanEditable(
      ctx.asCaller.supabase,
      { projectId, companyId: ctx.company.id, changeRequestId }
    );
    if (locked) return ctx.error("rule", locked);

    if (changeRequestId) {
      return run(ctx, "upsertProjectElementLink", () =>
        service.addLinkToChangeRequest(ctx.asSystem.pg, {
          companyId: ctx.company.id,
          userId: ctx.auditUserId,
          projectId,
          changeRequestId,
          link
        })
      );
    }
    return unwrap(
      ctx,
      await service.upsertProjectElementLink(ctx.asCaller.supabase, {
        ...link,
        projectId,
        companyId: ctx.company.id,
        createdBy: ctx.auditUserId
      })
    );
  }
});

/**
 * Delete a trace link.
 *
 * @remarks
 * A `feeds` link belongs to a formula and is refused: edit the formula
 * instead. With a change request the delete goes into it. A locked plan
 * deletes a link only through a change request.
 *
 * @mcp destructive
 */
export const deleteProjectElementLink = defineServiceFn({
  input: z.object({
    projectId: z.string(),
    id: z.string().min(1, { message: "No link selected" }),
    changeRequestId: changeRequestIdField
  }),
  permission: { update: "projects" },
  async run(ctx, input) {
    const { projectId, id } = input;
    const changeRequestId = input.changeRequestId ?? null;
    const project = await service.requireOpenProject(ctx, projectId);
    if (project instanceof CarbonError) return project;
    // A locked plan takes link changes only through a change request.
    const locked = await service.requireProjectPlanEditable(
      ctx.asCaller.supabase,
      { projectId, companyId: ctx.company.id, changeRequestId }
    );
    if (locked) return ctx.error("rule", locked);

    if (changeRequestId) {
      const queued = await run(ctx, "deleteProjectElementLink", () =>
        service.deleteLinkInChangeRequest(ctx.asSystem.pg, {
          companyId: ctx.company.id,
          userId: ctx.auditUserId,
          projectId,
          changeRequestId,
          linkId: id
        })
      );
      if (queued instanceof CarbonError) return queued;
      return { id };
    }
    const deleted = unwrap(
      ctx,
      await service.deleteProjectElementLink(
        ctx.asCaller.supabase,
        id,
        ctx.company.id
      )
    );
    if (deleted instanceof CarbonError) return deleted;
    return { id };
  }
});

/**
 * Mark a suspect trace link reviewed.
 *
 * @remarks
 * Clears `suspectSince` and records who reviewed it and when. Reviewing is
 * progress, not a plan change: it writes live, also on a locked plan.
 *
 * @mcp
 */
export const clearSuspectLink = defineServiceFn({
  input: z.object({
    projectId: z.string(),
    id: z.string().min(1, { message: "No link selected" })
  }),
  permission: { update: "projects" },
  async run(ctx, input) {
    const project = await service.requireOpenProject(ctx, input.projectId);
    if (project instanceof CarbonError) return project;
    return unwrap(
      ctx,
      await service.clearSuspectLink(ctx.asCaller.supabase, {
        id: input.id,
        companyId: ctx.company.id,
        userId: ctx.auditUserId
      })
    );
  }
});

/**
 * Save a Parameter's formula.
 *
 * @remarks
 * Refuses a parse error, a ref that is not a Parameter of the project, and a
 * cycle of `feeds` links. Then sets the Formula source and replaces the
 * element's incoming `feeds` links with one link from each ref, in one
 * transaction. A change request does not carry a formula, and a locked plan
 * takes none.
 */
export const saveParameterFormula = defineServiceFn({
  input: z.object({
    projectId: z.string(),
    elementId: z.string(),
    formula: z.string(),
    changeRequestId: changeRequestIdField
  }),
  permission: { update: "projects" },
  async run(ctx, input) {
    const { projectId } = input;
    const changeRequestId = input.changeRequestId ?? null;
    const project = await service.requireOpenProject(ctx, projectId);
    if (project instanceof CarbonError) return project;
    // A locked plan takes formula changes only through a change request.
    const locked = await service.requireProjectPlanEditable(
      ctx.asCaller.supabase,
      { projectId, companyId: ctx.company.id, changeRequestId }
    );
    if (locked) return ctx.error("rule", locked);
    // A formula rewrites its feeds links, which a change request does not
    // carry yet.
    if (changeRequestId) {
      return ctx.error(
        "rule",
        "A formula cannot change in a change request. Leave the change request to edit it."
      );
    }

    const saved = await service.saveParameterFormula(ctx.asSystem.pg, {
      companyId: ctx.company.id,
      userId: ctx.auditUserId,
      elementId: input.elementId,
      formula: input.formula,
      projectId
    });
    if ("error" in saved) return ctx.error("validation", saved.error);
    return saved;
  }
});

// --- Comments -------------------------------------------------------------------

/**
 * Get the comments on a project element.
 *
 * @remarks
 * Lists the comments on an element, oldest first.
 *
 * @mcp read
 */
export const getProjectElementComments = defineServiceFn({
  input: z.object({ projectElementId: z.string() }),
  permission: { view: "projects" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getProjectElementComments(
        ctx.asCaller.supabase,
        input.projectElementId,
        ctx.company.id
      )
    );
  }
});

/**
 * Add a comment to a project element.
 *
 * @remarks
 * `content` is the editor's JSON document, as a string.
 *
 * @mcp
 */
export const insertProjectElementComment = defineServiceFn({
  input: projectElementCommentValidator,
  permission: { view: "projects" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.insertProjectElementComment(ctx.asCaller.supabase, {
        ...input,
        companyId: ctx.company.id,
        createdBy: ctx.auditUserId
      })
    );
  }
});

/**
 * Delete a comment on a project element.
 *
 * @remarks
 * Only its author can delete it.
 *
 * @mcp destructive
 */
export const deleteProjectElementComment = defineServiceFn({
  input: z.object({
    id: z.string().min(1, { message: "No comment was given" })
  }),
  permission: { view: "projects" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteProjectElementComment(
        ctx.asCaller.supabase,
        input.id,
        ctx.company.id,
        ctx.auditUserId
      )
    );
  }
});

// --- Plan lines, build from part, jobs and PO lines, capital assets ------------

// --- Plan lines --------------------------------------------------------------

/**
 * Get the plan lines of an element.
 *
 * @remarks
 * Gets the material, labor and other-cost plan lines of an element.
 *
 * @mcp read
 */
export const getProjectElementPlanLines = defineServiceFn({
  input: z.object({ projectElementId: z.string() }),
  permission: { view: "projects" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getProjectElementPlanLines(
        ctx.asCaller.supabase,
        input.projectElementId,
        ctx.company.id
      )
    );
  }
});

/**
 * Create or update a material plan line of an element.
 *
 * @remarks
 * Creates the line when `id` is empty, else updates it. Refused while the
 * project is Closed, and while its plan is locked unless the write goes into
 * a Draft change request (`changeRequestId`), where the line changes instead
 * of the live plan.
 *
 * @mcp
 */
export const upsertProjectElementMaterial = defineServiceFn({
  input: projectElementMaterialValidator.extend({
    projectId: z.string(),
    changeRequestId: z.string().nullish()
  }),
  permission: { update: "projects" },
  async run(ctx, { projectId, changeRequestId, id, ...line }) {
    const refusal = await service.planLineWriteRefusal(ctx, {
      projectId,
      changeRequestId: changeRequestId ?? null
    });
    if (refusal) return refusal;

    if (changeRequestId) {
      const { projectElementId, ...fields } = line;
      return service.stagePlanLineChange(
        ctx,
        {
          projectId,
          changeRequestId,
          table: "projectElementMaterial",
          id,
          elementId: projectElementId,
          fields
        },
        "Failed to save the material"
      );
    }

    const saved = id
      ? await service.upsertProjectElementMaterial(ctx.asCaller.supabase, {
          ...line,
          id,
          companyId: ctx.company.id,
          updatedBy: ctx.auditUserId
        })
      : await service.upsertProjectElementMaterial(ctx.asCaller.supabase, {
          ...line,
          projectId,
          companyId: ctx.company.id,
          createdBy: ctx.auditUserId
        });
    if (saved.error || !saved.data) {
      return ctx.error("internal", "Failed to save the material", saved.error);
    }
    return { id: saved.data.id };
  }
});

/**
 * Delete a material plan line.
 *
 * @remarks
 * Refused while the project is Closed, and while its plan is locked unless
 * the delete goes into a Draft change request (`changeRequestId`).
 *
 * @mcp destructive
 */
export const deleteProjectElementMaterial = defineServiceFn({
  input: z.object({
    id: z.string().min(1),
    projectId: z.string(),
    changeRequestId: z.string().nullish()
  }),
  permission: { update: "projects" },
  async run(ctx, { id, projectId, changeRequestId }) {
    const refusal = await service.planLineWriteRefusal(ctx, {
      projectId,
      changeRequestId: changeRequestId ?? null
    });
    if (refusal) return refusal;

    if (changeRequestId) {
      return service.stagePlanLineChange(
        ctx,
        {
          projectId,
          changeRequestId,
          table: "projectElementMaterial",
          id,
          remove: true
        },
        "Failed to delete the line"
      );
    }

    const deleted = await service.deleteProjectElementMaterial(
      ctx.asCaller.supabase,
      id,
      ctx.company.id
    );
    if (deleted.error) {
      return ctx.error("internal", "Failed to delete the line", deleted.error);
    }
    return { id };
  }
});

/**
 * Create or update a labor plan line of an element.
 *
 * @remarks
 * Creates the line when `id` is empty, else updates it. Refused while the
 * project is Closed, and while its plan is locked unless the write goes into
 * a Draft change request (`changeRequestId`), where the line changes instead
 * of the live plan.
 *
 * @mcp
 */
export const upsertProjectElementLabor = defineServiceFn({
  input: projectElementLaborValidator.extend({
    projectId: z.string(),
    changeRequestId: z.string().nullish()
  }),
  permission: { update: "projects" },
  async run(ctx, { projectId, changeRequestId, id, ...line }) {
    const refusal = await service.planLineWriteRefusal(ctx, {
      projectId,
      changeRequestId: changeRequestId ?? null
    });
    if (refusal) return refusal;

    if (changeRequestId) {
      const { projectElementId, ...fields } = line;
      return service.stagePlanLineChange(
        ctx,
        {
          projectId,
          changeRequestId,
          table: "projectElementLabor",
          id,
          elementId: projectElementId,
          fields
        },
        "Failed to save the labor"
      );
    }

    const saved = id
      ? await service.upsertProjectElementLabor(ctx.asCaller.supabase, {
          ...line,
          id,
          companyId: ctx.company.id,
          updatedBy: ctx.auditUserId
        })
      : await service.upsertProjectElementLabor(ctx.asCaller.supabase, {
          ...line,
          projectId,
          companyId: ctx.company.id,
          createdBy: ctx.auditUserId
        });
    if (saved.error || !saved.data) {
      return ctx.error("internal", "Failed to save the labor", saved.error);
    }
    return { id: saved.data.id };
  }
});

/**
 * Delete a labor plan line.
 *
 * @remarks
 * Refused while the project is Closed, and while its plan is locked unless
 * the delete goes into a Draft change request (`changeRequestId`).
 *
 * @mcp destructive
 */
export const deleteProjectElementLabor = defineServiceFn({
  input: z.object({
    id: z.string().min(1),
    projectId: z.string(),
    changeRequestId: z.string().nullish()
  }),
  permission: { update: "projects" },
  async run(ctx, { id, projectId, changeRequestId }) {
    const refusal = await service.planLineWriteRefusal(ctx, {
      projectId,
      changeRequestId: changeRequestId ?? null
    });
    if (refusal) return refusal;

    if (changeRequestId) {
      return service.stagePlanLineChange(
        ctx,
        {
          projectId,
          changeRequestId,
          table: "projectElementLabor",
          id,
          remove: true
        },
        "Failed to delete the line"
      );
    }

    const deleted = await service.deleteProjectElementLabor(
      ctx.asCaller.supabase,
      id,
      ctx.company.id
    );
    if (deleted.error) {
      return ctx.error("internal", "Failed to delete the line", deleted.error);
    }
    return { id };
  }
});

/**
 * Create or update an other-cost plan line of an element.
 *
 * @remarks
 * Creates the line when `id` is empty, else updates it. Refused while the
 * project is Closed, and while its plan is locked unless the write goes into
 * a Draft change request (`changeRequestId`), where the line changes instead
 * of the live plan.
 *
 * @mcp
 */
export const upsertProjectElementCost = defineServiceFn({
  input: projectElementCostValidator.extend({
    projectId: z.string(),
    changeRequestId: z.string().nullish()
  }),
  permission: { update: "projects" },
  async run(ctx, { projectId, changeRequestId, id, ...line }) {
    const refusal = await service.planLineWriteRefusal(ctx, {
      projectId,
      changeRequestId: changeRequestId ?? null
    });
    if (refusal) return refusal;

    if (changeRequestId) {
      const { projectElementId, ...fields } = line;
      return service.stagePlanLineChange(
        ctx,
        {
          projectId,
          changeRequestId,
          table: "projectElementCost",
          id,
          elementId: projectElementId,
          fields
        },
        "Failed to save the cost"
      );
    }

    const saved = id
      ? await service.upsertProjectElementCost(ctx.asCaller.supabase, {
          ...line,
          id,
          companyId: ctx.company.id,
          updatedBy: ctx.auditUserId
        })
      : await service.upsertProjectElementCost(ctx.asCaller.supabase, {
          ...line,
          projectId,
          companyId: ctx.company.id,
          createdBy: ctx.auditUserId
        });
    if (saved.error || !saved.data) {
      return ctx.error("internal", "Failed to save the cost", saved.error);
    }
    return { id: saved.data.id };
  }
});

/**
 * Delete an other-cost plan line.
 *
 * @remarks
 * Refused while the project is Closed, and while its plan is locked unless
 * the delete goes into a Draft change request (`changeRequestId`).
 *
 * @mcp destructive
 */
export const deleteProjectElementCost = defineServiceFn({
  input: z.object({
    id: z.string().min(1),
    projectId: z.string(),
    changeRequestId: z.string().nullish()
  }),
  permission: { update: "projects" },
  async run(ctx, { id, projectId, changeRequestId }) {
    const refusal = await service.planLineWriteRefusal(ctx, {
      projectId,
      changeRequestId: changeRequestId ?? null
    });
    if (refusal) return refusal;

    if (changeRequestId) {
      return service.stagePlanLineChange(
        ctx,
        {
          projectId,
          changeRequestId,
          table: "projectElementCost",
          id,
          remove: true
        },
        "Failed to delete the line"
      );
    }

    const deleted = await service.deleteProjectElementCost(
      ctx.asCaller.supabase,
      id,
      ctx.company.id
    );
    if (deleted.error) {
      return ctx.error("internal", "Failed to delete the line", deleted.error);
    }
    return { id };
  }
});

// --- Item values for Parameters ----------------------------------------------

/**
 * Get the values a Parameter reads from linked parts.
 *
 * @remarks
 * The unit cost (`itemCost`) and the custom field values of each item, keyed
 * by item id, then by `customField.id`. The custom fields live on the typed
 * item table (`part`, `material`, `tool`, `consumable`), whose `id` is the
 * item's `readableId`. Values stay as stored (form data stores strings).
 *
 * @param itemIds - The items to read.
 *
 * @mcp read
 */
export const getProjectItemValues = defineServiceFn({
  input: z.object({ itemIds: z.array(z.string()) }),
  permission: { view: "projects" },
  async run(ctx, input) {
    const values = unwrap(
      ctx,
      await service.getProjectItemValues(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.itemIds
      )
    );
    if (values instanceof CarbonError) return values;
    // A Map does not serialize: the tool returns an object keyed by item id.
    return Object.fromEntries(values);
  }
});

/**
 * Get what the elements linked to an item have charged.
 *
 * @remarks
 * Averaged per element: labor hours, material cost and the last posting date
 * (`get_element_history_by_item`). Only elements with a ledger row count.
 *
 * @mcp read
 */
export const getElementHistoryByItem = defineServiceFn({
  input: z.object({ itemId: z.string() }),
  permission: { view: "projects" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getElementHistoryByItem(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.itemId
      )
    );
  }
});

/**
 * Get the Numeric custom fields of an item type.
 *
 * @remarks
 * The active Numeric custom fields of an item type, for a Parameter's
 * **Part field**. A type with no typed custom field table has none.
 *
 * @mcp read
 */
export const getItemNumericCustomFields = defineServiceFn({
  input: z.object({
    itemType: z.enum([
      "Part",
      "Material",
      "Tool",
      "Service",
      "Consumable",
      "Fixture"
    ])
  }),
  permission: { view: "projects" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getItemNumericCustomFields(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.itemType
      )
    );
  }
});

// --- Build from part ---------------------------------------------------------

/**
 * Create elements under a parent from a serial, an item or a template.
 *
 * @remarks
 * Build from part: a serial's build history, an item's make method or a
 * template project's elements, down to `depth` levels, become planned
 * elements under `parentId` (the top level when empty), in one transaction.
 * Returns the number of elements created and the count of BOM lines the
 * source could not read.
 */
export const buildElementsFromPart = defineServiceFn({
  input: buildFromPartValidator.safeExtend({ projectId: z.string() }),
  permission: { update: "projects" },
  async run(ctx, { projectId, ...data }) {
    try {
      return await service.buildElementsFromPart(
        ctx.asCaller.supabase,
        ctx.asSystem.pg,
        {
          ...service.toBuildFromPartArgs(data, ctx.company.id, projectId),
          userId: ctx.auditUserId
        }
      );
    } catch (error) {
      return ctx.error(
        "internal",
        getErrorMessage(error, "The elements could not be created"),
        error
      );
    }
  }
});

// --- Jobs and purchase order lines from plan-line materials ------------------

/**
 * Create a job for a Make to Order plan-line material.
 *
 * @remarks
 * The job is charged to the material's element. An Expense or Contract
 * project consumes the job; a Capitalize project builds the element's asset
 * under construction, so it must be released first. Refused for an item an
 * unreleased change notice holds, for a Make to Asset item that cannot
 * complete to the asset, and for a charge number that cannot take the job.
 * The material remembers the job.
 */
export const createJobFromMaterial = defineServiceFn({
  input: createJobFromMaterialValidator.extend({
    projectId: z.string(),
    projectElementId: z.string()
  }),
  permission: { create: "production", view: "projects" },
  async run(
    ctx,
    { projectId, projectElementId, materialId, quantity, dueDate, locationId }
  ) {
    const companyId = ctx.company.id;

    const material = await ctx.asCaller.supabase
      .from("projectElementMaterial")
      .select(
        "id, itemId, methodType, unitOfMeasureCode, jobId, item:item!projectElementMaterial_itemId_fkey(unitOfMeasureCode, itemTrackingType)"
      )
      .eq("id", materialId)
      .eq("projectId", projectId)
      .eq("projectElementId", projectElementId)
      .eq("companyId", companyId)
      .maybeSingle();
    if (material.error || !material.data) {
      if (material.error) {
        logger.error("Failed to load the plan-line material", {
          companyId,
          projectId,
          materialId,
          error: material.error
        });
      }
      return ctx.error("notFound", "The material is not on this element");
    }
    if (material.data.methodType !== "Make to Order") {
      return ctx.error("rule", "Only a Make to Order material makes a job");
    }
    if (material.data.jobId) {
      return ctx.error("conflict", "This material already has a job");
    }

    const target = await service.getJobChargeTarget(ctx.asSystem.pg, {
      companyId,
      projectId,
      projectElementId
    });
    if (!target) return ctx.error("notFound", "The project does not exist");
    const isCapital = target.costTreatment === "Capitalize";
    if (isCapital && !target.fixedAssetId) {
      return ctx.error(
        "rule",
        "Release the project first: its assets under construction are created on release"
      );
    }
    const consumeToProject =
      target.costTreatment === "Expense" || target.costTreatment === "Contract";
    const fixedAssetId = isCapital ? target.fixedAssetId : null;

    // The job is written with the service role: the location must be this
    // company's, no unreleased change notice may hold the item, and a Make to
    // Asset item must be able to complete to its asset.
    const refusal = await jobCreationRefusal(ctx, {
      itemId: material.data.itemId,
      quantity,
      locationId,
      fixedAssetId
    });
    if (refusal) return refusal;

    const chargeError = await service.chargeNumberError(
      ctx.asSystem.supabase,
      companyId,
      { projectId, projectElementId, consumeToProject }
    );
    if (chargeError) return ctx.error("validation", chargeError.message);

    const job = await insertJob(
      ctx.asSystem.supabase,
      ctx.asSystem.pg,
      {
        itemId: material.data.itemId,
        quantity,
        dueDate: dueDate || undefined,
        deadlineType: dueDate ? "Soft Deadline" : "No Deadline",
        locationId,
        unitOfMeasureCode:
          material.data.unitOfMeasureCode ??
          material.data.item?.unitOfMeasureCode ??
          undefined,
        projectId,
        projectElementId,
        consumeToProject,
        fixedAssetId,
        companyId,
        createdBy: ctx.auditUserId
      },
      { source: "erp" }
    );
    if (job.error || !job.data) {
      return ctx.error("internal", "Failed to create the job", job.error);
    }

    // The service role: creating a job needs no right to edit the plan.
    const stamp = await ctx.asSystem.supabase
      .from("projectElementMaterial")
      .update({
        jobId: job.data.id,
        updatedBy: ctx.auditUserId,
        updatedAt: datetime.timestamp()
      })
      .eq("id", materialId)
      .eq("companyId", companyId);
    if (stamp.error) {
      // The job exists; only the plan line's pointer to it failed.
      logger.error("Failed to link the job to its plan-line material", {
        companyId,
        projectId,
        materialId,
        jobId: job.data.id,
        error: stamp.error
      });
    }

    return { jobId: job.data.id };
  }
});

/**
 * Create a purchase order line for a Purchase to Order plan-line material.
 *
 * @remarks
 * The line is charged to the material's element, on a Draft purchase order
 * of the supplier (`purchaseOrderId`) or a new one (`purchaseOrderId` =
 * `new`). The quantity is in the plan line's unit and becomes purchase units
 * through the supplier part's conversion factor, raised to its minimum order
 * quantity; the price is the supplier part's, in the order's currency.
 * Refused while purchasing is blocked for the item. The material remembers
 * the line.
 */
export const createPurchaseOrderLineFromMaterial = defineServiceFn({
  input: createPurchaseOrderLineFromMaterialValidator.extend({
    projectId: z.string(),
    projectElementId: z.string()
  }),
  permission: { create: "purchasing", view: "projects" },
  async run(
    ctx,
    {
      projectId,
      projectElementId,
      materialId,
      supplierId,
      quantity,
      requiredDate,
      purchaseOrderId
    }
  ) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const companyGroupId = ctx.company.groupId;

    const [material, project, supplier] = await Promise.all([
      client
        .from("projectElementMaterial")
        .select(
          "id, itemId, methodType, unitOfMeasureCode, purchaseOrderLineId, item:item!projectElementMaterial_itemId_fkey(name, unitOfMeasureCode)"
        )
        .eq("id", materialId)
        .eq("projectId", projectId)
        .eq("projectElementId", projectElementId)
        .eq("companyId", companyId)
        .maybeSingle(),
      client
        .from("project")
        .select("locationId")
        .eq("id", projectId)
        .eq("companyId", companyId)
        .maybeSingle(),
      client
        .from("supplier")
        .select("id, taxPercent, currencyCode")
        .eq("id", supplierId)
        .eq("companyId", companyId)
        .maybeSingle()
    ]);
    if (material.error || !material.data) {
      if (material.error) {
        logger.error("Failed to load the plan-line material", {
          companyId,
          projectId,
          materialId,
          error: material.error
        });
      }
      return ctx.error("notFound", "The material is not on this element");
    }
    if (material.data.methodType !== "Purchase to Order") {
      return ctx.error(
        "rule",
        "Only a Purchase to Order material makes a PO line"
      );
    }
    if (material.data.purchaseOrderLineId) {
      return ctx.error("conflict", "This material already has a PO line");
    }
    if (supplier.error || !supplier.data) {
      return ctx.error("notFound", "The supplier does not exist");
    }
    const chargeError = await service.chargeNumberError(client, companyId, {
      projectId,
      projectElementId
    });
    if (chargeError) return ctx.error("validation", chargeError.message);

    const itemId = material.data.itemId;
    const [supplierPart, replenishment] = await Promise.all([
      client
        .from("supplierPart")
        .select(
          "id, companyId, currencyCode, supplierUnitPrice, supplierUnitOfMeasureCode, conversionFactor, minimumOrderQuantity"
        )
        .eq("itemId", itemId)
        .eq("supplierId", supplierId)
        .eq("companyId", companyId)
        .order("createdAt", { ascending: true })
        .limit(1),
      client
        .from("itemReplenishment")
        .select("purchasingBlocked")
        .eq("itemId", itemId)
        .eq("companyId", companyId)
        .maybeSingle()
    ]);
    if (replenishment.data?.purchasingBlocked) {
      return ctx.error("rule", "Purchasing is blocked for this item");
    }
    if (supplierPart.error) {
      logger.error("Failed to load the supplier part", {
        companyId,
        itemId,
        supplierId,
        error: supplierPart.error
      });
    }
    const part = supplierPart.data?.[0];
    const conversionFactor = Number(part?.conversionFactor ?? 1) || 1;
    const minimumOrderQuantity = Number(part?.minimumOrderQuantity ?? 0);
    const purchaseQuantity = Math.max(
      round(quantity / conversionFactor),
      minimumOrderQuantity
    );
    const inventoryUnit =
      material.data.unitOfMeasureCode ??
      material.data.item?.unitOfMeasureCode ??
      "EA";

    const [company, currencies] = await Promise.all([
      client
        .from("company")
        .select("baseCurrencyCode")
        .eq("id", companyId)
        .single(),
      client
        .from("currencies")
        .select("code, decimalPlaces")
        .eq("companyGroupId", companyGroupId)
    ]);
    const baseCurrencyCode = company.data?.baseCurrencyCode ?? "USD";
    const currencyCode = supplier.data.currencyCode ?? baseCurrencyCode;
    const locationId = project.data?.locationId ?? undefined;

    let orderId = purchaseOrderId;
    // The order's currency and rate (foreign per base): the line's price is in it.
    let order = { currencyCode, exchangeRate: 1 };
    if (purchaseOrderId === NEW_PURCHASE_ORDER) {
      const created = await insertPurchaseOrder(client, {
        status: "Draft",
        supplierId,
        purchaseOrderType: "Purchase",
        currencyCode,
        locationId,
        companyId,
        companyGroupId,
        createdBy: ctx.auditUserId
      });
      if (created.error || !created.data) {
        return ctx.error(
          "internal",
          "Failed to create the purchase order",
          created.error
        );
      }
      orderId = created.data.id;
      order = { currencyCode, exchangeRate: created.data.exchangeRate };
    } else {
      const draft = await client
        .from("purchaseOrder")
        .select("id, currencyCode, exchangeRate")
        .eq("id", purchaseOrderId)
        .eq("supplierId", supplierId)
        .eq("status", "Draft")
        .eq("companyId", companyId)
        .maybeSingle();
      if (draft.error || !draft.data) {
        return ctx.error(
          "rule",
          "The purchase order is not a Draft of this supplier"
        );
      }
      order = {
        currencyCode: draft.data.currencyCode ?? baseCurrencyCode,
        exchangeRate: Number(draft.data.exchangeRate ?? 1)
      };
    }
    const decimals =
      (currencies.data ?? []).find((c) => c.code === order.currencyCode)
        ?.decimalPlaces ?? SCALE;

    // The supplier part's price is in its own currency; convert it into the
    // order's, as every purchase document does (resolveSupplierPrice).
    const pricing = part
      ? await getSupplierPartPricing(
          client,
          part,
          baseCurrencyCode,
          order.currencyCode
        )
      : null;
    if (pricing?.error) return ctx.error("rule", pricing.error.message);
    const supplierUnitPrice = resolveSupplierPrice(
      pricing?.data ?? null,
      purchaseQuantity,
      order,
      0
    );
    const taxPercent = Number(supplier.data.taxPercent ?? 0);
    const line = await upsertPurchaseOrderLine(client, {
      purchaseOrderId: orderId,
      itemId,
      description: material.data.item?.name ?? undefined,
      purchaseOrderLineType: "Part",
      purchaseQuantity,
      purchaseUnitOfMeasureCode:
        part?.supplierUnitOfMeasureCode ?? inventoryUnit,
      inventoryUnitOfMeasureCode: inventoryUnit,
      conversionFactor,
      supplierUnitPrice,
      exchangeRate: order.exchangeRate,
      taxPercent,
      supplierTaxAmount: applyRate(
        taxableBase(supplierUnitPrice, purchaseQuantity, 0),
        taxPercent,
        decimals
      ),
      supplierShippingCost: 0,
      requiredDate: requiredDate || undefined,
      locationId,
      projectId,
      projectElementId,
      companyId,
      createdBy: ctx.auditUserId
    });
    if (line.error || !line.data) {
      return ctx.error(
        "internal",
        "Failed to create the purchase order line",
        line.error
      );
    }

    // The service role: creating a PO line needs no right to edit the plan.
    const stamp = await ctx.asSystem.supabase
      .from("projectElementMaterial")
      .update({
        purchaseOrderLineId: line.data.id,
        updatedBy: ctx.auditUserId,
        updatedAt: datetime.timestamp()
      })
      .eq("id", materialId)
      .eq("companyId", companyId);
    if (stamp.error) {
      // The line exists; only the plan line's pointer to it failed.
      logger.error("Failed to link the PO line to its plan-line material", {
        companyId,
        projectId,
        materialId,
        purchaseOrderLineId: line.data.id,
        error: stamp.error
      });
    }

    return { purchaseOrderId: orderId, purchaseOrderLineId: line.data.id };
  }
});

// --- Pegging -----------------------------------------------------------------

/**
 * Replace a Soft peg of a project with a Manual peg.
 *
 * @remarks
 * A planner's override: the peg's demand is fixed to an open purchase order
 * line or job (`supplyType`, `supplyId`) of the same planning group and item,
 * for `quantity`, with a reason. Needs the planning groups feature. The ee
 * function writes past row-level security, so the caller needs
 * `update: projects`.
 */
export const createManualPeg = defineServiceFn({
  input: z.object({
    projectId: z.string(),
    pegId: z.string().min(1),
    supplyType: z.enum(manualPegSupplyTypes),
    supplyId: z.string().min(1),
    quantity: z.number().positive(),
    manualReason: z.string().trim().min(1)
  }),
  permission: { update: "projects" },
  async run(ctx, input) {
    let result: Awaited<ReturnType<typeof pegging.createManualPeg>>;
    try {
      result = await pegging.createManualPeg(
        ctx.asCaller.supabase,
        ctx.asSystem.pg,
        { ...input, companyId: ctx.company.id, userId: ctx.auditUserId }
      );
    } catch (err) {
      if (!(err instanceof EntitlementError)) throw err;
      return ctx.error("entitlement", "Upgrade to use planning groups", err);
    }
    if (result.error || !result.id) {
      logger.error("Failed to create a manual peg", {
        companyId: ctx.company.id,
        projectId: input.projectId,
        error: result.error
      });
      return ctx.error(
        "rule",
        result.error ?? "The peg has changed. Reload the page."
      );
    }
    return { id: result.id };
  }
});

// --- Place in service --------------------------------------------------------

/**
 * Place a capital project's assets under construction in service.
 *
 * @remarks
 * Capitalizes each selected asset into the in-service class `toClassId`
 * (post-asset-transfer `capitalizeCip`), one transfer document per asset, each
 * in its own transaction: an asset that fails stays under construction, the
 * others stay capitalized. A final-asset element whose asset went into
 * service moves, with its descendants, to the default Completed state.
 * Returns one result per asset, with the refusal of each that failed.
 */
export const placeProjectAssetsInService = defineServiceFn({
  input: placeInServiceValidator.extend({ projectId: z.string() }),
  permission: { update: "projects", create: "accounting" },
  async run(ctx, { projectId, fixedAssetIds, toClassId, inServiceDate }) {
    const companyId = ctx.company.id;
    const db = ctx.asSystem.pg;
    const assets = await service.getProjectCapitalAssets(db, {
      companyId,
      projectId
    });
    const assetById = new Map(assets.map((asset) => [asset.id, asset]));

    const results: {
      fixedAssetId: string;
      label: string;
      error: string | null;
    }[] = [];
    for (const fixedAssetId of fixedAssetIds) {
      const asset = assetById.get(fixedAssetId);
      if (!asset) {
        results.push({
          fixedAssetId,
          label: fixedAssetId,
          error: "The asset is not part of this project"
        });
        continue;
      }
      const label = `${asset.fixedAssetId} ${asset.name}`;
      // One posting per asset by design: each is its own transfer document.
      const result = await invokeAssetTransfer(ctx.asCaller.supabase, db, {
        type: "capitalizeCip",
        companyId,
        userId: ctx.auditUserId,
        fixedAssetId,
        toClassId,
        inServiceDate
      });
      if (result.error) {
        logger.error("Failed to place an asset in service", {
          companyId,
          projectId,
          fixedAssetId,
          error: result.error
        });
      }
      results.push({
        fixedAssetId,
        label,
        error: result.error
          ? getErrorMessage(result.error, "Failed to capitalize the asset")
          : null
      });
    }

    const placedElementIds = results
      .filter((result) => !result.error)
      .map((result) => assetById.get(result.fixedAssetId)?.elementId)
      .filter((id): id is string => Boolean(id));
    try {
      await service.completeElementSubtrees(db, {
        companyId,
        projectId,
        elementIds: placedElementIds,
        userId: ctx.auditUserId
      });
    } catch (err) {
      logger.error("Failed to complete the placed elements", {
        companyId,
        projectId,
        error: err
      });
    }

    return { results };
  }
});

// --- Labor categories, timesheets, issues and expenses -------------------------

// --- Labor categories ----------------------------------------------------------

/**
 * List the labor categories of the company.
 *
 * @remarks
 * Each category carries its cost rates (`costRate`, `billRate`,
 * `effectiveFrom`). `search` matches the name.
 *
 * @mcp read
 */
export const getLaborCategories = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "projects" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getLaborCategories(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, {
          ...input,
          search: input.search ?? null
        }).build() as never
      )
    );
  }
});

/**
 * Get one labor category.
 *
 * @mcp read
 */
export const getLaborCategory = defineServiceFn({
  input: z.object({ id: z.string().min(1) }),
  permission: { view: "projects" },
  async run(ctx, { id }) {
    return unwrap(
      ctx,
      await service.getLaborCategory(ctx.asCaller.supabase, id, ctx.company.id)
    );
  }
});

/**
 * List the active labor categories of the company, for a picker.
 *
 * @mcp read
 */
export const getLaborCategoriesList = defineServiceFn({
  input: z.object({}),
  permission: { view: "projects" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getLaborCategoriesList(
        ctx.asCaller.supabase,
        ctx.company.id
      )
    );
  }
});

/**
 * Create or update a labor category.
 *
 * @remarks
 * With `id` it updates that category (needs `update: projects`); without, it
 * creates one (needs `create: projects`).
 *
 * @mcp
 */
export const upsertLaborCategory = defineServiceFn({
  input: laborCategoryValidator,
  // Create and update need different permissions: the body decides.
  permission: {},
  async run(ctx, { id, ...fields }) {
    if (!ctx.can(id ? { update: "projects" } : { create: "projects" })) {
      return ctx.error("forbidden", "You do not have permission to do this");
    }
    const result = id
      ? await service.upsertLaborCategory(ctx.asCaller.supabase, {
          ...fields,
          id,
          companyId: ctx.company.id,
          updatedBy: ctx.auditUserId
        })
      : await service.upsertLaborCategory(ctx.asCaller.supabase, {
          ...fields,
          companyId: ctx.company.id,
          createdBy: ctx.auditUserId
        });
    if (result.error) {
      return ctx.error(
        "internal",
        id
          ? "Failed to update the labor category"
          : "Failed to create the labor category",
        result.error
      );
    }
    return { id: result.data.id };
  }
});

/**
 * List the cost rates of a labor category, newest first.
 *
 * @mcp read
 */
export const getLaborCategoryRates = defineServiceFn({
  input: z.object({ laborCategoryId: z.string().min(1) }),
  permission: { view: "projects" },
  async run(ctx, { laborCategoryId }) {
    return unwrap(
      ctx,
      await service.getLaborCategoryRates(
        ctx.asCaller.supabase,
        laborCategoryId,
        ctx.company.id
      )
    );
  }
});

/**
 * Create or update a cost rate of a labor category.
 *
 * @remarks
 * An effective-dated cost rate, with its default bill rate (the price of an
 * hour on a Time & Materials contract line with no contract rate). With `id`
 * it updates that rate.
 *
 * @mcp
 */
export const upsertLaborCategoryRate = defineServiceFn({
  input: laborCategoryRateValidator,
  permission: { update: "projects" },
  async run(ctx, { id, ...rate }) {
    const result = id
      ? await service.upsertLaborCategoryRate(ctx.asCaller.supabase, {
          ...rate,
          id,
          companyId: ctx.company.id,
          updatedBy: ctx.auditUserId
        })
      : await service.upsertLaborCategoryRate(ctx.asCaller.supabase, {
          ...rate,
          companyId: ctx.company.id,
          createdBy: ctx.auditUserId
        });
    if (result.error) {
      return ctx.error("internal", "Failed to save the rate", result.error);
    }
    return { id: result.data.id };
  }
});

// --- Timesheets ----------------------------------------------------------------

/**
 * Get an employee's timesheet entries between two dates.
 *
 * @remarks
 * Both dates are inclusive. Each entry has the project, element and labor
 * category names; a Service project carries its service order. Left out,
 * `employeeId` is the caller.
 *
 * @mcp read
 */
export const getTimesheetWeek = defineServiceFn({
  input: z.object({
    employeeId: z.string().min(1).optional(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
  }),
  permission: { view: "projects" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getTimesheetWeek(ctx.asCaller.supabase, {
        companyId: ctx.company.id,
        employeeId: input.employeeId ?? ctx.auditUserId,
        from: input.from,
        to: input.to
      })
    );
  }
});

/**
 * Save one timesheet entry.
 *
 * @remarks
 * Runs `save-timesheet-entry`: one cell of the grid (employee, date, charge
 * number, labor category), or a new entry in `add` mode. Saving never posts.
 * Left out, `employeeId` is the caller. Another employee's week can be
 * changed by their manager or by a user with `update: projects` (in DCAA
 * mode the entry then waits in Pending Employee Review). An empty element,
 * work location or R&D role is none. A budget overrun never refuses the
 * entry: it comes back as `warning`.
 */
export const saveTimesheetEntry = defineServiceFn({
  input: saveTimesheetEntryInput.extend({
    employeeId: z.string().min(1).optional(),
    projectElementId: z.string().nullable().optional(),
    workLocationId: z.string().nullable().optional(),
    rdActivityRole: z
      .union([z.enum(rdActivityRoles), z.literal("")])
      .nullable()
      .optional()
  }),
  // Your own time needs company membership; another employee's is decided
  // in the body (their manager, or `update: projects`).
  permission: {},
  async run(ctx, input) {
    const employeeId = input.employeeId ?? ctx.auditUserId;
    if (
      employeeId !== ctx.auditUserId &&
      !ctx.can({ update: "projects" }) &&
      !(
        ctx.can({ view: "projects" }) &&
        (await service.managesEmployee(ctx.asCaller.supabase, {
          companyId: ctx.company.id,
          userId: ctx.auditUserId,
          employeeId
        }))
      )
    ) {
      return ctx.error(
        "forbidden",
        "You can open the timesheet of an employee you manage only"
      );
    }

    const saved = await run(ctx, "save-timesheet-entry", () =>
      service.saveTimesheetEntry(
        ctx,
        service.saveTimesheetEntryPostingInput({ ...input, employeeId })
      )
    );
    if (saved instanceof CarbonError) return saved;

    // Budget control (Government Contracting 5c): a timesheet only warns.
    const warning = await service.timesheetBudgetWarning(
      ctx.asCaller.supabase,
      ctx.asSystem.pg,
      {
        companyId: ctx.company.id,
        projectId: input.projectId,
        projectElementId: input.projectElementId,
        laborCategoryId: input.laborCategoryId,
        entryDate: input.entryDate,
        hours: input.hours
      }
    );
    return { ...saved, warning };
  }
});

/**
 * Log time on an element as a new entry for the caller.
 *
 * @remarks
 * Adds an entry through `save-timesheet-entry` (`add` mode, so DCAA mode
 * applies its controls). In Standard mode the entry is Submitted: with
 * approvals off it posts at once (`post-timesheet`), with approvals on it
 * waits in Approvals. In DCAA mode the entry is Draft until the week is
 * certified. `outcome` says which happened; a failed post leaves the entry
 * logged and comes back as `postingError`. A budget overrun is `warning`.
 */
export const logTimesheetEntry = defineServiceFn({
  input: logTimeValidator,
  permission: {},
  async run(ctx, input) {
    const settings = await getCompanySettings(
      ctx.asCaller.supabase,
      ctx.company.id
    );
    if (settings.error) {
      return ctx.error(
        "internal",
        "Failed to load the company settings",
        settings.error
      );
    }

    const saved = await run(ctx, "save-timesheet-entry", () =>
      service.saveTimesheetEntry(
        ctx,
        service.saveTimesheetEntryPostingInput({
          ...input,
          mode: "add",
          status: "Submitted",
          employeeId: ctx.auditUserId
        })
      )
    );
    if (saved instanceof CarbonError) return saved;
    if (!saved.entryId) return ctx.error("internal", "Failed to log the time");
    const entryId = saved.entryId;

    // Budget control (Government Contracting 5c): a timesheet only warns
    // (DCAAM 7641.90).
    const warning = await service.timesheetBudgetWarning(
      ctx.asCaller.supabase,
      ctx.asSystem.pg,
      {
        companyId: ctx.company.id,
        projectId: input.projectId,
        projectElementId: input.projectElementId,
        laborCategoryId: input.laborCategoryId,
        entryDate: input.entryDate,
        hours: input.hours
      }
    );

    // DCAA mode: the entry is Draft until the employee certifies the week.
    if (saved.status !== "Submitted") {
      return {
        entryId,
        status: saved.status,
        outcome: "saved" as const,
        warning,
        postingError: null
      };
    }
    if (settings.data.timesheetApprovalRequired) {
      return {
        entryId,
        status: saved.status,
        outcome: "submitted" as const,
        warning,
        postingError: null
      };
    }

    const postingError = await service.postTimesheetEntries(ctx, {
      timesheetEntryIds: [entryId]
    });
    return {
      entryId,
      status: saved.status,
      outcome: "posted" as const,
      warning,
      postingError
    };
  }
});

/**
 * Submit one week of the caller's timesheet.
 *
 * @remarks
 * Runs `submit-timesheet-week` on the caller's Draft entries in the ISO week
 * that starts on `weekStart`; DCAA mode also certifies the week with
 * `certificationText`. Refuses a week with no draft hours. With approvals off
 * the entries post at once (`post-timesheet`); a failed post leaves them
 * submitted and comes back as `postingError`. `warnings` (the timecard check)
 * never stop the week.
 */
export const submitTimesheetWeek = defineServiceFn({
  input: z.object({
    weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    certificationText: z.string().optional()
  }),
  permission: {},
  async run(ctx, input) {
    const submitted = await run(ctx, "submit-timesheet-week", () =>
      service.submitTimesheetWeek(ctx, {
        employeeId: ctx.auditUserId,
        weekStart: input.weekStart,
        certificationText: input.certificationText || undefined
      })
    );
    if (submitted instanceof CarbonError) return submitted;
    const { entryIds, warnings } = submitted;
    if (entryIds.length === 0) {
      return ctx.error("rule", "This week has no draft hours to submit");
    }

    const settings = await getCompanySettings(
      ctx.asCaller.supabase,
      ctx.company.id
    );
    if (settings.error) {
      logger.error("Failed to load company settings", {
        companyId: ctx.company.id,
        error: settings.error
      });
    }
    if (settings.data?.timesheetApprovalRequired ?? true) {
      return { entryIds, warnings, posted: false, postingError: null };
    }

    const postingError = await service.postTimesheetEntries(ctx, {
      timesheetEntryIds: entryIds
    });
    return { entryIds, warnings, posted: !postingError, postingError };
  }
});

/**
 * Post Submitted or Approved timesheet entries.
 *
 * @remarks
 * Runs `post-timesheet`: the cost goes Dr the project account / Cr
 * laborAbsorptionAccount, one projectLedger row per entry, and each entry is
 * stamped Posted. Entries that are not postable are skipped. It does not
 * check approval routing: the approval operations do.
 */
export const postTimesheet = defineServiceFn({
  input: postTimesheetInput,
  permission: service.postTimesheetPermission,
  async run(ctx, input) {
    return run(ctx, "post-timesheet", () => service.postTimesheet(ctx, input));
  }
});

/**
 * Approve Submitted timesheet entries and post them.
 *
 * @remarks
 * In DCAA mode a labor transfer needs an approver other than the requester;
 * every entry is checked before any status changes. The approved entries
 * post at once (`post-timesheet`); a failed post leaves them Approved and
 * comes back as `postingError`. Refuses when no entry could be approved.
 *
 * @mcp
 */
export const approveTimesheetEntries = defineServiceFn({
  input: z.object({ ids: z.array(z.string().min(1)).min(1) }),
  permission: { update: "projects" },
  async run(ctx, { ids }) {
    const refusal = await service.timesheetApprovalRefusal(
      ctx.asCaller.supabase,
      { companyId: ctx.company.id, approverId: ctx.auditUserId, ids }
    );
    if (refusal) return ctx.error("rule", refusal);

    const approved = await service.approveTimesheetEntries(
      ctx.asCaller.supabase,
      { ids, companyId: ctx.company.id, approvedBy: ctx.auditUserId }
    );
    if (approved.error) {
      return ctx.error(
        "internal",
        "Failed to approve the time",
        approved.error
      );
    }
    const approvedIds = (approved.data ?? []).map((row) => row.id);
    if (approvedIds.length === 0) {
      return ctx.error(
        "conflict",
        "No entry could be approved. Reload the page."
      );
    }

    const postingError = await service.postTimesheetEntries(ctx, {
      timesheetEntryIds: approvedIds
    });
    return { approvedIds, postingError };
  }
});

/**
 * Reject Submitted timesheet entries with a note.
 *
 * @remarks
 * The employee can edit them again. A note is required.
 *
 * @mcp
 */
export const rejectTimesheetEntries = defineServiceFn({
  input: z.object({
    ids: z.array(z.string().min(1)).min(1),
    note: z.string()
  }),
  permission: { update: "projects" },
  async run(ctx, input) {
    const note = input.note.trim();
    if (!note) {
      return ctx.error("validation", "A note is required to reject time");
    }
    const rejected = await service.rejectTimesheetEntries(
      ctx.asCaller.supabase,
      {
        ids: input.ids,
        companyId: ctx.company.id,
        note,
        updatedBy: ctx.auditUserId
      }
    );
    if (rejected.error) {
      return ctx.error("internal", "Failed to reject the time", rejected.error);
    }
    return { rejectedIds: (rejected.data ?? []).map((row) => row.id) };
  }
});

/**
 * Correct one of the caller's posted timesheet entries.
 *
 * @remarks
 * Writes a Submitted reversal of the posted hours and, when `hours` is not 0,
 * a Submitted replacement, both with the reason. A replacement on another
 * charge number (`projectId`, `projectElementId`) or labor category is a
 * labor transfer. In DCAA mode the correction writes one revision on the
 * original, and a labor transfer always waits for another user's approval.
 * Otherwise, with approvals off both post at once (`post-timesheet`); a failed
 * post comes back as `postingError`. `outcome` says which happened.
 *
 * @mcp
 */
export const createTimesheetCorrection = defineServiceFn({
  input: timesheetCorrectionValidator,
  permission: {},
  async run(ctx, input) {
    // The correction runs over Kysely (no RLS), so the entry must be the
    // caller's own.
    const entry = await ctx.asCaller.supabase
      .from("timesheetEntry")
      .select("id")
      .eq("id", input.timesheetEntryId)
      .eq("companyId", ctx.company.id)
      .eq("employeeId", ctx.auditUserId)
      .maybeSingle();
    if (entry.error || !entry.data) {
      return ctx.error("notFound", "The timesheet entry does not exist");
    }

    let correction: Awaited<
      ReturnType<typeof service.createTimesheetCorrection>
    >;
    try {
      correction = await service.createTimesheetCorrection(ctx.asSystem.pg, {
        ...input,
        companyId: ctx.company.id,
        userId: ctx.auditUserId
      });
    } catch (err) {
      logger.error("Failed to correct a timesheet entry", {
        companyId: ctx.company.id,
        error: err
      });
      return ctx.error(
        "rule",
        err instanceof Error ? err.message : "Failed to correct the entry",
        err
      );
    }

    const settings = await getCompanySettings(
      ctx.asCaller.supabase,
      ctx.company.id
    );
    if (settings.error) {
      logger.error("Failed to load company settings", {
        companyId: ctx.company.id,
        error: settings.error
      });
    }
    // DCAA mode: a labor transfer needs an approver other than the requester
    // (`assertCanApprove`), so it never posts on its own.
    if (
      correction.isTransfer &&
      settings.data?.timekeepingControls === "DCAA"
    ) {
      return {
        ...correction,
        outcome: "transferAwaitingApproval" as const,
        postingError: null
      };
    }
    if (settings.data?.timesheetApprovalRequired ?? true) {
      return {
        ...correction,
        outcome: "awaitingApproval" as const,
        postingError: null
      };
    }

    const postingError = await service.postTimesheetEntries(ctx, {
      timesheetEntryIds: [
        correction.reversalId,
        ...(correction.replacementId ? [correction.replacementId] : [])
      ]
    });
    return { ...correction, outcome: "posted" as const, postingError };
  }
});

/**
 * Accept the changes another user made to the caller's timesheet.
 *
 * @remarks
 * DCAA mode. Each entry, which must be the caller's and in Pending Employee
 * Review, returns to Draft with one revision "Accepted by employee".
 */
export const acceptTimesheetReview = defineServiceFn({
  input: timesheetReviewAcceptValidator,
  permission: {},
  async run(ctx, { ids }) {
    try {
      const acceptedIds = await service.acceptTimesheetReview(ctx.asSystem.pg, {
        companyId: ctx.company.id,
        employeeId: ctx.auditUserId,
        ids,
        userId: ctx.auditUserId
      });
      return { acceptedIds };
    } catch (err) {
      logger.error("Failed to accept timesheet changes", {
        companyId: ctx.company.id,
        error: err
      });
      return ctx.error(
        "rule",
        err instanceof Error ? err.message : "Failed to accept",
        err
      );
    }
  }
});

/**
 * List the revisions of one timesheet entry, oldest first.
 *
 * @remarks
 * Who changed it, when, why, and the fields before and after.
 *
 * @mcp read
 */
export const getTimesheetRevisions = defineServiceFn({
  input: z.object({ timesheetEntryId: z.string().min(1) }),
  permission: { view: "projects" },
  async run(ctx, { timesheetEntryId }) {
    return unwrap(
      ctx,
      await service.getTimesheetRevisions(ctx.asCaller.supabase, {
        companyId: ctx.company.id,
        timesheetEntryId
      })
    );
  }
});

/**
 * List an employee's entries in Pending Employee Review.
 *
 * @remarks
 * Each entry has its latest revision: the change the employee must accept.
 * Left out, `employeeId` is the caller.
 *
 * @mcp read
 */
export const getPendingReviewEntries = defineServiceFn({
  input: z.object({ employeeId: z.string().min(1).optional() }),
  permission: { view: "projects" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getPendingReviewEntries(ctx.asCaller.supabase, {
        companyId: ctx.company.id,
        employeeId: input.employeeId ?? ctx.auditUserId
      })
    );
  }
});

/**
 * Count the Submitted timesheet entries of the company.
 *
 * @remarks
 * The items waiting in Projects → Approvals.
 *
 * @mcp read
 */
export const getTimesheetApprovalCount = defineServiceFn({
  input: z.object({}),
  permission: { view: "projects" },
  async run(ctx) {
    const result = await service.getTimesheetApprovalCount(
      ctx.asCaller.supabase,
      ctx.company.id
    );
    if (result.error) {
      return ctx.error(
        "internal",
        "Failed to count the timesheet approvals",
        result.error
      );
    }
    return { count: result.count ?? 0 };
  }
});

/**
 * List the Submitted timesheet entries, grouped by employee and week.
 *
 * @remarks
 * Weeks start on Monday. When `ownerId` is set, only entries on projects that
 * user owns are listed.
 *
 * @mcp read
 */
export const getTimesheetApprovals = defineServiceFn({
  input: z.object({ ownerId: z.string().min(1).nullable().optional() }),
  permission: { view: "projects" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getTimesheetApprovals(
        ctx.asCaller.supabase,
        ctx.company.id,
        { ownerId: input.ownerId ?? null }
      )
    );
  }
});

/**
 * Remind employees of the days they have entered no time.
 *
 * @remarks
 * The Missing Time report's reminder. The dates are read again for the range;
 * an employee with none gets no reminder. Returns how many were sent.
 */
export const sendMissingTimeReminders = defineServiceFn({
  input: z.object({
    employeeIds: z.array(z.string().min(1)),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
  }),
  permission: { view: ["projects"] },
  async run(ctx, { employeeIds, startDate, endDate }) {
    // The dates come from the database again, not from the caller.
    const employees = await service.getMissingTimeByEmployee(ctx.asSystem.pg, {
      companyId: ctx.company.id,
      from: startDate,
      to: endDate,
      excluded: false
    });
    const chosen = employees.filter(
      (employee) =>
        employeeIds.includes(employee.employeeId) && employee.dates.length > 0
    );

    // A reminder names five dates, then "and N more".
    try {
      await Promise.all(
        chosen.map((employee) => {
          const shown = employee.dates
            .slice(0, 5)
            .map((date) => formatDate(date))
            .join(", ");
          const more = employee.dates.length - 5;
          return trigger("notify", {
            event: NotificationEvent.TimesheetMissing,
            companyId: ctx.company.id,
            documentId: employee.dates[employee.dates.length - 1]!,
            recipient: { type: "users", userIds: [employee.employeeId] },
            from: ctx.auditUserId,
            body:
              more > 0
                ? `No time entered for ${shown} and ${more} more days`
                : `No time entered for ${shown}`
          });
        })
      );
    } catch (err) {
      logger.error("Failed to send the missing time reminders", {
        companyId: ctx.company.id,
        employeeIds,
        error: err
      });
      return ctx.error("internal", "Failed to send the reminders", err);
    }
    return { sent: chosen.length };
  }
});

/**
 * Take an employee out of the Missing Time report, or back in.
 *
 * @remarks
 * Sets `timesheetRequired` on the employee's job record. Refuses an employee
 * with no job record.
 */
export const updateTimesheetRequired = defineServiceFn({
  input: z.object({
    employeeId: z.string().min(1),
    timesheetRequired: z.boolean()
  }),
  permission: { view: ["projects"], update: "people" },
  async run(ctx, { employeeId, timesheetRequired }) {
    try {
      const updated = await service.updateTimesheetRequired(ctx.asSystem.pg, {
        companyId: ctx.company.id,
        employeeId,
        timesheetRequired,
        updatedBy: ctx.auditUserId
      });
      if (!updated) {
        return ctx.error(
          "rule",
          "Set up the person's job before you change this"
        );
      }
    } catch (err) {
      logger.error("Failed to update timesheetRequired", {
        companyId: ctx.company.id,
        employeeId,
        error: err
      });
      return ctx.error("internal", "Failed to update", err);
    }
    return { employeeId, timesheetRequired };
  }
});

// --- Charges: expenses and issues --------------------------------------------------

/**
 * Charge a cost to a project element.
 *
 * @remarks
 * Inserts a project expense entry and posts it (`post-project-expense`: Dr
 * the project account / Cr GRNI, one Other Direct ledger row). An entry that
 * does not post is deleted again, so a refusal leaves nothing behind. Budget
 * control (Government Contracting 5c): a Block budget refuses the charge, a
 * Warn budget posts it and returns the overrun as `budgetWarning`.
 */
export const createProjectExpense = defineServiceFn({
  input: projectExpenseValidator,
  permission: { update: "projects" },
  async run(ctx, input) {
    const budget = await service.checkProjectBudget(
      ctx.asSystem.pg,
      ctx.asCaller.supabase,
      {
        companyId: ctx.company.id,
        source: "purchase",
        charges: [
          {
            projectId: input.projectId,
            projectElementId: input.projectElementId,
            amount: input.amount
          }
        ]
      }
    );
    if (budget.status === "block") return ctx.error("rule", budget.message);

    const postingError = await service.addProjectExpense(ctx, input);
    if (postingError) return ctx.error("rule", postingError);
    return {
      budgetWarning: budget.status === "warn" ? budget.message : null
    };
  }
});

/**
 * Issue stock to a project, or return it.
 *
 * @remarks
 * Runs `post-project-issue`: the stock leaves (or re-enters) inventory at its
 * carrying cost and the offset posts to the project account. Budget control
 * (Government Contracting 5c): an Issue charges the item's unit cost to the
 * element, so a Block budget refuses it and a Warn budget posts it and
 * returns the overrun as `budgetWarning`. A Return is never checked.
 */
export const postProjectIssue = defineServiceFn({
  input: projectIssueValidator,
  permission: { update: ["inventory", "projects"] },
  async run(ctx, input) {
    let budgetWarning: string | null = null;
    if (input.direction === "Issue") {
      const cost = await ctx.asSystem.pg
        .selectFrom("itemCost")
        .select("unitCost")
        .where("itemId", "=", input.itemId)
        .where("companyId", "=", ctx.company.id)
        .executeTakeFirst();
      const budget = await service.checkProjectBudget(
        ctx.asSystem.pg,
        ctx.asCaller.supabase,
        {
          companyId: ctx.company.id,
          source: "issue",
          charges: [
            {
              projectId: input.projectId,
              projectElementId: input.projectElementId ?? null,
              amount: input.quantity * Number(cost?.unitCost ?? 0)
            }
          ]
        }
      );
      if (budget.status === "block") return ctx.error("rule", budget.message);
      if (budget.status === "warn") budgetWarning = budget.message;
    }

    const posted = await run(ctx, "post-project-issue", () =>
      service.postProjectIssue(ctx, service.projectIssuePostingInput(input))
    );
    if (posted instanceof CarbonError) return posted;
    return { ...posted, budgetWarning };
  }
});

// --- Billing, planning groups, project stock transfers, indirect rates ---------

// --- Contract billing --------------------------------------------------------

/**
 * Get a project's billing elements.
 *
 * @remarks
 * Lists the billing elements of one project (`isBilling`), for a contract
 * line's billing element. Only a Contract-treatment project has them.
 *
 * @mcp read
 */
export const getProjectBillingElements = defineServiceFn({
  input: z.object({ projectId: z.string() }),
  permission: { view: "projects" },
  async run(ctx, { projectId }) {
    return unwrap(
      ctx,
      await service.getProjectBillingElements(
        ctx.asCaller.supabase,
        projectId,
        ctx.company.id
      )
    );
  }
});

/**
 * Get the billable items of contract billing lines.
 *
 * @remarks
 * Lists the billable items of contract billing lines, with the ledger row's
 * posting date and cost type, and the invoice that billed each one. Filter
 * by contract line, project or status.
 *
 * @mcp read
 */
export const getContractBillableItems = defineServiceFn({
  input: z.looseObject({
    customerContractLineId: z.string().nullable().optional(),
    projectId: z.string().nullable().optional(),
    status: z
      .array(z.enum(Constants.public.Enums.projectBillableItemStatus))
      .nullable()
      .optional(),
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0)
  }),
  permission: { view: ["projects", "sales"] },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getContractBillableItems(
        ctx.asCaller.supabase,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get the Time & Materials and Cost Plus contract lines.
 *
 * @remarks
 * Lists the Time & Materials and Cost Plus contract lines, of one project or
 * of the company, with their contract, billing element and funding terms.
 *
 * @mcp read
 */
export const getContractBillingLines = defineServiceFn({
  input: z.object({ projectId: z.string().nullable().optional() }),
  permission: { view: ["projects", "sales"] },
  async run(ctx, { projectId }) {
    return unwrap(
      ctx,
      await service.getContractBillingLines(ctx.asCaller.supabase, {
        companyId: ctx.company.id,
        projectId
      })
    );
  }
});

/**
 * Review contract billable items.
 *
 * @remarks
 * Reviews contract billable items before they are billed: hold them with a
 * reason, release a hold, write them off with a reason, or change one item's
 * unit price (the amount follows; a "No bill rate" hold is released). Billed
 * and Written Off items are refused. Each change reaches the audit log
 * ("Billable Item").
 *
 * @param ids - The billable items to change.
 * @param action - `hold`, `release`, `writeOff` or `price`.
 * @param reason - Required to hold or write off.
 * @param unitPrice - The new unit price (`price`, one item only).
 *
 * @mcp
 */
export const updateProjectBillableItems = defineServiceFn({
  input: billableItemActionValidator,
  // Billing review is contract billing: it also needs the sales permission.
  permission: { update: "projects", view: "sales" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.updateProjectBillableItems(ctx.asCaller.supabase, {
        ...input,
        companyId: ctx.company.id,
        userId: ctx.auditUserId
      })
    );
  }
});

// --- Planning groups ---------------------------------------------------------

/**
 * Get the planning groups.
 *
 * @remarks
 * Lists the planning groups of the company, with their location, the
 * exception project and the count of member projects.
 *
 * @mcp read
 */
export const getPlanningGroups = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "projects" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getPlanningGroups(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get a planning group.
 *
 * @mcp read
 */
export const getPlanningGroup = defineServiceFn({
  input: z.object({ planningGroupId: z.string() }),
  permission: { view: "projects" },
  async run(ctx, { planningGroupId }) {
    return unwrap(
      ctx,
      await service.getPlanningGroup(
        ctx.asCaller.supabase,
        planningGroupId,
        ctx.company.id
      )
    );
  }
});

/**
 * Get the active planning groups, for a picker.
 *
 * @remarks
 * Lists the active planning groups of the company: id, name and location.
 *
 * @mcp read
 */
export const getPlanningGroupsList = defineServiceFn({
  input: z.object({}),
  permission: { view: "projects" },
  async run(ctx) {
    return unwrap(
      ctx,
      await utils.getPlanningGroupsList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get the member projects of a planning group.
 *
 * @remarks
 * Membership is shown on the group, so no project can hoard the group's
 * stock out of sight.
 *
 * @mcp read
 */
export const getPlanningGroupMembers = defineServiceFn({
  input: z.object({ planningGroupId: z.string() }),
  permission: { view: "projects" },
  async run(ctx, { planningGroupId }) {
    return unwrap(
      ctx,
      await service.getPlanningGroupMembers(
        ctx.asCaller.supabase,
        planningGroupId,
        ctx.company.id
      )
    );
  }
});

/**
 * Create or update a planning group.
 *
 * @remarks
 * Planning groups are a commercial feature (PLANNING_GROUPS). Creating needs
 * `create: projects`, updating `update: projects`.
 */
export const upsertPlanningGroup = defineServiceFn({
  input: z
    .object({
      id: z.string().optional(),
      name: z.string().trim().min(1, { message: "Name is required" }),
      locationId: z.string().min(1, { message: "Location is required" }),
      excessRule: z.enum(planningGroupExcessRules),
      exceptionProjectId: z.string().optional(),
      priorityRule: z.enum(planningGroupPriorityRules),
      active: z.boolean()
    })
    .refine(
      (data) =>
        data.excessRule !== "Exception Project" || !!data.exceptionProjectId,
      {
        message: "Choose the project that takes the excess",
        path: ["exceptionProjectId"]
      }
    ),
  permission: {},
  async run(ctx, { id, ...fields }) {
    if (!ctx.can(id ? { update: "projects" } : { create: "projects" })) {
      return ctx.error("forbidden", "You do not have permission to do this");
    }
    try {
      const result = id
        ? await eeUpsertPlanningGroup(ctx.asCaller.supabase, {
            ...fields,
            id,
            companyId: ctx.company.id,
            updatedBy: ctx.auditUserId
          })
        : await eeUpsertPlanningGroup(ctx.asCaller.supabase, {
            ...fields,
            companyId: ctx.company.id,
            createdBy: ctx.auditUserId
          });
      // A refusal of the ee service carries no code: its message is for the person.
      if (result.error && !result.error.code) {
        return ctx.error("rule", result.error.message);
      }
      return unwrap(ctx, result);
    } catch (err) {
      if (!(err instanceof EntitlementError)) throw err;
      return ctx.error("entitlement", "Upgrade to use planning groups");
    }
  }
});

/**
 * Delete a planning group.
 *
 * @remarks
 * It refuses while a project is a member, or a purchase order line or job is
 * made for the group. Deleting is not plan-gated: a company whose plan lapsed
 * can still clean up.
 *
 * @mcp destructive
 */
export const deletePlanningGroup = defineServiceFn({
  input: z.object({ planningGroupId: z.string() }),
  permission: { delete: "projects" },
  async run(ctx, { planningGroupId }) {
    const deleted = await service.deletePlanningGroup(
      ctx.asCaller.supabase,
      planningGroupId,
      ctx.company.id
    );
    if (deleted.error) return unwrap(ctx, deleted);
    return { planningGroupId };
  }
});

// --- Project stock transfers -------------------------------------------------

/**
 * Get the project stock transfers.
 *
 * @remarks
 * Lists the project stock transfers of the company, newest first. With a
 * project, only the transfers from or to it.
 *
 * @mcp read
 */
export const getProjectStockTransfers = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional(),
    projectId: z.string().nullable().optional()
  }),
  permission: { view: "projects" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getProjectStockTransfers(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get a project stock transfer.
 *
 * @remarks
 * Loads one project stock transfer with its owners.
 *
 * @mcp read
 */
export const getProjectStockTransfer = defineServiceFn({
  input: z.object({ projectStockTransferId: z.string() }),
  permission: { view: "projects" },
  async run(ctx, { projectStockTransferId }) {
    return unwrap(
      ctx,
      await service.getProjectStockTransfer(
        ctx.asCaller.supabase,
        ctx.company.id,
        projectStockTransferId
      )
    );
  }
});

/**
 * Get the lines of a project stock transfer.
 *
 * @remarks
 * Lists the lines of a project stock transfer, oldest first.
 *
 * @mcp read
 */
export const getProjectStockTransferLines = defineServiceFn({
  input: z.object({ projectStockTransferId: z.string() }),
  permission: { view: "projects" },
  async run(ctx, { projectStockTransferId }) {
    return unwrap(
      ctx,
      await service.getProjectStockTransferLines(
        ctx.asCaller.supabase,
        ctx.company.id,
        projectStockTransferId
      )
    );
  }
});

/**
 * Create or update a project stock transfer.
 *
 * @remarks
 * Creates a Draft project stock transfer with the next readable id, or
 * updates a Draft one (without `id` it creates). A transfer past Draft is
 * not changed, and its type never changes. A Payback runs from the borrower
 * back to the lender, at the borrow's location: it takes its owners and
 * location from the open borrow it settles, on create and on update. Common
 * stock is the owner `common`.
 *
 * @mcp
 */
export const upsertProjectStockTransfer = defineServiceFn({
  input: projectStockTransferValidator,
  permission: { update: "projects" },
  async run(ctx, input) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;

    if (!input.id) {
      const { type, reason, settlesBorrowId } = input;
      let fromProjectId = toStockOwner(input.fromProjectId);
      let toProjectId = toStockOwner(input.toProjectId);
      let locationId = input.locationId ?? "";

      // The header names both owners (the owner CHECK needs one).
      if (type === "Payback") {
        const borrow = await client
          .from("projectBorrow")
          .select("borrowerProjectId, lenderProjectId, locationId, status")
          .eq("id", settlesBorrowId!)
          .eq("companyId", companyId)
          .single();
        if (borrow.error || borrow.data.status !== "Open") {
          return ctx.error(
            "validation",
            "Select an open borrow to pay back",
            borrow.error
          );
        }
        fromProjectId = borrow.data.borrowerProjectId;
        toProjectId = borrow.data.lenderProjectId;
        locationId = borrow.data.locationId;
      }

      return unwrap(
        ctx,
        await service.upsertProjectStockTransfer(client, {
          type,
          fromProjectId,
          toProjectId,
          locationId,
          reason,
          paybackDueDate:
            type === "Borrow" ? (input.paybackDueDate ?? null) : null,
          settlesBorrowId:
            type === "Payback" ? (settlesBorrowId ?? null) : null,
          companyId,
          createdBy: ctx.auditUserId
        })
      );
    }

    const current = await service.getProjectStockTransfer(
      client,
      companyId,
      input.id
    );
    if (current.error) {
      return ctx.error(
        "notFound",
        "Failed to load the transfer",
        current.error
      );
    }

    // A Payback keeps the owners and location of its borrow.
    const isPayback = current.data.type === "Payback";
    return unwrap(
      ctx,
      await service.upsertProjectStockTransfer(client, {
        id: input.id,
        companyId,
        updatedBy: ctx.auditUserId,
        fromProjectId: isPayback
          ? current.data.fromProjectId
          : toStockOwner(input.fromProjectId),
        toProjectId: isPayback
          ? current.data.toProjectId
          : toStockOwner(input.toProjectId),
        locationId: isPayback
          ? current.data.locationId
          : (input.locationId ?? current.data.locationId),
        reason: input.reason,
        paybackDueDate:
          current.data.type === "Borrow"
            ? (input.paybackDueDate ?? null)
            : null,
        settlesBorrowId: current.data.settlesBorrowId
      })
    );
  }
});

/**
 * Add or change a line of a Draft project stock transfer.
 *
 * @remarks
 * Without `id` the line is added. A transfer past Draft is refused.
 *
 * @mcp
 */
export const upsertProjectStockTransferLine = defineServiceFn({
  input: projectStockTransferLineValidator.extend({
    projectStockTransferId: z.string()
  }),
  permission: { update: "projects" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertProjectStockTransferLine(ctx.asCaller.supabase, {
        ...input,
        companyId: ctx.company.id,
        userId: ctx.auditUserId
      })
    );
  }
});

/**
 * Remove a line from a Draft project stock transfer.
 *
 * @remarks
 * A transfer past Draft is refused.
 *
 * @mcp destructive
 */
export const deleteProjectStockTransferLine = defineServiceFn({
  input: z.object({ id: z.string(), projectStockTransferId: z.string() }),
  permission: { update: "projects" },
  async run(ctx, { id, projectStockTransferId }) {
    const deleted = await service.deleteProjectStockTransferLine(
      ctx.asCaller.supabase,
      { id, projectStockTransferId, companyId: ctx.company.id }
    );
    if (deleted.error) return unwrap(ctx, deleted);
    return { id };
  }
});

/**
 * Post an Approved project stock transfer.
 *
 * @remarks
 * Stock moves between stock stripes at the same bin, at cost. A Transfer or
 * a Borrow moves the from-owner's cost layers to the to-owner (a Borrow
 * opens a project borrow); a Payback returns the borrowed cost to the lender
 * and books the borrower's Payback Variance. Government-furnished stock never
 * leaves for common stock or for a project of another customer.
 */
export const postProjectStockTransfer = defineServiceFn({
  input: service.postProjectStockTransferInput,
  permission: service.postProjectStockTransferPermission,
  async run(ctx, input) {
    return run(ctx, "post-project-stock-transfer", () =>
      service.postProjectStockTransfer(ctx, input)
    );
  }
});

/**
 * Approve, post or cancel a project stock transfer.
 *
 * @remarks
 * `approve` approves a Draft transfer: it refuses a transfer without lines,
 * and moves the government-furnished refusal of posting up to approval.
 * `post` posts an Approved transfer (see `postProjectStockTransfer`).
 * `cancel` cancels a Draft or Approved one.
 *
 * @param id - The project stock transfer.
 * @param action - `approve`, `post` or `cancel`.
 *
 * @mcp
 */
export const updateProjectStockTransferStatus = defineServiceFn({
  input: z.object({
    id: z.string(),
    action: z.enum(projectStockTransferActions)
  }),
  permission: { update: "projects" },
  async run(ctx, { id, action }) {
    if (action === "post") {
      return run(ctx, "post-project-stock-transfer", () =>
        service.postProjectStockTransfer(ctx, { projectStockTransferId: id })
      );
    }
    return unwrap(
      ctx,
      await service.updateProjectStockTransferStatus(ctx.asCaller.supabase, {
        id,
        action,
        companyId: ctx.company.id,
        userId: ctx.auditUserId
      })
    );
  }
});

/**
 * Get the project borrows.
 *
 * @remarks
 * Lists the borrows of the company, oldest due first. With a project, the
 * borrows it owes or lent; with statuses, only those.
 *
 * @param locationId - Only the borrows at this location.
 * @param dueBefore - Only the borrows due before this date (`YYYY-MM-DD`):
 * the overdue ones, when it is today.
 *
 * @mcp read
 */
export const getProjectBorrows = defineServiceFn({
  input: z.object({
    projectId: z.string().nullable().optional(),
    status: z.array(z.enum(projectBorrowStatuses)).nullable().optional(),
    locationId: z.string().nullable().optional(),
    dueBefore: z.string().nullable().optional()
  }),
  permission: { view: "projects" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getProjectBorrows(
        ctx.asCaller.supabase,
        ctx.company.id,
        input
      )
    );
  }
});

// --- Indirect rates (Government Contracting, @carbon/ee) ---------------------

/**
 * Create or update an indirect pool.
 *
 * @remarks
 * Government Contracting is a commercial feature: without it the call is
 * refused. Creating needs `create: accounting`, updating
 * `update: accounting`. A duplicate name or sequence is refused with the
 * field's message.
 */
export const upsertIndirectPool = defineServiceFn({
  input: z
    .object({
      id: z.string().optional(),
      name: z.string().min(1, { message: "Name is required" }),
      poolType: z.enum(indirectPoolTypes),
      sequence: z
        .number()
        .int({ message: "Sequence must be a whole number" })
        .min(1, { message: "Sequence must be 1 or more" }),
      baseType: z.enum(indirectBaseTypes),
      appliedAccountId: z.string().optional(),
      appliesToProjects: z.boolean(),
      offsetAbsorbedOverhead: z.boolean(),
      active: z.boolean()
    })
    .refine(
      (data) => !data.offsetAbsorbedOverhead || data.poolType === "Overhead",
      {
        message: "Only an Overhead pool can offset absorbed overhead",
        path: ["offsetAbsorbedOverhead"]
      }
    )
    .refine(
      (data) => data.poolType !== "Service Center" || !data.appliesToProjects,
      {
        message: "A Service Center pool cannot apply to projects",
        path: ["appliesToProjects"]
      }
    ),
  permission: {},
  async run(ctx, input) {
    if (
      !ctx.can(input.id ? { update: "accounting" } : { create: "accounting" })
    ) {
      return ctx.error("forbidden", "You do not have permission to do this");
    }
    try {
      const result = await eeUpsertIndirectPool(ctx.asCaller.supabase, {
        ...input,
        companyId: ctx.company.id,
        userId: ctx.auditUserId
      });
      if (result.error) {
        const fieldErrors = indirectRatesFieldErrors(result.error);
        if (fieldErrors) {
          return ctx.error(
            "conflict",
            Object.values(fieldErrors)[0]!,
            result.error
          );
        }
      }
      return unwrap(ctx, result);
    } catch (err) {
      if (!(err instanceof EntitlementError)) throw err;
      return ctx.error("entitlement", "Upgrade to use indirect rates");
    }
  }
});

/**
 * Delete an indirect pool.
 *
 * @remarks
 * A pool with rates or burden is refused: deactivate it instead.
 */
export const deleteIndirectPool = defineServiceFn({
  input: z.object({ id: z.string() }),
  permission: { delete: "accounting" },
  async run(ctx, { id }) {
    try {
      const deleted = await eeDeleteIndirectPool(ctx.asCaller.supabase, {
        id,
        companyId: ctx.company.id
      });
      if (deleted.error) {
        // A refusal of the ee service carries no code: its message is for the person.
        if (!("code" in deleted.error) || !deleted.error.code) {
          return ctx.error("rule", deleted.error.message);
        }
        return unwrap(ctx, deleted);
      }
      return { id };
    } catch (err) {
      if (!(err instanceof EntitlementError)) throw err;
      return ctx.error("entitlement", "Upgrade to use indirect rates");
    }
  }
});

/**
 * Add an account to an indirect pool, as a Cost or Base account.
 *
 * @remarks
 * A project account cannot be a Base account; one account and dimension
 * cell is a Cost account of at most one pool.
 */
export const upsertIndirectPoolAccount = defineServiceFn({
  input: indirectPoolAccountValidator,
  permission: { update: "accounting" },
  async run(ctx, input) {
    try {
      const result = await eeUpsertIndirectPoolAccount(ctx.asCaller.supabase, {
        ...input,
        companyId: ctx.company.id,
        userId: ctx.auditUserId
      });
      if (result.error) {
        const fieldErrors = indirectRatesFieldErrors(result.error);
        if (fieldErrors) {
          return ctx.error(
            "conflict",
            Object.values(fieldErrors)[0]!,
            result.error
          );
        }
        // A refusal of the ee service carries no code: its message is for the person.
        if (!("code" in result.error) || !result.error.code) {
          return ctx.error("rule", result.error.message);
        }
      }
      return unwrap(ctx, result);
    } catch (err) {
      if (!(err instanceof EntitlementError)) throw err;
      return ctx.error("entitlement", "Upgrade to use indirect rates");
    }
  }
});

/**
 * Remove an account from an indirect pool.
 */
export const deleteIndirectPoolAccount = defineServiceFn({
  input: z.object({ id: z.string() }),
  permission: { update: "accounting" },
  async run(ctx, { id }) {
    try {
      const deleted = await eeDeleteIndirectPoolAccount(ctx.asCaller.supabase, {
        id,
        companyId: ctx.company.id
      });
      if (deleted.error) return unwrap(ctx, deleted);
      return { id };
    } catch (err) {
      if (!(err instanceof EntitlementError)) throw err;
      return ctx.error("entitlement", "Upgrade to use indirect rates");
    }
  }
});

/**
 * Set an indirect rate of a pool, from a period of a fiscal year onward.
 *
 * @remarks
 * Actual rates come from the rate run: enter a Provisional, Target or Final
 * rate.
 */
export const setIndirectRate = defineServiceFn({
  input: indirectRateEntryValidator,
  permission: { update: "accounting" },
  async run(ctx, input) {
    try {
      const result = await eeSetIndirectRate(ctx.asCaller.supabase, {
        ...input,
        companyId: ctx.company.id,
        userId: ctx.auditUserId
      });
      // A refusal of the ee service carries no code: its message is for the person.
      if (result.error && (!("code" in result.error) || !result.error.code)) {
        return ctx.error("rule", result.error.message);
      }
      return unwrap(ctx, result);
    } catch (err) {
      if (!(err instanceof EntitlementError)) throw err;
      return ctx.error("entitlement", "Upgrade to use indirect rates");
    }
  }
});

/**
 * Run the indirect rates of a locked period.
 *
 * @remarks
 * Computes the period's indirect rates, the project burden and its billing.
 */
export const runIndirectRatePeriod = defineServiceFn({
  input: z.object({
    accountingPeriodId: z.string().min(1, { message: "Choose a locked period" })
  }),
  permission: { update: "accounting" },
  async run(ctx, { accountingPeriodId }) {
    try {
      const result = await eeRunIndirectRatePeriod(
        ctx.asSystem.pg,
        ctx.asCaller.supabase,
        {
          companyId: ctx.company.id,
          userId: ctx.auditUserId,
          accountingPeriodId
        }
      );
      if (result.error) return ctx.error("rule", result.error.message);
      return { accountingPeriodId, completed: true as const };
    } catch (err) {
      if (!(err instanceof EntitlementError)) throw err;
      return ctx.error("entitlement", "Upgrade to use indirect rates");
    }
  }
});

/**
 * Run the year-end true-up at Final rates.
 *
 * @remarks
 * The burden catch-up of `fiscalYear` at the Final rate of period 12, posted
 * into the given Locked period, then the burden billing.
 */
export const runFinalTrueUp = defineServiceFn({
  input: z.object({
    fiscalYear: z.number().int({ message: "Choose a fiscal year" }),
    accountingPeriodId: z.string().min(1, { message: "Choose a locked period" })
  }),
  permission: { update: "accounting" },
  async run(ctx, { fiscalYear, accountingPeriodId }) {
    try {
      const result = await eeRunFinalTrueUp(
        ctx.asSystem.pg,
        ctx.asCaller.supabase,
        {
          companyId: ctx.company.id,
          userId: ctx.auditUserId,
          fiscalYear,
          accountingPeriodId
        }
      );
      if (result.error) return ctx.error("rule", result.error.message);
      return { accountingPeriodId, fiscalYear, completed: true as const };
    } catch (err) {
      if (!(err instanceof EntitlementError)) throw err;
      return ctx.error("entitlement", "Upgrade to use indirect rates");
    }
  }
});
