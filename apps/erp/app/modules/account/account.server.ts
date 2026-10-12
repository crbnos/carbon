// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { redis } from "@carbon/kv";
import {
  type ChangelogPanelEntry,
  getChangelogPanelEntry
} from "./account.service";

const CHANGELOG_CACHE_KEY = "changelog:latest";
const CHANGELOG_CACHE_TTL_SECONDS = 300;

export async function getCachedChangelogPanelEntry(): Promise<ChangelogPanelEntry | null> {
  const cached = await redis.get(CHANGELOG_CACHE_KEY);
  if (cached) return JSON.parse(cached) as ChangelogPanelEntry;

  const entry = await getChangelogPanelEntry(getCarbonServiceRole());
  if (entry) {
    await redis.set(
      CHANGELOG_CACHE_KEY,
      JSON.stringify(entry),
      "EX",
      CHANGELOG_CACHE_TTL_SECONDS
    );
  }
  return entry;
}
