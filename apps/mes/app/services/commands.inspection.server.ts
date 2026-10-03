// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import {
  dispositionInspection,
  recordInspectionGauge,
  upsertInspectionMeasurement,
  upsertInspectionSample
} from "@carbon/database/quality";
import { getLogger } from "@carbon/logger";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  finishJobOperation,
  insertScrapQuantity,
  returnPickedRemainders
} from "~/services/operations.service";
import type { InspectionOutcomeState } from "~/services/quality.server";
import {
  createInspectionRejectionIssue,
  getInspectionOutcomeState,
  getSerialCompletionCandidates,
  postBulkCompletion,
  postSerialCompletions
} from "~/services/quality.server";
import type { CommandResult, Failed } from "./api-result.server";
import { failed, ok } from "./api-result.server";

/**
 * The five inspection-execution commands, lifted out of
 * `x+/inspection-lot.$id.measurement.tsx`, `.gauge.tsx`, `.sample.tsx`,
 * `.disposition.tsx` and `.complete-passed.tsx`.
 *
 * The bodies are unchanged. What the routes read from the request —
 * `companyId`, the user the work is attributed to, and the form fields —
 * arrives as arguments, because `userContext` is null under `api+/`.
 *
 * Each command takes the SAME clients its web route used, because which client
 * writes a row is part of the behaviour:
 *
 *  - `db` (Kysely, the superuser pool) runs the transactional quality engine.
 *    All five use it, the last two only to prove the lot is the caller's.
 *  - `serviceRole` invokes the `issue` / `trigger-rework` / `recalculate` edge
 *    functions and reads the operation's live bookkeeping, which RLS would hide
 *    from an operator.
 *  - `client` — the CALLER's RLS client — inserts the `productionQuantity` and
 *    scrap rows, so a posting is still attributable and still policed by RLS.
 *    `postBulkCompletion` and `insertScrapQuantity` take it for that reason.
 *
 * The lot id reaches every one of them from a URL, so each command re-reads it
 * under `companyId` first and answers `not_found` on a miss — the engine checks
 * the same thing inside its transaction, but reports it as a generic refusal,
 * and an API caller handed another tenant's id must get a 404 rather than a 409
 * that reads like "the lot is closed".
 */

type ServiceRole = Awaited<ReturnType<typeof getCarbonServiceRole>>;

const sampleLog = getLogger("mes", "inspection-lot-sample");

export type InspectionCommandContext = {
  companyId: string;
  /** The pinned operator on a shared terminal, else the signed-in user. */
  userId: string;
};

/** The three clients the two orchestration commands need. */
export type InspectionOutcomeClients = {
  serviceRole: ServiceRole;
  /** The caller's RLS client — what posts the quantity and scrap rows. */
  client: SupabaseClient<Database>;
  db: Kysely<KyselyDatabase>;
};

/** The production events a posting is clocked against. */
export type InspectionEventIds = {
  setupProductionEventId?: string;
  laborProductionEventId?: string;
  machineProductionEventId?: string;
};

/**
 * One scoped read, one definition of "this lot is mine".
 *
 * `details` carries the `{ message }` the engine's own refusal carries, so the
 * web routes keep rendering a miss exactly as they did when the engine was the
 * one that noticed.
 */
async function lotNotInCompany(
  db: Kysely<KyselyDatabase>,
  inspectionId: string,
  companyId: string
): Promise<Failed | null> {
  const lot = await db
    .selectFrom("inspection")
    .select(["id"])
    .where("id", "=", inspectionId)
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  if (lot) return null;
  return failed({
    kind: "not_found",
    message: "Inspection not found",
    details: { message: "Inspection not found" }
  });
}

// ---------------------------------------------------------------------------
// Measurement — one cell of the features x samples grid
// ---------------------------------------------------------------------------

export type RecordMeasurementArgs = {
  /** The lot in the path; the authoritative scope. */
  inspectionId: string;
  /** Absent = create an anonymous sample (non-serial grid columns). */
  sampleId?: string;
  inspectionFeatureId: string;
  /** Numeric string for Measurement features; empty clears the reading. */
  value?: string;
  /** Attribute (non-numeric) features toggle pass/fail instead of a value. */
  passed?: "true" | "false";
  notes?: string;
};

export async function recordInspectionMeasurement(
  db: Kysely<KyselyDatabase>,
  ctx: InspectionCommandContext,
  args: RecordMeasurementArgs
): Promise<
  CommandResult<{
    sampleId: string;
    measurementId: string;
    measurementStatus: string;
    sampleStatus: string;
  }>
> {
  const missing = await lotNotInCompany(db, args.inspectionId, ctx.companyId);
  if (missing) return missing;

  const result = await upsertInspectionMeasurement(db, {
    ...args,
    companyId: ctx.companyId,
    userId: ctx.userId
  });

  if (result.error) {
    // `conflict`, not `error`: every refusal the engine returns here is a
    // state the operator can read and act on (the lot is closed, the feature
    // is not on the plan). A 500 would tell the app to retry the write
    // instead of showing the reason.
    return failed({
      kind: "conflict",
      message: result.error.message,
      details: result.error
    });
  }

  return ok(result.data);
}

// ---------------------------------------------------------------------------
// Gauge — which gauge measured one feature of this lot
// ---------------------------------------------------------------------------

export type SetInspectionGaugeArgs = {
  inspectionId: string;
  inspectionFeatureId: string;
  /** Empty / absent clears the record. */
  gaugeId?: string;
};

export async function setInspectionGauge(
  db: Kysely<KyselyDatabase>,
  ctx: InspectionCommandContext,
  args: SetInspectionGaugeArgs
): Promise<
  CommandResult<{ inspectionFeatureId: string; gaugeId: string | null }>
> {
  const missing = await lotNotInCompany(db, args.inspectionId, ctx.companyId);
  if (missing) return missing;

  const result = await recordInspectionGauge(db, {
    inspectionId: args.inspectionId,
    inspectionFeatureId: args.inspectionFeatureId,
    gaugeId: args.gaugeId || null,
    companyId: ctx.companyId,
    userId: ctx.userId
  });

  if (result.error) {
    return failed({
      kind: "conflict",
      message: result.error.message,
      details: result.error
    });
  }

  return ok(result.data);
}

// ---------------------------------------------------------------------------
// Sample — a verdict (or an identify-only scan) for one unit
// ---------------------------------------------------------------------------

export type RecordSampleArgs = {
  inspectionId: string;
  /** Update an existing anonymous column in place (the overall-result row). */
  sampleId?: string;
  /** Serial parts scan a discrete tracked entity; other parts carry none. */
  trackedEntityId?: string;
  status: "Pending" | "Passed" | "Failed";
  notes?: string;
};

export async function recordInspectionSample(
  db: Kysely<KyselyDatabase>,
  ctx: InspectionCommandContext,
  args: RecordSampleArgs
): Promise<CommandResult<{ sampleId: string }>> {
  const missing = await lotNotInCompany(db, args.inspectionId, ctx.companyId);
  if (missing) return missing;

  // The sample write runs as the superuser and links the tracked entity, so
  // the entity must belong to this company.
  const { trackedEntityId } = args;
  if (trackedEntityId) {
    const entity = await db
      .selectFrom("trackedEntity")
      .select("id")
      .where("id", "=", trackedEntityId)
      .where("companyId", "=", ctx.companyId)
      .executeTakeFirst();
    if (!entity) {
      sampleLog.warn("Tracked entity not found for company", {
        companyId: ctx.companyId,
        inspectionId: args.inspectionId,
        trackedEntityId
      });
      // `fields` names the offending form field, which is both what the API
      // reports and how the web route tells this miss from a lot miss — the
      // two render different flashes.
      return failed({
        kind: "not_found",
        message: "Tracked entity not found",
        fields: { trackedEntityId: ["Tracked entity not found"] },
        details: { message: "Tracked entity not found" }
      });
    }
  }

  const result = await upsertInspectionSample(db, {
    ...args,
    companyId: ctx.companyId,
    inspectedBy: ctx.userId
  });

  if (result.error) {
    return failed({
      kind: "conflict",
      message: result.error.message,
      details: result.error
    });
  }

  return ok({ sampleId: result.data.id });
}

// ---------------------------------------------------------------------------
// Disposition — the verdict carries its physical outcome
// ---------------------------------------------------------------------------

export type DispositionArgs = {
  inspectionId: string;
  decision: "Accept" | "Reject" | "Partial";
  /** The job operation, which the lot must actually belong to. */
  operationId: string;
  /** Serial allocation: the tracked entities picked per outcome. */
  scrapEntityIds?: string[];
  reworkEntityIds?: string[];
  /** Non-serial allocation: quantities out of the failed / open remainder. */
  scrapQuantity?: number;
  reworkQuantity?: number;
  scrapReasonId?: string;
  targetOperationId?: string;
  reworkReason?: string;
  /** Optional documentation — never required for scrap or rework. */
  createNcr?: boolean;
  nonConformanceTypeId?: string;
  eventIds: InspectionEventIds;
};

export type DispositionOutcome = {
  decision: "Accept" | "Reject" | "Partial";
  completed: number;
  scrapped: number;
  reworked: number;
  /** The operation reached its target and was finished. */
  finished: boolean;
  /** Postings that failed AFTER the lot was closed, in the web's words. */
  warnings: string[];
  /** The sentence the operator reads: headline plus what was posted. */
  message: string;
};

/**
 * `x+/inspection-lot.$id.disposition.tsx`'s action, moved.
 *
 * One decision surface: the quality verdict carries its physical outcome.
 * Accept completes the remaining lot; Reject/Partial split the failed set
 * between Scrap (reason) and Rework (upstream target via `trigger-rework`'s
 * routing clone — the cloned Inspection op re-inspects for free) — or record
 * only. The disposition is one-shot (`requireOpen`): postings can never re-run.
 *
 * Two kinds of failure, and the difference matters to an API caller:
 *
 *  - Everything BEFORE the close is `validation` / `conflict` / `not_found` —
 *    nothing was written, and the operator can read the reason and retry.
 *  - Everything AFTER it is `error` (500), because the lot is closed and the
 *    postings are partly applied. The idempotency window stores and REPLAYS a
 *    5xx, so an automatic retry cannot re-run a half-applied disposition;
 *    only the operator minting a new key can, which is the same guarantee
 *    close-first gives the web.
 */
export async function dispositionInspectionLot(
  clients: InspectionOutcomeClients,
  ctx: InspectionCommandContext,
  args: DispositionArgs
): Promise<CommandResult<DispositionOutcome>> {
  const { serviceRole, client, db } = clients;
  const { companyId, userId } = ctx;
  const {
    inspectionId,
    decision,
    operationId,
    scrapReasonId,
    targetOperationId,
    reworkReason,
    createNcr,
    nonConformanceTypeId,
    eventIds
  } = args;
  const scrapEntityIds = args.scrapEntityIds ?? [];
  const reworkEntityIds = args.reworkEntityIds ?? [];

  const missing = await lotNotInCompany(db, inspectionId, companyId);
  if (missing) return missing;

  // ---------------------------------------------------------------
  // 1. Recompute every bucket fresh from the DB (form fields are
  //    operator intent, not trusted arithmetic) and validate.
  // ---------------------------------------------------------------
  const stateResult = await getInspectionOutcomeState(serviceRole, {
    inspectionId,
    companyId
  });
  if (stateResult.error !== null || !stateResult.data) {
    return failed({
      // A null `error` with no data is a refusal the caller can read — the lot
      // belongs to a receipt, not to a job operation, and only the ERP
      // dispositions those. A non-null error is a read that actually failed.
      kind: stateResult.error === null ? "conflict" : "error",
      message: stateResult.message ?? "Failed to load lot",
      details: stateResult.error
    });
  }
  const state = stateResult.data;
  if (state.jobOperationId !== operationId) {
    return failed({
      kind: "conflict",
      message: "Operation does not match the inspection lot"
    });
  }

  const inspectedCount = state.samples.filter(
    (s) => s.status !== "Pending"
  ).length;
  const passedCount = state.samples.filter((s) => s.status === "Passed").length;
  const failedCount = state.samples.filter((s) => s.status === "Failed").length;
  const failedEntityIds = new Set(
    state.samples
      .filter((s) => s.status === "Failed")
      .map((s) => s.trackedEntityId)
      .filter((entityId): entityId is string => Boolean(entityId))
  );

  // Partial is the terminal mixed close — only meaningful when every unit has
  // its own verdict (the operational meaning of "inspect all").
  if (decision === "Partial") {
    if (
      inspectedCount < state.lotSize ||
      passedCount === 0 ||
      failedCount === 0
    ) {
      return failed({
        kind: "conflict",
        message:
          "Partial disposition requires every unit inspected with both passes and failures"
      });
    }
  }

  // Serial allocation checks: ids must be this lot's WIP, still open at this
  // operation, and each unit allocated to exactly one outcome.
  let completionCandidates: {
    trackedEntityId: string;
    inspectionSampleId: string | null;
  }[] = [];
  let completionQuantity = 0;
  const scrapTotal = state.requiresSerialTracking
    ? scrapEntityIds.length
    : (args.scrapQuantity ?? 0);
  const reworkTotal = state.requiresSerialTracking
    ? reworkEntityIds.length
    : (args.reworkQuantity ?? 0);

  if (decision === "Accept" && scrapTotal + reworkTotal > 0) {
    return failed({
      kind: "validation",
      message: "Accept cannot scrap or rework units"
    });
  }

  if (state.requiresSerialTracking) {
    const allocated = new Set([...scrapEntityIds, ...reworkEntityIds]);
    if (allocated.size < scrapEntityIds.length + reworkEntityIds.length) {
      return failed({
        kind: "validation",
        message: "A unit cannot be both scrapped and reworked"
      });
    }
    for (const entityId of allocated) {
      if (!state.entityEligible(entityId)) {
        return failed({
          kind: "conflict",
          message:
            "An allocated unit is no longer open at this operation — reload and retry"
        });
      }
      if (decision === "Partial" && !failedEntityIds.has(entityId)) {
        return failed({
          kind: "conflict",
          message: "Partial can only scrap or rework failed units"
        });
      }
    }
    if (decision === "Accept") {
      completionCandidates = getSerialCompletionCandidates(state, {
        includePending: true,
        includeSampleless: true,
        excludeEntityIds: failedEntityIds
      });
    } else if (decision === "Partial") {
      completionCandidates = getSerialCompletionCandidates(state, {
        includePending: false,
        includeSampleless: false,
        excludeEntityIds: allocated
      });
    }
    completionQuantity = completionCandidates.length;
  } else {
    if (decision === "Partial" && scrapTotal + reworkTotal > failedCount) {
      return failed({
        kind: "conflict",
        message: "Allocation exceeds the failed unit count"
      });
    }
    if (decision === "Accept") {
      completionQuantity = state.opRemaining;
    } else if (decision === "Partial") {
      completionQuantity = Math.max(
        0,
        passedCount - state.linkedProductionQuantity
      );
    }
  }

  // Clamp to the operation column's remaining quantity — escape-hatch menu
  // postings already recorded there can never be double-counted. Serial
  // divergence blocks (silently dropping identified units would lie).
  const postedTotal = completionQuantity + scrapTotal + reworkTotal;
  if (postedTotal > state.opRemaining) {
    return failed({
      kind: "conflict",
      message: state.requiresSerialTracking
        ? `Allocated units (${postedTotal}) exceed the operation's remaining quantity (${state.opRemaining}) — quantities were already recorded from the actions menu`
        : `Allocation (${postedTotal}) exceeds the operation's remaining quantity (${state.opRemaining})`
    });
  }

  // ---------------------------------------------------------------
  // 2. Close the lot FIRST — the one-shot requireOpen update is the
  //    serialization point; a concurrent second POST dies here before
  //    any posting can re-run.
  // ---------------------------------------------------------------
  const dispositionResult = await dispositionInspection(db, {
    id: inspectionId,
    decision,
    companyId,
    dispositionedBy: userId,
    requireOpen: true
  });
  if (dispositionResult.error) {
    return failed({
      kind: "conflict",
      message: "Failed to disposition lot",
      details: dispositionResult.error
    });
  }

  // ---------------------------------------------------------------
  // 3. Physical postings. Failures past this point leave the lot
  //    closed with partial postings — surfaced loudly; the ERP's
  //    productionQuantity records (and their links) self-heal the
  //    arithmetic for whatever is re-posted manually.
  // ---------------------------------------------------------------
  const warnings: string[] = [];

  if (completionQuantity > 0) {
    if (state.requiresSerialTracking) {
      const completions = await postSerialCompletions(serviceRole, {
        candidates: completionCandidates,
        jobOperationId: state.jobOperationId,
        inspectionId,
        eventIds,
        companyId,
        userId
      });
      if (completions.error) {
        return failed({
          kind: "error",
          message: `Lot dispositioned, but completing units failed after ${completions.completed} of ${completionQuantity}`,
          details: completions.error
        });
      }
    } else {
      const completion = await postBulkCompletion(serviceRole, client, state, {
        quantity: completionQuantity,
        eventIds,
        companyId,
        userId
      });
      if (completion.error) {
        return failed({
          kind: "error",
          message: `Lot dispositioned, but ${completion.message ?? "completing units failed"}`,
          details: completion.error
        });
      }
    }
  }

  if (scrapTotal > 0 && scrapReasonId) {
    const scrapResult = await insertScrapQuantity(client, {
      jobOperationId: state.jobOperationId,
      quantity: scrapTotal,
      scrapReasonId,
      inspectionId,
      ...eventIds,
      companyId,
      createdBy: userId
    });
    if (scrapResult.error) {
      return failed({
        kind: "error",
        message: "Lot dispositioned, but recording scrap failed",
        details: scrapResult.error
      });
    }

    // Scrapped WIP serials leave the flow for good: Rejected keeps them out
    // of inventory and out of complete_job_to_inventory's release at the
    // last operation. Reworked units are NOT flipped — they continue through
    // the cloned branch.
    if (state.requiresSerialTracking && scrapEntityIds.length > 0) {
      const flip = await serviceRole
        .from("trackedEntity")
        .update({ status: "Rejected" })
        .in("id", scrapEntityIds)
        .eq("companyId", companyId);
      if (flip.error) {
        warnings.push("failed to mark scrapped units Rejected");
      }
    }

    const backflush = await serviceRole.functions.invoke("issue", {
      body: {
        id: state.jobOperationId,
        type: "jobOperation",
        quantity: scrapTotal,
        companyId,
        userId
      }
    });
    if (backflush.error) {
      warnings.push("failed to issue materials for scrap");
    }
  }

  if (reworkTotal > 0 && targetOperationId && reworkReason) {
    const rework = await serviceRole.functions.invoke("trigger-rework", {
      body: {
        jobId: state.jobId,
        triggeredAtJobOperationId: state.jobOperationId,
        targetJobOperationId: targetOperationId,
        reason: reworkReason,
        quantity: reworkTotal,
        trackedEntityIds: state.requiresSerialTracking
          ? reworkEntityIds
          : undefined,
        inspectionId,
        companyId,
        userId
      }
    });
    if (rework.error) {
      return failed({
        kind: "error",
        message: "Lot dispositioned, but triggering rework failed",
        details: rework.error
      });
    }

    const recalculate = await serviceRole.functions.invoke("recalculate", {
      body: {
        type: "jobRequirements",
        id: state.jobId,
        companyId,
        userId
      }
    });
    if (recalculate.error) {
      warnings.push("failed to recalculate job requirements");
    }
  }

  // NCR is optional documentation — never required for scrap or rework.
  if (decision !== "Accept" && createNcr) {
    const issue = await createInspectionRejectionIssue(serviceRole, {
      inspectionId,
      companyId,
      userId,
      nonConformanceTypeId
    });
    if (issue.error || issue.message) {
      warnings.push(issue.message ?? "failed to create quality issue");
    }
  }

  // Mirror complete.tsx: the quantity interceptor auto-flips Done when the
  // column sum reaches a positive target; the explicit finish covers
  // targetQuantity = 0 operations.
  const willBeFinished =
    (postedTotal > 0 || decision === "Accept") &&
    state.opAccounted + postedTotal >=
      (state.operation.targetQuantity ??
        state.operation.operationQuantity ??
        0);
  if (willBeFinished) {
    const finishResult = await finishJobOperation(serviceRole, {
      jobOperationId: state.jobOperationId,
      userId,
      companyId
    });
    if (finishResult.error) {
      warnings.push("failed to finish the operation");
    }
  }

  const outcomes = [
    completionQuantity > 0 &&
      `${completionQuantity} unit${completionQuantity === 1 ? "" : "s"} completed`,
    scrapTotal > 0 && `${scrapTotal} scrapped`,
    reworkTotal > 0 && `${reworkTotal} sent to rework`
  ]
    .filter(Boolean)
    .join(", ");
  const headline =
    decision === "Accept"
      ? "Lot accepted"
      : decision === "Reject"
        ? "Lot rejected"
        : "Lot partially accepted";

  return ok({
    decision,
    completed: completionQuantity,
    scrapped: scrapTotal,
    reworked: reworkTotal,
    finished: willBeFinished,
    warnings,
    message: outcomes ? `${headline} — ${outcomes}` : headline
  });
}

// ---------------------------------------------------------------------------
// Complete passed — progressive completion while the lot stays open
// ---------------------------------------------------------------------------

// Completions posted here insert productionQuantity rows, whose SQL interceptor
// can auto-flip the operation to 'Done' (and complete the job) inside the DB —
// no app hook fires on that path, so the picked-material return sweep is
// orchestrated here after the postings land.
async function sweepIfOperationDone(
  serviceRole: ServiceRole,
  args: { jobOperationId: string; userId: string; companyId: string }
) {
  const op = await serviceRole
    .from("jobOperation")
    .select("status")
    .eq("id", args.jobOperationId)
    .eq("companyId", args.companyId)
    .maybeSingle();
  if (op.data?.status !== "Done") return;
  await returnPickedRemainders(serviceRole, args);
}

export type CompletePassedArgs = {
  inspectionId: string;
  operationId: string;
  eventIds: InspectionEventIds;
};

/**
 * `x+/inspection-lot.$id.complete-passed.tsx`'s action, moved.
 *
 * Progressive completion while the lot stays open: any unit that passed
 * inspection can move on immediately, without waiting for the disposition.
 * Explicit (a button, not auto-on-pass) so a verdict typo doesn't need a
 * compensating transaction — un-posted verdicts stay editable.
 */
export async function completePassedInspectionUnits(
  clients: InspectionOutcomeClients,
  ctx: InspectionCommandContext,
  args: CompletePassedArgs
): Promise<CommandResult<{ completed: number }>> {
  const { serviceRole, client, db } = clients;
  const { companyId, userId } = ctx;
  const { inspectionId, operationId, eventIds } = args;

  const missing = await lotNotInCompany(db, inspectionId, companyId);
  if (missing) return missing;

  const stateResult = await getInspectionOutcomeState(serviceRole, {
    inspectionId,
    companyId
  });
  if (stateResult.error !== null || !stateResult.data) {
    return failed({
      // A null `error` with no data is a refusal the caller can read — the lot
      // belongs to a receipt, not to a job operation, and only the ERP
      // dispositions those. A non-null error is a read that actually failed.
      kind: stateResult.error === null ? "conflict" : "error",
      message: stateResult.message ?? "Failed to load lot",
      details: stateResult.error
    });
  }
  const state: InspectionOutcomeState = stateResult.data;
  if (state.jobOperationId !== operationId) {
    return failed({
      kind: "conflict",
      message: "Operation does not match the inspection lot"
    });
  }
  if (["Passed", "Failed", "Partial"].includes(state.inspection.status)) {
    return failed({
      kind: "conflict",
      message: "Inspection is closed — the disposition already ran"
    });
  }

  if (state.requiresSerialTracking) {
    const candidates = getSerialCompletionCandidates(state, {
      includePending: false,
      includeSampleless: false
    });
    if (candidates.length === 0) {
      return failed({
        kind: "conflict",
        message: "No passed units to complete"
      });
    }
    if (candidates.length > state.opRemaining) {
      return failed({
        kind: "conflict",
        message: `Passed units (${candidates.length}) exceed the operation's remaining quantity (${state.opRemaining}) — quantities were already recorded from the actions menu`
      });
    }
    const completions = await postSerialCompletions(serviceRole, {
      candidates,
      jobOperationId: state.jobOperationId,
      inspectionId,
      eventIds,
      companyId,
      userId
    });
    if (completions.error) {
      return failed({
        kind: "error",
        message: `Completing units failed after ${completions.completed} of ${candidates.length}`,
        details: completions.error
      });
    }
    await sweepIfOperationDone(serviceRole, {
      jobOperationId: state.jobOperationId,
      userId,
      companyId
    });
    return ok({ completed: completions.completed });
  }

  const passedCount = state.samples.filter((s) => s.status === "Passed").length;
  const quantity = Math.min(
    Math.max(0, passedCount - state.linkedProductionQuantity),
    state.opRemaining
  );
  if (quantity <= 0) {
    return failed({ kind: "conflict", message: "No passed units to complete" });
  }

  const completion = await postBulkCompletion(serviceRole, client, state, {
    quantity,
    eventIds,
    companyId,
    userId
  });
  if (completion.error) {
    return failed({
      kind: "error",
      message: completion.message ?? "Failed to complete units",
      details: completion.error
    });
  }

  await sweepIfOperationDone(serviceRole, {
    jobOperationId: state.jobOperationId,
    userId,
    companyId
  });

  return ok({ completed: quantity });
}
