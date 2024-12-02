import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useNavigate, useParams } from "@remix-run/react";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { ConfirmDelete } from "~/components/Modals";
import { useRouteData } from "~/hooks";
import type { Ability } from "~/modules/resources";
import { deleteEmployeeAbility } from "~/modules/resources";
import { usePeople } from "~/stores";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "resources",
  });

  const { abilityId, id } = params;
  if (!abilityId) throw new Error("No abilityId provided");
  if (!id) throw new Error("No id provided");

  const removeEmployeeAbility = await deleteEmployeeAbility(client, id);
  if (removeEmployeeAbility.error) {
    throw redirect(
      path.to.ability(abilityId),
      await flash(
        request,
        error(removeEmployeeAbility.error, "Failed to delete employee ability")
      )
    );
  }

  throw redirect(
    path.to.ability(abilityId),
    await flash(request, success("Successfully deleted employee ability"))
  );
}

export default function DeleteEmployeeAbilityRoute() {
  const navigate = useNavigate();
  const { abilityId, id } = useParams();
  const [people] = usePeople();

  if (!id) throw new Error("id is not found");
  if (!abilityId) throw new Error("abilityId is not found");

  const routeData = useRouteData<{
    ability: Ability;
  }>(path.to.ability(abilityId));

  if (!routeData?.ability) return null;
  if (!abilityId) throw new Error("abilityId is not found");

  const employee = Array.isArray(routeData?.ability.employeeAbility)
    ? routeData.ability.employeeAbility.find((ea) => ea.id === id)
    : undefined;

  const onCancel = () => navigate(path.to.ability(abilityId));

  const person = people?.find((p) => p.id === employee?.employeeId);

  const name = person ? person.name : "this employee";
  return (
    <ConfirmDelete
      action={path.to.deleteEmployeeAbility(abilityId, id)}
      name={name}
      text={`Are you sure you want remove delete ${name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
