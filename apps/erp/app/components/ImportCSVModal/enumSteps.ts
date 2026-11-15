// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// What the wizard needs to know about a field to decide whether it asks
// for the field's values in a step of their own.
type WizardField = {
  type: string;
  enumData?: {
    description?: string;
    options?: readonly string[];
    fetcher?: unknown;
    /** Ask for this field's values only while that field's column is mapped. */
    askWhenMapped?: string;
  };
};

/** Whether a field's column mapping names a CSV column ("None" leaves it unmapped). */
export function isColumnMapped(column: string | undefined): boolean {
  return !!column && column !== "None" && column !== "N/A";
}

/**
 * Whether the wizard gives an enum field a step of its own. An enum field
 * with `askWhenMapped` is asked only while that other field's column is
 * mapped; every other enum field is always asked.
 */
export function isEnumStepAsked(
  field: WizardField,
  columnMappings: Record<string, string | undefined>
): boolean {
  if (field.type !== "enum") return false;
  const dependsOn = field.enumData?.askWhenMapped;
  return !dependsOn || isColumnMapped(columnMappings[dependsOn]);
}
