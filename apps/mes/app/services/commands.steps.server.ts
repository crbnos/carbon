// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import type {
  NoteBody,
  PrintBody,
  QualityIssueBody,
  StepRecordBody
} from "@carbon/mes-core/models";
import { NotificationEvent } from "@carbon/notifications";
import { datetime } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { nanoid } from "nanoid";
import type { CommandResult } from "./api-result.server";
import { failed, ok } from "./api-result.server";
import {
  backflushUntrackedMaterialsOnStepRecord,
  deleteAttributeRecord,
  insertAttributeRecord
} from "./operations.service";
import { createQualityIssue } from "./quality.server";

/**
 * Step records, operation notes, quality issues and label printing — extracted
 * from `x+/record.tsx`, `x+/record.$id.delete.tsx`, `x+/quality-issue.new.tsx`
 * and `x+/print.tsx` so the web MES and the mobile API run ONE code path. See
 * `commands.server.ts` for the contract.
 *
 * `client` is the SERVICE ROLE client in every caller, exactly as those web
 * routes use it, so every read and write here filters `companyId` itself.
 *
 * `addOperationNote` is the one command with NO web route behind it: the web
 * Chat tab (`components/JobOperation/components/Chat.tsx`) inserts the row from
 * the browser as the signed-in user and then POSTs the ERP's
 * `api/messaging/notify`. That is wrong for a shared tablet, where the note
 * belongs to the PINNED operator rather than to the terminal's session, so the
 * API path does both halves server-side. `Chat.tsx` is unchanged.
 */

const log = getLogger("mes", "commands.steps");

type Scope = { companyId: string; userId: string };

/**
 * Record one step attribute, then auto-issue the untracked materials that step
 * owns.
 *
 * Recording a step auto-issues one unit's worth of the untracked materials that
 * step owns — a step-assigned part when its step is recorded, or a loose part
 * (unassigned) on the operation's first step. The operator builds unit by unit
 * and never scans these. A backflush failure (e.g. insufficient stock) never
 * blocks the record; the part just stays manually issuable.
 */
export async function recordStep(
  client: SupabaseClient<Database>,
  scope: Scope,
  body: StepRecordBody
): Promise<CommandResult<null>> {
  const { companyId, userId } = scope;

  const attributeRecord = await insertAttributeRecord(client, {
    ...body,
    companyId,
    createdBy: userId
  });

  if (attributeRecord.error) {
    return failed({
      kind: "error",
      message: "Failed to record attribute",
      details: attributeRecord.error
    });
  }

  const backflush = await backflushUntrackedMaterialsOnStepRecord(client, {
    jobOperationStepId: body.jobOperationStepId,
    companyId,
    userId
  });
  if (backflush.error) {
    log.error("Backflush on step record failed", {
      error: backflush.error,
      jobOperationStepId: body.jobOperationStepId
    });
  }

  return ok(null);
}

/** Delete one step record the caller created. */
export async function deleteStepRecord(
  client: SupabaseClient<Database>,
  scope: Scope,
  args: { id: string }
): Promise<CommandResult<null>> {
  const attributeDelete = await deleteAttributeRecord(client, {
    id: args.id,
    companyId: scope.companyId,
    userId: scope.userId
  });

  if (attributeDelete.error) {
    return failed({
      kind: "error",
      message: "Failed to delete step",
      details: attributeDelete.error
    });
  }

  return ok(null);
}

/**
 * Post a note on an operation's chat, attributed to `userId`.
 *
 * The insert mirrors the row `Chat.tsx` builds (`nanoid()` id, `createdBy`, the
 * note, `createdAt`, `companyId`); the notification mirrors what its debounced
 * `notify()` POSTs to the ERP's `api/messaging/notify` — every earlier author of
 * a note on this operation except the writer, plus the job's assignee when it
 * is somebody else, notified with `JobOperationMessage` and the
 * `jobId:operationId:makeMethodId:materialId` document id.
 *
 * `jobOperationNote` has no foreign key to `jobOperation`, so a service-role
 * insert of a caller-supplied operation id would happily cross tenants. The
 * company-scoped read below is the tenant check, not a convenience.
 */
export async function addOperationNote(
  client: SupabaseClient<Database>,
  scope: Scope,
  args: { jobOperationId: string },
  body: NoteBody
): Promise<CommandResult<{ id: string; createdAt: string }>> {
  const { companyId, userId } = scope;
  const { jobOperationId } = args;

  const operation = await client
    .from("jobOperation")
    .select("id, job(id, assignee), jobMakeMethod(id, parentMaterialId)")
    .eq("id", jobOperationId)
    .eq("companyId", companyId)
    .maybeSingle();

  if (operation.error || !operation.data) {
    log.warn("Job operation not found for company", {
      companyId,
      jobOperationId
    });
    return failed({ kind: "not_found", message: "Job operation not found" });
  }

  const row = {
    id: nanoid(),
    jobOperationId,
    createdBy: userId,
    note: body.note,
    createdAt: datetime.timestamp(),
    companyId
  };

  const insert = await client.from("jobOperationNote").insert(row);
  if (insert.error) {
    return failed({
      kind: "error",
      message: "Failed to post note",
      details: insert.error
    });
  }

  // The notification is best-effort, as it is in the browser: `Chat.tsx` only
  // logs "Failed to notify user" when the POST fails and the note stays.
  try {
    const previousMessages = await client
      .from("jobOperationNote")
      .select("createdBy")
      .eq("jobOperationId", jobOperationId)
      .eq("companyId", companyId);

    const assignee = operation.data.job?.assignee;
    const jobId = operation.data.job?.id;
    const makeMethodId = operation.data.jobMakeMethod?.id;
    const materialId = operation.data.jobMakeMethod?.parentMaterialId;

    const usersToNotify = [
      ...new Set(
        (previousMessages.data?.map((m) => m.createdBy) ?? []).filter(
          (id) => id !== userId
        )
      )
    ];

    if (assignee && assignee !== userId) {
      usersToNotify.push(assignee);
    }

    if (usersToNotify.length > 0) {
      await trigger("notify", {
        companyId,
        documentId: `${jobId}:${jobOperationId}:${makeMethodId}:${
          materialId ?? ""
        }`,
        event: NotificationEvent.JobOperationMessage,
        recipient: {
          type: "users",
          userIds: usersToNotify
        },
        from: userId
      });
    }
  } catch (e) {
    log.error("Failed to notify user", { error: e, jobOperationId });
  }

  return ok({ id: row.id, createdAt: row.createdAt });
}

/** Raise a quality issue (non-conformance) against an operation. */
export async function raiseQualityIssue(
  client: SupabaseClient<Database>,
  scope: Scope,
  body: QualityIssueBody
): Promise<CommandResult<{ id: string }>> {
  const result = await createQualityIssue(client, {
    companyId: scope.companyId,
    userId: scope.userId,
    jobOperationId: body.jobOperationId,
    trackedEntityId: body.trackedEntityId,
    // The operator's free-text description doubles as the issue name (the
    // original MES behavior — the description body stays empty).
    name: body.description,
    nonConformanceTypeId: body.nonConformanceTypeId,
    priority: body.priority as
      | "Low"
      | "Medium"
      | "High"
      | "Critical"
      | undefined,
    quantity: body.quantity
  });

  if (result.error || !result.data) {
    return failed({
      kind: "error",
      message: result.message ?? "Failed to create quality issue",
      details: result.error
    });
  }

  return ok({ id: result.data.id });
}

/**
 * Queue a label print.
 *
 * No client: this is one `trigger` call and nothing else. `locationId` is an
 * argument because the two callers read it from different places — the web form
 * carries it in the validated body, the API takes it from `x-carbon-location`.
 */
export async function printLabel(
  scope: Scope & { locationId?: string },
  body: PrintBody
): Promise<CommandResult<null>> {
  const { sourceDocument, sourceDocumentId, workCenterId, printerRouteId } =
    body;

  try {
    await trigger("print-job", {
      sourceDocument,
      sourceDocumentId,
      companyId: scope.companyId,
      userId: scope.userId,
      locationId: scope.locationId,
      workCenterId,
      printerRouteId
    });
    return ok(null);
  } catch (e) {
    return failed({
      kind: "error",
      message: e instanceof Error ? e.message : "Failed to queue print job"
    });
  }
}
