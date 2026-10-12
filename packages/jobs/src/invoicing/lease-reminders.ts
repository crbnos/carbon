// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Which lease dates the daily job reminds the lease's owner about: a notice
// date (the last day to give notice or exercise an option) and the end date,
// each once, when it is `leadDays` away or closer. A date already passed is
// not "coming up" and is never reminded. The lease records the date it last
// reminded for, so a moved date is reminded again. Also the two writes the
// job makes for leases: stamping the reminded dates, and expiring the leases
// that have run their course.
// Spec: `.ai/specs/2026-10-11-lessee-leases.md` → Notifications.

import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { parseDate } from "@internationalized/date";
import { sql } from "kysely";

export type LeaseReminderCandidate = {
  id: string;
  noticeDate: string | null;
  endDate: string;
  noticeRemindedFor: string | null;
  endRemindedFor: string | null;
};

export type LeaseReminder = {
  leaseId: string;
  kind: "notice" | "end";
  /** `YYYY-MM-DD`. */
  date: string;
};

/** @param today `YYYY-MM-DD` in the company's timezone. */
export function dueLeaseReminders(
  leases: LeaseReminderCandidate[],
  today: string,
  leadDays: number
): LeaseReminder[] {
  const horizon = parseDate(today).add({ days: leadDays }).toString();
  // `YYYY-MM-DD` strings order chronologically.
  const isComing = (date: string | null): date is string =>
    date !== null && date >= today && date <= horizon;

  const reminders: LeaseReminder[] = [];
  for (const lease of leases) {
    if (
      isComing(lease.noticeDate) &&
      lease.noticeRemindedFor !== lease.noticeDate
    ) {
      reminders.push({
        leaseId: lease.id,
        kind: "notice",
        date: lease.noticeDate
      });
    }
    if (isComing(lease.endDate) && lease.endRemindedFor !== lease.endDate) {
      reminders.push({ leaseId: lease.id, kind: "end", date: lease.endDate });
    }
  }
  return reminders;
}

/** Records the dates the owners were reminded of, so each is sent once. A
 *  date that moved since the reminder was read is left unstamped, so the
 *  new date is reminded too. */
export async function stampLeaseReminders(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  reminders: LeaseReminder[]
): Promise<void> {
  for (const kind of ["notice", "end"] as const) {
    const stamped = reminders.filter((r) => r.kind === kind);
    if (stamped.length === 0) continue;
    const column = kind === "notice" ? "noticeRemindedFor" : "endRemindedFor";
    const dateColumn = kind === "notice" ? "noticeDate" : "endDate";
    const values = sql.join(
      stamped.map((r) => sql`(${r.leaseId}, ${r.date}::date)`)
    );
    await sql`
      UPDATE "lease" SET ${sql.ref(column)} = v.date
      FROM (VALUES ${values}) AS v(id, date)
      WHERE "lease"."id" = v.id
        AND "lease"."companyId" = ${companyId}
        AND "lease".${sql.ref(dateColumn)} = v.date
    `.execute(db);
  }
}

/**
 * Expires every Active lease that has run its course: past its end date,
 * every lease run row posted, no payment left to bill, and no active asset
 * whose right-of-use asset is still on the books (an asset the lessee will
 * own amortizes over its useful life and ends with a Purchase). A lease with
 * any of these stays Active, so its last month is never left behind. Its
 * active assets expire with it.
 */
export async function expireLeases(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  today: string
): Promise<number> {
  return db.transaction().execute(async (trx) => {
    const expired = await trx
      .updateTable("lease")
      .set({
        status: "Expired",
        closedAt: sql`now()`,
        updatedBy: "system",
        updatedAt: sql`now()`
      })
      .where("companyId", "=", companyId)
      .where("status", "=", "Active")
      .where("endDate", "<", today)
      .where((eb) =>
        eb.not(
          eb.or([
            eb.exists(
              eb
                .selectFrom("revenueRecognitionSchedule as r")
                .select("r.id")
                .whereRef("r.leaseId", "=", "lease.id")
                .whereRef("r.companyId", "=", "lease.companyId")
                .where("r.status", "<>", "Posted")
            ),
            eb.exists(
              eb
                .selectFrom("leasePayment as p")
                .select("p.id")
                .whereRef("p.leaseId", "=", "lease.id")
                .whereRef("p.companyId", "=", "lease.companyId")
                .where("p.status", "=", "Pending")
            ),
            sql<boolean>`EXISTS (
              SELECT 1 FROM "leaseLine" l
              CROSS JOIN LATERAL (
                SELECT sl."closingRouAsset" FROM "leaseScheduleLine" sl
                WHERE sl."leaseLineId" = l."id" AND sl."companyId" = l."companyId"
                ORDER BY sl."periodDate" DESC LIMIT 1
              ) last
              WHERE l."leaseId" = "lease"."id" AND l."companyId" = "lease"."companyId"
                AND l."status" = 'Active' AND last."closingRouAsset" > 0.005
            )`
          ])
        )
      )
      .returning("id")
      .execute();
    if (expired.length === 0) return 0;
    await trx
      .updateTable("leaseLine")
      .set({
        status: "Expired",
        updatedBy: "system",
        updatedAt: sql`now()`
      })
      .where("companyId", "=", companyId)
      .where("status", "=", "Active")
      .where(
        "leaseId",
        "in",
        expired.map((row) => row.id)
      )
      .execute();
    return expired.length;
  });
}
