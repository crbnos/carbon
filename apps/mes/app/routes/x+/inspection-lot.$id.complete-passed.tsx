import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { inspectionCompletePassedValidator } from "~/services/models";
import {
  getInspectionOutcomeState,
  getSerialCompletionCandidates,
  postBulkCompletion,
  postSerialCompletions
} from "~/services/quality.server";
import { path } from "~/utils/path";

// Progressive completion while the lot stays open: any unit that passed
// inspection can move on immediately, without waiting for the disposition.
// Explicit (a button, not auto-on-pass) so a verdict typo doesn't need a
// compensating transaction — un-posted verdicts stay editable.
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "quality"
  });
  const { id } = params;
  if (!id) throw new Error("id is required");

  const formData = await request.formData();
  const validation = await validator(
    inspectionCompletePassedValidator
  ).validate(formData);
  if (validation.error) {
    return validationError(validation.error);
  }
  const {
    operationId,
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

  const serviceRole = await getCarbonServiceRole();
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
  if (["Passed", "Failed", "Partial"].includes(state.inspection.status)) {
    return fail(null, "Inspection is closed — the disposition already ran");
  }

  if (state.requiresSerialTracking) {
    const candidates = getSerialCompletionCandidates(state, {
      includePending: false,
      includeSampleless: false
    });
    if (candidates.length === 0) {
      return fail(null, "No passed units to complete");
    }
    if (candidates.length > state.opRemaining) {
      return fail(
        null,
        `Passed units (${candidates.length}) exceed the operation's remaining quantity (${state.opRemaining}) — quantities were already recorded from the actions menu`
      );
    }
    const completions = await postSerialCompletions(serviceRole, {
      candidates,
      jobOperationId: state.jobOperationId,
      inspectionId: id,
      eventIds,
      companyId,
      userId
    });
    if (completions.error) {
      return fail(
        completions.error,
        `Completing units failed after ${completions.completed} of ${candidates.length}`
      );
    }
    throw redirect(
      returnTo,
      await flash(
        request,
        success(
          `${completions.completed} unit${completions.completed === 1 ? "" : "s"} completed`
        )
      )
    );
  }

  const passedCount = state.samples.filter((s) => s.status === "Passed").length;
  const quantity = Math.min(
    Math.max(0, passedCount - state.linkedProductionQuantity),
    state.opRemaining
  );
  if (quantity <= 0) {
    return fail(null, "No passed units to complete");
  }

  const completion = await postBulkCompletion(serviceRole, client, state, {
    quantity,
    eventIds,
    companyId,
    userId
  });
  if (completion.error) {
    return fail(
      completion.error,
      completion.message ?? "Failed to complete units"
    );
  }

  throw redirect(
    returnTo,
    await flash(
      request,
      success(`${quantity} unit${quantity === 1 ? "" : "s"} completed`)
    )
  );
}
