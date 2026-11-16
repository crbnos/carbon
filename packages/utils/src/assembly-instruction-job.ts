// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";

/**
 * What an assembly instruction becomes on a job operation. Job creation
 * (`insertAssemblyDataForJobOperation`, ERP) writes it, and the MES operator
 * preview shows it, so the two cannot drift apart.
 */

type Tables = Database["public"]["Tables"];

export type InstructionStepSource = Pick<
  Tables["assemblyInstructionStep"]["Row"],
  | "id"
  | "title"
  | "type"
  | "description"
  | "instructionText"
  | "required"
  | "unitOfMeasureCode"
  | "minValue"
  | "maxValue"
  | "listValues"
  | "fileTypes"
  | "sortOrder"
  | "isSubAssembly"
>;

export type InstructionSlideSource = Pick<
  Tables["assemblyInstructionStepSlide"]["Row"],
  "stepId" | "imagePath" | "modelUploadId" | "caption" | "sortOrder" | "size"
> & { annotations: unknown };

export type InstructionStepLinkSource = {
  stepId: string;
  itemId: string | null;
  quantity: number | null;
};

/**
 * The job steps of an instruction: build steps only (a sub-assembly header is
 * not a build action), in play order, numbered from 1.
 * `description` is the raw value; the caller stores it as a document.
 */
export function getInstructionJobSteps(steps: InstructionStepSource[]) {
  return steps
    .filter((step) => !step.isSubAssembly)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((source, index) => ({
      assemblyInstructionStepId: source.id,
      name: source.title || `Step ${index + 1}`,
      type: source.type ?? "Task",
      description: source.description ?? source.instructionText,
      required: source.required ?? false,
      unitOfMeasureCode: source.unitOfMeasureCode,
      minValue: source.minValue,
      maxValue: source.maxValue,
      listValues: source.listValues,
      fileTypes: source.fileTypes,
      sortOrder: index + 1
    }));
}

/**
 * The slides of one job step: the instruction's 3D model first, unless the
 * step already shows it, then the step's own slides in the order given.
 */
export function getInstructionStepSlides(
  stepId: string,
  slides: InstructionSlideSource[],
  modelUploadId: string | null
) {
  const authored = slides.filter((slide) => slide.stepId === stepId);
  const modelSlide =
    modelUploadId &&
    !authored.some((slide) => slide.modelUploadId === modelUploadId)
      ? [
          {
            imagePath: null,
            modelUploadId,
            caption: null,
            sortOrder: 0,
            size: "medium",
            annotations: [] as unknown
          }
        ]
      : [];
  return [
    ...modelSlide,
    ...authored.map((slide) => ({
      imagePath: slide.imagePath,
      modelUploadId: slide.modelUploadId,
      caption: slide.caption,
      sortOrder: slide.sortOrder ?? 1,
      size: slide.size ?? "medium",
      annotations: slide.annotations ?? []
    }))
  ];
}

/**
 * The tools an instruction puts on a job operation: one per tool item, at the
 * largest quantity any step asks for, linked to every step that uses it. A step
 * lists a tool once (unique `stepId, itemId`).
 */
export function getInstructionTools(tools: InstructionStepLinkSource[]) {
  const byItemId = new Map<string, { quantity: number; stepIds: string[] }>();
  for (const tool of tools) {
    if (!tool.itemId) continue;
    const entry = byItemId.get(tool.itemId) ?? { quantity: 0, stepIds: [] };
    entry.quantity = Math.max(entry.quantity, tool.quantity ?? 1);
    entry.stepIds.push(tool.stepId);
    byItemId.set(tool.itemId, entry);
  }
  return [...byItemId].map(([itemId, entry]) => ({ itemId, ...entry }));
}

/**
 * The part ↔ step links of an instruction, matched to the operation's own
 * material lines by item. When two lines carry the item, the first by `order`
 * wins (a job line keeps its method line's `order`), so the preview and the
 * job pick the same line. A part the method does not carry gets no link.
 */
export function getInstructionMaterialLinks(
  stepMaterials: InstructionStepLinkSource[],
  lines: { id: string; itemId: string | null; order: number | null }[]
) {
  const lineIdByItemId = new Map<string, string>();
  const ordered = [...lines].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id)
  );
  for (const line of ordered) {
    if (line.itemId && !lineIdByItemId.has(line.itemId)) {
      lineIdByItemId.set(line.itemId, line.id);
    }
  }
  return stepMaterials.flatMap((link) => {
    const materialId = link.itemId
      ? lineIdByItemId.get(link.itemId)
      : undefined;
    return materialId
      ? [{ stepId: link.stepId, materialId, quantity: link.quantity ?? null }]
      : [];
  });
}
