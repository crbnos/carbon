// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Configuration rule fields name the rows they configure, joined by ":":
// `<column>:<lineId>` for a method line or operation field, and
// `billOfMaterial|billOfProcess:<makeMethodId>:<lineId | "undefined">` for a
// node's list. Copying a method gives every row a new id, so its rules are
// re-keyed through a map of old id → new id.

/** Whether a rule field names any of `ids`. */
export function ruleFieldReferences(field: string, ids: Set<string>) {
  return field.split(":").some((part) => ids.has(part));
}

/** The field re-keyed onto the copied rows, or null when it names none of them. */
export function remapRuleField(field: string, idMap: Map<string, string>) {
  const parts = field.split(":");
  if (!parts.some((part) => idMap.has(part))) return null;
  return parts.map((part) => idMap.get(part) ?? part).join(":");
}
