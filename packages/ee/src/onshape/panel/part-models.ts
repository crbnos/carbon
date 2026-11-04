// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { OnshapeBomNode } from "./bom";
import { normalizeConfiguration } from "./status";

/**
 * One STEP export an assembly push can queue for a BOM row's item: a part
 * (one `partId` of a Part Studio) or a sub-assembly. Keyed by part number,
 * since a row the push creates has no item id until apply.
 */
export type ModelExport = {
  partNumber: string;
  kind: "partstudio" | "assembly";
  documentId: string;
  wvm: "w" | "v";
  wvmId: string;
  elementId: string;
  partId?: string;
  /** Normalized: null is the default configuration. */
  configuration: string | null;
};

/**
 * The export a BOM row's Onshape source describes, or null when it names no
 * element or sits in a microversion (only a workspace or a version exports).
 * A row with a part id is a part; one without is an assembly, as
 * `externalIdForBomLine` keys it.
 */
export function modelExportFor(node: OnshapeBomNode): ModelExport | null {
  const source = node.itemSource;
  if (!node.partNumber || !source?.documentId || !source.elementId) {
    return null;
  }
  if (!source.wvmId || (source.wvmType !== "w" && source.wvmType !== "v")) {
    return null;
  }
  return {
    partNumber: node.partNumber,
    kind: source.partId ? "partstudio" : "assembly",
    documentId: source.documentId,
    wvm: source.wvmType,
    wvmId: source.wvmId,
    elementId: source.elementId,
    ...(source.partId ? { partId: source.partId } : {}),
    configuration: normalizeConfiguration(source.configuration)
  };
}
