import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  data,
  redirect,
  useLoaderData,
  useNavigate,
  useParams
} from "react-router";
import { useRouteData } from "~/hooks";
import { notifyScheduleInputsChanged } from "~/modules/production";
import type { Ability } from "~/modules/resources";
import {
  EmployeeAbilityForm,
  employeeAbilityCellValidator,
  getEmployeeAbility,
  resolveEmployeeAbilityExpiresAt,
  upsertEmployeeAbilityCell
} from "~/modules/resources";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "resources",
    role: "employee"
  });

  const { id: abilityId, employeeAbilityId } = params;
  if (!abilityId || !employeeAbilityId) {
    throw notFound("Invalid employee ability id");
  }

  const employeeAbility = await getEmployeeAbility(client, employeeAbilityId);
  if (employeeAbility.error || employeeAbility.data?.abilityId !== abilityId) {
    throw redirect(
      path.to.ability(abilityId),
      await flash(
        request,
        error(employeeAbility.error, "Failed to fetch employee ability")
      )
    );
  }

  return { employeeAbility: employeeAbility.data };
}

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
        error(upsert.error, "Failed to update employee ability")
      )
    );
  }

  await notifyScheduleInputsChanged(
    companyId,
    "ability",
    "Operator qualification updated",
    abilityId
  );

  throw redirect(
    path.to.ability(abilityId),
    await flash(request, success("Updated employee ability"))
  );
}

export default function EmployeeAbilityRoute() {
  const { employeeAbility } = useLoaderData<typeof loader>();
  const { id, employeeAbilityId } = useParams();
  if (!id || !employeeAbilityId) throw new Error("Invalid employee ability id");

  const { t } = useLingui();
  const navigate = useNavigate();
  const routeData = useRouteData<{ ability: Ability }>(path.to.ability(id));

  const onClose = () => navigate(path.to.ability(id));

  const initialValues = {
    employeeId: employeeAbility.employeeId,
    abilityId: id,
    lastTrainingDate: employeeAbility.lastTrainingDate ?? "",
    expiresAt: employeeAbility.expiresAt ?? ""
  };

  return (
    <EmployeeAbilityForm
      key={employeeAbilityId}
      mode="edit"
      action={path.to.employeeAbility(id, employeeAbilityId)}
      title={routeData?.ability?.name ?? t`Edit Employee Ability`}
      initialValues={initialValues}
      onClose={onClose}
    />
  );
}
