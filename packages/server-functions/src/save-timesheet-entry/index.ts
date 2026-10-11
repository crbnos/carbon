// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Saves one timesheet cell: the one write path of a timesheet entry for the
// ERP and the MES, so the DCAA timekeeping controls live in one place.
// Standard mode keeps the Phase 1a grid behavior exactly. DCAA mode adds the
// entry window, the late reason, charge restrictions, supervisor entry on a
// recorded absence, Pending Employee Review and the correction trail.
// Spec: .ai/specs/2026-10-09-government-contracting.md (Timekeeping).

import { getCompanyTimeZone } from "@carbon/database";
import type { KyselyDatabase as DB } from "@carbon/database/client";
import { toJson } from "@carbon/database/json";
import { inOrder } from "@carbon/database/rows";
import {
  datetime,
  isEntryDateAllowed,
  nextEntryStatus,
  TIMESHEET_REFUSAL_NOT_DRAFT,
  type TimesheetEntryStatus
} from "@carbon/utils";
import type { Selectable, Transaction } from "kysely";
import { z } from "zod";
import { defineServerFn } from "../define-server-fn";
import { NotFoundError, ServerFnError } from "../errors";

export const saveTimesheetEntryInput = z.object({
  employeeId: z.string().min(1),
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  projectId: z.string().min(1),
  projectElementId: z.string().min(1).nullable(),
  laborCategoryId: z.string().min(1),
  hours: z.number().min(0).max(24),
  note: z.string().optional(),
  /** Required when the date is late in DCAA mode. */
  lateReason: z.string().optional(),
  /** Required to change a saved entry in DCAA mode. */
  reason: z.string().optional()
});

export type SaveTimesheetEntryResult = {
  /** Null when nothing was saved (0 hours on an empty cell) or the entry was deleted. */
  entryId: string | null;
  status: TimesheetEntryStatus | null;
};

export const TIMESHEET_FUTURE_DATE = "Time cannot be entered for a future date";
export const TIMESHEET_LATE_REASON_REQUIRED =
  "Give a reason for the late entry";
export const TIMESHEET_CHANGE_REASON_REQUIRED = "Give a reason for the change";
export const TIMESHEET_SUPERVISOR_ENTRY_REFUSED =
  "You can enter time for another employee only on a day of recorded absence";

/** A refusal the caller can fix: returned as a 422 with its message. */
class TimesheetRefusal extends ServerFnError {
  constructor(message: string) {
    super(message, 422);
  }
}

type EntryRow = Pick<
  Selectable<DB["timesheetEntry"]>,
  | "id"
  | "status"
  | "hours"
  | "projectElementId"
  | "laborCategoryId"
  | "entryDate"
>;

/** The fields a revision records, before and after a change. */
function revisionFields(entry: {
  hours: number | string;
  projectElementId: string | null;
  laborCategoryId: string;
  entryDate: string;
}) {
  return {
    hours: Number(entry.hours),
    projectElementId: entry.projectElementId,
    laborCategoryId: entry.laborCategoryId,
    entryDate: entry.entryDate
  };
}

/**
 * The entry a cell edits: a Draft first, then Rejected, Pending Employee
 * Review, Submitted and Approved. A Posted entry only when no other exists,
 * so the refusal can name it (a posted entry changes only by correction).
 */
function currentEntry(rows: EntryRow[]): EntryRow | null {
  const order: TimesheetEntryStatus[] = [
    "Draft",
    "Rejected",
    "Pending Employee Review",
    "Submitted",
    "Approved",
    "Posted"
  ];
  for (const status of order) {
    const row = rows.find((candidate) => candidate.status === status);
    if (row) return row;
  }
  return null;
}

/**
 * Saves one cell of an employee's timesheet (employee, date, charge number,
 * labor category). Saving never posts.
 *
 * - **Standard mode** (Phase 1a): a new cell inserts a Draft; a Draft or
 *   Rejected entry is updated to Draft, or deleted at 0 hours; a Submitted,
 *   Approved or Posted entry is refused. No revision.
 * - **DCAA mode**: no future dates (except on a leave element); a date
 *   outside the entry window needs a late reason; a project that restricts
 *   charging takes time only from its members; another user may create an
 *   entry only on the employee's recorded absence; every change to a saved
 *   entry needs a reason and writes one `timesheetEntryRevision` row in the
 *   same transaction. A change by anyone but the owner gives Pending Employee
 *   Review; the owner's change returns the entry to Draft.
 */
const saveTimesheetEntry = defineServerFn({
  name: "save-timesheet-entry",
  input: saveTimesheetEntryInput,
  permissions: { update: "projects" },
  async run(ctx, input): Promise<SaveTimesheetEntryResult> {
    const { db, companyId, userId } = ctx;
    return db
      .transaction()
      .execute((trx) => save(trx, { ...input, companyId, userId }));
  }
});

export default saveTimesheetEntry;

async function save(
  trx: Transaction<DB>,
  input: z.output<typeof saveTimesheetEntryInput> & {
    companyId: string;
    userId: string;
  }
): Promise<SaveTimesheetEntryResult> {
  const { companyId, userId, employeeId } = input;
  const actorIsOwner = userId === employeeId;

  const settings = await trx
    .selectFrom("companySettings")
    .select(["timekeepingControls", "timesheetEntryWindowDays"])
    .where("id", "=", companyId)
    .executeTakeFirst();
  const mode = settings?.timekeepingControls ?? "Standard";

  let existingQuery = trx
    .selectFrom("timesheetEntry")
    .select([
      "id",
      "status",
      "hours",
      "projectElementId",
      "laborCategoryId",
      "entryDate"
    ])
    .where("companyId", "=", companyId)
    .where("employeeId", "=", employeeId)
    .where("entryDate", "=", input.entryDate)
    .where("projectId", "=", input.projectId)
    .where("laborCategoryId", "=", input.laborCategoryId)
    .where("reversalOfId", "is", null);
  existingQuery = input.projectElementId
    ? existingQuery.where("projectElementId", "=", input.projectElementId)
    : existingQuery.where("projectElementId", "is", null);
  const rows = await existingQuery.orderBy("id").forUpdate().execute();
  const current = currentEntry(rows);

  if (mode === "Standard") {
    return saveStandard(trx, input, rows, actorIsOwner);
  }

  const next = nextEntryStatus({
    mode,
    current: current?.status ?? null,
    actorIsOwner
  });
  if (typeof next !== "string") throw new TimesheetRefusal(next.refuse);

  // Nothing to save, nothing to change.
  if (!current && input.hours === 0) return { entryId: null, status: null };

  const [project, element, timezone] = await inOrder([
    () =>
      trx
        .selectFrom("project")
        .select(["identifier", "name", "restrictCharging"])
        .where("id", "=", input.projectId)
        .where("companyId", "=", companyId)
        .executeTakeFirst(),
    () =>
      input.projectElementId
        ? trx
            .selectFrom("projectElement")
            .select(["isLeave"])
            .where("id", "=", input.projectElementId)
            .where("projectId", "=", input.projectId)
            .where("companyId", "=", companyId)
            .executeTakeFirst()
        : Promise.resolve(null),
    () => getCompanyTimeZone(trx, companyId)
  ]);
  if (!project) throw new NotFoundError("The project does not exist");
  if (input.projectElementId && !element) {
    throw new NotFoundError("The element does not exist");
  }

  // 1–2. The entry window.
  const entryWindow = isEntryDateAllowed({
    entryDate: input.entryDate,
    today: datetime.today(timezone).toString(),
    windowDays: settings?.timesheetEntryWindowDays ?? 1,
    isLeave: element?.isLeave ?? false
  });
  if (!entryWindow.allowed) throw new TimesheetRefusal(TIMESHEET_FUTURE_DATE);
  const lateReason = input.lateReason?.trim() || null;
  if (entryWindow.late && !lateReason) {
    throw new TimesheetRefusal(TIMESHEET_LATE_REASON_REQUIRED);
  }

  // 3. Charge restrictions.
  if (project.restrictCharging) {
    const member = await trx
      .selectFrom("projectMember")
      .select("userId")
      .where("projectId", "=", input.projectId)
      .where("userId", "=", employeeId)
      .where("companyId", "=", companyId)
      .executeTakeFirst();
    if (!member) {
      throw new TimesheetRefusal(
        `${project.identifier || project.name} accepts time only from its members`
      );
    }
  }

  const reason = input.reason?.trim() || null;
  const now = datetime.timestamp();

  // 4. A new entry.
  if (!current) {
    if (!actorIsOwner) {
      const absence = await trx
        .selectFrom("peopleAbsence")
        .select("id")
        .where("companyId", "=", companyId)
        .where("employeeId", "=", employeeId)
        .where("date", "=", input.entryDate)
        .executeTakeFirst();
      if (!absence) {
        throw new TimesheetRefusal(TIMESHEET_SUPERVISOR_ENTRY_REFUSED);
      }
      if (!reason) throw new TimesheetRefusal(TIMESHEET_CHANGE_REASON_REQUIRED);
    }
    const created = await trx
      .insertInto("timesheetEntry")
      .values({
        companyId,
        employeeId,
        entryDate: input.entryDate,
        projectId: input.projectId,
        projectElementId: input.projectElementId,
        laborCategoryId: input.laborCategoryId,
        hours: input.hours,
        note: input.note ?? null,
        lateReason: entryWindow.late ? lateReason : null,
        status: next,
        createdBy: userId,
        createdAt: now
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    // 5. The owner's first save is not a change: no revision.
    if (!actorIsOwner) {
      await writeRevision(trx, {
        companyId,
        employeeId,
        timesheetEntryId: created.id,
        revisedBy: userId,
        reason: reason!,
        before: null,
        after: revisionFields(input)
      });
    }
    return { entryId: created.id, status: next };
  }

  // 5. A change to a saved entry.
  if (!reason) throw new TimesheetRefusal(TIMESHEET_CHANGE_REASON_REQUIRED);
  const before = revisionFields(current);

  // 7. Zero hours deletes the entry; the revision is written first.
  if (input.hours === 0) {
    await writeRevision(trx, {
      companyId,
      employeeId,
      timesheetEntryId: current.id,
      revisedBy: userId,
      reason,
      before,
      after: null
    });
    await trx
      .deleteFrom("timesheetEntry")
      .where("id", "=", current.id)
      .where("companyId", "=", companyId)
      .execute();
    return { entryId: null, status: null };
  }

  await trx
    .updateTable("timesheetEntry")
    .set({
      hours: input.hours,
      note: input.note ?? null,
      ...(entryWindow.late ? { lateReason } : {}),
      status: next,
      // A changed entry needs approval again.
      submittedAt: null,
      approvedBy: null,
      approvedAt: null,
      rejectionNote: null,
      updatedBy: userId,
      updatedAt: now
    })
    .where("id", "=", current.id)
    .where("companyId", "=", companyId)
    .execute();
  // 6. The correction trail, in the same transaction.
  await writeRevision(trx, {
    companyId,
    employeeId,
    timesheetEntryId: current.id,
    revisedBy: userId,
    reason,
    before,
    after: revisionFields({ ...current, hours: input.hours })
  });
  return { entryId: current.id, status: next };
}

/** Phase 1a `upsertTimesheetCell`, unchanged. */
async function saveStandard(
  trx: Transaction<DB>,
  input: z.output<typeof saveTimesheetEntryInput> & {
    companyId: string;
    userId: string;
  },
  rows: EntryRow[],
  actorIsOwner: boolean
): Promise<SaveTimesheetEntryResult> {
  const { companyId, userId } = input;
  const editable =
    rows.find((row) => row.status === "Draft") ??
    rows.find((row) => row.status === "Rejected");

  // Standard mode has no supervisor entry: the owner edits their own time.
  if (!actorIsOwner) throw new TimesheetRefusal(TIMESHEET_REFUSAL_NOT_DRAFT);

  if (!editable) {
    if (rows.some((row) => row.status === "Posted")) {
      throw new TimesheetRefusal(
        "This time is posted. Use a correction to change posted hours."
      );
    }
    if (rows.length > 0) {
      throw new TimesheetRefusal(
        "This time is submitted. It can change only after it is rejected."
      );
    }
    if (input.hours === 0) return { entryId: null, status: null };
    const created = await trx
      .insertInto("timesheetEntry")
      .values({
        companyId,
        employeeId: input.employeeId,
        entryDate: input.entryDate,
        projectId: input.projectId,
        projectElementId: input.projectElementId,
        laborCategoryId: input.laborCategoryId,
        hours: input.hours,
        note: input.note ?? null,
        status: "Draft",
        createdBy: userId
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    return { entryId: created.id, status: "Draft" };
  }

  if (input.hours === 0) {
    await trx
      .deleteFrom("timesheetEntry")
      .where("id", "=", editable.id)
      .where("companyId", "=", companyId)
      .where("status", "in", ["Draft", "Rejected"])
      .execute();
    return { entryId: null, status: null };
  }

  await trx
    .updateTable("timesheetEntry")
    .set({
      hours: input.hours,
      note: input.note ?? null,
      status: "Draft",
      rejectionNote: null,
      updatedBy: userId,
      updatedAt: datetime.timestamp()
    })
    .where("id", "=", editable.id)
    .where("companyId", "=", companyId)
    .where("status", "in", ["Draft", "Rejected"])
    .execute();
  return { entryId: editable.id, status: "Draft" };
}

async function writeRevision(
  trx: Transaction<DB>,
  args: {
    companyId: string;
    employeeId: string;
    timesheetEntryId: string;
    revisedBy: string;
    reason: string;
    before: ReturnType<typeof revisionFields> | null;
    after: ReturnType<typeof revisionFields> | null;
  }
): Promise<void> {
  await trx
    .insertInto("timesheetEntryRevision")
    .values({
      companyId: args.companyId,
      timesheetEntryId: args.timesheetEntryId,
      employeeId: args.employeeId,
      revisedBy: args.revisedBy,
      reason: args.reason,
      before: toJson(args.before) ?? null,
      after: toJson(args.after) ?? null
    })
    .execute();
}
