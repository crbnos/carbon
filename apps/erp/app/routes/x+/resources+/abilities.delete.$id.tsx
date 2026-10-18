// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize, respond } from "@carbon/api/carbon.server";
import { error, notFound } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { api } = await authorize(request, {
    view: "resources"
  });

  const { id } = params;
  if (!id) throw notFound("Invalid ability id");

  const ability = await api.resources.getAbility({ abilityId: id });
  if (ability.error) {
    throw redirect(
      path.to.abilities,
      await flash(request, error(ability.error, "Failed to get ability"))
    );
  }

  return {
    ability: ability.data
  };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, { params: ["id"] });
  if ("invalid" in input) return input.invalid;
  const { api } = await authorize(args.request);
  const result = await api.resources.deactivateAbility({
    id: input.params.id
  });
  return respond(args.request, result).redirect(path.to.abilities, {
    message: "Successfully deactivated ability"
  });
}

export default function DeleteAbilityRoute() {
  const { id } = useParams();
  const { ability } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const { t } = useLingui();

  if (!ability) return null;
  if (!id) throw new Error("id is not found");

  const onCancel = () => navigate(path.to.abilities);
  const name = ability.name;

  return (
    <ConfirmDelete
      action={path.to.deleteAbility(id)}
      name={name}
      text={t`Are you sure you want to deactivate the ability: ${name}?`}
      onCancel={onCancel}
    />
  );
}
