import { error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { AbilityEmployeesTable, getAbility } from "~/modules/resources";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Abilities`,
  to: path.to.abilities
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "resources",
    role: "employee"
  });

  const { id } = params;
  if (!id) throw notFound("Invalid ability id");

  const ability = await getAbility(client, id);
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
      <Outlet />
    </VStack>
  );
}
