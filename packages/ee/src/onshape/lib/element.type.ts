// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { OnshapeDocument } from "./document.type";

export interface OnshapeElement extends OnshapeDocument {
  elementId: string;
  linkDocumentId?: string;
  configuration?: string;
  partId?: string;
}

export enum OnshapeElementType {
  ASSEMBLY = "ASSEMBLY",
  PART_STUDIO = "PARTSTUDIO",
  DRAWING = "DRAWING",
  /** App elements, drawings among them: the element list never says DRAWING. */
  APPLICATION = "APPLICATION"
}

/** The `dataType` of an APPLICATION element that is a drawing. */
export const ONSHAPE_DRAWING_DATA_TYPE = "onshape-app/drawing";
