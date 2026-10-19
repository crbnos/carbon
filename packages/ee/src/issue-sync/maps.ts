// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

export {
  mapCarbonStatusToJiraCategory,
  mapJiraStatusToCarbonStatus
} from "../jira/lib/utils";
export {
  LinearWorkStateType,
  mapCarbonStatusToLinearStatus,
  mapLinearStatusToCarbonStatus
} from "../linear/lib/utils";

/** 32-bit FNV-1a of a string, as 8 lowercase hex digits. */
export function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * A short, stable fingerprint of a rich-text value (Tiptap JSON, Markdown,
 * ADF), so the sync snapshot can compare descriptions without storing them.
 */
export function hashText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return fnv1a(typeof value === "string" ? value : JSON.stringify(value));
}
