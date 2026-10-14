// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { AuditLogEntry } from "@carbon/database/audit.types";

/**
 * Whether a diff side holds no real value (null/undefined, empty string,
 * empty object/array). Rendered as a muted "Empty" pill instead of the
 * literal "null" — first-time sets read as "Empty → Net 15", not
 * "null → Net 15". Scalars like 0 and false are real values.
 */
export function isEmptyDiffValue(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

export type AuditLogCsvLabels = {
  columns: {
    date: string;
    changedBy: string;
    action: string;
    record: string;
    recordId: string;
    field: string;
    oldValue: string;
    newValue: string;
  };
  actions: Record<string, string>;
  system: string;
};

type AuditLogCsvEntry = Pick<
  AuditLogEntry,
  "createdAt" | "actorId" | "operation" | "tableName" | "recordId" | "diff"
>;

function toCsvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

/**
 * One CSV row per changed field of each entry (an entry with no changed field
 * gives one row with empty Field / Old / New). Skipped fields are already
 * removed server-side by `sanitizeAuditEntries`.
 */
export function buildAuditLogCsvRows(
  entries: AuditLogCsvEntry[],
  {
    labels,
    nameById,
    getRecordLabel
  }: {
    labels: AuditLogCsvLabels;
    nameById: Map<string, string>;
    getRecordLabel: (tableName: string) => string;
  }
): Record<string, string>[] {
  const { columns, actions, system } = labels;
  return entries.flatMap((entry) => {
    const base = {
      [columns.date]: entry.createdAt,
      [columns.changedBy]:
        !entry.actorId || entry.actorId === "system"
          ? system
          : (nameById.get(entry.actorId) ?? entry.actorId),
      [columns.action]: actions[entry.operation] ?? entry.operation,
      [columns.record]: getRecordLabel(entry.tableName),
      [columns.recordId]: entry.recordId ?? ""
    };
    const fields = Object.keys(entry.diff ?? {});
    if (fields.length === 0) {
      return [
        {
          ...base,
          [columns.field]: "",
          [columns.oldValue]: "",
          [columns.newValue]: ""
        }
      ];
    }
    return fields.map((field) => ({
      ...base,
      [columns.field]: field,
      [columns.oldValue]: toCsvCell(entry.diff?.[field]?.old),
      [columns.newValue]: toCsvCell(entry.diff?.[field]?.new)
    }));
  });
}
