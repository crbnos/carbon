// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Project posting rules shared by every path that charges a project: which
// account a charge posts to (the cost treatment), whether the project and
// element accept the charge, and the projectLedger row it writes.
// The SQL function `project_posting_account` (migration *_projects-functions.sql)
// mirrors `resolveProjectPostingAccount` for the SQL posting paths.
// Spec: .ai/specs/2026-10-03-projects.md (Cost treatment → posting account).

import { type Database, getCompanyTimeZone } from "@carbon/database";
import type { KyselyDatabase as DB } from "@carbon/database/client";
import { inOrder } from "@carbon/database/rows";
import { datetime, round } from "@carbon/utils";
import { type Kysely, sql, type Transaction } from "kysely";

export type ProjectCostTreatment =
  Database["public"]["Enums"]["projectCostTreatment"];
export type ProjectStateGroup =
  Database["public"]["Enums"]["projectStateGroup"];

export type ProjectPostingProject = {
  id: string;
  status: Database["public"]["Enums"]["projectStatus"];
  costTreatment: ProjectCostTreatment;
  costAccountId: string | null;
  /** For messages only. */
  identifier?: string | null;
  name?: string;
};

export type ProjectPostingElement = {
  id: string;
  parentId: string | null;
  isChargeable: boolean;
  stateGroup: ProjectStateGroup;
  costTreatment: ProjectCostTreatment | null;
  costTreatmentEffectiveFrom: string | null;
  costAccountId: string | null;
  /** For messages only. */
  readableId?: string;
};

export type ProjectPostingContext = {
  project: ProjectPostingProject;
  element: ProjectPostingElement | null;
  ancestors: ProjectPostingElement[]; // nearest parent first
  defaults: {
    projectExpenseAccount: string | null;
    projectWorkInProgressAccount: string | null;
  };
};

export class ProjectChargeError extends Error {
  /** A refusal the caller can fix: a server function returns it as a 422. */
  readonly status = 422;
  constructor(message: string) {
    super(message);
    this.name = "ProjectChargeError";
  }
}

type ProjectLedgerInsert =
  Database["public"]["Tables"]["projectLedger"]["Insert"];

function projectLabel(project: ProjectPostingProject): string {
  return project.identifier || project.name || project.id;
}

function elementLabel(element: ProjectPostingElement): string {
  return element.readableId || element.id;
}

/**
 * The treatment and account a charge posts to on `postingDate`
 * (`YYYY-MM-DD`). The nearest element (itself, then its ancestors) whose
 * treatment is in effect on the date decides; else the project does.
 * Statistical posts to no project account (`accountId: null`).
 */
export function resolveProjectPostingAccount(
  ctx: ProjectPostingContext,
  postingDate: string
): { treatment: ProjectCostTreatment; accountId: string | null } {
  const chain = ctx.element ? [ctx.element, ...ctx.ancestors] : [];
  const override = chain.find(
    (element) =>
      element.costTreatment !== null &&
      (element.costTreatmentEffectiveFrom === null ||
        element.costTreatmentEffectiveFrom <= postingDate)
  );

  const treatment = override?.costTreatment ?? ctx.project.costTreatment;
  const explicitAccount = override
    ? override.costAccountId
    : ctx.project.costAccountId;

  if (treatment === "Statistical") return { treatment, accountId: null };
  if (explicitAccount) return { treatment, accountId: explicitAccount };

  if (treatment === "Expense") {
    if (!ctx.defaults.projectExpenseAccount) {
      throw new ProjectChargeError(
        "Set Project Expense in Account Defaults before you charge an Expense project"
      );
    }
    return { treatment, accountId: ctx.defaults.projectExpenseAccount };
  }

  if (treatment === "Contract") {
    if (!ctx.defaults.projectWorkInProgressAccount) {
      throw new ProjectChargeError(
        "Set Project Work in Progress in Account Defaults before you charge a Contract project"
      );
    }
    return { treatment, accountId: ctx.defaults.projectWorkInProgressAccount };
  }

  throw new ProjectChargeError("The Capitalize treatment is not available yet");
}

/**
 * Refuses a charge the project or element does not accept.
 * - `new`: a new charge (time, an issue, a new PO line or job). The project
 *   must be Released, and the element chargeable and Unstarted or Started.
 * - `commitment`: a posting against an existing commitment (a receipt or
 *   invoice of an open PO line, a job completion, a reversal). The project
 *   must be Released, On Hold or Technically Complete, and the element not
 *   in Backlog or Cancelled.
 */
export function assertChargeable(
  ctx: ProjectPostingContext,
  mode: "new" | "commitment"
): void {
  const { project, element } = ctx;
  const label = projectLabel(project);

  if (mode === "new") {
    if (project.status !== "Released") {
      throw new ProjectChargeError(
        `Project ${label} is ${project.status}. Only a Released project takes new charges.`
      );
    }
    if (element) {
      if (!element.isChargeable) {
        throw new ProjectChargeError(
          `Element ${elementLabel(element)} of project ${label} does not take charges.`
        );
      }
      if (
        element.stateGroup !== "Unstarted" &&
        element.stateGroup !== "Started"
      ) {
        throw new ProjectChargeError(
          `Element ${elementLabel(element)} of project ${label} is ${element.stateGroup}. Only an Unstarted or Started element takes new charges.`
        );
      }
    }
    return;
  }

  if (
    project.status !== "Released" &&
    project.status !== "On Hold" &&
    project.status !== "Technically Complete"
  ) {
    throw new ProjectChargeError(
      `Project ${label} is ${project.status}. It takes no postings.`
    );
  }
  if (
    element &&
    (element.stateGroup === "Backlog" || element.stateGroup === "Cancelled")
  ) {
    throw new ProjectChargeError(
      `Element ${elementLabel(element)} of project ${label} is ${element.stateGroup}. It takes no postings.`
    );
  }
}

/** One projectLedger row. The amount is rounded at internal precision. */
export function buildProjectLedgerRow(args: {
  companyId: string;
  projectId: string;
  projectElementId: string | null;
  postingDate: string;
  costType: Database["public"]["Enums"]["projectCostType"];
  documentType: string;
  documentId: string;
  documentLineId?: string | null;
  jobId?: string | null;
  itemId?: string | null;
  employeeId?: string | null;
  laborCategoryId?: string | null;
  supplierId?: string | null;
  quantity?: number | null;
  unitOfMeasureCode?: string | null;
  amount: number;
  journalLineId?: string | null;
  reversalOfId?: string | null;
  createdBy: string;
}): ProjectLedgerInsert {
  return {
    companyId: args.companyId,
    projectId: args.projectId,
    projectElementId: args.projectElementId,
    postingDate: args.postingDate,
    costType: args.costType,
    documentType: args.documentType,
    documentId: args.documentId,
    documentLineId: args.documentLineId ?? null,
    jobId: args.jobId ?? null,
    itemId: args.itemId ?? null,
    employeeId: args.employeeId ?? null,
    laborCategoryId: args.laborCategoryId ?? null,
    supplierId: args.supplierId ?? null,
    quantity:
      args.quantity === null || args.quantity === undefined
        ? null
        : round(args.quantity),
    unitOfMeasureCode: args.unitOfMeasureCode ?? null,
    amount: round(args.amount),
    journalLineId: args.journalLineId ?? null,
    reversalOfId: args.reversalOfId ?? null,
    createdBy: args.createdBy
  };
}

/** The map key of a posting context. */
export function projectPostingKey(
  projectId: string,
  projectElementId: string | null
): string {
  return `${projectId}\x1f${projectElementId ?? ""}`;
}

type ElementRow = {
  id: string;
  parentId: string | null;
  projectId: string;
  readableId: string;
  isChargeable: boolean;
  stateGroup: ProjectStateGroup;
  costTreatment: ProjectCostTreatment | null;
  costTreatmentEffectiveFrom: string | null;
  costAccountId: string | null;
};

/**
 * Loads the posting context of every (project, element) ref in 3 queries:
 * the projects, the elements with all their ancestors, and the account
 * defaults. A ref whose project is missing, or whose element is missing or
 * belongs to another project, has no entry in the map.
 */
export async function loadProjectPostingContexts(
  trx: Kysely<DB>,
  companyId: string,
  refs: { projectId: string; projectElementId: string | null }[]
): Promise<Map<string, ProjectPostingContext>> {
  const contexts = new Map<string, ProjectPostingContext>();
  if (refs.length === 0) return contexts;

  const projectIds = [...new Set(refs.map((ref) => ref.projectId))];
  const elementIds = [
    ...new Set(
      refs
        .map((ref) => ref.projectElementId)
        .filter((id): id is string => Boolean(id))
    )
  ];

  const [projects, elements, defaults] = await inOrder([
    () =>
      trx
        .selectFrom("project")
        .select([
          "id",
          "name",
          "identifier",
          "status",
          "costTreatment",
          "costAccountId"
        ])
        .where("id", "in", projectIds)
        .where("companyId", "=", companyId)
        .execute(),
    async () =>
      elementIds.length === 0
        ? []
        : (
            await sql<ElementRow>`
              WITH RECURSIVE chain AS (
                SELECT e."id", e."parentId", e."projectId", e."readableId",
                  e."isChargeable", e."stateId", e."costTreatment",
                  e."costTreatmentEffectiveFrom", e."costAccountId"
                FROM "projectElement" e
                WHERE e."id" IN (${sql.join(elementIds)})
                  AND e."companyId" = ${companyId}
                UNION
                SELECT p."id", p."parentId", p."projectId", p."readableId",
                  p."isChargeable", p."stateId", p."costTreatment",
                  p."costTreatmentEffectiveFrom", p."costAccountId"
                FROM "projectElement" p
                JOIN chain c ON p."id" = c."parentId"
                WHERE p."companyId" = ${companyId}
              )
              SELECT c."id", c."parentId", c."projectId", c."readableId",
                c."isChargeable", s."group" AS "stateGroup", c."costTreatment",
                c."costTreatmentEffectiveFrom", c."costAccountId"
              FROM chain c
              JOIN "projectState" s ON s."id" = c."stateId" AND s."companyId" = ${companyId}
            `.execute(trx)
          ).rows,
    () =>
      trx
        .selectFrom("accountDefault")
        .select(["projectExpenseAccount", "projectWorkInProgressAccount"])
        .where("companyId", "=", companyId)
        .executeTakeFirst()
  ]);

  const projectById = new Map(projects.map((project) => [project.id, project]));
  const elementById = new Map<
    string,
    ProjectPostingElement & { projectId: string }
  >(
    elements.map((row) => [
      row.id,
      {
        id: row.id,
        parentId: row.parentId,
        projectId: row.projectId,
        readableId: row.readableId,
        isChargeable: row.isChargeable,
        stateGroup: row.stateGroup,
        costTreatment: row.costTreatment,
        // A DATE column arrives as a YYYY-MM-DD string from node-postgres.
        costTreatmentEffectiveFrom: row.costTreatmentEffectiveFrom,
        costAccountId: row.costAccountId
      }
    ])
  );
  const accountDefaults = {
    projectExpenseAccount: defaults?.projectExpenseAccount ?? null,
    projectWorkInProgressAccount: defaults?.projectWorkInProgressAccount ?? null
  };

  for (const ref of refs) {
    const project = projectById.get(ref.projectId);
    if (!project) continue;

    let element: ProjectPostingElement | null = null;
    const ancestors: ProjectPostingElement[] = [];
    if (ref.projectElementId) {
      const found = elementById.get(ref.projectElementId);
      if (!found || found.projectId !== ref.projectId) continue;
      element = found;
      const seen = new Set<string>([found.id]);
      let parentId = found.parentId;
      while (parentId && !seen.has(parentId)) {
        const parent = elementById.get(parentId);
        if (!parent) break;
        seen.add(parentId);
        ancestors.push(parent);
        parentId = parent.parentId;
      }
    }

    contexts.set(projectPostingKey(ref.projectId, ref.projectElementId), {
      project: {
        id: project.id,
        status: project.status,
        costTreatment: project.costTreatment,
        costAccountId: project.costAccountId,
        identifier: project.identifier,
        name: project.name
      },
      element,
      ancestors,
      defaults: accountDefaults
    });
  }

  return contexts;
}

/**
 * Moves each element still in an Unstarted state to its project's default
 * Started state: the first charge starts the work. One statement for all
 * elements. Mirrors `startElementOnFirstCharge` in the ERP projects module.
 */
export async function startElementsOnFirstCharge(
  trx: Transaction<DB>,
  companyId: string,
  projectElementIds: (string | null)[]
): Promise<void> {
  const ids = [
    ...new Set(projectElementIds.filter((id): id is string => Boolean(id)))
  ];
  if (ids.length === 0) return;
  await sql`
    UPDATE "projectElement" e
    SET "stateId" = started."id",
        "updatedAt" = NOW()
    FROM "projectState" current, "projectState" started
    WHERE e."id" IN (${sql.join(ids)})
      AND e."companyId" = ${companyId}
      AND current."id" = e."stateId"
      AND current."companyId" = e."companyId"
      AND current."group" = 'Unstarted'
      AND started."projectId" = e."projectId"
      AND started."companyId" = e."companyId"
      AND started."group" = 'Started'
      AND started."isDefault"
  `.execute(trx);
}

/** Where a consume-to-project job's costs post instead of WIP. */
export type JobProjectCharge = {
  projectId: string;
  projectElementId: string | null;
  accountId: string;
  /** The company's today, the date the account was resolved for. */
  postingDate: string;
};

/**
 * The project charge of a job, or null when the job does not consume to a
 * project (every other job keeps posting to WIP). Refuses a project or
 * element that takes no postings, and a Statistical treatment, which a
 * consume-to-project job cannot have.
 */
export async function loadJobProjectCharge(
  trx: Kysely<DB>,
  companyId: string,
  jobId: string
): Promise<JobProjectCharge | null> {
  const job = await trx
    .selectFrom("job")
    .select(["projectId", "projectElementId", "consumeToProject"])
    .where("id", "=", jobId)
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  if (!job?.consumeToProject || !job.projectId) return null;

  const [contexts, timezone] = await inOrder([
    () =>
      loadProjectPostingContexts(trx, companyId, [
        { projectId: job.projectId!, projectElementId: job.projectElementId }
      ]),
    () => getCompanyTimeZone(trx, companyId)
  ]);
  const context = contexts.get(
    projectPostingKey(job.projectId, job.projectElementId)
  );
  if (!context) {
    throw new ProjectChargeError("The job's project or element does not exist");
  }
  assertChargeable(context, "commitment");

  const postingDate = datetime.today(timezone).toString();
  const { treatment, accountId } = resolveProjectPostingAccount(
    context,
    postingDate
  );
  if (treatment === "Statistical" || !accountId) {
    throw new ProjectChargeError(
      `Project ${projectLabel(context.project)} is Statistical. A job cannot consume to a Statistical project.`
    );
  }
  return {
    projectId: job.projectId,
    projectElementId: job.projectElementId,
    accountId,
    postingDate
  };
}
