// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  RecordOutlet,
  VStack
} from "@carbon/react";
import { datetime, redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Plural, Trans } from "@lingui/react/macro";
import { LuTriangleAlert } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import {
  getAbility,
  getAbilityScheduleImpact
} from "~/modules/resources/resources.service";
import { AbilityEmployeesTable } from "~/modules/resources/ui";
import { getCompanyTimeZone } from "~/modules/shared/shared.service";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

const logger = getLogger("erp", "ability");

export const handle: Handle = {
  breadcrumb: msg`Abilities`,
  to: path.to.abilities
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
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

  // The warning is a hint: if its counts can't be read, the page still loads.
  const impact = ability.data.processId
    ? await getAbilityScheduleImpact(client, companyId, ability.data.processId)
    : null;
  if (impact?.error) {
    logger.error("Failed to read the ability's schedule impact", {
      companyId,
      abilityId: id,
      error: impact.error
    });
  }
  // Qualified today, by the scheduler's rule: not past the expiry day.
  const today = datetime
    .today(await getCompanyTimeZone(client, companyId))
    .toString();
  const qualified = (ability.data.employeeAbility ?? []).filter(
    (row) => !row.expiresAt || row.expiresAt.slice(0, 10) > today
  ).length;
  return {
    ability: ability.data,
    impact: impact && !impact.error ? { ...impact.data, qualified } : null
  };
}

export default function AbilityRoute() {
  const { ability, impact } = useLoaderData<typeof loader>();
  const qualified = impact?.qualified ?? 0;

  return (
    <VStack spacing={0} className="h-full">
      {impact?.requiresAbility &&
        (qualified === 0 || impact.unschedulable > 0) && (
          <div className="w-full p-4 pb-0">
            <Alert variant="warning">
              <LuTriangleAlert className="h-4 w-4" />
              <AlertTitle>
                {qualified === 0 ? (
                  <Trans>Nobody is qualified for {ability.name}</Trans>
                ) : (
                  <Trans>Some of this process's work can't be scheduled</Trans>
                )}
              </AlertTitle>
              <AlertDescription>
                {qualified === 0 ? (
                  <Plural
                    value={impact.unschedulable}
                    _0="Its process needs a qualified operator, so its operations can't be scheduled until someone is added."
                    one="Its process needs a qualified operator: # operation can't be scheduled until someone is added."
                    other="Its process needs a qualified operator: # operations can't be scheduled until someone is added."
                  />
                ) : (
                  <Plural
                    value={impact.unschedulable}
                    one="# operation of this process can't be scheduled. The Forecast shows why, and who is qualified."
                    other="# operations of this process can't be scheduled. The Forecast shows why, and who is qualified."
                  />
                )}
              </AlertDescription>
            </Alert>
          </div>
        )}
      <AbilityEmployeesTable ability={ability} />
      <RecordOutlet />
    </VStack>
  );
}
