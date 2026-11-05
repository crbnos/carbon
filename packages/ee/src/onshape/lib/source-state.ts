// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { createHash } from "node:crypto";
import type { OnshapeElementRow } from "./client";

// Elements whose edits change no part and no assembly: drawings and other app
// elements, and BOM tables (a property edited in a BOM table is written to its
// Part Studio).
const NON_SOURCE_ELEMENT_TYPES = new Set([
  "APPLICATION",
  "BILLOFMATERIALS",
  "DRAWING"
]);

/** What a workspace's parts are made from, and what its assemblies are. */
export type WorkspaceSourceStates = { parts: string; assemblies: string };

function fingerprint(prefix: string, elements: OnshapeElementRow[]): string {
  const entries = elements
    .map((element) => `${element.id}:${element.microversionId}`)
    .sort();
  return `${prefix}:${createHash("sha256")
    .update(entries.join("\n"))
    .digest("hex")
    .slice(0, 32)}`;
}

/**
 * What a workspace's parts and assemblies are made from: element
 * microversions, hashed. A part or assembly export is current while its
 * fingerprint is unchanged.
 *
 * Onshape gives every part the document's microversion, so a drawing edit
 * read as a change to every model. An element's microversion changes only
 * with its own content, and an assembly's also when a part in it changes
 * (checked 2026-10-31: a drawing edit changed only the drawing; an assembly
 * edit only the assembly and its BOM; a Part Studio edit the Part Studio,
 * the assembly and the BOM).
 *
 * - `parts`: every element except drawings, app elements, BOM tables and
 *   assemblies. Not the part's own Part Studio alone: a Variable Studio,
 *   Feature Studio or derived Part Studio in the workspace changes its
 *   geometry without changing that Part Studio's microversion. An assembly
 *   changes a part only through an in-context reference, and updating one
 *   is an edit to the Part Studio.
 * - `assemblies`: the same, assemblies included.
 *
 * Null when no part or assembly element carries a microversion.
 */
export function workspaceSourceStates(
  elements: OnshapeElementRow[]
): WorkspaceSourceStates | null {
  const sources = elements.filter(
    (element) =>
      !NON_SOURCE_ELEMENT_TYPES.has(element.elementType) &&
      typeof element.microversionId === "string" &&
      element.microversionId.length > 0
  );
  if (sources.length === 0) return null;
  return {
    parts: fingerprint(
      "wp1",
      sources.filter((element) => element.elementType !== "ASSEMBLY")
    ),
    assemblies: fingerprint("wa1", sources)
  };
}
