// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Pure matching helpers for the CSV import column-mapping step. A column whose
// header names a field maps to it outright; the AI only proposes columns for
// the fields left over, and a proposal never replaces or removes a mapping.

const normalize = (value: string): string => value.toLowerCase().trim();

// Map each field to the file column whose header equals the field's label
// ("Process Type") or its name ("processType"), ignoring case and surrounding
// whitespace. The label is tried first.
export function matchColumnsExactly(
  fields: Record<string, { label: string }>,
  fileColumns: string[]
): Record<string, string> {
  const normalizedColumns = fileColumns.map(normalize);
  const matches: Record<string, string> = {};
  for (const [fieldName, { label }] of Object.entries(fields)) {
    const labelIdx = normalizedColumns.indexOf(normalize(label));
    if (labelIdx !== -1) {
      matches[fieldName] = fileColumns[labelIdx];
      continue;
    }
    const nameIdx = normalizedColumns.indexOf(normalize(fieldName));
    if (nameIdx !== -1) {
      matches[fieldName] = fileColumns[nameIdx];
    }
  }
  return matches;
}

// Add the AI's proposed columns to the current mapping. A proposal fills a
// field only when the field has no column yet, the column is in the file, and
// no field is mapped to that column already (the AI is asked about the
// unmatched columns only). Everything already mapped is kept as it is.
export function mergeSuggestedColumns({
  current,
  suggested,
  fileColumns
}: {
  current: Record<string, string>;
  suggested: Record<string, unknown>;
  fileColumns: string[];
}): Record<string, string> {
  const merged = { ...current };
  const claimed = new Set(Object.values(current));
  for (const [fieldName, column] of Object.entries(suggested)) {
    if (Object.hasOwn(merged, fieldName) && merged[fieldName]) continue;
    if (typeof column !== "string" || !fileColumns.includes(column)) continue;
    if (claimed.has(column)) continue;
    merged[fieldName] = column;
  }
  return merged;
}
