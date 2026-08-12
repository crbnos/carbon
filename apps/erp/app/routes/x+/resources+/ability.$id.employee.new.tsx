import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect, useNavigate, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import { notifyScheduleInputsChanged } from "~/modules/production";
import type { Ability } from "~/modules/resources";
import {
  EmployeeAbilityForm,
  employeeAbilityCellValidator,
  resolveEmployeeAbilityExpiresAt,
  upsertEmployeeAbilityCell
} from "~/modules/resources";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    update: "resources"
  });

  const { id: abilityId } = params;
  if (!abilityId) throw notFound("Invalid ability id");

  const formData = await request.formData();
  const validation = await validator(employeeAbilityCellValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { employeeId, lastTrainingDate, expiresAt } = validation.data;

  const resolvedExpiresAt = await resolveEmployeeAbilityExpiresAt(
    client,
    abilityId,
    lastTrainingDate ?? null,
    expiresAt ?? null
  );

  const upsert = await upsertEmployeeAbilityCell(client, {
    employeeId,
    abilityId,
    companyId,
    lastTrainingDate: lastTrainingDate ?? null,
    expiresAt: resolvedExpiresAt
  });
  if (upsert.error) {
    return data(
      {},
      await flash(
        request,
        error(upsert.error, "Failed to add employee to ability")
      )
    );
  }

  await notifyScheduleInputsChanged(
    companyId,
    "ability",
    "Operator qualification added",
    abilityId
  );

  throw redirect(
    path.to.ability(abilityId),
    await flash(request, success("Added employee to ability"))
  );
}

export default function NewEmployeeAbilityRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Invalid ability id");

  const { t } = useLingui();
  const navigate = useNavigate();
  const routeData = useRouteData<{ ability: Ability }>(path.to.ability(id));

  const onClose = () => navigate(path.to.ability(id));

  const initialValues = {
    employeeId: "",
    abilityId: id,
    lastTrainingDate: "",
    expiresAt: ""
  };

  return (
    <EmployeeAbilityForm
      mode="new-employee"
      action={path.to.newEmployeeAbility(id)}
      title={routeData?.ability?.name ?? t`Add Employee`}
      initialValues={initialValues}
      onClose={onClose}
    />
  );
}
