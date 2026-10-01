// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Copyright (C) Carbon Manufacturing Systems Corporation.
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
  DRAWING = "DRAWING"
}
