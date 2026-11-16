// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type { JSONContent } from "@carbon/files/markdown";
import { toStepDocument } from "@carbon/files/markdown";
import {
  getInstructionJobSteps,
  getInstructionMaterialLinks,
  getInstructionStepSlides,
  getInstructionTools,
  type InstructionStepLinkSource
} from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getAssemblyPlaybackByInstructionId,
  getModelUploadsByIds,
  getThumbnailPathByItemId,
  getWorkCenter
} from "./operations.service";
import { getInspectionDocumentWithBalloons } from "./quality.service";

/**
 * A Bill of Process operation shaped like the job operation the MES screens
 * render, so the ERP's operator preview can show the real screen before any
 * job exists. Steps follow job creation: a linked procedure first, then a
 * linked assembly instruction, then the operation's own steps.
 * Nothing here writes, and every read is scoped to the company.
 */
export async function getMethodOperationPreview(
  client: SupabaseClient<Database>,
  methodOperationId: string,
  companyId: string
) {
  const operation = await client
    .from("methodOperation")
    .select(
      "*, procedure(content), makeMethod(id, itemId, item(id, readableIdWithRevision, name, unitOfMeasureCode))"
    )
    .eq("id", methodOperationId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (!operation.data) return null;

  const op = operation.data;
  const makeMethod = op.makeMethod as {
    id: string;
    itemId: string;
    item: {
      id: string;
      readableIdWithRevision: string;
      name: string;
      unitOfMeasureCode: string | null;
    } | null;
  } | null;
  if (!makeMethod) return null;

  const [plan, parameters, materials, methodTools, thumbnailPath, workCenter] =
    await Promise.all([
      getPreviewSteps(client, op, companyId),
      getPreviewParameters(client, op, companyId),
      getPreviewMaterials(client, makeMethod.id, companyId),
      client
        .from("methodOperationTool")
        .select(
          "quantity, item:toolId(id, name, type, readableId), methodOperationToolStep(methodOperationStepId)"
        )
        .eq("operationId", methodOperationId)
        .eq("companyId", companyId),
      getThumbnailPathByItemId(client, makeMethod.itemId),
      op.workCenterId ? getWorkCenter(client, op.workCenterId) : null
    ]);
  const { steps } = plan;

  // Job creation keeps a part or tool link only to a step it copied; a link
  // to any other step is dropped, and the row then shows on every step.
  const stepIds = new Set(steps.map((step) => step.id));
  const onCopiedSteps = <T extends { stepId: string }>(links: T[]) =>
    links.filter((link) => stepIds.has(link.stepId));

  // Job creation links instruction parts to the operation's own lines only,
  // never to a kit's components.
  const instructionLinks = getInstructionMaterialLinks(
    plan.instructionMaterials,
    materials.filter((material) => !material.isKitComponent)
  );
  const instructionToolIds = new Set(
    plan.instructionTools.map((tool) => tool.item?.id)
  );

  const slideModelIds = Array.from(
    new Set(
      steps.flatMap((step) =>
        step.jobOperationStepSlide.map((slide) => slide.modelUploadId)
      )
    )
  ).filter((id): id is string => !!id);

  const inspectionDocumentId =
    op.operationType === "Inspection" ? op.inspectionDocumentId : null;
  const [slideModels, assemblyPlayback, document, features] = await Promise.all(
    [
      slideModelIds.length > 0
        ? getModelUploadsByIds(client, slideModelIds)
        : null,
      op.operationType === "Assembly" && op.assemblyInstructionId
        ? getAssemblyPlaybackByInstructionId(client, op.assemblyInstructionId)
        : null,
      inspectionDocumentId
        ? getInspectionDocumentWithBalloons(client, inspectionDocumentId)
        : null,
      inspectionDocumentId
        ? client
            .from("inspectionFeature")
            .select("*, gaugeType(name)")
            .eq("inspectionDocumentId", inspectionDocumentId)
            .eq("companyId", companyId)
            .order("label", { ascending: true })
        : null
    ]
  );

  const item = makeMethod.item;

  return {
    operationType: op.operationType,
    inspectionDocumentId: op.inspectionDocumentId,
    item,
    thumbnailPath,
    // The job operation fields the screens read, with a fresh job's values.
    operation: {
      id: op.id,
      description: op.description,
      operationType: op.operationType,
      workCenterId: op.workCenterId,
      processId: op.processId,
      itemId: item?.id ?? null,
      itemReadableId: item?.readableIdWithRevision ?? null,
      itemDescription: item?.name ?? null,
      itemUnitOfMeasure: item?.unitOfMeasureCode ?? null,
      jobId: null,
      jobReadableId: null,
      jobMakeMethodId: makeMethod.id,
      jobStatus: "Ready",
      operationStatus: "Todo",
      jobDeadlineType: "No Deadline",
      jobDueDate: null,
      operationDueDate: null,
      operationQuantity: 1,
      targetQuantity: 1,
      quantityComplete: 0,
      quantityReworked: 0,
      quantityScrapped: 0,
      setupDuration: 0,
      laborDuration: 0,
      machineDuration: 0,
      duration: 0,
      // Job creation copies a linked procedure's content into the instructions.
      workInstruction: op.procedureId
        ? ((op.procedure as { content: unknown } | null)?.content ?? null)
        : op.workInstruction,
      parentMaterialId: null,
      reworkId: null
    },
    job: {
      id: null,
      itemReadableIdWithRevision: item?.readableIdWithRevision ?? null,
      customer: null
    },
    procedure: { attributes: steps, parameters },
    materials: materials.map(({ stepLinks, ...material }) => {
      const links = onCopiedSteps([
        ...stepLinks,
        ...instructionLinks.filter((link) => link.materialId === material.id)
      ]);
      return {
        ...material,
        jobOperationStepIds: links.map((link) => link.stepId),
        jobOperationStepQuantities: Object.fromEntries(
          links.map((link) => [link.stepId, link.quantity])
        )
      };
    }),
    tools: [
      ...plan.instructionTools,
      ...(methodTools.data ?? [])
        .filter((tool) => !instructionToolIds.has(tool.item?.id ?? ""))
        .map((tool) => ({
          quantity: tool.quantity,
          item: tool.item,
          jobOperationStepIds: onCopiedSteps(
            (tool.methodOperationToolStep ?? []).map((link) => ({
              stepId: link.methodOperationStepId
            }))
          ).map((link) => link.stepId)
        }))
    ],
    // The view reads id and name, which a work center row always has.
    workCenter:
      (workCenter?.data as {
        id: string;
        name: string;
        isBlocked: boolean | null;
        blockingDispatchId: string | null;
        blockingDispatchReadableId: string | null;
      } | null) ?? null,
    slideModels: Object.fromEntries(
      (slideModels?.data ?? []).map((model) => [model.id, model])
    ),
    assemblyPlayback,
    // The plan of an Inspection operation: each feature as a one-sample plan row.
    inspection: {
      balloons: document?.data?.balloons ?? [],
      documentName: document?.data?.name ?? null,
      pdfUrl: document?.data?.pdfUrl ?? null,
      model: document?.data?.model ?? null,
      features: (features?.data ?? []).map((feature) => ({
        id: feature.id,
        inspectionId: null,
        inspectionFeatureId: feature.id,
        sampleSize: 1,
        acceptanceNumber: 0,
        rejectionNumber: 1,
        inspectionFeature: feature
      }))
    }
  };
}

type PreviewSlide = {
  id: string;
  imagePath: string | null;
  modelUploadId: string | null;
  caption: string | null;
  sortOrder: number | null;
  size: string | null;
  annotations: unknown;
};

type PreviewStep = {
  id: string;
  operationId: string;
  name: string;
  description: JSONContent;
  type: Database["public"]["Enums"]["procedureStepType"];
  unitOfMeasureCode: string | null;
  minValue: number | null;
  maxValue: number | null;
  listValues: string[] | null;
  fileTypes: string[] | null;
  required: boolean | null;
  sortOrder: number;
  assemblyInstructionStepId: string | null;
  jobOperationStepRecord: never[];
  jobOperationStepSlide: PreviewSlide[];
};

type ToolItem = {
  id: string;
  name: string;
  type: string;
  readableId: string | null;
};

type StepPlan = {
  steps: PreviewStep[];
  instructionTools: {
    quantity: number;
    item: ToolItem | null;
    jobOperationStepIds: string[];
  }[];
  instructionMaterials: InstructionStepLinkSource[];
};

type StepFields = Pick<
  PreviewStep,
  | "id"
  | "name"
  | "type"
  | "unitOfMeasureCode"
  | "minValue"
  | "maxValue"
  | "listValues"
  | "fileTypes"
  | "required"
  | "sortOrder"
> & { description: unknown };

/** One step as a job step row, whatever it was copied from. */
function toPreviewStep(
  operationId: string,
  step: StepFields,
  extra: Pick<
    PreviewStep,
    "assemblyInstructionStepId" | "jobOperationStepSlide"
  >
): PreviewStep {
  return {
    id: step.id,
    operationId,
    name: step.name,
    description: toStepDocument(step.description),
    type: step.type,
    unitOfMeasureCode: step.unitOfMeasureCode,
    minValue: step.minValue,
    maxValue: step.maxValue,
    listValues: step.listValues,
    fileTypes: step.fileTypes,
    required: step.required,
    sortOrder: step.sortOrder,
    jobOperationStepRecord: [],
    ...extra
  };
}

const noLinks = { assemblyInstructionStepId: null, jobOperationStepSlide: [] };

/**
 * The steps a new job would get, with the same source rule as job creation:
 * a procedure, else an assembly instruction, else the operation's own steps.
 */
async function getPreviewSteps(
  client: SupabaseClient<Database>,
  op: {
    id: string;
    procedureId: string | null;
    assemblyInstructionId: string | null;
  },
  companyId: string
): Promise<StepPlan> {
  const none = { instructionTools: [], instructionMaterials: [] };

  if (op.procedureId) {
    const steps = await client
      .from("procedureStep")
      .select("*")
      .eq("procedureId", op.procedureId)
      .eq("companyId", companyId)
      .order("sortOrder", { ascending: true });
    return {
      ...none,
      steps: (steps.data ?? []).map((step) =>
        toPreviewStep(op.id, step, noLinks)
      )
    };
  }

  if (op.assemblyInstructionId) {
    return getInstructionStepPlan(
      client,
      op.id,
      op.assemblyInstructionId,
      companyId
    );
  }

  const steps = await client
    .from("methodOperationStep")
    .select("*, methodOperationStepSlide(*)")
    .eq("operationId", op.id)
    .eq("companyId", companyId)
    .order("sortOrder", { ascending: true });
  return {
    ...none,
    steps: (steps.data ?? []).map(({ methodOperationStepSlide, ...step }) =>
      toPreviewStep(op.id, step, {
        assemblyInstructionStepId: null,
        jobOperationStepSlide: methodOperationStepSlide ?? []
      })
    )
  };
}

/** An assembly instruction's steps, slides, tools and part links, as job creation copies them. */
async function getInstructionStepPlan(
  client: SupabaseClient<Database>,
  operationId: string,
  instructionId: string,
  companyId: string
): Promise<StepPlan> {
  const [instruction, sourceSteps] = await Promise.all([
    client
      .from("assemblyInstruction")
      .select("modelUploadId")
      .eq("id", instructionId)
      .eq("companyId", companyId)
      .maybeSingle(),
    client
      .from("assemblyInstructionStep")
      .select("*")
      .eq("assemblyInstructionId", instructionId)
      .eq("companyId", companyId)
  ]);
  const jobSteps = getInstructionJobSteps(sourceSteps.data ?? []);
  const sourceStepIds = jobSteps.map((step) => step.assemblyInstructionStepId);
  if (sourceStepIds.length === 0) {
    return { steps: [], instructionTools: [], instructionMaterials: [] };
  }

  const [slides, tools, stepMaterials] = await Promise.all([
    client
      .from("assemblyInstructionStepSlide")
      .select("*")
      .in("stepId", sourceStepIds)
      .eq("companyId", companyId)
      .order("sortOrder", { ascending: true }),
    client
      .from("assemblyInstructionStepTool")
      .select(
        "stepId, itemId, quantity, item:itemId(id, name, type, readableId)"
      )
      .in("stepId", sourceStepIds)
      .eq("companyId", companyId),
    client
      .from("assemblyInstructionStepMaterial")
      .select("stepId, itemId, quantity")
      .in("stepId", sourceStepIds)
      .eq("companyId", companyId)
  ]);
  const toolItemById = new Map(
    (tools.data ?? []).map((tool) => [
      tool.itemId,
      tool.item as ToolItem | null
    ])
  );

  return {
    // A preview step keeps its source id, so part and tool links match it.
    steps: jobSteps.map((step) =>
      toPreviewStep(
        operationId,
        { ...step, id: step.assemblyInstructionStepId },
        {
          assemblyInstructionStepId: step.assemblyInstructionStepId,
          jobOperationStepSlide: getInstructionStepSlides(
            step.assemblyInstructionStepId,
            slides.data ?? [],
            instruction.data?.modelUploadId ?? null
          ).map((slide, index) => ({
            ...slide,
            id: `${step.assemblyInstructionStepId}:${index}`
          }))
        }
      )
    ),
    instructionTools: getInstructionTools(tools.data ?? []).map((tool) => ({
      quantity: tool.quantity,
      item: toolItemById.get(tool.itemId) ?? null,
      jobOperationStepIds: tool.stepIds
    })),
    instructionMaterials: stepMaterials.data ?? []
  };
}

/**
 * The parts the operation's screen lists, as the MES part reader returns them
 * for a job (`getJobMaterialsByOperationId`): by part number, with each kit's
 * components after it.
 */
async function getPreviewMaterials(
  client: SupabaseClient<Database>,
  makeMethodId: string,
  companyId: string
) {
  const select =
    "id, order, quantity, kit, methodType, makeMethodId, materialMakeMethodId, methodOperationId, item(id, readableIdWithRevision, name, type, itemTrackingType), methodMaterialStep(methodOperationStepId, quantity)";
  const lines = await client
    .from("methodMaterial")
    .select(select)
    .eq("makeMethodId", makeMethodId)
    .eq("companyId", companyId);
  const kitMethodIds = (lines.data ?? [])
    .filter((line) => line.kit && line.materialMakeMethodId)
    .map((line) => line.materialMakeMethodId as string);
  const kitLines =
    kitMethodIds.length > 0
      ? await client
          .from("methodMaterial")
          .select(select)
          .in("makeMethodId", kitMethodIds)
          .neq("methodType", "Make to Order")
          .eq("companyId", companyId)
      : null;
  const kitParentByMethodId = new Map(
    (lines.data ?? [])
      .filter((line) => line.kit && line.materialMakeMethodId)
      .map((line) => [line.materialMakeMethodId as string, line.id])
  );

  const toMaterial = (
    line: NonNullable<typeof lines.data>[number],
    kitParentId: string | null
  ) => {
    const item = line.item as {
      id: string;
      readableIdWithRevision: string;
      name: string;
      type: string;
      itemTrackingType: string;
    } | null;
    return {
      id: line.id,
      order: line.order,
      itemId: item?.id ?? null,
      itemReadableId: item?.readableIdWithRevision ?? null,
      description: item?.name ?? "",
      itemType: item?.type ?? null,
      quantity: line.quantity,
      estimatedQuantity: line.quantity,
      quantityIssued: 0,
      kit: line.kit,
      isKitComponent: kitParentId !== null,
      kitParentId,
      requiresSerialTracking: item?.itemTrackingType === "Serial",
      requiresBatchTracking: item?.itemTrackingType === "Batch",
      jobOperationId: line.methodOperationId ?? null,
      stepLinks: (line.methodMaterialStep ?? []).map((link) => ({
        stepId: link.methodOperationStepId,
        quantity: link.quantity
      }))
    };
  };

  const ordered = (lines.data ?? [])
    .map((line) => toMaterial(line, null))
    .sort(
      (a, b) =>
        (a.itemReadableId ?? "").localeCompare(b.itemReadableId ?? "") ||
        a.id.localeCompare(b.id)
    );
  return [
    ...ordered,
    ...(kitLines?.data ?? []).map((line) =>
      toMaterial(line, kitParentByMethodId.get(line.makeMethodId) ?? null)
    )
  ];
}

async function getPreviewParameters(
  client: SupabaseClient<Database>,
  op: { id: string; procedureId: string | null },
  companyId: string
) {
  const parameters = op.procedureId
    ? await client
        .from("procedureParameter")
        .select("id, key, value")
        .eq("procedureId", op.procedureId)
        .eq("companyId", companyId)
    : await client
        .from("methodOperationParameter")
        .select("id, key, value")
        .eq("operationId", op.id)
        .eq("companyId", companyId);
  return parameters.data ?? [];
}
