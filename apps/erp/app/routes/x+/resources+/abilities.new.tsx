// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { carbon, respond } from "~/modules/carbon.server";
import {
  AbilityForm,
  abilityValidator,
  getProcessesWithoutAbility
} from "~/modules/resources";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    create: "resources"
  });

  const processes = await getProcessesWithoutAbility(client, companyId);

  return {
    processes: (processes.data ?? []).map((p) => ({
      value: p.id,
      label: p.name
    }))
  };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(abilityValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.resources.ability.create(input.data);
  return respond(args.request, result).redirect(
    path.to.abilities,
    "Created ability"
  );
}

export default function NewAbilityRoute() {
  const { processes } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const onClose = () => navigate(path.to.abilities);

  const initialValues = {
    processId: "",
    recertifyEveryDays: undefined as number | undefined
  };

  return (
    <AbilityForm
      onClose={onClose}
      initialValues={initialValues}
      processes={processes}
    />
  );
}
