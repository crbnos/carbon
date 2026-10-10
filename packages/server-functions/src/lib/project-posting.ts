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
import {
  type CoverageChargeType,
  datetime,
  resolveCoverage,
  round,
  type ServiceCoverage
} from "@carbon/utils";
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
  /** The project's own CIP asset (Capitalize). */
  fixedAssetId: string | null;
  /** A Service project's contract project (By Coverage → Contract). */
  parentProjectId?: string | null;
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
  /** A final-asset element holds its own CIP asset (Capitalize). */
  isFinalAsset: boolean;
  fixedAssetId: string | null;
  /** For messages only. */
  readableId?: string;
};

/** A capital project's asset, with the asset account of its current class. */
export type ProjectPostingAsset = {
  id: string;
  status: Database["public"]["Enums"]["fixedAssetStatus"];
  classAssetAccountId: string;
};

export type ProjectPostingContext = {
  project: ProjectPostingProject;
  element: ProjectPostingElement | null;
  ancestors: ProjectPostingElement[]; // nearest parent first
  defaults: {
    projectExpenseAccount: string | null;
    projectWorkInProgressAccount: string | null;
    /** By Coverage: Warranty. */
    warrantyExpenseAccount: string | null;
    /** By Coverage: Billable, and Contract with no contract project. */
    costOfGoodsSoldAccount: string | null;
    /** By Coverage: Capitalized (a Refurbishment). */
    workInProgressAccount: string | null;
  };
  /** The project's asset and each final-asset node's asset, by asset id. */
  assets: Map<string, ProjectPostingAsset>;
  /**
   * The parent project's own context (no element), when the project names one.
   * A Service project's Contract charges post to its account.
   */
  parent?: ProjectPostingContext | null;
};

export type ResolvedProjectPostingAccount = {
  treatment: ProjectCostTreatment;
  accountId: string | null;
  /** The asset a Capitalize charge builds; null for the other treatments. */
  fixedAssetId: string | null;
  /** True when the Capitalize asset is already in service (a late cost). */
  postCapitalization: boolean;
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
 * The asset a Capitalize charge builds: the element itself when it is a
 * final asset, else its nearest final-asset ancestor, else the project's
 * own asset. Null when none of them holds an asset.
 */
export function capitalAssetId(ctx: ProjectPostingContext): string | null {
  const chain = ctx.element ? [ctx.element, ...ctx.ancestors] : [];
  const finalAsset = chain.find((element) => element.isFinalAsset);
  if (finalAsset) return finalAsset.fixedAssetId;
  return ctx.project.fixedAssetId;
}

/**
 * The node that decides the treatment on `postingDate`: the nearest element
 * (itself, then its ancestors) whose treatment is in effect, else the
 * project. Never throws.
 */
function treatmentNode(
  ctx: ProjectPostingContext,
  postingDate: string
): { treatment: ProjectCostTreatment; explicitAccount: string | null } {
  const chain = ctx.element ? [ctx.element, ...ctx.ancestors] : [];
  const override = chain.find(
    (element) =>
      element.costTreatment !== null &&
      (element.costTreatmentEffectiveFrom === null ||
        element.costTreatmentEffectiveFrom <= postingDate)
  );
  return override?.costTreatment
    ? {
        treatment: override.costTreatment,
        explicitAccount: override.costAccountId
      }
    : {
        treatment: ctx.project.costTreatment,
        explicitAccount: ctx.project.costAccountId
      };
}

/** The treatment in effect on `postingDate`, with no account checks. */
export function resolveProjectTreatment(
  ctx: ProjectPostingContext,
  postingDate: string
): ProjectCostTreatment {
  return treatmentNode(ctx, postingDate).treatment;
}

/**
 * By Coverage (a Service project): the charge's coverage decides the account.
 * Warranty → Warranty Expense; Contract → the parent (contract) project's
 * posting account (refused while that project is Closed), else Cost of Goods
 * Sold; Billable → Cost of Goods Sold;
 * Capitalized → Work in Progress (a Refurbishment's completion sweeps it).
 */
function coverageAccount(
  ctx: ProjectPostingContext,
  postingDate: string,
  coverage: ServiceCoverage | null | undefined
): string {
  const required = (accountId: string | null, name: string) => {
    if (!accountId) {
      throw new ProjectChargeError(
        `Set ${name} in Account Defaults before you charge a service order`
      );
    }
    return accountId;
  };

  switch (coverage) {
    case "Warranty":
      return required(ctx.defaults.warrantyExpenseAccount, "Warranty Expense");
    case "Contract": {
      if (ctx.project.parentProjectId) {
        if (!ctx.parent) {
          throw new ProjectChargeError(
            "The service order's contract project does not exist"
          );
        }
        // A Closed contract project takes no more cost. On Hold and
        // Technically Complete still do, as assertChargeable's 'commitment'
        // mode allows.
        if (ctx.parent.project.status === "Closed") {
          const contractProject =
            ctx.parent.project.identifier ??
            ctx.parent.project.name ??
            ctx.parent.project.id;
          throw new ProjectChargeError(
            `The contract project ${contractProject} is closed. Change the coverage to Billable, or reopen the contract project.`
          );
        }
        // A Statistical contract project keeps the natural account.
        const parentAccount = resolveProjectPostingAccount(
          ctx.parent,
          postingDate
        ).accountId;
        if (parentAccount) return parentAccount;
      }
      return required(
        ctx.defaults.costOfGoodsSoldAccount,
        "Cost of Goods Sold"
      );
    }
    case "Billable":
      return required(
        ctx.defaults.costOfGoodsSoldAccount,
        "Cost of Goods Sold"
      );
    case "Capitalized":
      return required(ctx.defaults.workInProgressAccount, "Work in Progress");
    default:
      throw new ProjectChargeError(
        "A charge on a service order needs a coverage"
      );
  }
}

/**
 * The treatment and account a charge posts to on `postingDate`
 * (`YYYY-MM-DD`). The nearest element (itself, then its ancestors) whose
 * treatment is in effect on the date decides; else the project does.
 * Statistical posts to no project account (`accountId: null`).
 * Capitalize posts to the asset account of the asset it builds
 * (`capitalAssetId`): the CIP class while the asset is Under Construction,
 * its in-service class once it is Active (a late cost).
 * By Coverage (Service projects) posts to the account of the charge's
 * `coverage`, which the caller must pass.
 */
export function resolveProjectPostingAccount(
  ctx: ProjectPostingContext,
  postingDate: string,
  coverage?: ServiceCoverage | null
): ResolvedProjectPostingAccount {
  const { treatment, explicitAccount } = treatmentNode(ctx, postingDate);
  const noAsset = { fixedAssetId: null, postCapitalization: false };

  if (treatment === "By Coverage") {
    return {
      treatment,
      accountId: coverageAccount(ctx, postingDate, coverage),
      ...noAsset
    };
  }

  if (treatment === "Capitalize") {
    // The asset decides the account, so an explicit account is ignored: the
    // capitalization credits the CIP class account for every CIP cost row.
    const assetId = capitalAssetId(ctx);
    const asset = assetId ? ctx.assets.get(assetId) : undefined;
    if (asset?.status === "Under Construction") {
      return {
        treatment,
        accountId: asset.classAssetAccountId,
        fixedAssetId: asset.id,
        postCapitalization: false
      };
    }
    if (asset?.status === "Active") {
      return {
        treatment,
        accountId: asset.classAssetAccountId,
        fixedAssetId: asset.id,
        postCapitalization: true
      };
    }
    throw new ProjectChargeError(
      "This capital project has no asset under construction. Release the project first."
    );
  }

  if (treatment === "Statistical") {
    return { treatment, accountId: null, ...noAsset };
  }
  if (explicitAccount) {
    return { treatment, accountId: explicitAccount, ...noAsset };
  }

  if (treatment === "Expense") {
    if (!ctx.defaults.projectExpenseAccount) {
      throw new ProjectChargeError(
        "Set Project Expense in Account Defaults before you charge an Expense project"
      );
    }
    return {
      treatment,
      accountId: ctx.defaults.projectExpenseAccount,
      ...noAsset
    };
  }

  if (!ctx.defaults.projectWorkInProgressAccount) {
    throw new ProjectChargeError(
      "Set Project Work in Progress in Account Defaults before you charge a Contract project"
    );
  }
  return {
    treatment,
    accountId: ctx.defaults.projectWorkInProgressAccount,
    ...noAsset
  };
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
  /** A Service project's charge: who pays for it. */
  coverage?: ServiceCoverage | null;
  coverageReason?: string | null;
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
    coverage: args.coverage ?? null,
    coverageReason: args.coverageReason ?? null,
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
  isFinalAsset: boolean;
  fixedAssetId: string | null;
};

/**
 * Loads the posting context of every (project, element) ref in 4 queries:
 * the projects, the elements with all their ancestors, the account
 * defaults, and the capital assets the projects and elements hold. A ref whose project is missing, or whose element is missing or
 * belongs to another project, has no entry in the map. A project that names a
 * parent project (a Service project's contract project) gets the parent's
 * context in `parent`, loaded by one more call only when one is named.
 */
export async function loadProjectPostingContexts(
  trx: Kysely<DB>,
  companyId: string,
  refs: { projectId: string; projectElementId: string | null }[],
  { withParents = true }: { withParents?: boolean } = {}
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
          "costAccountId",
          "fixedAssetId",
          "parentProjectId"
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
                  e."costTreatmentEffectiveFrom", e."costAccountId",
                  e."isFinalAsset", e."fixedAssetId"
                FROM "projectElement" e
                WHERE e."id" IN (${sql.join(elementIds)})
                  AND e."companyId" = ${companyId}
                UNION
                SELECT p."id", p."parentId", p."projectId", p."readableId",
                  p."isChargeable", p."stateId", p."costTreatment",
                  p."costTreatmentEffectiveFrom", p."costAccountId",
                  p."isFinalAsset", p."fixedAssetId"
                FROM "projectElement" p
                JOIN chain c ON p."id" = c."parentId"
                WHERE p."companyId" = ${companyId}
              )
              SELECT c."id", c."parentId", c."projectId", c."readableId",
                c."isChargeable", s."group" AS "stateGroup", c."costTreatment",
                c."costTreatmentEffectiveFrom", c."costAccountId",
                c."isFinalAsset", c."fixedAssetId"
              FROM chain c
              JOIN "projectState" s ON s."id" = c."stateId" AND s."companyId" = ${companyId}
            `.execute(trx)
          ).rows,
    () =>
      trx
        .selectFrom("accountDefault")
        .select([
          "projectExpenseAccount",
          "projectWorkInProgressAccount",
          "warrantyExpenseAccount",
          "costOfGoodsSoldAccount",
          "workInProgressAccount"
        ])
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
        costAccountId: row.costAccountId,
        isFinalAsset: row.isFinalAsset,
        fixedAssetId: row.fixedAssetId
      }
    ])
  );

  const assetIds = [
    ...new Set(
      [
        ...projects.map((project) => project.fixedAssetId),
        ...elements.map((row) => (row.isFinalAsset ? row.fixedAssetId : null))
      ].filter((id): id is string => Boolean(id))
    )
  ];
  const assetRows =
    assetIds.length === 0
      ? []
      : await trx
          .selectFrom("fixedAsset")
          .innerJoin(
            "fixedAssetClass",
            "fixedAssetClass.id",
            "fixedAsset.fixedAssetClassId"
          )
          .select([
            "fixedAsset.id",
            "fixedAsset.status",
            "fixedAssetClass.assetAccountId"
          ])
          .where("fixedAsset.id", "in", assetIds)
          .where("fixedAsset.companyId", "=", companyId)
          .execute();
  const assets = new Map<string, ProjectPostingAsset>(
    assetRows.map((row) => [
      row.id,
      {
        id: row.id,
        status: row.status,
        classAssetAccountId: row.assetAccountId
      }
    ])
  );
  const accountDefaults = {
    projectExpenseAccount: defaults?.projectExpenseAccount ?? null,
    projectWorkInProgressAccount:
      defaults?.projectWorkInProgressAccount ?? null,
    warrantyExpenseAccount: defaults?.warrantyExpenseAccount ?? null,
    costOfGoodsSoldAccount: defaults?.costOfGoodsSoldAccount ?? null,
    workInProgressAccount: defaults?.workInProgressAccount ?? null
  };

  // A Service project's contract project, loaded one level deep (its own
  // parent is never read), only when a project names one.
  const parentIds = withParents
    ? [
        ...new Set(
          projects
            .map((project) => project.parentProjectId)
            .filter((id): id is string => Boolean(id))
        )
      ]
    : [];
  const parents =
    parentIds.length === 0
      ? new Map<string, ProjectPostingContext>()
      : await loadProjectPostingContexts(
          trx,
          companyId,
          parentIds.map((projectId) => ({ projectId, projectElementId: null })),
          { withParents: false }
        );

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
        fixedAssetId: project.fixedAssetId,
        parentProjectId: project.parentProjectId,
        identifier: project.identifier,
        name: project.name
      },
      element,
      ancestors,
      defaults: accountDefaults,
      assets,
      parent: project.parentProjectId
        ? (parents.get(projectPostingKey(project.parentProjectId, null)) ??
          null)
        : null
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

/**
 * Where a project job's costs post. A consume-to-project job posts to the
 * project account in place of WIP. A capital job (`keepsWip`) keeps WIP as
 * `accountId`: its completion sweeps WIP onto the asset under construction,
 * and the projectLedger rows let the project see each cost as it happens.
 */
export type JobProjectCharge = {
  projectId: string;
  projectElementId: string | null;
  accountId: string;
  /** The company's today, the date the account was resolved for. */
  postingDate: string;
  /** True for a capital job: the cost stays on WIP. */
  keepsWip: boolean;
};

/**
 * The project charge of a job, or null when the job neither consumes to a
 * project nor builds a capital project's asset (every other job keeps
 * posting to WIP with no projectLedger row). Refuses a project or element
 * that takes no postings, and a Statistical treatment, which a
 * consume-to-project job cannot have.
 *
 * A capital job is one with a charge number whose treatment is Capitalize,
 * `consumeToProject` off and a `fixedAssetId`: it returns the WIP account
 * with `keepsWip`. A job with an asset target and any other treatment
 * returns null, as before.
 */
export async function loadJobProjectCharge(
  trx: Kysely<DB>,
  companyId: string,
  jobId: string
): Promise<JobProjectCharge | null> {
  const job = await trx
    .selectFrom("job")
    .select([
      "projectId",
      "projectElementId",
      "consumeToProject",
      "fixedAssetId"
    ])
    .where("id", "=", jobId)
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  if (!job?.projectId) return null;
  if (!job.consumeToProject) {
    if (!job.fixedAssetId) return null;
    return loadCapitalJobCharge(trx, companyId, {
      projectId: job.projectId,
      projectElementId: job.projectElementId
    });
  }

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
    postingDate,
    keepsWip: false
  };
}

async function loadCapitalJobCharge(
  trx: Kysely<DB>,
  companyId: string,
  ref: { projectId: string; projectElementId: string | null }
): Promise<JobProjectCharge | null> {
  const [contexts, timezone, defaults] = await inOrder([
    () => loadProjectPostingContexts(trx, companyId, [ref]),
    () => getCompanyTimeZone(trx, companyId),
    () =>
      trx
        .selectFrom("accountDefault")
        .select(["workInProgressAccount"])
        .where("companyId", "=", companyId)
        .executeTakeFirst()
  ]);
  const context = contexts.get(
    projectPostingKey(ref.projectId, ref.projectElementId)
  );
  if (!context) {
    throw new ProjectChargeError("The job's project or element does not exist");
  }
  const postingDate = datetime.today(timezone).toString();
  if (resolveProjectTreatment(context, postingDate) !== "Capitalize") {
    return null;
  }
  assertChargeable(context, "commitment");
  if (!defaults?.workInProgressAccount) {
    throw new Error("workInProgressAccount not configured in account defaults");
  }
  return {
    ...ref,
    accountId: defaults.workInProgressAccount,
    postingDate,
    keepsWip: true
  };
}

/** The project account a document line posts to, and its Capitalize asset. */
export type ProjectLineCharge = {
  accountId: string;
  fixedAssetId: string | null;
  postCapitalization: boolean;
};

/**
 * The project charge of every line charged to a non-Statistical project,
 * keyed by line id, resolved on `postingDate`. One posting-context load for
 * all lines. A Statistical line has no entry (it keeps its own account and
 * the Project tag). Refuses a project or element that takes no postings.
 */
export async function resolveProjectLineCharges(
  trx: Kysely<DB>,
  companyId: string,
  lines: {
    id: string;
    projectId: string | null;
    projectElementId: string | null;
  }[],
  postingDate: string
): Promise<Map<string, ProjectLineCharge>> {
  const charges = new Map<string, ProjectLineCharge>();
  const charged = lines.filter(
    (line): line is typeof line & { projectId: string } =>
      Boolean(line.projectId)
  );
  if (charged.length === 0) return charges;

  const contexts = await loadProjectPostingContexts(
    trx,
    companyId,
    charged.map((line) => ({
      projectId: line.projectId,
      projectElementId: line.projectElementId
    }))
  );
  for (const line of charged) {
    const context = contexts.get(
      projectPostingKey(line.projectId, line.projectElementId)
    );
    if (!context) {
      throw new ProjectChargeError(
        "The line's project or element does not exist"
      );
    }
    const { treatment, accountId, fixedAssetId, postCapitalization } =
      resolveProjectPostingAccount(context, postingDate);
    if (treatment === "Statistical" || !accountId) continue;
    assertChargeable(context, "commitment");
    charges.set(line.id, { accountId, fixedAssetId, postCapitalization });
  }
  return charges;
}

/**
 * The project account of every line charged to a non-Statistical project,
 * keyed by line id (`resolveProjectLineCharges` without the asset).
 */
export async function resolveProjectLineAccounts(
  trx: Kysely<DB>,
  companyId: string,
  lines: {
    id: string;
    projectId: string | null;
    projectElementId: string | null;
  }[],
  postingDate: string
): Promise<Map<string, string>> {
  const charges = await resolveProjectLineCharges(
    trx,
    companyId,
    lines,
    postingDate
  );
  return new Map(
    [...charges].map(([lineId, charge]) => [lineId, charge.accountId])
  );
}

/**
 * Reverses every open projectLedger row of a document, for a void: one
 * negative row per row that is not a reversal and has none, with
 * `reversalOfId` set.
 */
export async function reverseProjectLedgerRows(
  trx: Transaction<DB>,
  args: {
    companyId: string;
    documentType: string;
    documentId: string;
    postingDate: string;
    userId: string;
  }
): Promise<void> {
  const rows = await trx
    .selectFrom("projectLedger")
    .selectAll()
    .where("documentType", "=", args.documentType)
    .where("documentId", "=", args.documentId)
    .where("companyId", "=", args.companyId)
    .execute();
  const reversedIds = new Set(
    rows
      .map((row) => row.reversalOfId)
      .filter((id): id is string => Boolean(id))
  );
  const reversals = rows
    .filter((row) => !row.reversalOfId && !reversedIds.has(row.id))
    .map((row) =>
      buildProjectLedgerRow({
        companyId: args.companyId,
        projectId: row.projectId,
        projectElementId: row.projectElementId,
        postingDate: args.postingDate,
        costType: row.costType,
        documentType: args.documentType,
        documentId: args.documentId,
        documentLineId: row.documentLineId,
        jobId: row.jobId,
        itemId: row.itemId,
        employeeId: row.employeeId,
        laborCategoryId: row.laborCategoryId,
        supplierId: row.supplierId,
        quantity: row.quantity === null ? null : -Number(row.quantity),
        unitOfMeasureCode: row.unitOfMeasureCode,
        amount: -Number(row.amount),
        reversalOfId: row.id,
        coverage: row.coverage,
        coverageReason: row.coverageReason,
        createdBy: args.userId
      })
    );
  if (reversals.length > 0) {
    await trx.insertInto("projectLedger").values(reversals).execute();
  }
}

// ─── Service projects: coverage inputs and billable items ────────────────────

/** What a charge on a Service project needs to decide its coverage and price. */
export type ServicePostingContext = {
  serviceOrderId: string;
  /** The readable id (SVC000123). */
  serviceOrderReadableId: string;
  orderType: Database["public"]["Enums"]["serviceOrderType"];
  /** The order's customer (null for a Refurbishment), for the Customer dimension. */
  customerId: string | null;
  customerContractId: string | null;
  customerAssetId: string | null;
  /** The asset's serial: the output of an installed part's genealogy. */
  assetTrackedEntityId: string | null;
  /** The order's subject serial (a Refurbishment's unit in stock). */
  subjectTrackedEntityId: string;
  laborWarrantyEndDate: string | null;
  partsWarrantyEndDate: string | null;
  /** The node's installed component: the open component holding its serial. */
  componentId: string | null;
  componentPartsWarrantyEndDate: string | null;
  /** `companySettings.serviceLaborItemId` and its sale price; null when unset. */
  laborItemId: string | null;
  laborPrice: number | null;
};

/**
 * The service context of every (project, element) ref, keyed by
 * `projectPostingKey`, in at most 3 queries for any number of refs: the
 * service orders with their asset's warranty, the service labor price, and the
 * nodes' installed components. A ref whose project no service order owns has
 * no entry.
 */
export async function loadServicePostingContexts(
  trx: Kysely<DB>,
  companyId: string,
  refs: { projectId: string; projectElementId: string | null }[]
): Promise<Map<string, ServicePostingContext>> {
  const contexts = new Map<string, ServicePostingContext>();
  if (refs.length === 0) return contexts;
  const projectIds = [...new Set(refs.map((ref) => ref.projectId))];

  const [orders, labor] = await inOrder([
    () =>
      trx
        .selectFrom("serviceOrder")
        .leftJoin("customerAsset", (join) =>
          join
            .onRef("customerAsset.id", "=", "serviceOrder.customerAssetId")
            .onRef("customerAsset.companyId", "=", "serviceOrder.companyId")
        )
        .select([
          "serviceOrder.id",
          "serviceOrder.serviceOrderId",
          "serviceOrder.projectId",
          "serviceOrder.type",
          "serviceOrder.customerId",
          "serviceOrder.customerContractId",
          "serviceOrder.customerAssetId",
          "serviceOrder.trackedEntityId as subjectTrackedEntityId",
          "customerAsset.trackedEntityId as assetTrackedEntityId",
          "customerAsset.laborWarrantyEndDate",
          "customerAsset.partsWarrantyEndDate"
        ])
        .where("serviceOrder.projectId", "in", projectIds)
        .where("serviceOrder.companyId", "=", companyId)
        .execute(),
    () =>
      trx
        .selectFrom("companySettings")
        .leftJoin("itemUnitSalePrice", (join) =>
          join
            .onRef(
              "itemUnitSalePrice.itemId",
              "=",
              "companySettings.serviceLaborItemId"
            )
            .onRef("itemUnitSalePrice.companyId", "=", "companySettings.id")
        )
        .select([
          "companySettings.serviceLaborItemId",
          "itemUnitSalePrice.unitSalePrice"
        ])
        .where("companySettings.id", "=", companyId)
        .executeTakeFirst()
  ]);
  if (orders.length === 0) return contexts;
  const orderByProject = new Map(
    orders.map((order) => [order.projectId, order])
  );

  // The nodes' serials, matched to their assets' open components in one query.
  const elementIds = [
    ...new Set(
      refs
        .filter(
          (ref) =>
            ref.projectElementId &&
            orderByProject.get(ref.projectId)?.customerAssetId
        )
        .map((ref) => ref.projectElementId as string)
    )
  ];
  const assetIds = [
    ...new Set(
      orders
        .map((order) => order.customerAssetId)
        .filter((id): id is string => Boolean(id))
    )
  ];
  const components =
    elementIds.length === 0 || assetIds.length === 0
      ? []
      : await trx
          .selectFrom("customerAssetComponent")
          .innerJoin("projectElement", (join) =>
            join
              .onRef(
                "projectElement.trackedEntityId",
                "=",
                "customerAssetComponent.trackedEntityId"
              )
              .onRef(
                "projectElement.companyId",
                "=",
                "customerAssetComponent.companyId"
              )
          )
          .select([
            "customerAssetComponent.id",
            "customerAssetComponent.customerAssetId",
            "customerAssetComponent.partsWarrantyEndDate",
            "projectElement.id as elementId"
          ])
          .where("projectElement.id", "in", elementIds)
          .where("customerAssetComponent.customerAssetId", "in", assetIds)
          .where("customerAssetComponent.companyId", "=", companyId)
          .where("customerAssetComponent.removedDate", "is", null)
          .orderBy("customerAssetComponent.installedDate", "desc")
          .orderBy("customerAssetComponent.id")
          .execute();

  const laborItemId = labor?.serviceLaborItemId ?? null;
  const laborPrice =
    laborItemId &&
    labor?.unitSalePrice !== null &&
    labor?.unitSalePrice !== undefined
      ? Number(labor.unitSalePrice)
      : null;

  for (const ref of refs) {
    const order = orderByProject.get(ref.projectId);
    if (!order) continue;
    // The latest open component of the node's serial in this order's asset.
    const component = ref.projectElementId
      ? components.find(
          (row) =>
            row.elementId === ref.projectElementId &&
            row.customerAssetId === order.customerAssetId
        )
      : undefined;
    contexts.set(projectPostingKey(ref.projectId, ref.projectElementId), {
      serviceOrderId: order.id,
      serviceOrderReadableId: order.serviceOrderId,
      orderType: order.type,
      customerId: order.customerId,
      customerContractId: order.customerContractId,
      customerAssetId: order.customerAssetId,
      assetTrackedEntityId: order.assetTrackedEntityId ?? null,
      subjectTrackedEntityId: order.subjectTrackedEntityId,
      // DATE columns arrive as YYYY-MM-DD strings from node-postgres.
      laborWarrantyEndDate: order.laborWarrantyEndDate ?? null,
      partsWarrantyEndDate: order.partsWarrantyEndDate ?? null,
      componentId: component?.id ?? null,
      componentPartsWarrantyEndDate: component?.partsWarrantyEndDate ?? null,
      laborItemId,
      laborPrice
    });
  }
  return contexts;
}

/**
 * The service order of a Service project, its asset's warranty, the node's
 * installed component and the service labor price, in at most 3 queries.
 * Null when no service order owns the project.
 */
export async function loadServicePostingContext(
  trx: Kysely<DB>,
  args: { companyId: string; projectId: string; elementId: string | null }
): Promise<ServicePostingContext | null> {
  const ref = { projectId: args.projectId, projectElementId: args.elementId };
  const contexts = await loadServicePostingContexts(trx, args.companyId, [ref]);
  return (
    contexts.get(projectPostingKey(ref.projectId, ref.projectElementId)) ?? null
  );
}

/** The coverage of one charge on a service order (`resolveCoverage`). */
export function serviceChargeCoverage(
  service: ServicePostingContext,
  chargeType: CoverageChargeType,
  serviceDate: string
): ServiceCoverage {
  return resolveCoverage({
    chargeType,
    serviceDate,
    orderType: service.orderType,
    laborWarrantyEndDate: service.laborWarrantyEndDate,
    partsWarrantyEndDate: service.partsWarrantyEndDate,
    componentPartsWarrantyEndDate: service.componentPartsWarrantyEndDate,
    hasCoverageContract: Boolean(service.customerContractId)
  });
}

type ProjectBillableItemInsert =
  Database["public"]["Tables"]["projectBillableItem"]["Insert"];
type ProjectBillableItemRow =
  Database["public"]["Tables"]["projectBillableItem"]["Row"];

const COVERED_NOTE: Partial<Record<ServiceCoverage, string>> = {
  Warranty: "Covered by warranty",
  Contract: "Covered by contract"
};

/**
 * The billing row of one projectLedger row of a Service project, or null when
 * the charge bills nothing (a Capitalized charge, or a cost type that is not
 * time, a part or an expense).
 * - Labor: hours at the service labor price.
 * - Material: the quantity at the item's sale price.
 * - Other Direct: one unit at the amount.
 * - Warranty and Contract: price 0, with a "Covered by …" note.
 */
export function buildBillableItem(args: {
  ledgerRow: Pick<
    ProjectLedgerInsert,
    | "companyId"
    | "projectId"
    | "projectElementId"
    | "costType"
    | "quantity"
    | "amount"
    | "itemId"
    | "createdBy"
  > & { id: string };
  coverage: ServiceCoverage;
  laborPrice: number | null;
  partPrice: number | null;
  description: string;
}): ProjectBillableItemInsert | null {
  const { ledgerRow, coverage } = args;
  if (coverage === "Capitalized") return null;

  let quantity: number;
  let unitPrice: number;
  switch (ledgerRow.costType) {
    case "Labor":
      quantity = Number(ledgerRow.quantity ?? 0);
      unitPrice = args.laborPrice ?? 0;
      break;
    case "Material":
      quantity = Number(ledgerRow.quantity ?? 0);
      unitPrice = args.partPrice ?? 0;
      break;
    case "Other Direct":
      quantity = 1;
      unitPrice = Number(ledgerRow.amount);
      break;
    default:
      return null;
  }

  const note = COVERED_NOTE[coverage];
  if (note) unitPrice = 0;

  return {
    companyId: ledgerRow.companyId,
    projectId: ledgerRow.projectId,
    projectElementId: ledgerRow.projectElementId ?? null,
    projectLedgerId: ledgerRow.id,
    itemId: ledgerRow.itemId ?? null,
    description: note ? `${args.description} (${note})` : args.description,
    quantity: round(quantity),
    unitPrice: round(unitPrice),
    amount: round(quantity * unitPrice),
    coverage,
    status: "Unbilled",
    createdBy: ledgerRow.createdBy
  };
}

/**
 * What reversing a charge does to its billable item:
 * - not billed yet (Unbilled or On Hold): write it off with the reason "Reversed";
 * - Billed: a negative Unbilled copy (`reversalOfId`), which the next invoice
 *   credits. `projectLedgerId` is the reversing ledger row, when given.
 * - Written Off: nothing.
 */
export function reverseBillableItem(
  original: Pick<
    ProjectBillableItemRow,
    | "id"
    | "companyId"
    | "projectId"
    | "projectElementId"
    | "projectLedgerId"
    | "customerContractLineId"
    | "itemId"
    | "description"
    | "quantity"
    | "unitPrice"
    | "amount"
    | "coverage"
    | "status"
    | "createdBy"
  >,
  reversal: { projectLedgerId?: string; createdBy?: string } = {}
): {
  update?: Pick<ProjectBillableItemInsert, "status" | "statusReason">;
  insert?: ProjectBillableItemInsert;
} {
  if (original.status === "Unbilled" || original.status === "On Hold") {
    return { update: { status: "Written Off", statusReason: "Reversed" } };
  }
  if (original.status !== "Billed") return {};
  return {
    insert: {
      companyId: original.companyId,
      projectId: original.projectId,
      projectElementId: original.projectElementId,
      projectLedgerId: reversal.projectLedgerId ?? original.projectLedgerId,
      customerContractLineId: original.customerContractLineId,
      itemId: original.itemId,
      description: original.description,
      quantity: round(-Number(original.quantity)),
      unitPrice: round(Number(original.unitPrice)),
      amount: round(-Number(original.amount)),
      coverage: original.coverage,
      status: "Unbilled",
      reversalOfId: original.id,
      createdBy: reversal.createdBy ?? original.createdBy
    }
  };
}
