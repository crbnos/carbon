// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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

export function isColumnMapped(column: string | undefined): boolean {
  return !!column && column !== "None" && column !== "N/A";
}

export function isEnumStepAsked(
  field: WizardField,
  columnMappings: Record<string, string | undefined>
): boolean {
  if (field.type !== "enum") return false;
  const dependsOn = field.enumData?.askWhenMapped;
  return !dependsOn || isColumnMapped(columnMappings[dependsOn]);
}
