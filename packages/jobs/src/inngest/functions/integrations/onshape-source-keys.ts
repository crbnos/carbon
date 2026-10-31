// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createHash } from "node:crypto";
import type { SyncOnshapeElementInput } from "./onshape-sync-element";

// What names an Onshape export, so a sync can tell an unchanged source from a
// changed one. Free of the Inngest client: the panel's review reads them too.

// An assembly's last export is recorded per item as a mapping row, so a push of
// an unchanged assembly reuses its model instead of exporting it again.
export const MODEL_SOURCE_ENTITY_TYPE = "modelSource";

// Immutable generation: old optimizer/thumbnail/compact jobs can only finish
// against their old model ID. Replays of this exact released source share one
// ID; a different part/configuration cannot reuse its artifacts. A whole
// assembly, or a workspace part with no microversion, has no fixed source to
// name; the attach names it by its bytes instead. The tag changed with the
// export format: a GLTF generation of the same source already holds the
// "selected-part-v1" id, and reusing it would fail the attach's identity check.
export function partSourceId(
  input: Pick<
    SyncOnshapeElementInput,
    | "modelElementKind"
    | "sourceWvm"
    | "sourceMicroversionId"
    | "companyId"
    | "itemId"
    | "documentId"
    | "versionId"
    | "modelElementId"
    | "partId"
    | "configuration"
  >
): string | null {
  if (
    input.modelElementKind !== "partstudio" ||
    (input.sourceWvm === "w" && !input.sourceMicroversionId)
  ) {
    return null;
  }
  return `onshape-${createHash("sha256")
    .update(
      JSON.stringify([
        "selected-part-step-v1",
        input.companyId,
        input.itemId,
        input.documentId,
        input.versionId,
        input.modelElementId,
        input.partId,
        input.configuration ?? "",
        ...(input.sourceWvm === "w" ? [input.sourceMicroversionId] : [])
      ])
    )
    .digest("hex")
    .slice(0, 40)}`;
}

/** A model an Onshape export made: every export's id carries this prefix. */
export function isOnshapeModelId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith("onshape-");
}

/** The assembly source key once its version or workspace state (`state`) is known. */
export function assemblySourceKeyAt(
  input: Pick<
    SyncOnshapeElementInput,
    "documentId" | "sourceWvm" | "modelElementId" | "configuration"
  >,
  state: string
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        "assembly-source-v1",
        input.documentId,
        input.sourceWvm ?? "v",
        state,
        input.modelElementId,
        input.configuration ?? ""
      ])
    )
    .digest("hex");
}

/**
 * The model the last export from `source` produced, when the item still uses
 * it. A different source, or a model replaced since (by hand or another sync),
 * means the export runs again.
 */
export function reusableModelUploadId(
  mapping: { externalId: string | null; metadata: unknown } | null,
  itemModelUploadId: string | null | undefined,
  source: string
): string | null {
  const modelUploadId = (
    mapping?.metadata as { modelUploadId?: unknown } | null
  )?.modelUploadId;
  if (
    mapping?.externalId !== source ||
    typeof modelUploadId !== "string" ||
    itemModelUploadId !== modelUploadId
  ) {
    return null;
  }
  return modelUploadId;
}

// Mirrors ~/utils/string stripSpecialCharacters (app-only, not importable here):
// keep only characters valid for storage (S3) keys.
export function stripSpecialCharacters(inputString: string): string {
  return inputString.replace(/[^a-zA-Z0-9/!_\-.*'() &$@=;:+,?]/g, "");
}

/** Where a synced document (a drawing PDF) of an item is stored. */
export function itemDocumentPath(
  companyId: string,
  itemId: string,
  fileName: string
): string {
  return `${companyId}/parts/${itemId}/${stripSpecialCharacters(fileName)}`;
}
