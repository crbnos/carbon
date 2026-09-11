import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { Heading, ScrollArea, VStack } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { z } from "zod";
import {
  getCompanySettings,
  getItemPostingGroupResponsibilities,
  setDefaultResponsibleEmployee,
  setLocationResponsibleEmployee,
  setRescheduleToleranceDays,
  upsertItemPostingGroupResponsibility
} from "~/modules/settings";
import {
  RescheduleToleranceCard,
  ResponsibleEmployeeCard
} from "~/modules/settings/ui/Planning";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Planning",
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
    locations: locations.data ?? [],
    itemGroups: itemGroups.data ?? [],
    responsibilities: responsibilities.data ?? []
  };
}

const employeeIdValidator = z.string().optional();
const toleranceValidator = z.coerce.number().int().min(0).max(365);

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
      const parsed = toleranceValidator.safeParse(formData.get("days"));
      if (!parsed.success) {
        return {
          success: false,
          message: "Tolerance must be between 0 and 365 days"
        };
      }
      const result = await setRescheduleToleranceDays(client, {
        companyId,
        days: parsed.data
      });
      if (result.error) {
        return { success: false, message: "Failed to update tolerance" };
      }
      return { success: true, message: "Reschedule tolerance updated" };
    }
    default:
      return { success: false, message: `Unknown intent '${String(intent)}'` };
  }
}

export default function PlanningSettingsRoute() {
  const {
    defaultResponsibleEmployee,
    rescheduleToleranceDays,
    locations,
    itemGroups,
    responsibilities
  } = useLoaderData<typeof loader>();

  return (
    <ScrollArea className="w-full h-[calc(100dvh-49px)]">
      <VStack
        spacing={4}
        className="py-12 px-4 max-w-[60rem] h-full mx-auto gap-4"
      >
        <Heading size="h3">
          <Trans>Planning</Trans>
        </Heading>
        <RescheduleToleranceCard
          rescheduleToleranceDays={rescheduleToleranceDays}
        />
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
