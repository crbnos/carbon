// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { IS_LOCAL_DEV } from "@carbon/auth";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { requireEntitlement } from "./entitlements.server";

/**
 * The un-strippable BACKUPS lock. Embedded at the top of every durable
 * backup / restore / import function in `@carbon/jobs` so that RUNNING a backup
 * requires executing this commercial code — the route-level `requireBackupAccess`
 * gate (`apps/erp`) is the friendly UX gate this backstops, and a future direct
 * `trigger()` cannot route around it.
 *
 * Local dev is exempt: the durable functions run with a service-role client and
 * no `email`, so the ERP's internal-staff hatch (`IS_LOCAL_DEV ||
 * isInternalEmail`) cannot be evaluated here — `IS_LOCAL_DEV` preserves the dev
 * workflow, and `companyHasFeature` still passes for Enterprise/Test self-hosted,
 * bypass-listed, and carbon-owned companies. Community/Starter are blocked.
 *
 * The demo-template jobs use the engine's `takeSnapshot` / `revertRun`
 * DIRECTLY (not these gated functions), so templating stays
 * available on every edition — do NOT push this check down into those engine
 * helpers.
 */
export async function requireBackupsEntitlement(
  companyId: string
): Promise<void> {
  if (IS_LOCAL_DEV) return;
  await requireEntitlement(getCarbonServiceRole(), companyId, "BACKUPS");
}
