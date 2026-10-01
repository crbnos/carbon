// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Copyright (C) Carbon Manufacturing Systems Corporation.
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { getJiraClient } from "./lib/client";

export async function jiraHealthcheck(
  companyId: string,
  _: Record<string, unknown>
) {
  const jira = getJiraClient();
  return await jira.healthcheck(companyId);
}
