// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Submits one week of an employee's timesheet. Standard mode keeps Phase 1a
// `submitTimesheetEntries`. DCAA mode adds the review check, the total-time
// check against the timecards and the certification row.
// Spec: .ai/specs/implemented/2026-10-09-government-contracting.md (Timekeeping).

import { createHash } from "node:crypto";
import { getCompanyTimeZone } from "@carbon/database";
import { inOrder } from "@carbon/database/rows";
import { datetime, round, timecardShortfall } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { sql } from "kysely";
import { z } from "zod";
import { defineServerFn } from "../define-server-fn";
import { ServerFnError } from "../errors";

export const submitTimesheetWeekInput = z.object({
  employeeId: z.string().min(1),
  /** The week's Monday, `YYYY-MM-DD`. */
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** The text the employee confirmed (DCAA mode). */
  certificationText: z.string().optional()
});

export type SubmitTimesheetWeekResult = {
  /** The entries it submitted. */
  entryIds: string[];
  /** Messages the caller shows; the week is submitted anyway. */
  warnings: string[];
};

export const TIMESHEET_REVIEW_PENDING =
  "Review the changes to your timesheet first";
export const TIMESHEET_CERTIFICATION_CHANGED =
  "The certification text changed. Reload the page";
export const TIMESHEET_CERTIFICATION_MISSING =
  "Set the certification text in Settings → Time before you submit";

/** A refusal the caller can fix: returned as a 422 with its message. */
class TimesheetRefusal extends ServerFnError {
  constructor(message: string) {
    super(message, 422);
  }
}

/** "Your entries account for X h of Y h on your timecards". */
export function timecardShortfallMessage(
  entryHours: number,
  timecardHours: number
): string {
  return `Your entries account for ${round(entryHours)} h of ${round(timecardHours)} h on your timecards`;
}

/** The SHA-256 hex of a certification text, as `timesheetCertification.textHash`. */
export function certificationTextHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Submits an employee's Draft entries of Standard projects in the ISO week
 * that starts on `weekStart`. Service time posts from Draft and is never
 * submitted here.
 *
 * In DCAA mode it first refuses a week with a Pending Employee Review entry,
 * checks the week's entries against the timecard hours (Warn adds a warning,
 * Block refuses), refuses a certification text that is not the current one,
 * and writes a `timesheetCertification` row with the text's hash and the
 * employee's FLSA status.
 */
const submitTimesheetWeek = defineServerFn({
  name: "submit-timesheet-week",
  input: submitTimesheetWeekInput,
  permissions: { update: "projects" },
  async run(ctx, input): Promise<SubmitTimesheetWeekResult> {
    const { db, companyId, userId } = ctx;
    const { employeeId, weekStart } = input;
    const weekEnd = parseDate(weekStart).add({ days: 6 }).toString();

    return db.transaction().execute(async (trx) => {
      const [settings, job] = await inOrder([
        () =>
          trx
            .selectFrom("companySettings")
            .select([
              "timekeepingControls",
              "timeCardEnabled",
              "timesheetTimecardCheck",
              "certificationTextExempt",
              "certificationTextNonExempt"
            ])
            .where("id", "=", companyId)
            .executeTakeFirst(),
        () =>
          trx
            .selectFrom("employeeJob")
            .select("flsaStatus")
            .where("id", "=", employeeId)
            .where("companyId", "=", companyId)
            .executeTakeFirst()
      ]);
      const mode = settings?.timekeepingControls ?? "Standard";

      // Row locks: a save during the submit waits for it.
      const entries = await trx
        .selectFrom("timesheetEntry")
        .innerJoin("project", (join) =>
          join
            .onRef("project.id", "=", "timesheetEntry.projectId")
            .onRef("project.companyId", "=", "timesheetEntry.companyId")
        )
        .select([
          "timesheetEntry.id",
          "timesheetEntry.status",
          "timesheetEntry.hours",
          "project.projectType"
        ])
        .where("timesheetEntry.companyId", "=", companyId)
        .where("timesheetEntry.employeeId", "=", employeeId)
        .where("timesheetEntry.entryDate", ">=", weekStart)
        .where("timesheetEntry.entryDate", "<=", weekEnd)
        .orderBy("timesheetEntry.id")
        .forUpdate("timesheetEntry")
        .execute();

      // A service order's time is posted from its visit page, never here.
      const drafts = entries.filter(
        (entry) => entry.status === "Draft" && entry.projectType === "Standard"
      );
      const warnings: string[] = [];

      if (mode === "DCAA") {
        if (
          entries.some((entry) => entry.status === "Pending Employee Review")
        ) {
          throw new TimesheetRefusal(TIMESHEET_REVIEW_PENDING);
        }

        const check = settings?.timesheetTimecardCheck ?? "Warn";
        if (settings?.timeCardEnabled && check !== "Off") {
          const timezone = await getCompanyTimeZone(trx, companyId);
          const { rows } = await sql<{ hours: number | string | null }>`
            SELECT SUM(EXTRACT(EPOCH FROM ("clockOut" - "clockIn"))) / 3600 AS "hours"
            FROM "timeCardEntry"
            WHERE "companyId" = ${companyId}
              AND "employeeId" = ${employeeId}
              AND "clockOut" IS NOT NULL
              AND ("clockIn" AT TIME ZONE ${timezone})::date
                BETWEEN ${weekStart}::date AND ${weekEnd}::date
          `.execute(trx);
          const timecardHours = Number(rows[0]?.hours ?? 0);
          const entryHours = entries.reduce(
            (sum, entry) => sum + Number(entry.hours),
            0
          );
          if (timecardShortfall(entryHours, timecardHours) > 0) {
            const message = timecardShortfallMessage(entryHours, timecardHours);
            if (check === "Block") throw new TimesheetRefusal(message);
            warnings.push(message);
          }
        }

        if (drafts.length > 0) {
          const flsaStatus = job?.flsaStatus ?? null;
          const text =
            flsaStatus === "Exempt"
              ? settings?.certificationTextExempt
              : settings?.certificationTextNonExempt;
          if (!text)
            throw new TimesheetRefusal(TIMESHEET_CERTIFICATION_MISSING);
          if (input.certificationText !== text) {
            throw new TimesheetRefusal(TIMESHEET_CERTIFICATION_CHANGED);
          }
          await trx
            .insertInto("timesheetCertification")
            .values({
              companyId,
              employeeId,
              weekStart,
              textHash: certificationTextHash(text),
              flsaStatus
            })
            .execute();
        }
      }

      if (drafts.length === 0) return { entryIds: [], warnings };

      const now = datetime.timestamp();
      const submitted = await trx
        .updateTable("timesheetEntry")
        .set({
          status: "Submitted",
          submittedAt: now,
          updatedBy: userId,
          updatedAt: now
        })
        .where("companyId", "=", companyId)
        .where(
          "id",
          "in",
          drafts.map((entry) => entry.id)
        )
        .where("status", "=", "Draft")
        .returning("id")
        .execute();
      return { entryIds: submitted.map((row) => row.id), warnings };
    });
  }
});

export default submitTimesheetWeek;
