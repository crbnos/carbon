// The Onshape BOM import's RESULT, and how it reads to a person.
//
// Kept out of the job module because importing that boots the Inngest client,
// which requires signing keys — so anything unit-tested has to live here, the
// same reason `onshape-matching.ts` is its own file.

export type OnshapeBomImportOutcome = {
  imported: number;
  created: number;
  /** Existing Carbon parts this import LINKED rather than created. */
  adopted: number;
  updated: number;
  removed: number;
  assetsAttached: number;
  assetsSkipped: number;
  /** Rows Onshape sent that could not be read at all. */
  unreadableRows: number;
  /** Existing lines left untouched because their row was refused. */
  protectedLines: number;
  /** Rows the import refused, each with why. */
  skipped: Array<{ partNumber: string; revision: string; reason: string }>;
};

/** How many refusals to name before the rest become a count. */
const MAX_LISTED_SKIPS = 5;

/**
 * One paragraph a person can act on.
 *
 * Names the parts rather than counting them — "2 rows skipped" tells the user
 * something is wrong but not what to go fix, and the reason is the whole point
 * of having refused the row.
 */
export function summarizeOutcomeForUser(
  outcome: OnshapeBomImportOutcome
): string {
  const parts: string[] = [
    `${outcome.imported} line(s) imported, ${outcome.created} part(s) created`
  ];

  // Adopted parts were NOT created — reporting them as created tells the user
  // this import made something it merely linked to.
  if (outcome.adopted > 0) {
    parts.push(
      `${outcome.adopted} existing part(s) linked to Onshape rather than created`
    );
  }

  if (outcome.protectedLines > 0) {
    parts.push(
      `${outcome.protectedLines} existing line(s) left untouched because their Onshape row was refused`
    );
  }
  if (outcome.unreadableRows > 0) {
    parts.push(
      `${outcome.unreadableRows} Onshape row(s) could not be read, so nothing was removed`
    );
  }

  // GROUPED by reason. One assembly refused for one cause produces the same
  // sentence per row, and eight copies of it is a wall the reader skims past —
  // the parts are what differ, so the parts are what should be listed.
  const byReason = new Map<string, string[]>();
  for (const skip of outcome.skipped) {
    const name = skip.revision
      ? `${skip.partNumber}.${skip.revision}`
      : skip.partNumber;
    byReason.set(skip.reason, [...(byReason.get(skip.reason) ?? []), name]);
  }

  for (const [reason, names] of byReason) {
    const listed = names.slice(0, MAX_LISTED_SKIPS).join(", ");
    const remaining = names.length - MAX_LISTED_SKIPS;
    parts.push(
      remaining > 0
        ? `${listed} and ${remaining} more — ${reason}`
        : `${listed} — ${reason}`
    );
  }

  return parts.join(". ");
}
