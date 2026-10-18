// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { toJson } from "@carbon/database/json";

type SourceSlide = {
  stepId: string;
  imagePath: string | null;
  modelUploadId: string | null;
  caption: string | null;
  sortOrder: number;
  size: string;
  annotations: unknown;
};

/**
 * The rows that copy a step's slides onto its copied step. Source steps and
 * inserted step ids are paired by index; a slide whose step was not copied is
 * dropped. `annotations` is a jsonb array: written raw through Kysely, the
 * driver sends it as a Postgres array literal and the insert fails. A source
 * holding anything but an array — `{}`, which copies made before that was
 * fixed wrote for a slide with no pins — is copied as no pins.
 */
export function stepSlideCopies(
  slides: SourceSlide[],
  sourceSteps: Array<{ id?: string | null }>,
  insertedStepIds: Array<{ id: string }>,
  companyId: string,
  userId: string
) {
  return slides.flatMap((slide) => {
    const index = sourceSteps.findIndex((step) => step.id === slide.stepId);
    const stepId = insertedStepIds[index]?.id;
    if (!stepId) return [];
    return [
      {
        stepId,
        imagePath: slide.imagePath,
        modelUploadId: slide.modelUploadId,
        caption: slide.caption,
        sortOrder: slide.sortOrder,
        size: slide.size,
        annotations: toJson(
          Array.isArray(slide.annotations) ? slide.annotations : []
        ),
        companyId,
        createdBy: userId
      }
    ];
  });
}
