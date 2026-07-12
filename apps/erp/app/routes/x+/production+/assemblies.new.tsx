import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { trigger } from "@carbon/jobs";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData, useNavigate } from "react-router";
import {
  assemblyInstructionFromItemValidator,
  createAssemblyPlanJob,
  getAssemblyModelState,
  getLatestAssemblyPlanJob,
  getModelForItem,
  upsertAssemblyInstruction
} from "~/modules/production";
import {
  isAssemblerServiceHealthy,
  requireAssembliesInternal
} from "~/modules/production/production.server";
import AssemblyInstructionForm from "~/modules/production/ui/Assemblies/AssemblyInstructionForm";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  const { email } = await requirePermissions(request, {
    create: "production"
  });
  requireAssembliesInternal(email);

  const url = new URL(request.url);

  return {
    initialValues: {
      itemId: url.searchParams.get("itemId") ?? ""
    }
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId, email } = await requirePermissions(
    request,
    {
      create: "production"
    }
  );
  requireAssembliesInternal(email);

  const validation = await validator(
    assemblyInstructionFromItemValidator
  ).validate(await request.formData());

  if (validation.error) {
    return validationError(validation.error);
  }

  const { itemId, modelUploadId } = validation.data;

  // An explicitly provided model (e.g. from the part details page) wins when
  // it is usable; otherwise derive it from the item's CAD files
  let model: { id: string } | null = null;
  let modelState: ReturnType<typeof getAssemblyModelState> = "none";

  if (modelUploadId) {
    const explicit = await client
      .from("modelUpload")
      .select("id, processingStatus, glbPath, graphPath, modelPath")
      .eq("id", modelUploadId)
      .eq("companyId", companyId)
      .maybeSingle();
    const explicitState = getAssemblyModelState(explicit.data ?? null);
    if (explicit.data && explicitState !== "none") {
      model = explicit.data;
      modelState = explicitState;
    }
  }

  const derived = await getModelForItem(client, itemId, companyId);
  if (!derived.item) {
    return data(
      {},
      await flash(request, error(null, "Failed to load the selected item"))
    );
  }
  if (!model && derived.model && derived.modelState !== "none") {
    model = derived.model;
    modelState = derived.modelState;
  }

  if (!model) {
    return data(
      {},
      await flash(
        request,
        error(
          null,
          "The selected item has no 3D model. Upload a STEP file on the item's Model tab first."
        )
      )
    );
  }

  // A model that still needs converting can't become a usable instruction while
  // the geometry service is down — refuse rather than create a stuck record.
  const needsConversion =
    modelState === "convertible" || modelState === "failed";
  const assemblerHealthy = await isAssemblerServiceHealthy();
  if (needsConversion && !assemblerHealthy) {
    return data(
      {},
      await flash(
        request,
        error(
          null,
          "The geometry service is unavailable — model conversion can't run right now. Try again shortly."
        )
      )
    );
  }

  const create = await upsertAssemblyInstruction(client, {
    name: derived.item.name || "Assembly",
    modelUploadId: model.id,
    itemId,
    companyId,
    createdBy: userId
  });

  if (create.error || !create.data?.id) {
    return data(
      {},
      await flash(
        request,
        error(create.error, "Failed to create assembly instruction")
      )
    );
  }

  // Lazy conversion: the geometry pipeline only runs for models that are
  // actually used in an assembly. "processing" means a job is already in
  // flight, so only kick one off for unconverted or previously failed models.
  if (modelState === "convertible" || modelState === "failed") {
    await trigger("assembly-convert", {
      companyId,
      modelUploadId: model.id,
      userId
    });
  } else if (modelState === "converted" && assemblerHealthy) {
    // Conversion chains motion planning, but a model converted before this
    // instruction existed may have no plan yet — start planning now so the
    // plan is ready by the time the author clicks Generate Steps. Skipped when
    // the geometry service is down; the author's Generate click starts it later.
    const planJob = await getLatestAssemblyPlanJob(client, model.id);
    const planStatus = planJob.data?.status;
    if (
      !planJob.data ||
      (planStatus !== "Success" &&
        planStatus !== "Processing" &&
        planStatus !== "Queued")
    ) {
      // Pre-create the job row so the instruction page shows "planning" on
      // first load; the worker adopts it via planJobId
      const created = await createAssemblyPlanJob(client, {
        modelUploadId: model.id,
        companyId,
        userId
      });

      await trigger("assembly-plan", {
        companyId,
        modelUploadId: model.id,
        userId,
        ...(created.data?.id ? { planJobId: created.data.id } : {})
      });
    }
  }

  // A model-backed instruction auto-generates its steps: the explorer sees
  // ?autogen=1 and submits Generate once — if the plan is ready it lands
  // instantly, otherwise the submit kicks planning and the awaiting machinery
  // finishes the chain when the plan completes.
  const autogen = modelState !== "none" ? "?autogen=1" : "";
  throw redirect(
    `${path.to.assemblyInstruction(create.data.id)}${autogen}`,
    await flash(request, success("Assembly instruction created"))
  );
}

export default function NewAssemblyInstructionRoute() {
  const { initialValues } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <AssemblyInstructionForm
      initialValues={initialValues}
      onClose={() => navigate(path.to.assemblyInstructions)}
    />
  );
}
