import { IS_LOCAL_DEV } from "@carbon/auth";
import { isInternalEmail } from "@carbon/utils";

/**
 * The internal-staff / local-dev escape hatch for backups. Backups are a
 * Business/Enterprise feature — the authoritative gate is
 * `canManageBackups` (`~/modules/settings/backups.server`), which is
 * `canAccessBackups(email) || companyHasFeature(BACKUPS)`. This helper stays a
 * pure, browser-safe predicate (no plan/DB read) so it can back Demo Data — which
 * remains internal-only — and be the escape hatch inside `canManageBackups`.
 */
export function canAccessBackups(email: string | null | undefined): boolean {
  return IS_LOCAL_DEV || isInternalEmail(email);
}
