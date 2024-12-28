import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useLoaderData, useNavigate, useParams } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { useRouteData } from "~/hooks";
import type { Ability } from "~/modules/resources";
import {
  AbilityEmployeeStatus,
  EmployeeAbilityForm,
  employeeAbilityValidator,
  getEmployeeAbility,
  getTrainingStatus,
  upsertEmployeeAbility,
} from "~/modules/resources";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "resources",
  });

  // get the abilityId and id from the params
  const { abilityId, id } = params;
  if (!abilityId) {
    throw new Error("Ability ID not found");
  }

  if (!id) {
    throw new Error("Employee ID not found");
  }

  const employeeAbility = await getEmployeeAbility(client, abilityId, id);
  if (employeeAbility.error) {
    redirect(
      path.to.abilities,
      await flash(
        request,
        error(employeeAbility.error, "Failed to get employee ability")
      )
    );
  }

  return { employeeAbility: employeeAbility.data };
}

export async function action({ params, request }: ActionFunctionArgs) {
  const { abilityId, id } = params;
  if (!abilityId) throw new Error("abilityId is not found");
  if (!id) throw new Error("id is not found");

  const { client, companyId } = await requirePermissions(request, {
    create: "resources",
  });

  const validation = await validator(employeeAbilityValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { employeeId, trainingStatus, trainingDays } = validation.data;

  const updateEmployeeAbility = await upsertEmployeeAbility(client, {
    id,
    employeeId,
    abilityId,
    trainingCompleted: trainingStatus === AbilityEmployeeStatus.Complete,
    trainingDays: trainingDays || 0,
    companyId,
  });

  if (updateEmployeeAbility.error) {
    throw redirect(
      path.to.ability(abilityId),
      await flash(
        request,
        error(
          updateEmployeeAbility.error,
          "Failed to insert new employee ability"
        )
      )
    );
  }

  throw redirect(
    path.to.ability(abilityId),
    await flash(request, success("Employee ability updated"))
  );
}

export default function EmployeeAbilityRoute() {
  const navigate = useNavigate();
  const { abilityId } = useParams();
  if (!abilityId) throw new Error("abilityId is not found");
  const { employeeAbility } = useLoaderData<typeof loader>();
  const routeData = useRouteData<{
    ability: Ability;
    weeks: number;
  }>(path.to.ability(abilityId));

  const initialValues = {
    employeeId: employeeAbility?.employeeId ?? "",
    trainingStatus: getTrainingStatus(employeeAbility) ?? "",
    trainingPercent: getTrainingPercent(
      employeeAbility?.trainingDays,
      routeData?.weeks
    ),
  };

  return (
    <EmployeeAbilityForm
      key={`${initialValues.employeeId}${abilityId}`}
      ability={routeData?.ability}
      initialValues={initialValues}
      weeks={routeData?.weeks ?? 4}
      onClose={() => navigate(-1)}
    />
  );
}

function getTrainingPercent(traniningDays?: number, weeks?: number) {
  if (!traniningDays || !weeks) return 0;
  return traniningDays / 5 / weeks;
}
