import { IS_LOCAL_DEV } from "@carbon/auth";
import { isInternalEmail } from "@carbon/utils";

/**
 * Backups/restores stay internal-only in real deployments while the
 * multi-tenant caveats are unhardened, but any user can exercise them on a
 * local dev stack. Shared by the route gates, the backup API loaders, and the
 * settings nav so they can never diverge.
 */
export function canAccessBackups(email: string | null | undefined): boolean {
  return IS_LOCAL_DEV || isInternalEmail(email);
}
