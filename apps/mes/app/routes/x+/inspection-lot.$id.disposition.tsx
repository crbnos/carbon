import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { dispositionInspection } from "@carbon/database/quality";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getDatabaseClient } from "~/services/database.server";
import { inspectionDispositionValidator } from "~/services/models";
import {
  finishJobOperation,
  insertScrapQuantity
} from "~/services/operations.service";
import {
  createInspectionRejectionIssue,
  getInspectionOutcomeState,
  getSerialCompletionCandidates,
  postBulkCompletion,
  postSerialCompletions
} from "~/services/quality.server";
import { path } from "~/utils/path";

// One decision surface: the quality verdict carries its physical outcome.
// Accept completes the remaining lot; Reject/Partial split the failed set
// between Scrap (reason) and Rework (upstream target via trigger-rework's
// routing clone — the cloned Inspection op re-inspects for free) — or record
// only. The disposition is one-shot (requireOpen): postings can never re-run.
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "quality"
  });
  const { id } = params;
  if (!id) throw new Error("id is required");

  const formData = await request.formData();
  const validation = await validator(inspectionDispositionValidator).validate(
    formData
  );
  if (validation.error) {
    return validationError(validation.error);
  }
  const {
    decision,
    operationId,
    scrapReasonId,
    targetOperationId,
    reworkReason,
    createNcr,
    nonConformanceTypeId,
    setupProductionEventId,
    laborProductionEventId,
    machineProductionEventId
  } = validation.data;
  const eventIds = {
    setupProductionEventId,
    laborProductionEventId,
    machineProductionEventId
  };
  const returnTo = path.to.inspection(operationId);
  const fail = async (err: unknown, message: string): Promise<never> => {
    throw redirect(returnTo, await flash(request, error(err, message)));
  };

  const parseIds = (json: string | undefined): string[] => {
    if (!json) return [];
    try {
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch {
      return [];
    }
  };
  const scrapEntityIds = parseIds(validation.data.scrapEntityIds);
  const reworkEntityIds = parseIds(validation.data.reworkEntityIds);

  const serviceRole = await getCarbonServiceRole();

  // ---------------------------------------------------------------
  // 1. Recompute every bucket fresh from the DB (form fields are
  //    operator intent, not trusted arithmetic) and validate.
  // ---------------------------------------------------------------
  const stateResult = await getInspectionOutcomeState(serviceRole, {
    inspectionId: id,
    companyId
  });
  if (stateResult.error !== null || !stateResult.data) {
    return fail(stateResult.error, stateResult.message ?? "Failed to load lot");
  }
  const state = stateResult.data;
  if (state.jobOperationId !== operationId) {
    return fail(null, "Operation does not match the inspection lot");
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
      return fail(
        null,
        "Partial disposition requires every unit inspected with both passes and failures"
      );
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
    : (validation.data.scrapQuantity ?? 0);
  const reworkTotal = state.requiresSerialTracking
    ? reworkEntityIds.length
    : (validation.data.reworkQuantity ?? 0);

  if (decision === "Accept" && scrapTotal + reworkTotal > 0) {
    return fail(null, "Accept cannot scrap or rework units");
  }

  if (state.requiresSerialTracking) {
    const allocated = new Set([...scrapEntityIds, ...reworkEntityIds]);
    if (allocated.size < scrapEntityIds.length + reworkEntityIds.length) {
      return fail(null, "A unit cannot be both scrapped and reworked");
    }
    for (const entityId of allocated) {
      if (!state.entityEligible(entityId)) {
        return fail(
          null,
          "An allocated unit is no longer open at this operation — reload and retry"
        );
      }
      if (decision === "Partial" && !failedEntityIds.has(entityId)) {
        return fail(null, "Partial can only scrap or rework failed units");
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
      return fail(null, "Allocation exceeds the failed unit count");
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
    if (state.requiresSerialTracking) {
      return fail(
        null,
        `Allocated units (${postedTotal}) exceed the operation's remaining quantity (${state.opRemaining}) — quantities were already recorded from the actions menu`
      );
    }
    return fail(
      null,
      `Allocation (${postedTotal}) exceeds the operation's remaining quantity (${state.opRemaining})`
    );
  }

  // ---------------------------------------------------------------
  // 2. Close the lot FIRST — the one-shot requireOpen update is the
  //    serialization point; a concurrent second POST dies here before
  //    any posting can re-run.
  // ---------------------------------------------------------------
  const dispositionResult = await dispositionInspection(getDatabaseClient(), {
    id,
    decision,
    companyId,
    dispositionedBy: userId,
    requireOpen: true
  });
  if (dispositionResult.error) {
    return fail(dispositionResult.error, "Failed to disposition lot");
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
        inspectionId: id,
        eventIds,
        companyId,
        userId
      });
      if (completions.error) {
        return fail(
          completions.error,
          `Lot dispositioned, but completing units failed after ${completions.completed} of ${completionQuantity}`
        );
      }
    } else {
      const completion = await postBulkCompletion(serviceRole, client, state, {
        quantity: completionQuantity,
        eventIds,
        companyId,
        userId
      });
      if (completion.error) {
        return fail(
          completion.error,
          `Lot dispositioned, but ${completion.message ?? "completing units failed"}`
        );
      }
    }
  }

  if (scrapTotal > 0 && scrapReasonId) {
    const scrapResult = await insertScrapQuantity(client, {
      jobOperationId: state.jobOperationId,
      quantity: scrapTotal,
      scrapReasonId,
      inspectionId: id,
      ...eventIds,
      companyId,
      createdBy: userId
    });
    if (scrapResult.error) {
      return fail(
        scrapResult.error,
        "Lot dispositioned, but recording scrap failed"
      );
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
        inspectionId: id,
        companyId,
        userId
      }
    });
    if (rework.error) {
      return fail(
        rework.error,
        "Lot dispositioned, but triggering rework failed"
      );
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
  if (decision !== "Accept" && createNcr === "true") {
    const issue = await createInspectionRejectionIssue(serviceRole, {
      inspectionId: id,
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
  const message = outcomes ? `${headline} — ${outcomes}` : headline;

  if (warnings.length > 0) {
    throw redirect(
      willBeFinished ? path.to.operations : returnTo,
      await flash(
        request,
        error(null, `${message}, but ${warnings.join("; ")}`)
      )
    );
  }

  throw redirect(
    willBeFinished ? path.to.operations : returnTo,
    await flash(request, success(message))
  );
}
