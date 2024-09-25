import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useNavigate, useParams } from "@remix-run/react";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { useRouteData } from "~/hooks";
import type { Ability } from "~/modules/resources";
import {
  AbilityEmployeeStatus,
  EmployeeAbilityForm,
  employeeAbilityValidator,
  upsertEmployeeAbility,
} from "~/modules/resources";
import { path } from "~/utils/path";

export async function action({ params, request }: ActionFunctionArgs) {
  const { abilityId } = params;
  if (!abilityId) throw new Error("abilityId is not found");

  const { client } = await requirePermissions(request, {
    create: "resources",
  });

  const validation = await validator(employeeAbilityValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { employeeId, trainingStatus, trainingDays } = validation.data;

  const insertEmployeeAbility = await upsertEmployeeAbility(client, {
    employeeId,
    abilityId,
    trainingCompleted: trainingStatus === AbilityEmployeeStatus.Complete,
    trainingDays: trainingDays || 0,
  });

  if (insertEmployeeAbility.error) {
    throw redirect(
      path.to.ability(abilityId),
      await flash(
        request,
        error(
          insertEmployeeAbility.error,
          "Failed to insert new employee ability"
        )
      )
    );
  }

  throw redirect(
    path.to.ability(abilityId),
    await flash(request, success("Employee ability created"))
  );
}

export default function NewEmployeeAbilityRoute() {
  const { abilityId } = useParams();
  if (!abilityId) throw new Error("abilityId is not found");

  const navigate = useNavigate();
  const onClose = () => navigate(-1);
  const abilitiesRouteData = useRouteData<{
    ability: Ability;
    weeks: number;
  }>(path.to.ability(abilityId));

  if (!abilitiesRouteData?.ability) return null;

  return (
    <EmployeeAbilityForm
      initialValues={{
        employeeId: "",
        trainingStatus: "",
      }}
      ability={abilitiesRouteData?.ability}
      weeks={abilitiesRouteData.weeks}
      onClose={onClose}
    />
  );
}
