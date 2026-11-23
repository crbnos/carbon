// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { deleteEventSystemSubscriptionsByName } from "@carbon/database/event";
import {
  ensureIssueSyncSubscriptions,
  issueSyncSubscriptionName
} from "../issue-sync/subscriptions";
import { getLinearClient } from "./lib/client";

export async function linearHealthcheck(
  companyId: string,
  _: Record<string, unknown>
) {
  const linear = getLinearClient();
  return await linear.healthcheck(companyId);
}

/**
 * Install and settings-save hook: converge the company's
 * `linear-issue-sync` subscriptions, which drive the outbound push.
 */
export async function linearOnInstall(companyId: string) {
  await ensureIssueSyncSubscriptions(
    getCarbonServiceRole(),
    companyId,
    "linear"
  );
}

export async function linearOnUninstall(companyId: string) {
  await deleteEventSystemSubscriptionsByName(
    getCarbonServiceRole(),
    companyId,
    issueSyncSubscriptionName("linear")
  );
}
