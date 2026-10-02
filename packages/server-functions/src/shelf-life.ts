// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { KyselyDatabase } from "@carbon/database/client";
import { type CalendarDate, parseDate } from "@internationalized/date";
import type { Kysely } from "kysely";

export type ExpiredEntityPolicy = "Warn" | "Block" | "BlockWithOverride";

/** An operator's request to consume or move expired material anyway. */
export type ExpiryOverride = { allowed: boolean; reason: string | null };

/**
 * The company's expired-entity policy (`companySettings.inventoryShelfLife`).
 * `Block` when unset, so the safe behavior is the default.
 */
export async function getExpiredEntityPolicy(
  db: Kysely<KyselyDatabase>,
  companyId: string
): Promise<ExpiredEntityPolicy> {
  const row = await db
    .selectFrom("companySettings")
    .select("inventoryShelfLife")
    .where("id", "=", companyId)
    .executeTakeFirst();
  const settings = row?.inventoryShelfLife as {
    expiredEntityPolicy?: ExpiredEntityPolicy;
  } | null;
  return settings?.expiredEntityPolicy ?? "Block";
}

/** The entities that expired before `today`; an unparseable date never counts. */
export function expiredEntities<E extends { expirationDate: string | null }>(
  entities: E[],
  today: CalendarDate
): E[] {
  return entities.filter(({ expirationDate }) => {
    if (!expirationDate) return false;
    try {
      return parseDate(expirationDate).compare(today) < 0;
    } catch {
      return false;
    }
  });
}

/**
 * What the policy does with expired material: `warn` under `Warn`, `allow`
 * under `BlockWithOverride` when the override carries a reason, else `block`.
 */
export function expiryVerdict(
  policy: ExpiredEntityPolicy,
  override: ExpiryOverride
): "warn" | "allow" | "block" {
  if (policy === "Warn") return "warn";
  if (
    policy === "BlockWithOverride" &&
    override.allowed &&
    (override.reason?.trim().length ?? 0) > 0
  ) {
    return "allow";
  }
  return "block";
}
