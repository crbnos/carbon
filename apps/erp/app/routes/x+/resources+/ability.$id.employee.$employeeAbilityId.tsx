// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import { employeeAbilityCellValidator } from "~/modules/resources/resources.models";
import { getEmployeeAbility } from "~/modules/resources/resources.service";
import type { Ability } from "~/modules/resources/types";
import { EmployeeAbilityForm } from "~/modules/resources/ui";
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

export async function action(args: ActionFunctionArgs) {
  const input = await validator(employeeAbilityCellValidator).request(args, {
    params: ["id"]
  });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.resources.updateEmployeeAbility({
    ...input.data,
    abilityId: input.params.id
  });
  // The drawer posts through a fetcher, which toasts a refusal.
  if (result.error) return result;
  return respond(args.request, result).redirect(
    path.to.ability(input.params.id),
    { message: "Updated employee ability" }
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
