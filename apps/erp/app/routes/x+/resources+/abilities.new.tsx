import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate } from "react-router";
import { notifyScheduleInputsChanged } from "~/modules/production";
import {
  AbilityForm,
  abilityValidator,
  ensureProcessAbility,
  getProcessesWithoutAbility
} from "~/modules/resources";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    create: "resources"
  });

  const processes = await getProcessesWithoutAbility(client, companyId);

  return {
    processes: (processes.data ?? []).map((p) => ({
      value: p.id,
      label: p.name
    }))
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "resources"
  });

  const formData = await request.formData();
  const validation = await validator(abilityValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { processId, recertifyEveryDays } = validation.data;

  // An ability IS a process's qualification, so creating one turns the gate on
  // for that process. The picker only offers processes without an ability, so
  // ensureProcessAbility never duplicates.
  const requireAbility = await client
    .from("process")
    .update({ requiresAbility: true, updatedBy: userId })
    .eq("id", processId)
    .eq("companyId", companyId);
  if (requireAbility.error) {
    throw redirect(
      path.to.abilities,
      await flash(
        request,
        error(requireAbility.error, "Failed to create ability")
      )
    );
  }

  const createAbility = await ensureProcessAbility(client, {
    processId,
    companyId,
    userId,
    recertifyEveryDays: recertifyEveryDays ?? null
  });
  if (createAbility.error) {
    throw redirect(
      path.to.abilities,
      await flash(
        request,
        error(createAbility.error, "Failed to create ability")
      )
    );
  }

  // A new gate changes the operator pool for every job on this process — let the
  // scheduler restamp affected jobs.
  await notifyScheduleInputsChanged(
    companyId,
    "ability",
    "Ability created",
    createAbility.data?.id
  );

  throw redirect(
    path.to.abilities,
    await flash(request, success("Created ability"))
  );
}

export default function NewAbilityRoute() {
  const { processes } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const onClose = () => navigate(path.to.abilities);

  const initialValues = {
    processId: "",
    recertifyEveryDays: undefined as number | undefined
  };

  return (
    <AbilityForm
      onClose={onClose}
      initialValues={initialValues}
      processes={processes}
    />
  );
}
