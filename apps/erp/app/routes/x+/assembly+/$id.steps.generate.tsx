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

  if (!result.error) {
    const base =
      mode === "regenerate"
        ? `Regenerated ${result.data.created} steps from the motion plan`
        : `Generated ${result.data.created} steps from the motion plan`;
    // Some geometry has no BOM match, so those parts got no material — point the
    // user at Match BOM rather than leaving a silent gap.
    const unmapped = result.data.unmappedComponentCount ?? 0;
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

  // A refusal carries its reason; a database failure does not.
  const refusal = "reason" in result.error ? result.error : null;

  if (refusal?.reason === "no-plan" && refusal.modelUploadId) {
    const modelUploadId = refusal.modelUploadId;
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
        .eq("id", modelUploadId)
        .maybeSingle(),
      getLatestAssemblyPlanJob(client, modelUploadId)
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
        modelUploadId,
        companyId,
        userId
      });

      await trigger("assembly-plan", {
        modelUploadId,
        companyId,
        userId,
        ...(created.data?.id ? { planJobId: created.data.id } : {})
      });
    }

    return { success: false, planning: true };
  }

  const message = result.error.message || "Failed to generate steps";

  return data({ success: false }, await flash(request, error(null, message)));
}
