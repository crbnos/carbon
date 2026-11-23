// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { deleteEventSystemSubscriptionsByName } from "@carbon/database/event";
import {
  ensureIssueSyncSubscriptions,
  issueSyncSubscriptionName
} from "../issue-sync/subscriptions";
import { getJiraClient } from "./lib/client";

export async function jiraHealthcheck(
  companyId: string,
  _: Record<string, unknown>
) {
  const jira = getJiraClient();
  return await jira.healthcheck(companyId);
}

/**
 * Install and settings-save hook: converge the company's
 * `jira-issue-sync` subscriptions, which drive the outbound push.
 */
export async function jiraOnInstall(companyId: string) {
  await ensureIssueSyncSubscriptions(getCarbonServiceRole(), companyId, "jira");
}

export async function jiraOnUninstall(companyId: string) {
  await deleteEventSystemSubscriptionsByName(
    getCarbonServiceRole(),
    companyId,
    issueSyncSubscriptionName("jira")
  );
}
