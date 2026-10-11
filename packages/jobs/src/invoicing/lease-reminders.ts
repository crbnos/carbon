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

/** Records the dates the owners were reminded of, so each is sent once. */
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
    // The reminded date is the lease's own date column, so one statement
    // stamps every lease of this kind.
    await db
      .updateTable("lease")
      .set((eb) => ({ [column]: eb.ref(dateColumn) }))
      .where("companyId", "=", companyId)
      .where(
        "id",
        "in",
        stamped.map((r) => r.leaseId)
      )
      .execute();
  }
}

/**
 * Expires every Active lease that has run its course: past its end date,
 * every lease run row posted and no payment left to bill. A lease with a
 * row still to post or a payment still Pending stays Active until both are
 * done, so its last month is never left behind.
 */
export async function expireLeases(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  today: string
): Promise<number> {
  const result = await db
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
          )
        ])
      )
    )
    .executeTakeFirst();
  return Number(result.numUpdatedRows);
}
