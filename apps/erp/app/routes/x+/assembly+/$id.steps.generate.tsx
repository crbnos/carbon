import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { trigger } from "@carbon/jobs";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  createAssemblyPlanJob,
  generateAssemblyStepsFromPlan,
  getLatestAssemblyPlanJob,
  isAssemblyPlanRunning
} from "~/modules/production";
import { isAssemblerServiceHealthy } from "~/modules/production/production.server";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  // bypassRls: generateAssemblyStepsFromPlan materializes auto-detected units
  // (a system/derived write) whose INSERT/DELETE RLS needs
  // production_create/_delete — which this update-authorized action's user may
  // lack. Authorization is still gated on production_update above; the service
  // role only bypasses row-level policy for the derived write (companyId-scoped).
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "production",
    bypassRls: true
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const mode =
    formData.get("mode") === "regenerate" ? "regenerate" : "generate";

  const result = await generateAssemblyStepsFromPlan(client, {
    assemblyInstructionId: id,
    companyId,
    userId,
    mode
  });

  if (result.ok) {
    const base =
      mode === "regenerate"
        ? `Regenerated ${result.created} steps from the motion plan`
        : `Generated ${result.created} steps from the motion plan`;
    // Some geometry has no BOM match, so those parts got no material — point the
    // user at Match BOM rather than leaving a silent gap.
    const unmapped = result.unmappedComponentCount ?? 0;
    return data(
      { success: true },
      await flash(
        request,
        success(
          unmapped > 0
            ? `${base}. ${unmapped} component${unmapped === 1 ? "" : "s"} have no BOM match — use Match BOM to link their materials.`
            : base
        )
      )
    );
  }

  if (result.reason === "no-plan" && result.modelUploadId) {
    // No plan yet — planning is lazy, so this click is what starts it, which
    // needs the geometry service. Refuse when it's down (a stale tab could POST
    // here after the loader gated the button).
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
    // The caller polls and re-submits once the plan lands (or once a still-running
    // conversion finishes). Don't start a run while the model is converting or
    // a plan job is already Queued/Processing.
    const [model, planJob] = await Promise.all([
      client
        .from("modelUpload")
        .select("processingStatus")
        .eq("id", result.modelUploadId)
        .maybeSingle(),
      getLatestAssemblyPlanJob(client, result.modelUploadId)
    ]);

    const isConverting =
      model.data?.processingStatus === "Queued" ||
      model.data?.processingStatus === "Processing";
    const isPlanning = isAssemblyPlanRunning(planJob.data);

    if (!isConverting && !isPlanning) {
      // Pre-create the job row so the run is visible to the very next loader
      // read; the worker adopts it via planJobId (falls back to inserting its
      // own row when the insert fails).
      const created = await createAssemblyPlanJob(client, {
        modelUploadId: result.modelUploadId,
        companyId,
        userId
      });

      await trigger("assembly-plan", {
        modelUploadId: result.modelUploadId,
        companyId,
        userId,
        ...(created.data?.id ? { planJobId: created.data.id } : {})
      });
    }

    return { success: false, planning: true };
  }

  const message =
    result.reason === "steps-exist"
      ? "Steps already exist — delete them before generating from the plan"
      : result.reason === "steps-locked"
        ? (result.message ?? "Some steps are locked — cannot regenerate")
        : result.reason === "no-model"
          ? "This instruction has no processed model"
          : (result.message ?? "Failed to generate steps");

  return data({ success: false }, await flash(request, error(null, message)));
}
