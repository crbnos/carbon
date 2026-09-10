import type { ConformanceCheck, Violation } from "../check";

/**
 * Matches `ADD COLUMN … NOT NULL` where the same column definition carries no
 * `DEFAULT`.
 *
 * `[^,;]*?` cannot cross a comma or a semicolon, so the match is confined to the
 * ONE column definition being added — a `DEFAULT` belonging to a later column in
 * the same `ALTER TABLE` cannot satisfy an earlier one, and a `NOT NULL` in a
 * following statement cannot be attributed to this column.
 *
 * The negative lookahead is applied over that same bounded span, which is what
 * makes "has no DEFAULT" mean "this column has no DEFAULT" rather than "the file
 * has no DEFAULT anywhere".
 *
 * `(?<!\bIS\s+)` excludes `IS NOT NULL`, which is a predicate and not a column
 * constraint. Without it, a generated column whose expression contains
 * `CASE WHEN "x" IS NOT NULL` is reported as a required column — that is a real
 * false positive this check produced on
 * `20250115041610_backfill-release-date.sql`.
 *
 * `GENERATED` columns are skipped outright: a backup can never supply one, and
 * `reportBackupCompatibility` already excludes them for the same reason.
 *
 * Only the `ADD COLUMN` form is checked. A `NOT NULL` column in a `CREATE TABLE`
 * is not a backup-compatibility problem: the table is simply absent from older
 * manifests, which `reportBackupCompatibility` already handles as a separate
 * finding. Detecting "CREATE TABLE for a table that already existed" is not
 * something a regex over one file can do honestly.
 */
const REQUIRED_COLUMN_NO_DEFAULT =
  /ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?(?!(?:[^,;]*?\b(?:DEFAULT|GENERATED)\b))[^,;]*?(?<!\bIS\s+)\bNOT\s+NULL\b/gi;

export const noRequiredColumnWithoutDefault: ConformanceCheck = {
  id: "no-required-column-without-default",
  description:
    "A new NOT NULL column must ship a DEFAULT, so existing backups stay restorable.",
  provenance: {
    deprecates: 'ADD COLUMN "x" TEXT NOT NULL',
    replacedBy: "ADD COLUMN \"x\" TEXT NOT NULL DEFAULT ''"
  },
  scan(file, contents) {
    const violations: Violation[] = [];
    for (const m of contents.matchAll(REQUIRED_COLUMN_NO_DEFAULT)) {
      violations.push({
        file,
        line: contents.slice(0, m.index).split("\n").length,
        snippet: m[0].replace(/\s+/g, " "),
        message:
          "A NOT NULL column with no DEFAULT makes every existing backup unrestorable — the backup has no value to supply for it, so the compatibility gate refuses the whole restore. Add a DEFAULT, or make the column nullable and backfill."
      });
    }
    return violations;
  }
};
