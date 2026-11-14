// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

/**
 * The two decisions SCIM makes about a person's access, kept pure so
 * `mapping.test.ts` pins them: which employee type the person's IdP
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
 * The type of the mapped group that comes first by `compareGroupPrecedence`,
 * else the connection's default type. Unmapped groups take no
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
    .sort(compareGroupPrecedence);
  return mapped[0]?.employeeTypeId ?? defaultTypeId;
}

/**
 * The order mapped groups win in: lower `priority` first, ties by
 * `displayName`. The settings list shows mapped groups in this order, so the
 * group at the top is the one that wins.
 */
export function compareGroupPrecedence(
  a: Pick<MappedGroup, "priority" | "displayName">,
  b: Pick<MappedGroup, "priority" | "displayName">
): number {
  return a.priority - b.priority || a.displayName.localeCompare(b.displayName);
}

/** The gap between two mapped groups' priorities after a save. */
export const GROUP_PRIORITY_STEP = 10;

export type GroupMappingChoice = {
  groupId: string;
  employeeTypeId: string | null;
};

/**
 * What a save of the group mappings writes. `submitted` is the list as the
 * settings card shows it: mapped groups in the order they win, then the rest.
 * Mapped groups are renumbered from `GROUP_PRIORITY_STEP` in that order; an
 * unmapped group keeps its priority, which takes no part. Only changed groups
 * are in `updates`. `removedGroupIds` are the groups that lose their mapping.
 */
export function planGroupMappingSave(
  current: { id: string; employeeTypeId: string | null; priority: number }[],
  submitted: GroupMappingChoice[]
): {
  unknownGroupIds: string[];
  updates: { id: string; employeeTypeId: string | null; priority: number }[];
  removedGroupIds: string[];
} {
  const byId = new Map(current.map((group) => [group.id, group]));
  const unknownGroupIds: string[] = [];
  const updates: {
    id: string;
    employeeTypeId: string | null;
    priority: number;
  }[] = [];
  const removedGroupIds: string[] = [];
  let position = 0;

  for (const choice of submitted) {
    const group = byId.get(choice.groupId);
    if (!group) {
      unknownGroupIds.push(choice.groupId);
      continue;
    }
    const priority = choice.employeeTypeId
      ? ++position * GROUP_PRIORITY_STEP
      : group.priority;
    if (group.employeeTypeId && !choice.employeeTypeId) {
      removedGroupIds.push(group.id);
    }
    if (
      group.employeeTypeId !== choice.employeeTypeId ||
      group.priority !== priority
    ) {
      updates.push({
        id: group.id,
        employeeTypeId: choice.employeeTypeId,
        priority
      });
    }
  }
  return { unknownGroupIds, updates, removedGroupIds };
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
