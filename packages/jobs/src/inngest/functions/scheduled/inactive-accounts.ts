import { parseAbsolute, type ZonedDateTime } from "@internationalized/date";

/**
 * A single employee membership considered for inactivity auto-deactivation
 * (NIST 800-171 3.5.6 / AC-2(3)).
 *
 * `lastSignInAt` is the most recent GoTrue login instant for the account, or
 * `null` when there is no login record. `createdAt` is the account's creation
 * instant and acts as the activity floor: a never-logged-in account is judged
 * from when it was created, so a freshly invited account is not disabled the
 * moment it is created, while a long-abandoned invite still is.
 */
export type InactiveAccountCandidate = {
  userId: string;
  companyId: string;
  /** Most recent login instant (ISO 8601 UTC), or null if none is recorded. */
  lastSignInAt: string | null;
  /** Account creation instant (ISO 8601 UTC) — the floor when no login exists. */
  createdAt: string;
  /**
   * Console/device/admin/developer accounts are never auto-disabled. The caller
   * computes this from `user.isConsoleOperator | admin | developer`.
   */
  protected: boolean;
};

export type SelectInactiveAccountsOptions = {
  /** Current instant (ISO 8601 UTC), e.g. `datetime.timestamp()`. */
  nowIso: string;
  /** Idle threshold in whole days. Non-positive / non-finite disables selection. */
  thresholdDays: number;
  /**
   * Accounts that must never be auto-disabled regardless of idleness — the
   * system/acting/service account ids.
   */
  systemUserIds?: string[];
};

export type InactiveAccountSelection = {
  userId: string;
  companyId: string;
  /** The activity instant used for the decision (`lastSignInAt ?? createdAt`). */
  lastActivityAt: string;
};

function parseInstant(value: string): ZonedDateTime | null {
  try {
    return parseAbsolute(value, "UTC");
  } catch {
    return null;
  }
}

/**
 * Pure selection: given candidate memberships and a threshold, return the ones
 * that should be auto-deactivated. No I/O — the reason it is unit-tested in
 * isolation while the surrounding cleanup step (DB reads, deactivation writes)
 * is not.
 *
 * An account is selected iff its effective activity instant
 * (`lastSignInAt ?? createdAt`) is STRICTLY older than `now - thresholdDays`,
 * it is not `protected`, and it is not in `systemUserIds`. A safety guard
 * returns nothing when the threshold is not a positive finite number, so a
 * misconfiguration can never trigger a mass deactivation.
 */
export function selectInactiveAccounts(
  candidates: InactiveAccountCandidate[],
  options: SelectInactiveAccountsOptions
): InactiveAccountSelection[] {
  const { nowIso, thresholdDays, systemUserIds = [] } = options;

  if (!Number.isFinite(thresholdDays) || thresholdDays <= 0) {
    return [];
  }

  const now = parseInstant(nowIso);
  if (now === null) {
    return [];
  }
  const cutoff = now.subtract({ days: thresholdDays });
  const excluded = new Set(systemUserIds);

  const selections: InactiveAccountSelection[] = [];
  for (const candidate of candidates) {
    if (candidate.protected) continue;
    if (excluded.has(candidate.userId)) continue;

    const lastActivityAt = candidate.lastSignInAt ?? candidate.createdAt;
    const activity = parseInstant(lastActivityAt);
    // Bad data must never cause a deactivation.
    if (activity === null) continue;

    if (activity.compare(cutoff) < 0) {
      selections.push({
        userId: candidate.userId,
        companyId: candidate.companyId,
        lastActivityAt
      });
    }
  }

  return selections;
}
