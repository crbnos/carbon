import { assertIsPost, error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { redirect, useLoaderData, useNavigate } from "react-router";
import { notifyScheduleInputsChanged } from "~/modules/production";
import {
  ensureProcessAbility,
  getProcess,
  ProcessForm,
  processValidator,
  upsertProcess
} from "~/modules/resources";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";
import { getCompanyId, processesQuery } from "~/utils/react-query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "resources"
  });

  const { processId } = params;
  if (!processId) throw notFound("processId was not found");

  const process = await getProcess(client, processId);

  if (process.error) {
    throw redirect(
      path.to.processes,
      await flash(request, error(process.error, "Failed to get process"))
    );
  }

  return {
    process: process.data
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "resources"
  });

  const formData = await request.formData();
  const modal = formData.get("type") === "modal";
  const validation = await validator(processValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...d } = validation.data;
  if (!id) throw notFound("Process ID was not found");

  const existingProcess = await getProcess(client, id);
  const previouslyRequiredAbility =
    existingProcess.data?.requiresAbility ?? false;

  const createProcess = await upsertProcess(client, {
    id,
    ...d,
    companyId,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });

  if (createProcess.error) {
    throw redirect(
      path.to.processes,
      await flash(
        request,
        error(createProcess.error, "Failed to create process.")
      )
    );
  }

  let abilityId: string | undefined;
  if (d.requiresAbility) {
    const abilityResult = await ensureProcessAbility(client, {
      processId: id,
      processName: d.name,
      companyId,
      userId
    });
    if (abilityResult.error) {
      // Don't leave an unschedulable process behind: requiresAbility=true
      // without its backing ability gates scheduling on a qualification
      // nobody can hold
      await client
        .from("process")
        .update({ requiresAbility: previouslyRequiredAbility })
        .eq("id", id)
        .eq("companyId", companyId);
      throw redirect(
        path.to.processes,
        await flash(
          request,
          error(abilityResult.error, "Failed to create process ability.")
        )
      );
    }
    abilityId = abilityResult.data?.id;
  } else if (previouslyRequiredAbility) {
    const ability = await client
      .from("ability")
      .select("id")
      .eq("processId", id)
      .eq("companyId", companyId)
      .maybeSingle();
    abilityId = ability.data?.id;
  }

  const requiresAbility = d.requiresAbility ?? false;
  if (requiresAbility !== previouslyRequiredAbility) {
    // A requiresAbility flip changes the operator gate for every job with an
    // unfinished operation on this process, so the schedule must be recomputed.
    // Prefer the process's ability for precise scoping (the "ability" kind
    // resolves ability → process → affected jobs); fall back to a company-wide
    // mark when the ability can't be resolved, so the notify NEVER silently
    // no-ops — that gap is why a requiresAbility change could leave the forecast
    // stale.
    const reason = requiresAbility
      ? `Process "${d.name}" now requires an ability`
      : `Process "${d.name}" no longer requires an ability`;
    if (abilityId) {
      await notifyScheduleInputsChanged(
        companyId,
        "ability",
        reason,
        abilityId
      );
    } else {
      await notifyScheduleInputsChanged(companyId, "reorder", reason);
    }
  }

  return modal ? createProcess : redirect(path.to.processes);
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  window.clientCache?.setQueryData(
    processesQuery(getCompanyId()).queryKey,
    null
  );
  return await serverAction();
}

export default function ProcessRoute() {
  const { process } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const onClose = () => navigate(-1);

  const initialValues = {
    id: process.id!,
    name: process.name!,
    processType: process.processType ?? "Process",
    defaultStandardFactor: process.defaultStandardFactor ?? "Minutes/Piece",
    workCenters: process.workCenters ?? [],
    // @ts-ignore
    suppliers: (process.suppliers ?? []).map((s) => s.id) ?? [],
    ...getCustomFields(process.customFields),
    completeAllOnScan: process.completeAllOnScan ?? false,
    requiresAbility: process.requiresAbility ?? false
  };

  return <ProcessForm initialValues={initialValues} onClose={onClose} />;
}
