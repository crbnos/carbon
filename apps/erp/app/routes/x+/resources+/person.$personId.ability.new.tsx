// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useNavigate, useParams } from "react-router";
import { employeeAbilityCellValidator } from "~/modules/resources/resources.models";
import { EmployeeAbilityForm } from "~/modules/resources/ui";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "resources",
    role: "employee"
  });

  return null;
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(employeeAbilityCellValidator).request(args, {
    params: ["personId"]
  });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.resources.addEmployeeAbility({
    ...input.data,
    employeeId: input.params.personId
  });
  // The drawer posts through a fetcher, which toasts a refusal.
  if (result.error) return result;
  return respond(args.request, result).redirect(
    path.to.personAbilities(input.params.personId),
    { message: "Added ability" }
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
