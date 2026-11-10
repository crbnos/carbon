// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { RowsByTable } from "@carbon/jobs/backups";
import { formatDate } from "@carbon/utils";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";

// Backup folder names are `{timestamp}_{label-slug}`. Turn the slug back into a
// readable title (the timestamp is shown separately as the date).
const BACKUP_ACRONYMS = new Set([
  "oem",
  "amr",
  "scara",
  "cad",
  "bom",
  "erp",
  "mes",
  "ai",
  "qa"
]);

export function formatBackupName(name: string): string {
  const underscore = name.indexOf("_");
  const slug = underscore >= 0 ? name.slice(underscore + 1) : "";
  if (!slug) return "Untitled backup";
  return slug
    .split("-")
    .filter(Boolean)
    .map((word) =>
      BACKUP_ACRONYMS.has(word.toLowerCase())
        ? word.toUpperCase()
        : word.charAt(0).toUpperCase() + word.slice(1)
    )
    .join(" ");
}

/** "45s" / "2m 07s" — how long a long-running settings job has been going.
 *  Shared by the backup progress dialog and the demo-data review row. */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`;
}

/**
 * The ONLY words a backup row is allowed to say about itself. Anything a
 * person reads here they may act on, so the vocabulary is closed: a new state
 * gets added here, with copy, rather than invented at a call site. (A failed
 * EXPORT never becomes a row — it renders as the failure banner instead.)
 */
export type BackupStatus =
  | "ready"
  | "restorable-with-changes"
  | "not-restorable"
  | "incomplete";

const STATUS_LABELS: Record<BackupStatus, MessageDescriptor> = {
  ready: msg`Ready`,
  "restorable-with-changes": msg`Restorable with changes`,
  "not-restorable": msg`Not restorable`,
  incomplete: msg`Incomplete`
};

/** Resolve at the render site with `useLingui().t(...)`. */
export function backupStatusLabel(status: BackupStatus): MessageDescriptor {
  return STATUS_LABELS[status];
}

/** Which badge color a status wears. */
export function backupStatusVariant(
  status: BackupStatus
): "green" | "yellow" | "red" | "secondary" {
  switch (status) {
    case "ready":
      return "green";
    case "restorable-with-changes":
      return "yellow";
    case "not-restorable":
      return "red";
    case "incomplete":
      return "secondary";
  }
}

/** A backup's timestamp for display, in the viewer's `locale`. */
export function formatBackupDate(
  iso: string | null | undefined,
  locale: string,
  withTime = true
): string {
  return formatDate(
    iso,
    withTime
      ? { dateStyle: "medium", timeStyle: "short" }
      : { dateStyle: "medium" },
    locale
  );
}

/**
 * How many ROWS a skip or purge affects. `violations`/`excludedRows` are per FK
 * EDGE — a row escaping scope through three of its foreign keys appears three
 * times there — so totals must come from the per-table distinct counts.
 */
export function totalScopeRows(rowsByTable: RowsByTable): number {
  return rowsByTable.reduce((sum, t) => sum + t.rows, 0);
}
