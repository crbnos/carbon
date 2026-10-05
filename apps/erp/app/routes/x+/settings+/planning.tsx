// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { Heading, ScrollArea, VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { parseTime } from "@internationalized/date";
import { msg } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { z } from "zod";
import SettingsSectionHeader from "~/components/SettingsSectionHeader";
import {
  forecastConsumptionValidator,
  getCompanySettings,
  getItemPostingGroupResponsibilities,
  mrpScheduleValidator,
  planningHorizonValidator,
  rescheduleToleranceValidator,
  setDefaultPlanningHorizonDays,
  setDefaultResponsibleEmployee,
  setForecastConsumptionWindow,
  setLocationResponsibleEmployee,
  setRescheduleToleranceDays,
  updateMrpRunTimeSetting,
  upsertItemPostingGroupResponsibility
} from "~/modules/settings";
import {
  ForecastConsumptionCard,
  MrpScheduleCard,
  PlanningHorizonCard,
  RescheduleToleranceCard,
  ResponsibleEmployeeCard
} from "~/modules/settings/ui/Planning";
import { isActiveCompanyEmployee } from "~/modules/shared/shared.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

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
    locations: locations.data ?? [],
    itemGroups: itemGroups.data ?? [],
    responsibilities: responsibilities.data ?? []
  };
}

const employeeIdValidator = z.string().optional();

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "settings"
  });

  const formData = await request.formData();
  const intent = formData.get("intent");

  switch (intent) {
    case "setCompanyDefault": {
      const employeeId = employeeIdValidator.parse(
        formData.get("employeeId") ?? undefined
      );
      if (
        employeeId &&
        !(await isActiveCompanyEmployee(client, companyId, employeeId))
      ) {
        return {
          success: false,
          message: "Choose an employee of this company"
        };
      }
      const result = await setDefaultResponsibleEmployee(client, {
        companyId,
        employeeId: employeeId || null
      });
      if (result.error) {
        return { success: false, message: "Failed to update company default" };
      }
      return { success: true, message: "Company default updated" };
    }
    case "setLocation": {
      const locationId = formData.get("locationId");
      if (typeof locationId !== "string" || !locationId) {
        return { success: false, message: "Location is required" };
      }
      const employeeId = employeeIdValidator.parse(
        formData.get("employeeId") ?? undefined
      );
      if (
        employeeId &&
        !(await isActiveCompanyEmployee(client, companyId, employeeId))
      ) {
        return {
          success: false,
          message: "Choose an employee of this company"
        };
      }
      const result = await setLocationResponsibleEmployee(client, {
        companyId,
        locationId,
        employeeId: employeeId || null,
        userId
      });
      if (result.error) {
        return {
          success: false,
          message: "Failed to update location ownership"
        };
      }
      return { success: true, message: "Location ownership updated" };
    }
    case "setItemGroup": {
      const locationId = formData.get("locationId");
      const itemPostingGroupId = formData.get("itemPostingGroupId");
      if (
        typeof locationId !== "string" ||
        !locationId ||
        typeof itemPostingGroupId !== "string" ||
        !itemPostingGroupId
      ) {
        return {
          success: false,
          message: "Location and item group are required"
        };
      }
      const employeeId = employeeIdValidator.parse(
        formData.get("employeeId") ?? undefined
      );
      if (
        employeeId &&
        !(await isActiveCompanyEmployee(client, companyId, employeeId))
      ) {
        return {
          success: false,
          message: "Choose an employee of this company"
        };
      }
      const result = await upsertItemPostingGroupResponsibility(client, {
        companyId,
        locationId,
        itemPostingGroupId,
        employeeId: employeeId || null,
        userId
      });
      if (result.error) {
        return {
          success: false,
          message: "Failed to update item group ownership"
        };
      }
      return { success: true, message: "Item group ownership updated" };
    }
    case "setTolerance": {
      const validation = await validator(rescheduleToleranceValidator).validate(
        formData
      );
      if (validation.error) {
        return {
          success: false,
          message: "Tolerance must be between 0 and 365 days"
        };
      }
      const result = await setRescheduleToleranceDays(client, {
        companyId,
        days: validation.data.days
      });
      if (result.error) {
        return { success: false, message: "Failed to update tolerance" };
      }
      return { success: true, message: "Reschedule tolerance updated" };
    }
    case "setPlanningHorizon": {
      const validation = await validator(planningHorizonValidator).validate(
        formData
      );
      if (validation.error) {
        return {
          success: false,
          message: "Planning horizon must be a whole number of days"
        };
      }
      const result = await setDefaultPlanningHorizonDays(client, {
        companyId,
        days: validation.data.days ?? null
      });
      if (result.error) {
        return { success: false, message: "Failed to update planning horizon" };
      }
      return { success: true, message: "Planning horizon updated" };
    }
    case "setForecastConsumption": {
      const validation = await validator(forecastConsumptionValidator).validate(
        formData
      );
      if (validation.error) {
        return {
          success: false,
          message: "Consumption window must be between 0 and 52 weeks"
        };
      }
      const result = await setForecastConsumptionWindow(client, {
        companyId,
        backwardPeriods: validation.data.backwardPeriods,
        forwardPeriods: validation.data.forwardPeriods
      });
      if (result.error) {
        return {
          success: false,
          message: "Failed to update forecast consumption"
        };
      }
      return { success: true, message: "Forecast consumption updated" };
    }
    case "setMrpSchedule": {
      const validation =
        await validator(mrpScheduleValidator).validate(formData);
      if (validation.error) {
        return {
          success: false,
          message: "Choose a time for the daily MRP run"
        };
      }
      const { mrpSchedule, mrpRunTime } = validation.data;
      const result = await updateMrpRunTimeSetting(
        client,
        companyId,
        mrpSchedule === "Daily" && mrpRunTime
          ? parseTime(mrpRunTime).toString()
          : null
      );
      if (result.error) {
        return { success: false, message: "Failed to update MRP schedule" };
      }
      return { success: true, message: "MRP schedule updated" };
    }
    default:
      return { success: false, message: `Unknown intent '${String(intent)}'` };
  }
}

export default function PlanningSettingsRoute() {
  const {
    defaultResponsibleEmployee,
    rescheduleToleranceDays,
    defaultPlanningHorizonDays,
    forecastConsumptionBackwardPeriods,
    forecastConsumptionForwardPeriods,
    mrpRunTime,
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
