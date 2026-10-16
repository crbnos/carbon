// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { Submit, ValidatedForm, validator } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  HStack,
  Label,
  ScrollArea,
  Separator,
  Switch,
  toast,
  VStack
} from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback } from "react";
import { LuMapPin } from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { z } from "zod";
import { Users } from "~/components/Form";
import { SettingsPage, SettingsPageHeading } from "~/components/SettingsPage";
import {
  jobCompletedValidator,
  settingsToggle
} from "~/modules/settings/settings.models";
import type { updateProductionSettings } from "~/modules/settings/settings.server";
import { getCompanySettings } from "~/modules/settings/settings.service";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Production`,
  to: path.to.productionSettings
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "settings"
  });

  const [companySettings, locations] = await Promise.all([
    getCompanySettings(client, companyId),
    client
      .from("location")
      .select("id, name, requiresStaffing")
      .eq("companyId", companyId)
      .order("name")
  ]);

  if (!companySettings.data)
    throw redirect(
      path.to.settings,
      await flash(
        request,
        error(companySettings.error, "Failed to get company settings")
      )
    );
  return {
    companySettings: companySettings.data,
    locations: locations.data ?? []
  };
}

// One form per card, told apart by its intent: each becomes the fields of
// `settings.production.update` it saves.
const productionSettingsForm = z.discriminatedUnion("intent", [
  jobCompletedValidator
    .extend({ intent: z.literal("jobCompleted") })
    .transform((form) => ({
      inventoryJobCompletedNotificationGroup:
        form.inventoryJobCompletedNotificationGroup ?? [],
      salesJobCompletedNotificationGroup:
        form.salesJobCompletedNotificationGroup ?? []
    })),
  settingsToggle("operationTimer", "autoStartOperationTimer"),
  settingsToggle("jobTravelerMaterials", "includeMaterialsOnTraveler"),
  settingsToggle("jobTravelerOperations", "includeOperationsOnTraveler"),
  settingsToggle(
    "autoSelectMaterialWithoutPickingListToggle",
    "autoSelectMaterialWithoutPickingList"
  ),
  z
    .object({
      intent: z.literal("locationRequiresStaffing"),
      locationId: z.string().min(1, { message: "Missing location" }),
      enabled: z.string().optional()
    })
    .transform(({ locationId, enabled }) => ({
      locationStaffing: { locationId, requiresStaffing: enabled === "true" }
    }))
]);

type ProductionSettingsSaved = z.output<typeof updateProductionSettings.input>;

export async function action(args: ActionFunctionArgs) {
  const input = await validator(productionSettingsForm).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  return api.settings.updateProductionSettings(input.data);
}

export default function ProductionSettingsRoute() {
  const { t } = useLingui();
  const { companySettings, locations } = useLoaderData<typeof loader>();
  const fetcher = useAction<typeof action>({
    onSuccess: ({ data }) => {
      if (data) toast.success(productionSettingsMessage(data));
    }
  });
  const notificationsFetcher = useAction<typeof action>({
    onSuccess: () => toast.success(t`Job notification settings updated`)
  });
  const staffingFetcher = useAction<typeof action>({
    onSuccess: ({ data }) => {
      if (data) toast.success(productionSettingsMessage(data));
    }
  });

  function productionSettingsMessage(data: ProductionSettingsSaved) {
    if (data.autoStartOperationTimer !== undefined) {
      return data.autoStartOperationTimer
        ? t`Operation timer auto-start enabled`
        : t`Operation timer auto-start disabled`;
    }
    if (data.includeMaterialsOnTraveler !== undefined) {
      return data.includeMaterialsOnTraveler
        ? t`Traveler materials enabled`
        : t`Traveler materials disabled`;
    }
    if (data.includeOperationsOnTraveler !== undefined) {
      return data.includeOperationsOnTraveler
        ? t`Traveler operations enabled`
        : t`Traveler operations disabled`;
    }
    if (data.autoSelectMaterialWithoutPickingList !== undefined) {
      return data.autoSelectMaterialWithoutPickingList
        ? t`Material pre-selection enabled`
        : t`Material pre-selection disabled`;
    }
    if (data.locationStaffing) {
      return data.locationStaffing.requiresStaffing
        ? t`Staffing requirement enabled`
        : t`Staffing requirement disabled`;
    }
    return t`Production settings updated`;
  }

  const isToggling = fetcher.state !== "idle";

  const includeMaterialsOnTraveler =
    (companySettings as { includeMaterialsOnTraveler?: boolean | null })
      .includeMaterialsOnTraveler ?? false;
  const includeOperationsOnTraveler =
    (companySettings as { includeOperationsOnTraveler?: boolean | null })
      .includeOperationsOnTraveler ?? true;
  const autoStartOperationTimer =
    companySettings.autoStartOperationTimer ?? false;
  const autoSelectMaterialWithoutPickingList =
    companySettings.autoSelectMaterialWithoutPickingList ?? false;

  const handleTravelerMaterialsToggle = useCallback(
    (checked: boolean) => {
      fetcher.submit(
        { intent: "jobTravelerMaterials", enabled: String(checked) },
        { method: "POST" }
      );
    },
    [fetcher]
  );

  const handleTravelerOperationsToggle = useCallback(
    (checked: boolean) => {
      fetcher.submit(
        { intent: "jobTravelerOperations", enabled: String(checked) },
        { method: "POST" }
      );
    },
    [fetcher]
  );

  const handleOperationTimerToggle = useCallback(
    (checked: boolean) => {
      fetcher.submit(
        { intent: "operationTimer", enabled: String(checked) },
        { method: "POST" }
      );
    },
    [fetcher]
  );

  const handleAutoSelectMaterialToggle = useCallback(
    (checked: boolean) => {
      fetcher.submit(
        {
          intent: "autoSelectMaterialWithoutPickingListToggle",
          enabled: String(checked)
        },
        { method: "POST" }
      );
    },
    [fetcher]
  );

  const handleStaffingToggle = useCallback(
    (locationId: string, checked: boolean) => {
      staffingFetcher.submit(
        {
          intent: "locationRequiresStaffing",
          locationId,
          enabled: String(checked)
        },
        { method: "POST" }
      );
    },
    [staffingFetcher]
  );

  return (
    <ScrollArea className="w-full h-[calc(100dvh-var(--topbar-height)-var(--content-inset))]">
      <SettingsPage className="gap-4">
        <SettingsPageHeading>
          <Trans>Production</Trans>
        </SettingsPageHeading>

        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Job Traveler</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>Choose what appears on the printed job traveler.</Trans>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <VStack spacing={4}>
              <HStack className="justify-between items-center w-full">
                <VStack className="items-start" spacing={1}>
                  <span className="font-medium">
                    {includeOperationsOnTraveler ? (
                      <Trans>Operations are included</Trans>
                    ) : (
                      <Trans>Operations are not included</Trans>
                    )}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {includeOperationsOnTraveler ? (
                      <Trans>
                        The traveler lists each routing operation with its
                        expected times and scan barcodes.
                      </Trans>
                    ) : (
                      <Trans>
                        Add an operations section that lists each routing
                        operation with its expected times and scan barcodes.
                      </Trans>
                    )}
                  </span>
                </VStack>
                <Switch
                  checked={includeOperationsOnTraveler}
                  onCheckedChange={handleTravelerOperationsToggle}
                  disabled={isToggling}
                />
              </HStack>

              <Separator />

              <HStack className="justify-between items-center w-full">
                <VStack className="items-start" spacing={1}>
                  <span className="font-medium">
                    {includeMaterialsOnTraveler ? (
                      <Trans>Materials are included</Trans>
                    ) : (
                      <Trans>Materials are not included</Trans>
                    )}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {includeMaterialsOnTraveler ? (
                      <Trans>
                        The traveler lists each item on the bill of materials
                        with its quantity.
                      </Trans>
                    ) : (
                      <Trans>
                        Add a materials section that lists each item on the bill
                        of materials with its quantity.
                      </Trans>
                    )}
                  </span>
                </VStack>
                <Switch
                  checked={includeMaterialsOnTraveler}
                  onCheckedChange={handleTravelerMaterialsToggle}
                  disabled={isToggling}
                />
              </HStack>
            </VStack>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Shop Floor</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>
                Control how operators pick material and track time on the shop
                floor.
              </Trans>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <VStack spacing={4}>
              <HStack className="justify-between items-center w-full">
                <VStack className="items-start" spacing={1}>
                  <span className="font-medium">
                    {autoStartOperationTimer ? (
                      <Trans>The timer starts automatically</Trans>
                    ) : (
                      <Trans>The timer starts manually</Trans>
                    )}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {autoStartOperationTimer ? (
                      <Trans>
                        Opening an operation starts its timer, so time is
                        tracked from the moment work begins.
                      </Trans>
                    ) : (
                      <Trans>
                        Operators start the timer themselves when they begin an
                        operation.
                      </Trans>
                    )}
                  </span>
                </VStack>
                <Switch
                  checked={autoStartOperationTimer}
                  onCheckedChange={handleOperationTimerToggle}
                  disabled={isToggling}
                />
              </HStack>

              <Separator />

              <HStack className="justify-between items-center w-full">
                <VStack className="items-start" spacing={1}>
                  <span className="font-medium">
                    {autoSelectMaterialWithoutPickingList ? (
                      <Trans>Material is pre-selected</Trans>
                    ) : (
                      <Trans>Operators start on the Scan tab</Trans>
                    )}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {autoSelectMaterialWithoutPickingList ? (
                      <Trans>
                        Tracked material is pre-selected by pick order (FEFO),
                        even without a picking list.
                      </Trans>
                    ) : (
                      <Trans>
                        Without a picking list, operators pick material from the
                        Scan tab.
                      </Trans>
                    )}
                  </span>
                </VStack>
                <Switch
                  checked={autoSelectMaterialWithoutPickingList}
                  onCheckedChange={handleAutoSelectMaterialToggle}
                  disabled={isToggling}
                />
              </HStack>
            </VStack>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Scheduling</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>
                Require an assigned operator before the scheduler places work at
                a location. When on, unstaffed work centers get no work and an
                operation with no manned coverage shows as unschedulable.
                Lights-out (24×7) work centers are exempt.
              </Trans>
            </CardDescription>
          </CardHeader>
          <CardContent>
            {locations.length > 0 ? (
              <div className="flex flex-col">
                {locations.map((location) => (
                  <HStack
                    key={location.id}
                    className="justify-between items-center w-full py-2.5 border-t border-border/50 first:border-t-0"
                  >
                    <HStack spacing={2}>
                      <div className="size-7 bg-muted rounded-lg flex items-center justify-center shrink-0">
                        <LuMapPin className="size-4 text-muted-foreground" />
                      </div>
                      <span className="text-sm font-medium">
                        {location.name}
                      </span>
                    </HStack>
                    <HStack spacing={2}>
                      <span className="text-xs text-muted-foreground">
                        {location.requiresStaffing ? (
                          <Trans>Staffing required</Trans>
                        ) : (
                          <Trans>Staffing optional</Trans>
                        )}
                      </span>
                      <Switch
                        checked={location.requiresStaffing ?? false}
                        onCheckedChange={(checked) =>
                          handleStaffingToggle(location.id, checked)
                        }
                        disabled={staffingFetcher.state !== "idle"}
                      />
                    </HStack>
                  </HStack>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                <Trans>No locations found.</Trans>
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <ValidatedForm
            method="post"
            validator={jobCompletedValidator}
            defaultValues={{
              inventoryJobCompletedNotificationGroup:
                companySettings.inventoryJobCompletedNotificationGroup ?? [],
              salesJobCompletedNotificationGroup:
                companySettings.salesJobCompletedNotificationGroup ?? []
            }}
            fetcher={notificationsFetcher}
          >
            <input type="hidden" name="intent" value="jobCompleted" />
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trans>Notifications</Trans>
              </CardTitle>
              <CardDescription>
                <Trans>
                  Configure notifications for when jobs are completed.
                </Trans>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-8 max-w-[400px]">
                <div className="flex flex-col gap-2">
                  <Label>
                    <Trans>Inventory Job Notifications</Trans>
                  </Label>
                  <Users
                    name="inventoryJobCompletedNotificationGroup"
                    label={t`Who should receive notifications when an inventory job is completed?`}
                    type="employee"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>
                    <Trans>Sales Job Notifications</Trans>
                  </Label>
                  <Users
                    name="salesJobCompletedNotificationGroup"
                    label={t`Who should receive notifications when a sales job is completed?`}
                    type="employee"
                  />
                </div>
              </div>
            </CardContent>
            <CardFooter>
              <Submit
                isDisabled={notificationsFetcher.state !== "idle"}
                isLoading={notificationsFetcher.state !== "idle"}
              >
                <Trans>Save</Trans>
              </Submit>
            </CardFooter>
          </ValidatedForm>
        </Card>
      </SettingsPage>
    </ScrollArea>
  );
}
