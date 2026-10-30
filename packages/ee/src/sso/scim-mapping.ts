// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

/**
 * The two decisions SCIM makes about a person's access, kept pure so
 * `scim-mapping.test.ts` pins them: which employee type the person's IdP
 * groups give, and how that type's grants replace this company's slice of the
 * person's `userPermission` row. The row is global (`{ "<module>_<action>":
 * [companyId, …] }`), so only this company's id may ever move.
 */

export type MappedGroup = {
  employeeTypeId: string | null;
  priority: number;
  displayName: string;
};

/**
 * The type of the mapped group with the lowest `priority` (ties broken by
 * `displayName`), else the connection's default type. Unmapped groups take no
 * part: a person in no mapped group gets the default.
 */
export function pickEmployeeType(
  groups: MappedGroup[],
  defaultTypeId: string
): string {
  const mapped = groups
    .filter(
      (group): group is MappedGroup & { employeeTypeId: string } =>
        group.employeeTypeId !== null
    )
    .sort(
      (a, b) =>
        a.priority - b.priority || a.displayName.localeCompare(b.displayName)
    );
  return mapped[0]?.employeeTypeId ?? defaultTypeId;
}

export type EmployeeTypePermissionRow = {
  module: string;
  view: string[];
  create: string[];
  update: string[];
  delete: string[];
};

const ACTIONS = ["view", "create", "update", "delete"] as const;

/**
 * The claim keys (`<module>_<action>`, module lowercased — the shape
 * `makePermissionsFromEmployeeType` writes for an invite) an employee type
 * grants in this company.
 */
export function typeGrantsFor(
  rows: EmployeeTypePermissionRow[],
  companyId: string
): string[] {
  const keys: string[] = [];
  for (const row of rows) {
    const module = row.module.toLowerCase();
    for (const action of ACTIONS) {
      if (row[action].includes(companyId)) keys.push(`${module}_${action}`);
    }
  }
  return keys;
}

/** Remove this company from every grant, leaving other companies' ids alone. */
export function stripCompanyGrants(
  current: Record<string, string[]>,
  companyId: string
): Record<string, string[]> {
  const next: Record<string, string[]> = {};
  for (const [key, companies] of Object.entries(current)) {
    next[key] = Array.isArray(companies)
      ? companies.filter((id) => id !== companyId)
      : companies;
  }
  return next;
}

/**
 * This company's grants become exactly `grantedKeys`; every other company's
 * grants stay as they are. A type change means "these permissions" in Carbon,
 * so a hand edit to the person's grants in this company is replaced.
 */
export function replaceCompanyGrants(
  current: Record<string, string[]>,
  grantedKeys: string[],
  companyId: string
): Record<string, string[]> {
  const next = stripCompanyGrants(current, companyId);
  for (const key of grantedKeys) {
    next[key] = [...(next[key] ?? []), companyId];
  }
  return next;
}
