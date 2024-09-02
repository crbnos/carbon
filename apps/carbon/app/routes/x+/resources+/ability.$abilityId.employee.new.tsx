import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { useNavigate, useParams } from "@remix-run/react";
import { useRouteData } from "~/hooks";
import type { Ability } from "~/modules/resources";
import {
  AbilityEmployeeStatus,
  EmployeeAbilityForm,
  employeeAbilityValidator,
  upsertEmployeeAbility,
} from "~/modules/resources";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { path } from "~/utils/path";
import { error, success } from "~/utils/result";

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
