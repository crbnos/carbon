import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { Submit, ValidatedForm, validator } from "@carbon/form";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Heading,
  HStack,
  Label,
  ScrollArea,
  Separator,
  Switch,
  toast,
  VStack
} from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData } from "react-router";
import { Users } from "~/components/Form";
import {
  getCompanySettings,
  jobCompletedValidator,
  updateAutoSelectMaterialWithoutPickingListSetting,
  updateIncludeMaterialsOnTravelerSetting
} from "~/modules/settings";
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

  const companySettings = await getCompanySettings(client, companyId);

  if (!companySettings.data)
    throw redirect(
      path.to.settings,
      await flash(
        request,
        error(companySettings.error, "Failed to get company settings")
      )
    );
  return { companySettings: companySettings.data };
}

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "settings"
  });

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "jobCompleted") {
    const validation = await validator(jobCompletedValidator).validate(
      formData
    );

    if (validation.error) {
      return { success: false, message: "Invalid form data" };
    }

    const update = await client
      .from("companySettings")
      .update({
        inventoryJobCompletedNotificationGroup:
          validation.data.inventoryJobCompletedNotificationGroup ?? [],
        salesJobCompletedNotificationGroup:
          validation.data.salesJobCompletedNotificationGroup ?? []
      })
      .eq("id", companyId);

    if (update.error) return { success: false, message: update.error.message };

    return { success: true, message: "Job notification settings updated" };
  }

  if (intent === "operationTimer") {
    const autoStartOperationTimer = formData.get("enabled") === "true";

    const update = await client
      .from("companySettings")
      .update({ autoStartOperationTimer })
      .eq("id", companyId);

    if (update.error) return { success: false, message: update.error.message };

    return {
      success: true,
      message: `Operation timer auto-start ${
        autoStartOperationTimer ? "enabled" : "disabled"
      }`
    };
  }

  if (intent === "jobTravelerMaterials") {
    const includeMaterialsOnTraveler = formData.get("enabled") === "true";

    const update = await updateIncludeMaterialsOnTravelerSetting(
      client,
      companyId,
      includeMaterialsOnTraveler
    );

    if (update.error) return { success: false, message: update.error.message };

    return {
      success: true,
      message: `Traveler materials ${
        includeMaterialsOnTraveler ? "enabled" : "disabled"
      }`
    };
  }

  if (intent === "autoSelectMaterialWithoutPickingListToggle") {
    const autoSelectMaterialWithoutPickingList =
      formData.get("enabled") === "true";
    const result = await updateAutoSelectMaterialWithoutPickingListSetting(
      client,
      companyId,
      autoSelectMaterialWithoutPickingList
    );

    if (result.error) return { success: false, message: result.error.message };

    return {
      success: true,
      message: `Material pre-selection ${
        autoSelectMaterialWithoutPickingList ? "enabled" : "disabled"
      }`
    };
  }

  return { success: false, message: "Unknown intent" };
}

export default function ProductionSettingsRoute() {
  const { t } = useLingui();
  const { companySettings } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const notificationsFetcher = useFetcher<typeof action>();

  const isToggling = fetcher.state !== "idle";

  const includeMaterialsOnTraveler =
    (companySettings as { includeMaterialsOnTraveler?: boolean | null })
      .includeMaterialsOnTraveler ?? false;
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

  useEffect(() => {
    if (fetcher.data?.success === true && fetcher?.data?.message) {
      toast.success(fetcher.data.message);
    }

    if (fetcher.data?.success === false && fetcher?.data?.message) {
      toast.error(fetcher.data.message);
    }
  }, [fetcher.data?.message, fetcher.data?.success]);

  useEffect(() => {
    if (
      notificationsFetcher.data?.success === true &&
      notificationsFetcher?.data?.message
    ) {
      toast.success(notificationsFetcher.data.message);
    }

    if (
      notificationsFetcher.data?.success === false &&
      notificationsFetcher?.data?.message
    ) {
      toast.error(notificationsFetcher.data.message);
    }
  }, [notificationsFetcher.data?.message, notificationsFetcher.data?.success]);

  return (
    <ScrollArea className="w-full h-[calc(100dvh-49px)]">
      <VStack
        spacing={4}
        className="py-12 px-4 max-w-[60rem] h-full mx-auto gap-4"
      >
        <Heading size="h3">
          <Trans>Production</Trans>
        </Heading>

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
            <HStack className="justify-between items-center">
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
                      The traveler lists each item on the bill of materials with
                      its quantity.
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
      </VStack>
    </ScrollArea>
  );
}
