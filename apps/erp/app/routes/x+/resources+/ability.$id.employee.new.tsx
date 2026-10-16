// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs } from "react-router";
import { useNavigate, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import { employeeAbilityCellValidator } from "~/modules/resources/resources.models";
import type { Ability } from "~/modules/resources/types";
import { EmployeeAbilityForm } from "~/modules/resources/ui";
import { path } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(employeeAbilityCellValidator).request(args, {
    params: ["id"]
  });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.resources.addEmployeeAbility({
    ...input.data,
    abilityId: input.params.id
  });
  // The drawer posts through a fetcher, which toasts a refusal.
  if (result.error) return result;
  return respond(args.request, result).redirect(
    path.to.ability(input.params.id),
    { message: "Added employee to ability" }
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
