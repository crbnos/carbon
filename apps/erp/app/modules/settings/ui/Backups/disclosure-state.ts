import type { CompanyBackupSummary } from "../../backups.service";

/** The word a person types to confirm a restore that discards data. */
export const CONFIRM_WORD = "restore";

export type DisclosureState = {
  /** No verdict — an upload-sourced restore. Say so rather than imply it is clean. */
  unchecked: boolean;
  /** A finding refuses the restore outright. No confirm button is offered. */
  blocked: boolean;
  /** Something in the company today will not exist after. Gates the typed confirm. */
  discards: boolean;
  /** Whether the confirm button may be pressed. */
  canConfirm: boolean;
};

/**
 * Which of the five disclosure states a backup is in.
 *
 * Pure and separate from the component because the states a person most needs to
 * see — discarded columns, a blocked backup — are the hardest to produce by hand.
 */
export function disclosureState(
  backup: CompanyBackupSummary | undefined,
  typed: string
): DisclosureState {
  const findings = backup?.compatibility?.findings ?? [];
  const blocked = findings.some((f) => f.kind === "blocked");
  const discards = findings.some((f) => f.kind === "discarded");

  return {
    // A listed backup normally carries a live verdict (computed in the loader).
    // It is missing only for an upload-sourced restore, or when the schema read
    // failed — both mean "nobody checked", which is not the same as clean.
    unchecked: !backup || !backup.compatibility,
    blocked,
    discards,
    canConfirm:
      !blocked && (!discards || typed.trim().toLowerCase() === CONFIRM_WORD)
  };
}
