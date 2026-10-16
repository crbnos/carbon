// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { Heading, ScrollArea, VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { z } from "zod";
import SettingsSectionHeader from "~/components/SettingsSectionHeader";
import {
  forecastConsumptionValidator,
  mrpScheduleValidator,
  planningHorizonValidator,
  rescheduleToleranceValidator,
  settingsToggle
} from "~/modules/settings/settings.models";
import {
  getCompanySettings,
  getItemPostingGroupResponsibilities
} from "~/modules/settings/settings.service";
import {
  ForecastConsumptionCard,
  MrpScheduleCard,
  PlanningHorizonCard,
  PlanningPurchaseOrderApprovalCard,
  RescheduleToleranceCard,
  ResponsibleEmployeeCard
} from "~/modules/settings/ui/Planning";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

const logger = getLogger("erp", "settings", "planning");

export const handle: Handle = {
  breadcrumb: msg`Planning`,
  to: path.to.planningSettings
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "settings"
  });

  const [companySettings, locations, itemGroups, responsibilities] =
    await Promise.all([
      getCompanySettings(client, companyId),
      client
        .from("location")
        .select("id, name, responsibleEmployee")
        .eq("companyId", companyId)
        .order("name"),
      client
        .from("itemPostingGroup")
        .select("id, name")
        .eq("companyId", companyId)
        .eq("active", true)
        .order("name"),
      getItemPostingGroupResponsibilities(client, companyId)
    ]);

  if (!companySettings.data) {
    throw redirect(
      path.to.settings,
      await flash(
        request,
        error(companySettings.error, "Failed to get company settings")
      )
    );
  }

  // A failed list read renders as "no locations / groups / owners", which
  // reads as a clean company; log it so it is not silent.
  for (const [name, read] of [
    ["location", locations],
    ["itemPostingGroup", itemGroups],
    ["itemPostingGroupResponsibility", responsibilities]
  ] as const) {
    if (read.error) {
      logger.error("Failed to load planning settings", {
        companyId,
        table: name,
        error: read.error
      });
    }
  }

  return {
    defaultResponsibleEmployee:
      companySettings.data.defaultResponsibleEmployee ?? null,
    rescheduleToleranceDays: companySettings.data.rescheduleToleranceDays ?? 7,
    defaultPlanningHorizonDays:
      companySettings.data.defaultPlanningHorizonDays ?? null,
    forecastConsumptionBackwardPeriods:
      companySettings.data.forecastConsumptionBackwardPeriods ?? 4,
    forecastConsumptionForwardPeriods:
      companySettings.data.forecastConsumptionForwardPeriods ?? 1,
    mrpRunTime: companySettings.data.mrpRunTime ?? null,
    skipApprovalForPlanningPurchaseOrders:
      companySettings.data.skipApprovalForPlanningPurchaseOrders ?? true,
    locations: locations.data ?? [],
    itemGroups: itemGroups.data ?? [],
    responsibilities: responsibilities.data ?? []
  };
}

// One form per card, told apart by its intent: each becomes the fields of
// `settings.planning.update` it saves. A blank employee clears the rung.
const employeeId = z
  .string()
  .optional()
  .transform((id) => id || null);

const planningSettingsForm = z.discriminatedUnion("intent", [
  z
    .object({ intent: z.literal("setCompanyDefault"), employeeId })
    .transform(({ employeeId }) => ({
      defaultResponsibleEmployee: employeeId
    })),
  z
    .object({
      intent: z.literal("setLocation"),
      locationId: z.string().min(1, { message: "Location is required" }),
      employeeId
    })
    .transform(({ locationId, employeeId }) => ({
      locationResponsibleEmployee: {
        locationId,
        responsibleEmployee: employeeId
      }
    })),
  z
    .object({
      intent: z.literal("setItemGroup"),
      locationId: z.string().min(1, { message: "Location is required" }),
      itemPostingGroupId: z
        .string()
        .min(1, { message: "Item group is required" }),
      employeeId
    })
    .transform(({ locationId, itemPostingGroupId, employeeId }) => ({
      itemGroupResponsibleEmployee: {
        locationId,
        itemPostingGroupId,
        responsibleEmployee: employeeId
      }
    })),
  settingsToggle(
    "setPlanningPurchaseOrderApproval",
    "skipApprovalForPlanningPurchaseOrders"
  ),
  rescheduleToleranceValidator
    .extend({ intent: z.literal("setTolerance") })
    .transform(({ days }) => ({ rescheduleToleranceDays: days })),
  planningHorizonValidator
    .extend({ intent: z.literal("setPlanningHorizon") })
    .transform(({ days }) => ({ defaultPlanningHorizonDays: days ?? null })),
  forecastConsumptionValidator
    .extend({ intent: z.literal("setForecastConsumption") })
    .transform(({ backwardPeriods, forwardPeriods }) => ({
      forecastConsumptionBackwardPeriods: backwardPeriods,
      forecastConsumptionForwardPeriods: forwardPeriods
    })),
  mrpScheduleValidator
    .safeExtend({ intent: z.literal("setMrpSchedule") })
    .transform(({ mrpSchedule, mrpRunTime }) => ({
      mrpRunTime: mrpSchedule === "Daily" && mrpRunTime ? mrpRunTime : null
    }))
]);

export async function action(args: ActionFunctionArgs) {
  const input = await validator(planningSettingsForm).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  return api.settings.updatePlanningSettings(input.data);
}

export default function PlanningSettingsRoute() {
  const {
    defaultResponsibleEmployee,
    rescheduleToleranceDays,
    defaultPlanningHorizonDays,
    forecastConsumptionBackwardPeriods,
    forecastConsumptionForwardPeriods,
    mrpRunTime,
    skipApprovalForPlanningPurchaseOrders,
    locations,
    itemGroups,
    responsibilities
  } = useLoaderData<typeof loader>();

  return (
    <ScrollArea className="w-full h-[calc(100dvh-var(--topbar-height)-var(--content-inset))]">
      <VStack
        spacing={4}
        className="py-12 px-4 max-w-[60rem] h-full mx-auto gap-4"
      >
        <Heading size="h3">
          <Trans>Planning</Trans>
        </Heading>

        <SettingsSectionHeader>
          <Trans>MRP Suggestions</Trans>
        </SettingsSectionHeader>
        <MrpScheduleCard mrpRunTime={mrpRunTime} />
        <RescheduleToleranceCard
          rescheduleToleranceDays={rescheduleToleranceDays}
        />
        <PlanningHorizonCard
          defaultPlanningHorizonDays={defaultPlanningHorizonDays}
        />
        <ForecastConsumptionCard
          backwardPeriods={forecastConsumptionBackwardPeriods}
          forwardPeriods={forecastConsumptionForwardPeriods}
        />
        <PlanningPurchaseOrderApprovalCard
          skipApprovalForPlanningPurchaseOrders={
            skipApprovalForPlanningPurchaseOrders
          }
        />

        <SettingsSectionHeader>
          <Trans>Ownership</Trans>
        </SettingsSectionHeader>
        <ResponsibleEmployeeCard
          defaultResponsibleEmployee={defaultResponsibleEmployee}
          locations={locations}
          itemGroups={itemGroups}
          responsibilities={responsibilities}
        />
      </VStack>
    </ScrollArea>
  );
}
