// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/api/carbon.server";
import { error, notFound } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { RecordOutlet, VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { AbilityEmployeesTable } from "~/modules/resources/ui";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Abilities`,
  to: path.to.abilities
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { api } = await authorize(request, {
    view: "resources",
    role: "employee"
  });

  const { id } = params;
  if (!id) throw notFound("Invalid ability id");

  const ability = await api.resources.getAbility({ abilityId: id });
  if (ability.error) {
    throw redirect(
      path.to.abilities,
      await flash(request, error(ability.error, "Failed to fetch ability"))
    );
  }

  return { ability: ability.data };
}

export default function AbilityRoute() {
  const { ability } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <AbilityEmployeesTable ability={ability} />
      <RecordOutlet />
    </VStack>
  );
}
