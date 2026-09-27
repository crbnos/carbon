import { IS_LOCAL_DEV } from "@carbon/auth";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { requireEntitlement } from "./entitlements.server";

/**
 * The un-strippable BACKUPS lock. Embedded at the top of every durable
 * backup / restore / import function in `@carbon/jobs` so that RUNNING a backup
 * requires executing this commercial code — the route-level `canManageBackups`
 * gate (`apps/erp`) is the friendly UX gate this backstops, and a future direct
 * `trigger()` cannot route around it.
 *
 * Local dev is exempt: the durable functions run with a service-role client and
 * no `email`, so the internal-staff hatch (`canAccessBackups` = `IS_LOCAL_DEV ||
 * isInternalEmail`) cannot be evaluated here — `IS_LOCAL_DEV` preserves the dev
 * workflow, and `companyHasFeature` still passes for Enterprise/Test self-hosted,
 * bypass-listed, and carbon-owned companies. Community/Starter are blocked.
 *
 * Onboarding's demo-template apply/revert call `buildCompanyBackup` /
 * `wipeAndLoad` DIRECTLY (not these gated functions), so templating stays
 * available on every edition — do NOT push this check down into those engine
 * helpers.
 */
export async function requireBackupsEntitlement(
  companyId: string
): Promise<void> {
  if (IS_LOCAL_DEV) return;
  await requireEntitlement(getCarbonServiceRole(), companyId, "BACKUPS");
}
