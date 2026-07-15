import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { trigger } from "@carbon/jobs";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  createAssemblyPlanJob,
  getLatestAssemblyPlanJob,
  isAssemblyPlanRunning
} from "~/modules/production";
import { isAssemblerServiceHealthy } from "~/modules/production/production.server";

/**
 * Re-runs motion planning over the instruction's converted model. When the
 * instruction already has steps, it runs in ORDER-PRESERVING mode: the planner
 * takes the existing step order as fixed and only recomputes each step's motion
 * to avoid collision with parts from earlier steps, updating the step motions in
 * place (Done steps kept). With no steps yet, it plans fresh (deriving order).
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "production"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  // `fresh` forces a from-scratch DERIVE plan (re-detects grouping/swarms and
  // re-orders) even when steps exist — used by "Regenerate Steps". Without it,
  // an instruction with steps re-plans in order-preserving re-motion mode.
  const formData = await request.formData();
  const fresh = formData.get("fresh") === "1";

  const instruction = await client
    .from("assemblyInstruction")
    .select("modelUploadId, modelUpload(processingStatus)")
    .eq("id", id)
    .eq("companyId", companyId)
    .single();

  if (instruction.error || !instruction.data.modelUploadId) {
    return data(
      { success: false },
      await flash(
        request,
        error(instruction.error, "This instruction has no model")
      )
    );
  }

  if (instruction.data.modelUpload?.processingStatus !== "Success") {
    return data(
      { success: false },
      await flash(
        request,
        error(null, "The model must finish converting before planning")
      )
    );
  }

  // Every path here triggers the planner, which needs the geometry service.
  if (!(await isAssemblerServiceHealthy())) {
    return data(
      { success: false },
      await flash(
        request,
        error(
          null,
          "The geometry service is unavailable — motion planning can't run right now."
        )
      )
    );
  }

  const planJob = await getLatestAssemblyPlanJob(
    client,
    instruction.data.modelUploadId
  );
  if (isAssemblyPlanRunning(planJob.data)) {
    return data(
      { success: false },
      await flash(request, error(null, "Motion planning is already running"))
    );
  }
  if (
    planJob.data?.status === "Queued" ||
    planJob.data?.status === "Processing"
  ) {
    // Stale row the guard above already ruled non-live: a Queued event that
    // was never picked up, or a Processing run whose worker is gone (crash,
    // or the in-memory dev Inngest server restarting mid-run). Fail it so it
    // can't shadow the run we're about to start.
    await client
      .from("assemblyPlanJob")
      .update({
        status: "Failed",
        error:
          planJob.data.status === "Queued"
            ? "Planning never started — the job event was lost"
            : "Planning run was lost (worker restarted mid-run)",
        updatedAt: new Date().toISOString()
      })
      .eq("id", planJob.data.id)
      .eq("companyId", companyId);
  }

  // Order-preserving re-motion when steps already exist; fresh (reordering)
  // plan when there are none yet.
  const stepCount = await client
    .from("assemblyInstructionStep")
    .select("id", { count: "exact", head: true })
    .eq("assemblyInstructionId", id)
    .eq("companyId", companyId);
  // `fresh` re-derives from scratch (no order preservation), so treat it like
  // "no steps yet" for the trigger below.
  const hasSteps = !fresh && (stepCount.count ?? 0) > 0;

  // Regenerate (fresh) replaces all steps once the plan lands — refuse up front
  // if any step is manually authored or Done, rather than running the planner
  // for ~15s and only then failing the regenerate.
  if (fresh && (stepCount.count ?? 0) > 0) {
    const locked = await client
      .from("assemblyInstructionStep")
      .select("id", { count: "exact", head: true })
      .eq("assemblyInstructionId", id)
      .eq("companyId", companyId)
      .or("planConfidence.eq.manual,status.eq.Done");
    if ((locked.count ?? 0) > 0) {
      return data(
        { success: false },
        await flash(
          request,
          error(
            null,
            "Some steps are manually authored or Done — reset or delete them before regenerating"
          )
        )
      );
    }
  }

  // Auto-detected groups (swarms) are materialized as `assemblyUnit` rows so
  // they show/edit like authored units — but that FREEZES the detection: on the
  // next plan `loadPlanUnits` feeds them back as caller units, so the planner
  // merges them as-is and never re-runs swarm detection (which is where things
  // like board-mounted-component absorption happen). A from-scratch regenerate
  // must re-derive them. We DON'T delete the rows here (a delete-then-failed-
  // re-plan would strand the model ungrouped); instead `reDetectUnits` below
  // tells the worker to omit auto-units for this run so detection re-runs, and
  // step generation swaps the rows atomically once the new plan lands.

  // Create the job row before sending the event so the UI reflects the run
  // immediately (the worker adopts it via planJobId). Best-effort: planning
  // still works if the insert fails — the worker inserts its own row then.
  const created = await createAssemblyPlanJob(client, {
    modelUploadId: instruction.data.modelUploadId,
    companyId,
    userId
  });

  await trigger("assembly-plan", {
    modelUploadId: instruction.data.modelUploadId,
    companyId,
    userId,
    ...(created.data?.id ? { planJobId: created.data.id } : {}),
    ...(hasSteps ? { reMotionFor: id } : {}),
    ...(fresh ? { reDetectUnits: true } : {})
  });

  return data(
    { success: true },
    await flash(
      request,
      success(
        hasSteps
          ? "Re-planning motions in the current step order — steps update when it finishes"
          : fresh
            ? "Re-planning from scratch — steps rebuild automatically when it finishes"
            : "Motion planning started — steps generate when it finishes"
      )
    )
  );
}
