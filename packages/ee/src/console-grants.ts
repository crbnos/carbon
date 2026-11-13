// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { GrantInput } from "@carbon/database/access-write";

/**
 * What a new Console Operator type may do: the MES modules only, never ERP
 * administration. Module grants, so every page of a module (the MES gates on
 * `production.jobs`, `production.batches`, `quality.inspections`,
 * `quality.issues`) is covered. Edit is view, create and update without delete
 * — the checkboxes this type was created with before grants.
 */
export const CONSOLE_OPERATOR_GRANTS: readonly GrantInput[] = [
  { module: "Production", page: null, level: "Edit" },
  { module: "Inventory", page: null, level: "Edit" },
  { module: "Quality", page: null, level: "Edit" },
  { module: "Resources", page: null, level: "View" },
  { module: "People", page: null, level: "View" }
];

/**
 * What enabling console mode must do to the company's Console Operator type:
 * create it with its grants, give grants to one that has none, or nothing.
 * A type with no grants is what a failed provisioning used to leave behind,
 * so enabling again repairs it; a type that holds any grant was set up and is
 * left as the admin keeps it.
 */
export function consoleOperatorWork(
  existing: { id: string; grantCount: number } | undefined
): "create" | "grant" | null {
  if (!existing) return "create";
  return existing.grantCount === 0 ? "grant" : null;
}
