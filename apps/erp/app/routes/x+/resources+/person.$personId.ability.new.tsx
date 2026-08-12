import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useNavigate, useParams } from "react-router";
import { notifyScheduleInputsChanged } from "~/modules/production";
import {
  EmployeeAbilityForm,
  employeeAbilityCellValidator,
  resolveEmployeeAbilityExpiresAt,
  upsertEmployeeAbilityCell
} from "~/modules/resources";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "resources",
    role: "employee"
  });

  return null;
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    update: "resources"
  });

  const { personId } = params;
  if (!personId) throw notFound("Invalid person id");

  const formData = await request.formData();
  const validation = await validator(employeeAbilityCellValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { abilityId, lastTrainingDate, expiresAt } = validation.data;

  const resolvedExpiresAt = await resolveEmployeeAbilityExpiresAt(
    client,
    abilityId,
    lastTrainingDate ?? null,
    expiresAt ?? null
  );

  const upsert = await upsertEmployeeAbilityCell(client, {
    employeeId: personId,
    abilityId,
    companyId,
    lastTrainingDate: lastTrainingDate ?? null,
    expiresAt: resolvedExpiresAt
  });
  if (upsert.error) {
    return data(
      {},
      await flash(request, error(upsert.error, "Failed to add ability"))
    );
  }

  await notifyScheduleInputsChanged(
    companyId,
    "ability",
    "Operator qualification added",
    abilityId
  );

  throw redirect(
    path.to.personAbilities(personId),
    await flash(request, success("Added ability"))
  );
}

export default function NewPersonAbilityRoute() {
  const { personId } = useParams();
  if (!personId) throw new Error("Invalid person id");

  const { t } = useLingui();
  const navigate = useNavigate();

  const onClose = () => navigate(path.to.personAbilities(personId));

  const initialValues = {
    employeeId: personId,
    abilityId: "",
    lastTrainingDate: "",
    expiresAt: ""
  };

  return (
    <EmployeeAbilityForm
      mode="new-ability"
      action={path.to.newPersonAbility(personId)}
      title={t`Add Ability`}
      initialValues={initialValues}
      onClose={onClose}
    />
  );
}
