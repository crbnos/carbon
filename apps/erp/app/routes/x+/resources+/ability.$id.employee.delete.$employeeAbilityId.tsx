// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs } from "react-router";
import { useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { useRouteData } from "~/hooks";
import type { Ability } from "~/modules/resources/types";
import { path } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, {
    params: ["id", "employeeAbilityId"]
  });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.resources.removeEmployeeAbility({
    abilityId: input.params.id,
    employeeAbilityId: input.params.employeeAbilityId
  });
  return respond(args.request, result).redirect(
    path.to.ability(input.params.id),
    { message: "Removed employee from ability" }
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
