// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Which lease dates the daily job reminds the lease's owner about: a notice
// date (the last day to give notice or exercise an option) and the end date,
// each once, when it is `leadDays` away or closer. A date already passed is
// not "coming up" and is never reminded. The lease records the date it last
// reminded for, so a moved date is reminded again. Also what the job reads
// to send them (`loadLeaseReminders`), and the two writes it makes for
// leases: stamping the reminded dates, and expiring the leases that have run
// their course.
// Spec: `.ai/specs/2026-10-11-lessee-leases.md` → Notifications.

import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { parseDate } from "@internationalized/date";
import { sql } from "kysely";

export type LeaseReminderCandidate = {
  id: string;
  noticeDate: string | null;
  /** Null is open-ended: there is no end date to remind of. */
  endDate: string | null;
  noticeRemindedFor: string | null;
  endRemindedFor: string | null;
};

export type LeaseReminder = {
  leaseId: string;
  kind: "notice" | "end";
  /** `YYYY-MM-DD`. */
  date: string;
};

/** `companySettings.leaseReminderDays` when a company has no settings row. */
const DEFAULT_LEASE_REMINDER_DAYS = 90;

/** A right-of-use asset carried at less than this is fully amortized: the
 *  schedule's last closing balance can keep a rounding residue. */
const AMORTIZED_ROU_TOLERANCE = 0.005;

export type LeaseReminderPlan = {
  reminders: LeaseReminder[];
  /** `[leaseId, userId]`: each reminded lease's owner (assignee, else
   *  creator), when they can be notified in this company. */
  owners: [string, string][];
  /** The company's "Also notify" selection. */
  groupIds: string[];
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

/** What the daily job reminds a company's Active leases of today, and to
 *  whom. */
export async function loadLeaseReminders(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  today: string
): Promise<LeaseReminderPlan> {
  const [leases, settings] = await Promise.all([
    db
      .selectFrom("lease")
      .select([
        "id",
        "assignee",
        "createdBy",
        "noticeDate",
        "endDate",
        "noticeRemindedFor",
        "endRemindedFor"
      ])
      .where("companyId", "=", companyId)
      .where("status", "=", "Active")
      .execute(),
    db
      .selectFrom("companySettings")
      .select(["leaseReminderDays", "invoiceNotificationGroup"])
      .where("id", "=", companyId)
      .executeTakeFirst()
  ]);
  const reminders = dueLeaseReminders(
    leases,
    today,
    settings?.leaseReminderDays ?? DEFAULT_LEASE_REMINDER_DAYS
  );
  const groupIds = settings?.invoiceNotificationGroup ?? [];
  if (reminders.length === 0) return { reminders, owners: [], groupIds };

  const remindedIds = new Set(reminders.map((r) => r.leaseId));
  const ownerOf = leases
    .filter((l) => remindedIds.has(l.id))
    .map((l) => ({ id: l.id, owner: l.assignee ?? l.createdBy }))
    .filter((l) => l.owner !== "system");
  const ownerIds = [...new Set(ownerOf.map((l) => l.owner))];
  const members =
    ownerIds.length > 0
      ? await db
          .selectFrom("userToCompany")
          .select("userId")
          .where("companyId", "=", companyId)
          .where("userId", "in", ownerIds)
          .execute()
      : [];
  const memberIds = new Set(members.map((m) => m.userId));
  return {
    reminders,
    owners: ownerOf
      .filter((l) => memberIds.has(l.owner))
      .map((l) => [l.id, l.owner]),
    groupIds
  };
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
                AND l."status" = 'Active'
                AND last."closingRouAsset" > ${AMORTIZED_ROU_TOLERANCE}
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
