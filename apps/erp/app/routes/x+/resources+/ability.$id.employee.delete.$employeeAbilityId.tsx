import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs } from "react-router";
import { redirect, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { useRouteData } from "~/hooks";
import { notifyScheduleInputsChanged } from "~/modules/production";
import type { Ability } from "~/modules/resources";
import { deleteEmployeeAbility } from "~/modules/resources";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "resources"
  });

  const { id: abilityId, employeeAbilityId } = params;
  if (!abilityId || !employeeAbilityId) {
    throw notFound("Invalid employee ability id");
  }

  // Soft delete — employee abilities keep their training history
  const remove = await deleteEmployeeAbility(client, employeeAbilityId);
  if (remove.error) {
    throw redirect(
      path.to.ability(abilityId),
      await flash(
        request,
        error(remove.error, "Failed to remove employee from ability")
      )
    );
  }

  await notifyScheduleInputsChanged(
    companyId,
    "ability",
    "Operator qualification removed",
    abilityId
  );

  throw redirect(
    path.to.ability(abilityId),
    await flash(request, success("Removed employee from ability"))
  );
}

export default function DeleteEmployeeAbilityRoute() {
  const { id, employeeAbilityId } = useParams();
  if (!id || !employeeAbilityId) throw new Error("Invalid employee ability id");

  const { t } = useLingui();
  const navigate = useNavigate();
  const routeData = useRouteData<{ ability: Ability }>(path.to.ability(id));
  const name = routeData?.ability?.name ?? t`this ability`;

  const onCancel = () => navigate(path.to.ability(id));

  return (
    <ConfirmDelete
      action={path.to.deleteEmployeeAbility(id, employeeAbilityId)}
      name={name}
      text={t`Are you sure you want to remove this employee from ${name}? The training history is kept and the employee can be re-added later.`}
      deleteText={t`Remove`}
      onCancel={onCancel}
    />
  );
}
