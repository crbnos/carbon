// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * ERP bindings for the shared inspection execution engine
 * (@carbon/database/quality). The engine moved there so the MES inspection
 * routes can run the same transactional core; these wrappers keep the ERP
 * call sites unchanged by currying in the ERP Kysely singleton.
 *
 * Below them, the quality module's operations (`defineServiceFn`).
 */
import { openai } from "@ai-sdk/openai";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import { getCompanyTimeZone } from "@carbon/database";
import * as engine from "@carbon/database/quality";
import { lockIssueDispositions } from "@carbon/database/quality";
import { approvalDecisionValidator } from "@carbon/ee/approvals";
import {
  cancelPendingApprovals,
  decideApprovalRequest,
  openApprovalRequests
} from "@carbon/ee/approvals/document.server";
import {
  notifyIssueCreated,
  notifyIssueStatusChanged,
  notifyTaskStatusChanged
} from "@carbon/ee/notifications";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import { NotificationEvent } from "@carbon/notifications";
import { serverFns } from "@carbon/server-functions";
import { async, datetime, unchecked } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateText, Output } from "ai";
import template from "lodash.template";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { updateChangeNotice } from "~/modules/items/items.service";
import {
  deletePurchaseReturnOrder,
  insertPurchaseReturnOrder,
  setPurchaseReturnOrderLineTrackedEntities,
  upsertPurchaseReturnOrderLine
} from "~/modules/purchasing/purchasing.service";
import { systemContext } from "~/modules/service-context.server";
import {
  defineServiceFn,
  type ServiceContext
} from "~/modules/service-fn.server";
import { getCompanyIntegrations } from "~/modules/settings/settings.server";
import { refuseUnlessOwned } from "~/modules/shared/shared.server";
import { getExternalLink } from "~/modules/shared/shared.service";
import { getLocationTimeZone } from "~/modules/shared/timezone.server";
import { getUserDefaults } from "~/modules/users/users.server";
import { getDatabaseClient } from "~/services/database.server";
import { ERP_URL, path } from "~/utils/path";
import {
  type BalloonRegionAnalysis,
  balloonRegionAnalysisResultSchema,
  disposition,
  type inspectionDispositionValidator,
  inspectionDocumentSamplingValidator,
  type inspectionMeasurementValidator,
  type inspectionSampleValidator,
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
import {
  deleteIssue,
  getInspection,
  getInspectionMeasurements,
  getInspectionSamplingPlans,
  getIssueActionTasks,
  getIssueFromExternalLink,
  getIssueTypesList,
  getRisk,
  insertIssue,
  saveInspectionDocumentAtomic,
  updateInspectionDocumentSampling,
  updateIssueStatus,
  updateIssueTaskContent,
  updateIssueTaskStatus,
  upsertRisk
} from "./quality.service";
import {
  closeIssue,
  linkEntitiesToIssueItemRow,
  updateIssueItemQuantity
} from "./quality-disposition.server";

const logger = getLogger("erp", "quality");

export type { Result } from "@carbon/database/quality";
export { errResult, valuateMeasurement } from "@carbon/database/quality";

export async function upsertInspectionSample(
  sample: z.infer<typeof inspectionSampleValidator> & {
    companyId: string;
    inspectedBy: string;
  }
) {
  return engine.upsertInspectionSample(getDatabaseClient(), sample);
}

export async function dispositionInspection(
  args: z.infer<typeof inspectionDispositionValidator> & {
    companyId: string;
    dispositionedBy: string;
  } & Pick<engine.InspectionDispositionInput, "requireOpen" | "requireSource">
) {
  return engine.dispositionInspection(getDatabaseClient(), args);
}

export async function upsertInspectionMeasurement(
  args: z.infer<typeof inspectionMeasurementValidator> & {
    companyId: string;
    userId: string;
  }
) {
  return engine.upsertInspectionMeasurement(getDatabaseClient(), args);
}

export async function reconcileInspectionSamplingPlans(
  inspectionId: string,
  companyId: string
) {
  return engine.reconcileInspectionSamplingPlans(
    getDatabaseClient(),
    inspectionId,
    companyId
  );
}

export async function changeInspectionDocument(args: {
  inspectionId: string;
  inspectionDocumentId: string | null;
  companyId: string;
  userId: string;
}) {
  return engine.changeInspectionDocument(getDatabaseClient(), args);
}

export async function recordInspectionGauge(
  args: Parameters<typeof engine.recordInspectionGauge>[1]
) {
  return engine.recordInspectionGauge(getDatabaseClient(), args);
}

export async function getRecentInspectionGauges(
  args: Parameters<typeof engine.getRecentInspectionGauges>[1]
) {
  return engine.getRecentInspectionGauges(getDatabaseClient(), args);
}

// ─── Inspection plan save ────────────────────────────────────────────────────

/** Maps persisted balloon ids to inspectionFeature ids for legacy save payloads. */
async function mapBalloonIdsToFeatureIdsForDocument(
  client: SupabaseClient<Database>,
  inspectionDocumentId: string,
  companyId: string,
  ids: string[]
) {
  const unique = [...new Set(ids.filter((id) => id.length > 0))];
  const mapped = new Map<string, string>();
  for (const id of unique) {
    mapped.set(id, id);
  }

  const [balloons, features] = await Promise.all([
    client
      .from("balloon")
      .select("id, inspectionFeatureId")
      .eq("inspectionDocumentId", inspectionDocumentId)
      .eq("companyId", companyId),
    client
      .from("inspectionFeature")
      .select("id")
      .eq("inspectionDocumentId", inspectionDocumentId)
      .eq("companyId", companyId)
  ]);

  for (const balloon of balloons.data ?? []) {
    if (mapped.has(balloon.id)) {
      mapped.set(balloon.id, balloon.inspectionFeatureId);
    }
  }
  for (const row of features.data ?? []) {
    if (mapped.has(row.id)) {
      mapped.set(row.id, row.id);
    }
  }

  return mapped;
}

export type InspectionSaveFeaturesPayload = ReturnType<
  typeof inspectionSaveFeaturesPayloadValidator.parse
>;
export type InspectionSaveBalloonsGeometryPayload = ReturnType<
  typeof inspectionSaveBalloonsGeometryPayloadValidator.parse
>;
type LegacyAnchors = ReturnType<
  typeof inspectionSaveAnchorsPayloadValidator.parse
>;
type LegacyBalloons = ReturnType<
  typeof inspectionSaveBalloonsPayloadValidator.parse
>;

export function isTempInspectionId(id: string) {
  return id.startsWith("temp-");
}

/** Maps legacy anchors + metadata balloons save shape to features + geometry balloons. */
export function translateLegacyInspectionSavePayload(
  anchors: LegacyAnchors,
  balloons: LegacyBalloons
): {
  features: InspectionSaveFeaturesPayload;
  balloons: InspectionSaveBalloonsGeometryPayload;
} {
  const anchorByTempId = new Map(anchors.create.map((a) => [a.tempId, a]));

  const featuresCreate = balloons.create.map((b) => {
    const anchor = anchorByTempId.get(b.tempBalloonAnchorId);
    return {
      tempId: b.tempBalloonAnchorId,
      pageNumber: anchor?.pageNumber ?? 1,
      label: b.label,
      description: b.description ?? null,
      nominalValue: b.nominalValue ?? null,
      tolerancePlus: b.tolerancePlus ?? null,
      toleranceMinus: b.toleranceMinus ?? null,
      unit: b.unit ?? null
    };
  });

  for (const anchor of anchors.create) {
    if (featuresCreate.some((f) => f.tempId === anchor.tempId)) continue;
    featuresCreate.push({
      tempId: anchor.tempId,
      pageNumber: anchor.pageNumber,
      label: "0",
      description: null,
      nominalValue: null,
      tolerancePlus: null,
      toleranceMinus: null,
      unit: null
    });
  }

  const balloonsCreate = balloons.create.map((b) => {
    const anchor = anchorByTempId.get(b.tempBalloonAnchorId);
    return {
      tempInspectionFeatureId: b.tempBalloonAnchorId,
      tempBalloonAnchorId: b.tempBalloonAnchorId,
      pageNumber: anchor?.pageNumber ?? 1,
      regionX: anchor?.xCoordinate ?? 0,
      regionY: anchor?.yCoordinate ?? 0,
      regionWidth: anchor?.width ?? 0.1,
      regionHeight: anchor?.height ?? 0.1,
      xCoordinate: b.xCoordinate,
      yCoordinate: b.yCoordinate
    };
  });

  for (const anchor of anchors.create) {
    if (balloons.create.some((b) => b.tempBalloonAnchorId === anchor.tempId)) {
      continue;
    }
    balloonsCreate.push({
      tempInspectionFeatureId: anchor.tempId,
      tempBalloonAnchorId: anchor.tempId,
      pageNumber: anchor.pageNumber,
      regionX: anchor.xCoordinate,
      regionY: anchor.yCoordinate,
      regionWidth: anchor.width,
      regionHeight: anchor.height,
      xCoordinate: Math.min(
        1 - 0.04,
        Math.max(0, anchor.xCoordinate + anchor.width + 0.02)
      ),
      yCoordinate: Math.min(1 - 0.04, Math.max(0, anchor.yCoordinate))
    });
  }

  const featuresUpdate = balloons.update.map((b) => ({
    id: b.id,
    label: b.label,
    description: b.description ?? null,
    nominalValue: b.nominalValue ?? null,
    tolerancePlus: b.tolerancePlus ?? null,
    toleranceMinus: b.toleranceMinus ?? null,
    unit: b.unit ?? null
  }));

  const balloonsUpdate = [
    ...anchors.update.map((a) => ({
      id: a.id,
      pageNumber: a.pageNumber,
      regionX: a.xCoordinate,
      regionY: a.yCoordinate,
      regionWidth: a.width,
      regionHeight: a.height
    })),
    ...balloons.update.map((b) => ({
      id: b.id,
      xCoordinate: b.xCoordinate,
      yCoordinate: b.yCoordinate
    }))
  ];

  const mergedBalloonUpdates = new Map<
    string,
    (typeof balloonsUpdate)[number]
  >();
  for (const item of balloonsUpdate) {
    const existing = mergedBalloonUpdates.get(item.id);
    mergedBalloonUpdates.set(item.id, { ...existing, ...item });
  }

  return {
    features: {
      create: featuresCreate,
      update: featuresUpdate,
      delete: [...new Set([...balloons.delete, ...anchors.delete])]
    },
    balloons: {
      create: balloonsCreate,
      update: [...mergedBalloonUpdates.values()],
      delete: []
    }
  };
}

export function mergeInspectionFeaturesPayload(
  base: InspectionSaveFeaturesPayload,
  extra: InspectionSaveFeaturesPayload
): InspectionSaveFeaturesPayload {
  return {
    create: [...base.create, ...extra.create],
    update: [...base.update, ...extra.update],
    delete: [...new Set([...base.delete, ...extra.delete])]
  };
}

export function mergeInspectionBalloonsPayload(
  base: InspectionSaveBalloonsGeometryPayload,
  extra: InspectionSaveBalloonsGeometryPayload
): InspectionSaveBalloonsGeometryPayload {
  return {
    create: [...base.create, ...extra.create],
    update: [...base.update, ...extra.update],
    delete: [...new Set([...base.delete, ...extra.delete])]
  };
}

export async function resolveInspectionFeaturePayloadIds(
  client: SupabaseClient<Database>,
  inspectionDocumentId: string,
  companyId: string,
  features: InspectionSaveFeaturesPayload
): Promise<InspectionSaveFeaturesPayload> {
  const ids = [
    ...features.update.map((row) => row.id),
    ...features.delete
  ].filter((rowId) => !isTempInspectionId(rowId));

  if (ids.length === 0) {
    return features;
  }

  const idMap = await mapBalloonIdsToFeatureIdsForDocument(
    client,
    inspectionDocumentId,
    companyId,
    ids
  );

  return {
    create: features.create,
    update: features.update.map((row) => ({
      ...row,
      id: idMap.get(row.id) ?? row.id
    })),
    delete: [
      ...new Set(features.delete.map((rowId) => idMap.get(rowId) ?? rowId))
    ]
  };
}

// ─── Balloon region vision analysis ──────────────────────────────────────────

/** Decoded image size limit for vision analyze (bytes). */
export const INSPECTION_BALLOON_ANALYZE_MAX_IMAGE_BYTES = 12 * 1024 * 1024;

const BALLOON_REGION_ANALYSIS_SYSTEM = `You assist with mechanical inspection ballooning on technical CAD drawings.

You receive one raster image: a crop of a single callout region from a sheet.

Return ONLY the JSON object matching the schema (field names and allowed enum values exactly).

type (required, exactly one of):
- linear — linear length/width/height dimension without ⌀ or R prefix.
- diameter — nominal is the value for a diameter callout (⌀ or equivalent).
- radius — nominal is the value for a radius callout (R or equivalent).
- angle — nominal is the numeric angle; set unit to degree or rad only when °, deg, or rad is visible in the crop; otherwise unit null.
- unknown — not clearly one of the above, or unreadable / ambiguous.

unit (nullable, exactly one of the allowed enum strings or null):
- Default is null. Set unit ONLY when this crop visibly shows a unit indicator (e.g. mm, cm, m, um, µm, in, ", IN, ft, °, DEG, RAD, or equivalent text/symbols next to the dimension).
- Do NOT infer unit from decimal places, title block, drawing "standard," locale, or anything outside visible pixels in this crop. A bare number with tolerances but no unit text/symbol → unit null.
- For type angle: use degree or rad only when that angle notation is visible; otherwise unit null.

nominal / tolerances:
- Prefer numbers from the print; use null (not zero) when not shown or unreadable.
- Bilateral ±T: tol_plus = +T, tol_minus = -T (e.g. ±0.02 → tol_plus 0.02, tol_minus -0.02).
- Unilateral stacked +0.005 / -0.000 (plus above, minus below nominal): tol_plus = 0.005, tol_minus = 0 (minus side is zero additional tolerance below nominal).
- Other asymmetric +a / −b (both non-zero): tol_plus = +a, tol_minus = -b using the signed values as printed relative to nominal.

Do not invent title-block or revision data outside the crop.
`;

const BALLOON_REGION_ANALYSIS_USER_MESSAGE =
  "Extract nominal, tol_plus, tol_minus, unit, and type per the system rules. For unit: use null unless a unit symbol or unit letters are literally visible in this crop; do not guess. Use only allowed enum literals for type and for unit when non-null.";

const BALLOON_REGION_ANALYSIS_SCHEMA_DESCRIPTION =
  "Drawing crop: nominal, tolerances, type enum; unit enum only when a unit symbol/text is visible in the crop, otherwise null";

/**
 * Runs vision extraction on a prepared PNG/JPEG/WebP buffer (caller validates size and auth).
 */
export async function runInspectionBalloonRegionVisionAnalysis(args: {
  imageBytes: Buffer;
  mediaType: string;
}): Promise<BalloonRegionAnalysis> {
  const { imageBytes, mediaType } = args;
  const { output: object } = await generateText({
    model: openai("gpt-4o"),
    output: Output.object({
      schema: balloonRegionAnalysisResultSchema,
      name: "balloon_region_analysis",
      description: BALLOON_REGION_ANALYSIS_SCHEMA_DESCRIPTION
    }),
    instructions: BALLOON_REGION_ANALYSIS_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: BALLOON_REGION_ANALYSIS_USER_MESSAGE },
          {
            type: "image",
            image: imageBytes,
            mediaType
          }
        ]
      }
    ],
    temperature: 0.1
  });
  return object;
}

// ---------------------------------------------------------------------------
// Operations (`defineServiceFn`): what the routes, the API and MCP all run
// ---------------------------------------------------------------------------

/** Custom field values, as `setCustomFields` reads them off a form. */
const customFieldValues = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean()])
);

const issueLocked = "Cannot modify a closed issue. Reopen it first.";

/** The issue's integrations told, never failing the write that came first. */
async function notifyIssue(
  ctx: ServiceContext,
  send: (
    integrations: Awaited<ReturnType<typeof getCompanyIntegrations>>
  ) => Promise<unknown>,
  failure: string
) {
  try {
    await send(
      await getCompanyIntegrations(ctx.asCaller.supabase, ctx.company.id)
    );
  } catch (error) {
    logger.error(failure, { error });
  }
}

/** The issue's action tasks, from its required actions and approvals. */
function createIssueTasks(ctx: ServiceContext, issueId: string) {
  return serverFns
    .system({
      db: ctx.asSystem.pg,
      companyId: ctx.company.id,
      userId: ctx.auditUserId
    })
    .invoke("create", { type: "nonConformanceTasks", id: issueId });
}

// --- Issues -----------------------------------------------------------------

/**
 * Open an issue (non-conformance).
 *
 * @remarks
 * Every record the issue names (location, type, workflow, required actions,
 * items, customer, `trackedEntityIds`) must be the company's, or nothing is
 * created. The issue is inserted, the tracked entities are linked to it, and
 * an issue filed against a job operation links the lot that operation's make
 * method produced onto the item's disposition row. Its action and approval
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

    const created = await insertIssue(serviceRole, {
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

    // Pre-associate the tracked entities passed in (the "Create Issue from
    // Inspection" button on inbound inspection lots).
    if (trackedEntityIds.length > 0) {
      await serviceRole.from("nonConformanceTrackedEntity").insert(
        trackedEntityIds.map((trackedEntityId) => ({
          nonConformanceId: issueId,
          trackedEntityId,
          companyId,
          createdBy: userId
        }))
      );
    }

    // An issue filed against a job operation: surface the tracked entity that
    // operation's make method produced onto a disposition row, so the MRB can
    // scrap / rework / use-as-is it at once.
    if (input.jobOperationId) {
      await linkJobOperationLot(ctx, {
        nonConformanceId: issueId,
        jobOperationId: input.jobOperationId
      });
    }

    const tasks = await createIssueTasks(ctx, issueId);
    if (tasks.error) {
      await deleteIssue(serviceRole, issueId);
      return ctx.error("internal", "Failed to create tasks", tasks.error);
    }

    await notifyIssue(
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

/**
 * Links the lot a job operation's make method produced to a new issue: the
 * issue-level tracked-entity links, then the item's disposition row (found
 * or created) under the issue lock every link writer shares. Failures are
 * logged, never returned: the issue already exists.
 */
async function linkJobOperationLot(
  ctx: ServiceContext,
  {
    nonConformanceId,
    jobOperationId
  }: { nonConformanceId: string; jobOperationId: string }
) {
  const client = ctx.asSystem.supabase;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;

  const operation = await client
    .from("jobOperation")
    .select("jobMakeMethodId")
    .eq("id", jobOperationId)
    .eq("companyId", companyId)
    .single();
  const jobMakeMethodId = operation.data?.jobMakeMethodId ?? null;
  if (!jobMakeMethodId) return;

  const makeMethod = await client
    .from("jobMakeMethod")
    .select("itemId")
    .eq("id", jobMakeMethodId)
    .eq("companyId", companyId)
    .single();
  const itemId = makeMethod.data?.itemId ?? null;
  if (!itemId) return;

  const entities = await client
    .from("trackedEntity")
    .select("id, quantity")
    .eq("attributes->>Job Make Method", jobMakeMethodId)
    .eq("companyId", companyId);
  const lotEntities = (entities.data ?? []) as {
    id: string;
    quantity: number | null;
  }[];
  if (lotEntities.length === 0) return;

  const entityIds = lotEntities.map((e) => e.id);
  const existingLinks = await client
    .from("nonConformanceTrackedEntity")
    .select("trackedEntityId")
    .eq("nonConformanceId", nonConformanceId)
    .in("trackedEntityId", entityIds);
  const alreadyLinked = new Set(
    (existingLinks.data ?? []).map((r) => r.trackedEntityId as string)
  );
  const linkRows = entityIds
    .filter((id) => !alreadyLinked.has(id))
    .map((trackedEntityId) => ({
      nonConformanceId,
      trackedEntityId,
      companyId,
      createdBy: userId
    }));
  if (linkRows.length > 0) {
    const inserted = await client
      .from("nonConformanceTrackedEntity")
      .insert(linkRows);
    if (inserted.error) {
      logger.error("Issue creation step failed", { error: inserted.error });
      return;
    }
  }

  try {
    await ctx.asSystem.pg.transaction().execute(async (trx) => {
      await lockIssueDispositions(trx, { nonConformanceId, companyId });
      await linkEntitiesToIssueItemRow(trx, {
        nonConformanceId,
        companyId,
        userId,
        itemId,
        entities: lotEntities.map((e) => ({
          id: e.id,
          quantity: Number(e.quantity ?? 1)
        }))
      });
    });
  } catch (err) {
    logger.error("Issue creation step failed", { error: err });
  }
}

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
    value: z.string().nullish()
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
      return ctx.error("rule", issueLocked);
    }

    const isArrayField = (issueArrayFields as readonly string[]).includes(
      field
    );
    const update = await client
      .from("nonConformance")
      .update(
        unchecked({
          [field]: isArrayField
            ? value
              ? value.split(",")
              : []
            : value || null,
          updatedBy: ctx.auditUserId,
          updatedAt: new Date().toISOString()
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
        ({ id }) => createIssueTasks(ctx, id),
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
 * Closing is `quality.issue.close`, which posts the dispositions. Reopening a
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
    if (current.data?.status === "Closed") {
      const posted = await serviceRole
        .from("itemLedger")
        .select("id")
        .eq("documentType", "Non-Conformance")
        .eq("documentId", id)
        .eq("companyId", companyId)
        .limit(1);
      if ((posted.data?.length ?? 0) > 0) {
        return ctx.error(
          "rule",
          "This NCR posted inventory transactions and can't be reopened. Create a correcting entry instead."
        );
      }
    }

    const update = await updateIssueStatus(ctx.asCaller.supabase, {
      id,
      status,
      assignee: undefined,
      closeDate: null,
      updatedBy: userId
    });
    if (update.error) {
      return ctx.error(
        "internal",
        "Failed to update issue status",
        update.error
      );
    }

    await notifyIssue(
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
 * close while a linked supplier return is open. The inventory value the
 * dispositions move (scrap and return write-offs, the restore of an
 * inspection lot used as is) posts first, through `post-nonconformance`; a
 * failed posting leaves the issue open. Then the issue is Closed, its
 * assignee cleared and its close date stamped. The company's integrations
 * are told.
 *
 * @mcp
 */
export const completeIssue = defineServiceFn({
  input: z.object({ id: z.string() }),
  permission: { update: "quality" },

  async run(ctx, { id }) {
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;
    const result = await closeIssue(ctx.asSystem.supabase, {
      nonConformanceId: id,
      companyId,
      userId
    });
    if (result.error) {
      return ctx.error(
        "rule",
        result.error.message ?? "Failed to close NCR",
        result.error
      );
    }

    await notifyIssue(
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
    return { id };
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
    const update = await updateIssueTaskStatus(ctx.asCaller.supabase, {
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
      await notifyIssue(
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
    const { error } = await ctx.asCaller.supabase
      .from("nonConformanceActionTask")
      .update({ dueDate: dueDate || null })
      .eq("id", id)
      .eq("companyId", ctx.company.id);
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
    const client = ctx.asCaller.supabase;
    const results = await Promise.all(
      Object.entries(updates).map(([id, sortOrder]) =>
        client
          .from("nonConformanceActionTask")
          .update({ sortOrder, updatedBy: ctx.auditUserId })
          .eq("id", id)
          .eq("companyId", ctx.company.id)
      )
    );
    const failed = results.find((result) => result.error)?.error;
    if (failed) {
      return ctx.error("internal", "Failed to update sort order", failed);
    }
    return { ids: Object.keys(updates) };
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
      return ctx.error("rule", issueLocked);
    }

    if (input.field === "quantity") {
      const result = await updateIssueItemQuantity({
        id: input.id,
        companyId,
        userId: ctx.auditUserId,
        quantity: input.value,
        expectedQuantity: input.expectedQuantity
      });
      if (result.error) return ctx.error("rule", result.error.message);
      return { id: input.id };
    }

    const update = await client
      .from("nonConformanceItem")
      .update({
        disposition: input.value,
        updatedBy: ctx.auditUserId,
        updatedAt: datetime.timestamp()
      })
      .eq("id", input.id)
      .eq("companyId", companyId);
    if (update.error) {
      return ctx.error("internal", "Failed to update issue item", update.error);
    }
    return { id: input.id };
  }
});

/** The header a line association names: its id and readable id. */
const associationHeaders = {
  jobOperations: { table: "job", readable: "jobId", noun: "job operation" },
  purchaseOrderLines: {
    table: "purchaseOrder",
    readable: "purchaseOrderId",
    noun: "purchase order line"
  },
  salesOrderLines: {
    table: "salesOrder",
    readable: "salesOrderId",
    noun: "sales order line"
  },
  shipmentLines: {
    table: "shipment",
    readable: "shipmentId",
    noun: "shipment line"
  },
  receiptLines: {
    table: "receipt",
    readable: "receiptId",
    noun: "receipt line"
  },
  salesReturnOrderLines: {
    table: "salesReturnOrder",
    readable: "salesReturnOrderId",
    noun: "sales return order line"
  },
  purchaseReturnOrderLines: {
    table: "purchaseReturnOrder",
    readable: "purchaseReturnOrderId",
    noun: "purchase return order line"
  }
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
    if (isIssueLocked(issue.data?.status)) {
      return ctx.error("rule", issueLocked);
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
        const linked = await linkInspectionToIssue(ctx, {
          nonConformanceId,
          inspectionId: id
        });
        if (!linked) return failed("inbound inspection");
        break;
      }
      default: {
        const { table, readable, noun } = associationHeaders[type];
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

        const insert = await insertLineAssociation(ctx, type, {
          ...audit,
          lineId: lineId!,
          headerId: row.id!,
          readableId: row[readable] ?? null
        });
        if (insert.error) return failed(noun, insert.error);

        if (type === "jobOperations") {
          await linkJobOperationContext(ctx, {
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

/** One insert per line association type: each table names its columns. */
function insertLineAssociation(
  ctx: ServiceContext,
  type: keyof typeof associationHeaders,
  row: {
    nonConformanceId: string;
    companyId: string;
    createdBy: string;
    lineId: string;
    headerId: string;
    readableId: string | null;
  }
) {
  const client = ctx.asCaller.supabase;
  const { lineId, headerId, readableId, ...audit } = row;
  switch (type) {
    case "jobOperations":
      return client.from("nonConformanceJobOperation").insert({
        ...audit,
        jobOperationId: lineId,
        jobId: headerId,
        jobReadableId: readableId
      });
    case "purchaseOrderLines":
      return client.from("nonConformancePurchaseOrderLine").insert({
        ...audit,
        purchaseOrderLineId: lineId,
        purchaseOrderId: headerId,
        purchaseOrderReadableId: readableId
      });
    case "salesOrderLines":
      return client.from("nonConformanceSalesOrderLine").insert({
        ...audit,
        salesOrderLineId: lineId,
        salesOrderId: headerId,
        salesOrderReadableId: readableId
      });
    case "shipmentLines":
      return client.from("nonConformanceShipmentLine").insert({
        ...audit,
        shipmentLineId: lineId,
        shipmentId: headerId,
        shipmentReadableId: readableId
      });
    case "receiptLines":
      return client.from("nonConformanceReceiptLine").insert({
        ...audit,
        receiptLineId: lineId,
        receiptId: headerId,
        receiptReadableId: readableId
      });
    case "salesReturnOrderLines":
      return client.from("nonConformanceSalesReturnOrderLine").insert({
        ...audit,
        salesReturnOrderLineId: lineId,
        salesReturnOrderId: headerId,
        salesReturnOrderReadableId: readableId ?? ""
      });
    case "purchaseReturnOrderLines":
      return client.from("nonConformancePurchaseReturnOrderLine").insert({
        ...audit,
        purchaseReturnOrderLineId: lineId,
        purchaseReturnOrderId: headerId,
        purchaseReturnOrderReadableId: readableId ?? "",
        quantity: 0
      });
  }
}

// Auto-linking after a job operation association: it surfaces context into
// the issue explorer (the job's item, the tracked entities its make method
// produced), so its failures are logged, never returned.
async function linkJobOperationContext(
  ctx: ServiceContext,
  args: {
    nonConformanceId: string;
    jobItemId: string | null;
    jobOperationId: string;
  }
) {
  const client = ctx.asCaller.supabase;
  const { nonConformanceId, jobItemId, jobOperationId } = args;

  if (jobItemId) {
    const existing = await client
      .from("nonConformanceItem")
      .select("id")
      .eq("nonConformanceId", nonConformanceId)
      .eq("itemId", jobItemId)
      .maybeSingle();
    if (!existing.data) {
      const result = await client.from("nonConformanceItem").insert({
        itemId: jobItemId,
        nonConformanceId,
        createdBy: ctx.auditUserId,
        companyId: ctx.company.id,
        quantity: 0
      });
      if (result.error) {
        logger.error("Failed to create association", { error: result.error });
      }
    }
  }

  const operation = await client
    .from("jobOperation")
    .select("jobMakeMethodId")
    .eq("id", jobOperationId)
    .single();
  const jobMakeMethodId = operation.data?.jobMakeMethodId ?? null;
  if (!jobMakeMethodId) return;

  const entities = await client
    .from("trackedEntity")
    .select("id")
    .eq("attributes->>Job Make Method", jobMakeMethodId)
    .eq("companyId", ctx.company.id);
  await linkMissingTrackedEntities(ctx, {
    nonConformanceId,
    trackedEntityIds: (entities.data ?? []).map((e) => e.id)
  });
}

async function linkMissingTrackedEntities(
  ctx: ServiceContext,
  {
    nonConformanceId,
    trackedEntityIds
  }: { nonConformanceId: string; trackedEntityIds: string[] }
) {
  if (trackedEntityIds.length === 0) return;
  const client = ctx.asCaller.supabase;

  const existing = await client
    .from("nonConformanceTrackedEntity")
    .select("trackedEntityId")
    .eq("nonConformanceId", nonConformanceId)
    .in("trackedEntityId", trackedEntityIds);
  const already = new Set(
    (existing.data ?? []).map((r) => r.trackedEntityId as string)
  );
  const rows = trackedEntityIds
    .filter((id) => !already.has(id))
    .map((trackedEntityId) => ({
      nonConformanceId,
      trackedEntityId,
      createdBy: ctx.auditUserId,
      companyId: ctx.company.id
    }));
  if (rows.length === 0) return;

  const result = await client.from("nonConformanceTrackedEntity").insert(rows);
  if (result.error) {
    logger.error("Failed to create association", { error: result.error });
  }
}

/**
 * Links an inspection to the issue with its whole lot, and seeds the item's
 * disposition row with it. The inspection link and the row writes share one
 * transaction under the issue lock, so a concurrent quantity edit either
 * lands before (and the row write overwrites it) or sees the inspection link
 * and is refused. False when any step failed.
 */
async function linkInspectionToIssue(
  ctx: ServiceContext,
  {
    nonConformanceId,
    inspectionId
  }: { nonConformanceId: string; inspectionId: string }
): Promise<boolean> {
  const client = ctx.asCaller.supabase;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;

  const inspection = await client
    .from("inspection")
    .select(
      "id, itemId, lotSize, sourceDocument, sourceDocumentLineId, inspectionSample(trackedEntityId)"
    )
    .eq("id", inspectionId)
    // The link below is written through Kysely (no RLS), so scope here.
    .eq("companyId", companyId)
    .single();
  if (inspection.error) {
    logger.error("Failed to create association", { error: inspection.error });
    return false;
  }

  const sampledIds = (
    (inspection.data.inspectionSample ?? []) as {
      trackedEntityId: string | null;
    }[]
  )
    .map((s) => s.trackedEntityId)
    .filter((id): id is string => Boolean(id));
  // The rest of the lot too: un-sampled entities are still part of the lot
  // the MRB needs to disposition.
  let lotEntityIds: string[] = sampledIds;
  if (
    inspection.data.sourceDocument === "Receipt" &&
    inspection.data.sourceDocumentLineId
  ) {
    const receiptLineEntities = await client
      .from("trackedEntity")
      .select("id")
      .eq("attributes ->> Receipt Line", inspection.data.sourceDocumentLineId)
      .eq("companyId", companyId);
    // A failed read would link only the sampled part of the lot.
    if (receiptLineEntities.error) {
      logger.error("Failed to create association", {
        error: receiptLineEntities.error
      });
      return false;
    }
    lotEntityIds = [
      ...new Set([
        ...sampledIds,
        ...(receiptLineEntities.data ?? []).map((r) => r.id)
      ])
    ];
  }

  // Read before writing anything: a failed read would seed the row with
  // wrong quantities and still report success.
  const entityQuantities =
    lotEntityIds.length > 0
      ? await client
          .from("trackedEntity")
          .select("id, quantity")
          .in("id", lotEntityIds)
          .eq("companyId", companyId)
      : { data: [], error: null };
  if (entityQuantities.error) {
    logger.error("Failed to create association", {
      error: entityQuantities.error
    });
    return false;
  }

  await linkMissingTrackedEntities(ctx, {
    nonConformanceId,
    trackedEntityIds: lotEntityIds
  });

  const quantityById = new Map(
    (entityQuantities.data ?? []).map((e) => [e.id, Number(e.quantity ?? 1)])
  );
  const itemId = inspection.data.itemId ?? null;

  try {
    await ctx.asSystem.pg.transaction().execute(async (trx) => {
      const { status } = await lockIssueDispositions(trx, {
        nonConformanceId,
        companyId
      });
      if (isIssueLocked(status)) throw new Error(issueLocked);

      await trx
        .insertInto("nonConformanceInspection")
        .values({
          nonConformanceId,
          inspectionId: inspection.data.id,
          companyId,
          createdBy: userId
        })
        .execute();

      if (itemId) {
        await linkEntitiesToIssueItemRow(trx, {
          nonConformanceId,
          companyId,
          userId,
          itemId,
          entities: lotEntityIds.map((id) => ({
            id,
            quantity: quantityById.get(id) ?? 1
          })),
          fallbackQuantity: Number(inspection.data.lotSize ?? 0)
        });
      }
    });
    return true;
  } catch (err) {
    logger.error("Failed to create association", { error: err });
    return false;
  }
}

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
 * Reject an inspection lot of a receipt, and open an issue for it.
 *
 * @remarks
 * Every tracked entity of the lot becomes Rejected and the lot Failed (ISO
 * 9001:2015 §8.7). Only a Receipt lot: a Job Operation lot is rejected from
 * the shop floor. A non-tracked Inventory lot's value is written off through
 * `post-nonconformance`; when that fails no issue is opened (closing the
 * issue later restores value on the assumption the write-off posted), and
 * rejecting again retries it. With `createNcr` false that is all
 * (`issueId` null). Otherwise an issue opens, of `nonConformanceTypeId` or the
 * first issue type, at the caller's default location: its item's disposition
 * row takes the lot quantity and Scrap, the lot's entities and receipt line
 * are linked to it, and its tasks are created. The failed features, with
 * their measured values against spec, go in its description. A failure after
 * the issue was inserted deletes it again; the lot stays rejected.
 *
 * @mcp
 */
export const rejectInspection = defineServiceFn({
  input: z.object({
    id: z.string(),
    nonConformanceTypeId: z.string().nullish(),
    createNcr: z.boolean().default(true)
  }),
  permission: { update: "quality" },

  async run(ctx, { id, nonConformanceTypeId, createNcr }) {
    const client = ctx.asCaller.supabase;
    const serviceRole = ctx.asSystem.supabase;
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;

    const rejected = await engine.dispositionInspection(ctx.asSystem.pg, {
      id,
      decision: "Reject",
      companyId,
      dispositionedBy: userId,
      // The ERP reject does receipt-specific NCR / write-off work.
      requireSource: "Receipt"
    });
    if (rejected.error) {
      return ctx.error("rule", "Failed to reject lot", rejected.error);
    }

    const writeOff = rejected.data?.writeOff;
    if (writeOff) {
      const post = await serverFns
        .as({ client, db: ctx.asSystem.pg, companyId, userId })
        .invoke("post-nonconformance", {
          documentType: "Inbound Inspection",
          documentId: id,
          description: "Inbound inspection lot rejected",
          movements: [
            {
              itemId: writeOff.itemId,
              locationId: writeOff.locationId,
              trackedEntityId: null,
              quantity: writeOff.quantity
            }
          ]
        });
      if (post.error) {
        return ctx.error(
          "internal",
          "Lot rejected, but the inventory write-off failed to post — resolve the accounting error and reject again to retry.",
          post.error
        );
      }
    }

    if (!createNcr) return { id, issueId: null };

    const [inspection, userDefaults, issueTypes] = await Promise.all([
      getInspection(client, id),
      getUserDefaults(client, userId, companyId),
      getIssueTypesList(client, companyId)
    ]);
    if (inspection.error || !inspection.data) {
      return ctx.error(
        "internal",
        "Lot rejected, but failed to load it for NCR",
        inspection.error
      );
    }
    // The inspection view embeds joins its generated type does not carry.
    const insp = inspection.data as any;

    const issueType =
      issueTypes.data?.find((t) => t.id === nonConformanceTypeId) ??
      issueTypes.data?.[0];
    const locationId = userDefaults.data?.locationId ?? null;
    if (!issueType || !locationId) {
      return ctx.error(
        "rule",
        "Lot rejected. Configure at least one Issue Type and a default user location to auto-create an NCR."
      );
    }

    const supplierName = insp.supplier?.name ?? "supplier";
    const sourceReadableId = insp.sourceDocumentReadableId ?? "";
    const itemReadableId =
      insp.item?.readableId ?? insp.itemReadableId ?? insp.itemId;
    const inspectionReadableId = insp.inspectionId ?? "";
    const issueTitle = [
      "Rejected lot",
      inspectionReadableId,
      itemReadableId && `— ${itemReadableId}`,
      sourceReadableId && `on ${sourceReadableId}`
    ]
      .filter(Boolean)
      .join(" ");

    const failedFeatures = await failedFeatureLines(ctx, id);
    const failedFeaturesBlock =
      failedFeatures.length > 0
        ? `\n\nFailed features:\n${failedFeatures.join("\n")}`
        : "";

    const created = await insertIssue(serviceRole, {
      name: issueTitle,
      description: `Auto-created from inbound inspection ${inspectionReadableId}. Lot size ${insp.lotSize}, sample ${insp.sampleSize}, Ac ${insp.acceptanceNumber} / Re ${insp.rejectionNumber}. Supplier: ${supplierName}.${failedFeaturesBlock}`,
      priority: "Medium",
      source: "Internal",
      locationId,
      nonConformanceTypeId: issueType.id,
      openDate: datetime
        .today(await getLocationTimeZone(client, locationId, companyId))
        .toString(),
      quantity: Number(insp.lotSize ?? 0),
      items: insp.itemId ? [insp.itemId] : [],
      companyId,
      createdBy: userId
    });
    if (created.error || !created.data) {
      return ctx.error(
        "internal",
        "Lot rejected, but failed to create NCR",
        created.error
      );
    }
    const { id: issueId, nonConformanceId } = created.data;
    const abandon = async (message: string, cause: unknown) => {
      await deleteIssue(serviceRole, issueId);
      return ctx.error("internal", message, cause);
    };

    // Every tracked entity in the lot: the sampled ones plus the un-sampled
    // ones, which the cascade also Rejected. A failed read would link only
    // part of the lot, so the issue is rolled back and the reject can retry.
    const sampledIds = (
      (insp.inspectionSample ?? []) as {
        trackedEntityId: string | null;
      }[]
    )
      .map((s) => s.trackedEntityId)
      .filter((id): id is string => Boolean(id));
    const receiptLineEntities = await serviceRole
      .from("trackedEntity")
      .select("id")
      .eq("attributes ->> Receipt Line", insp.sourceDocumentLineId ?? "")
      .eq("companyId", companyId);
    if (receiptLineEntities.error) {
      return abandon(
        "Lot rejected, but failed to read the lot for the NCR",
        receiptLineEntities.error
      );
    }
    const lotEntityIds = [
      ...new Set([
        ...sampledIds,
        ...(receiptLineEntities.data ?? []).map((r) => r.id)
      ])
    ];
    const entityQuantities =
      lotEntityIds.length > 0
        ? await serviceRole
            .from("trackedEntity")
            .select("id, quantity")
            .in("id", lotEntityIds)
            .eq("companyId", companyId)
        : { data: [], error: null };
    if (entityQuantities.error) {
      return abandon(
        "Lot rejected, but failed to read the lot for the NCR",
        entityQuantities.error
      );
    }

    // insertIssue inserted the item's disposition row at quantity 0 and
    // Pending. Now it takes the lot quantity and Scrap (the most conservative
    // start; the MRB can downgrade or split later), the inspection link, and
    // a link per entity — under the issue lock every disposition writer
    // shares, so a quantity edit cannot land between them.
    try {
      await ctx.asSystem.pg.transaction().execute(async (trx) => {
        await lockIssueDispositions(trx, {
          nonConformanceId: issueId,
          companyId
        });

        let scrapRowId: string | null = null;
        if (insp.itemId) {
          const scrapRow = await trx
            .updateTable("nonConformanceItem")
            .set({
              quantity: Number(insp.lotSize ?? 0),
              disposition: "Scrap",
              updatedBy: userId,
              updatedAt: datetime.timestamp()
            })
            .where("nonConformanceId", "=", issueId)
            .where("itemId", "=", insp.itemId)
            .where("companyId", "=", companyId)
            .returning(["id"])
            .executeTakeFirst();
          scrapRowId = scrapRow?.id ?? null;
        }

        await trx
          .insertInto("nonConformanceInspection")
          .values({
            nonConformanceId: issueId,
            inspectionId: insp.id,
            companyId,
            createdBy: userId
          })
          .execute();

        const entityRows = entityQuantities.data ?? [];
        if (scrapRowId && entityRows.length > 0) {
          await trx
            .insertInto("nonConformanceItemTrackedEntity")
            .values(
              entityRows.map((e) => ({
                nonConformanceItemId: scrapRowId!,
                nonConformanceId: issueId,
                trackedEntityId: e.id,
                quantity: Number(e.quantity ?? 1),
                companyId,
                createdBy: userId
              }))
            )
            .execute();
        }
      });
    } catch (err) {
      return abandon(
        "Lot rejected, but failed to link the NCR to the lot",
        err
      );
    }

    // The receipt line gives the explorer the supplier / receipt context.
    if (
      insp.sourceDocument === "Receipt" &&
      insp.sourceDocumentLineId &&
      insp.sourceDocumentId
    ) {
      await serviceRole.from("nonConformanceReceiptLine").insert({
        nonConformanceId: issueId,
        receiptLineId: insp.sourceDocumentLineId,
        receiptId: insp.sourceDocumentId,
        receiptReadableId: insp.sourceDocumentReadableId ?? null,
        companyId,
        createdBy: userId
      });
    }
    if (lotEntityIds.length > 0) {
      await serviceRole.from("nonConformanceTrackedEntity").insert(
        lotEntityIds.map((trackedEntityId) => ({
          nonConformanceId: issueId,
          trackedEntityId,
          companyId,
          createdBy: userId
        }))
      );
    }

    const tasks = await createIssueTasks(ctx, issueId);
    if (tasks.error) {
      return abandon(
        "Lot rejected, but failed to create NCR tasks",
        tasks.error
      );
    }

    await notifyIssue(
      ctx,
      (integrations) =>
        notifyIssueCreated({ client, serviceRole }, integrations, {
          companyId,
          userId,
          carbonUrl: `${ERP_URL}${path.to.issue(issueId)}`,
          issue: {
            id: issueId,
            nonConformanceId,
            title: issueTitle,
            description: `Auto-created from inbound inspection ${inspectionReadableId || id}`,
            severity: "Medium"
          }
        }),
      "Failed to send NCR notifications"
    );

    return { id, issueId };
  }
});

/** A document-driven lot's failed features, measured values against spec. */
async function failedFeatureLines(ctx: ServiceContext, inspectionId: string) {
  const [lotFeatures, lotMeasurements] = await Promise.all([
    getInspectionSamplingPlans(
      ctx.asSystem.supabase,
      inspectionId,
      ctx.company.id
    ),
    getInspectionMeasurements(
      ctx.asSystem.supabase,
      inspectionId,
      ctx.company.id
    )
  ]);
  const lines: string[] = [];
  for (const lotFeature of lotFeatures.data ?? []) {
    const feature = lotFeature.inspectionFeature;
    if (!feature) continue;
    const measurements = (lotMeasurements.data ?? []).filter(
      (m) => m.inspectionFeatureId === feature.id
    );
    const recorded = measurements.filter((m) => m.status !== "Pending").length;
    const failed = measurements.filter((m) => m.status === "Failed");
    if (failed.length === 0) continue;
    const failedValues = failed
      .map((m) => (m.value == null ? "F" : String(m.value)))
      .join(", ");
    const spec = [
      feature.nominalValue,
      feature.tolerancePlus != null || feature.toleranceMinus != null
        ? `+${feature.tolerancePlus ?? "0"}/−${feature.toleranceMinus ?? "0"}`
        : null,
      feature.unit
    ]
      .filter(Boolean)
      .join(" ");
    lines.push(
      spec
        ? `- ${feature.label}: nominal ${spec} — failed values: ${failedValues} (${failed.length}/${recorded} failed, n=${lotFeature.sampleSize}, Ac=${lotFeature.acceptanceNumber})`
        : `- ${feature.label}: ${failed.length}/${recorded} failed (n=${lotFeature.sampleSize}, Ac=${lotFeature.acceptanceNumber})`
    );
  }
  return lines;
}

// --- Inspection documents ---------------------------------------------------------

const emptyInspectionSave = { create: [], update: [], delete: [] };

/** The message of an RPC error, which may not be an `Error`. */
function rpcErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return fallback;
}

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
 * its retry would create them twice. Returns the saved rows and the maps
 * from temporary to persisted ids.
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
    samplingDefault: inspectionDocumentSamplingValidator.optional()
  }),
  permission: { update: "quality" },

  async run(ctx, input) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const id = input.inspectionDocumentId;

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
      const translated = translateLegacyInspectionSavePayload(
        input.anchors!,
        input.balloons
          ? inspectionSaveBalloonsPayloadValidator.parse(input.balloons)
          : emptyInspectionSave
      );
      features = mergeInspectionFeaturesPayload(features, translated.features);
      balloons = mergeInspectionBalloonsPayload(balloons, translated.balloons);
    }

    features = await resolveInspectionFeaturePayloadIds(
      client,
      id,
      companyId,
      features
    );

    if (input.samplingDefault) {
      const sampling = await updateInspectionDocumentSampling(client, {
        ...input.samplingDefault,
        inspectionDocumentId: id,
        companyId,
        userId: ctx.auditUserId
      });
      if (sampling.error) {
        return ctx.error(
          "internal",
          "Failed to save default sampling",
          sampling.error
        );
      }
    }

    const saved = await saveInspectionDocumentAtomic(client, {
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
        rpcErrorMessage(saved.error, "Failed to save inspection plan"),
        saved.error
      );
    }
    return saved.data as {
      success: boolean;
      featureIdMap: Record<string, string>;
      balloonAnchorIdMap: Record<string, string>;
      features: Array<Record<string, unknown>>;
      anchors: Array<Record<string, unknown>>;
      balloons: Array<Record<string, unknown>>;
    };
  }
});

/**
 * Set an inspection plan's drawing number; an empty one clears it.
 *
 * @mcp
 */
export const setInspectionDocumentDrawingNumber = defineServiceFn({
  input: z.object({ id: z.string(), drawingNumber: z.string().nullish() }),
  permission: { update: "quality" },

  async run(ctx, { id, drawingNumber }) {
    const { error } = await ctx.asCaller.supabase
      .from("inspectionDocument")
      .update({
        drawingNumber: drawingNumber?.trim() || null,
        updatedBy: ctx.auditUserId,
        updatedAt: new Date().toISOString()
      })
      .eq("id", id)
      .eq("companyId", ctx.company.id);
    if (error) {
      return ctx.error(
        "internal",
        "Failed to update the drawing number",
        error
      );
    }
    return { id };
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
      updatedAt: new Date().toISOString()
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
      return activateQualityDocuments(ctx, ids, documents.data);
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
 * Draft or Archived → Active. With an approval rule, each document opens a
 * request and waits in Draft (an Archived one moves to Draft) until it is
 * approved; without one it goes Active at once.
 */
async function activateQualityDocuments(
  ctx: ServiceContext,
  ids: string[],
  documents: { id: string; status: string | null }[]
) {
  const client = ctx.asCaller.supabase;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;
  const audit = { updatedBy: userId, updatedAt: new Date().toISOString() };

  const transitioning = documents.filter(
    (doc) => doc.status === "Draft" || doc.status === "Archived"
  );
  const opened =
    transitioning.length > 0
      ? await openApprovalRequests(ctx.asSystem.supabase, {
          documentType: "qualityDocument",
          documentIds: transitioning.map((doc) => doc.id),
          companyId,
          userId
        })
      : ({ status: "not-required" } as const);
  if (opened.status === "failed") {
    return ctx.error("internal", "Failed to submit for approval");
  }

  const awaitingApproval = new Set(
    opened.status === "opened" ? transitioning.map((doc) => doc.id) : []
  );
  if (opened.status === "opened" && opened.requested.length > 0) {
    if (opened.approverIds.length > 0) {
      for (const documentId of opened.requested) {
        await trigger("notify", {
          event: NotificationEvent.ApprovalRequested,
          companyId,
          documentId,
          documentType: "qualityDocument",
          recipient: { type: "users", userIds: opened.approverIds },
          from: userId
        }).catch((e) =>
          logger.error("Failed to trigger approval notification", {
            companyId,
            documentId,
            error: e
          })
        );
      }
    }

    const archivedToDraft = transitioning
      .filter(
        (doc) => doc.status === "Archived" && opened.requested.includes(doc.id)
      )
      .map((doc) => doc.id);
    if (archivedToDraft.length > 0) {
      await client
        .from("qualityDocument")
        .update({ status: "Draft", ...audit })
        .in("id", archivedToDraft)
        .eq("companyId", companyId);
    }
  }

  const activate = ids.filter((id) => !awaitingApproval.has(id));
  if (activate.length > 0) {
    const update = await client
      .from("qualityDocument")
      .update({ status: "Active", ...audit })
      .in("id", activate)
      .eq("companyId", companyId);
    if (update.error) {
      return ctx.error(
        "internal",
        "Failed to update the document",
        update.error
      );
    }
  }
  return { ids, awaitingApproval: [...awaitingApproval] };
}

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

/** Fills `<%= company.name %>` in every text of a template document. */
function interpolateTemplate(
  content: unknown,
  data: { company: { name: string } }
): unknown {
  if (typeof content === "string") return template(content)(data);
  if (Array.isArray(content)) {
    return content.map((item) => interpolateTemplate(item, data));
  }
  if (content && typeof content === "object") {
    return Object.fromEntries(
      Object.entries(content).map(([key, value]) => [
        key,
        key === "text" && typeof value === "string"
          ? template(value)(data)
          : interpolateTemplate(value, data)
      ])
    );
  }
  return content;
}

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
        content: interpolateTemplate(document.content, {
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
        updatedAt: new Date().toISOString()
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

/** Tell a risk's assignee it is theirs. A failure never fails the save. */
async function notifyRiskAssignee(
  ctx: ServiceContext,
  riskId: string,
  assignee: string
) {
  try {
    await trigger("notify", {
      companyId: ctx.company.id,
      documentId: riskId,
      event: NotificationEvent.RiskAssignment,
      recipient: { type: "user", userId: assignee },
      from: ctx.auditUserId
    });
  } catch (err) {
    logger.error("Failed to notify assignee", { error: err });
  }
}

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
    const result = await upsertRisk(ctx.asCaller.supabase, {
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
      await notifyRiskAssignee(ctx, result.data.id, input.assignee);
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
    const previous = await getRisk(client, id);
    const result = await upsertRisk(client, {
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
      await notifyRiskAssignee(ctx, id, input.assignee);
    }
    return { id };
  }
});

// --- Supplier corrective action (SCAR) share link -----------------------------------

/**
 * The context for a SCAR share link: a system actor in the link's company,
 * acting for whoever linked the supplier to the issue. Null when the link is
 * not a SCAR link, or names an issue of another company.
 */
export async function scarLinkContext(
  externalLinkId: string
): Promise<ServiceContext | null> {
  const serviceRole = getCarbonServiceRole();
  const link = await getExternalLink(serviceRole, externalLinkId);
  if (
    !link.data?.documentId ||
    link.data.documentType !== "Non-Conformance Supplier"
  ) {
    return null;
  }
  const [issueSupplier, company] = await Promise.all([
    getIssueFromExternalLink(serviceRole, link.data.documentId),
    serviceRole
      .from("company")
      .select("companyGroupId")
      .eq("id", link.data.companyId)
      .single()
  ]);
  if (
    !issueSupplier.data ||
    issueSupplier.data.companyId !== link.data.companyId ||
    !company.data?.companyGroupId
  ) {
    return null;
  }
  return systemContext({
    companyId: link.data.companyId,
    companyGroupId: company.data.companyGroupId,
    onBehalfOf: issueSupplier.data.createdBy
  });
}

/**
 * The supplier's action task a SCAR link may change: the link's issue must
 * still be open, and the task one of the supplier's on it.
 */
async function scarTask(
  ctx: ServiceContext,
  { externalLinkId, taskId }: { externalLinkId: string; taskId: string }
) {
  const serviceRole = ctx.asSystem.supabase;
  const link = await getExternalLink(serviceRole, externalLinkId);
  if (
    !link.data?.documentId ||
    link.data.companyId !== ctx.company.id ||
    link.data.documentType !== "Non-Conformance Supplier"
  ) {
    return ctx.error("notFound", "Could not find id");
  }
  const issue = await getIssueFromExternalLink(
    serviceRole,
    link.data.documentId
  );
  if (!issue.data || issue.data.companyId !== ctx.company.id) {
    return ctx.error("notFound", "Could not find the issue");
  }
  if (issue.data.nonConformance?.status === "Closed") {
    return ctx.error(
      "rule",
      "Issue has been closed already. Unable to make changes"
    );
  }
  const tasks = await getIssueActionTasks(
    serviceRole,
    issue.data.nonConformanceId,
    ctx.company.id,
    issue.data.supplierId
  );
  if (!tasks.data?.some((task) => task.id === taskId)) {
    return ctx.error("notFound", "Invalid task id");
  }
  return taskId;
}

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
    const task = await scarTask(ctx, { externalLinkId, taskId });
    if (typeof task !== "string") return task;
    const update = await updateIssueTaskStatus(ctx.asSystem.supabase, {
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
    const task = await scarTask(ctx, { externalLinkId, taskId });
    if (typeof task !== "string") return task;
    const update = await updateIssueTaskContent(ctx.asSystem.supabase, {
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
