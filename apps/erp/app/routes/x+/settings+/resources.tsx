import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  Boolean,
  Number,
  Submit,
  ValidatedForm,
  validator
} from "@carbon/form";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Heading,
  Label,
  ScrollArea,
  toast,
  VStack
} from "@carbon/react";
import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData } from "react-router";
import { Users } from "~/components/Form";
import {
  getCompany,
  getCompanySettings,
  maintenanceDispatchNotificationValidator,
  maintenanceSettingsValidator,
  suggestionNotificationValidator,
  updateMaintenanceDispatchNotificationSettings,
  updateSuggestionNotificationSetting
} from "~/modules/settings";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Resources",
  to: path.to.resourcesSettings
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "settings"
  });

  const [company, companySettings] = await Promise.all([
    getCompany(client, companyId),
    getCompanySettings(client, companyId)
  ]);

  if (!company.data)
    throw redirect(
      path.to.settings,
      await flash(request, error(company.error, "Failed to get company"))
    );

  if (!companySettings.data)
    throw redirect(
      path.to.settings,
      await flash(
        request,
        error(companySettings.error, "Failed to get company settings")
      )
    );

  return { company: company.data, companySettings: companySettings.data };
}

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "settings"
  });

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "maintenance") {
    const validation = await validator(maintenanceSettingsValidator).validate(
      formData
    );

    if (validation.error) {
      return { success: false, message: "Invalid form data" };
    }

    const update = await client
      .from("companySettings")
      .update({
        maintenanceGenerateInAdvance:
          validation.data.maintenanceGenerateInAdvance,
        maintenanceAdvanceDays: validation.data.maintenanceAdvanceDays
      })
      .eq("id", companyId);

    if (update.error) return { success: false, message: update.error.message };

    return { success: true, message: "Maintenance settings updated" };
  }

  if (intent === "suggestions") {
    const validation = await validator(
      suggestionNotificationValidator
    ).validate(formData);

    if (validation.error) {
      return { success: false, message: "Invalid form data" };
    }

    const update = await updateSuggestionNotificationSetting(
      client,
      companyId,
      validation.data.suggestionNotificationGroup ?? []
    );

    if (update.error) return { success: false, message: update.error.message };

    return {
      success: true,
      message: "Suggestion notification settings updated"
    };
  }

  if (intent === "maintenanceDispatchNotifications") {
    const validation = await validator(
      maintenanceDispatchNotificationValidator
    ).validate(formData);

    if (validation.error) {
      return { success: false, message: "Invalid form data" };
    }

    const update = await updateMaintenanceDispatchNotificationSettings(
      client,
      companyId,
      {
        maintenanceDispatchNotificationGroup:
          validation.data.maintenanceDispatchNotificationGroup ?? [],
        qualityDispatchNotificationGroup:
          validation.data.qualityDispatchNotificationGroup ?? [],
        operationsDispatchNotificationGroup:
          validation.data.operationsDispatchNotificationGroup ?? [],
        otherDispatchNotificationGroup:
          validation.data.otherDispatchNotificationGroup ?? []
      }
    );

    if (update.error) return { success: false, message: update.error.message };

    return {
      success: true,
      message: "Maintenance dispatch notification settings updated"
    };
  }

  return null;
}

export default function ResourcesSettingsRoute() {
  const { company, companySettings } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [maintenanceGenerateInAdvance, setMaintenanceGenerateInAdvance] =
    useState(companySettings.maintenanceGenerateInAdvance ?? false);

  useEffect(() => {
    if (fetcher.data?.success === true && fetcher?.data?.message) {
      toast.success(fetcher.data.message);
    }

    if (fetcher.data?.success === false && fetcher?.data?.message) {
      toast.error(fetcher.data.message);
    }
  }, [fetcher.data?.message, fetcher.data?.success]);

  return (
    <ScrollArea className="w-full h-[calc(100dvh-49px)]">
      <VStack
        spacing={4}
        className="py-12 px-4 max-w-[60rem] h-full mx-auto gap-4"
      >
        <Heading size="h3">Resources</Heading>

        <Card>
          <ValidatedForm
            method="post"
            validator={maintenanceDispatchNotificationValidator}
            defaultValues={{
              maintenanceDispatchNotificationGroup:
                (companySettings as any).maintenanceDispatchNotificationGroup ??
                [],
              qualityDispatchNotificationGroup:
                (companySettings as any).qualityDispatchNotificationGroup ?? [],
              operationsDispatchNotificationGroup:
                (companySettings as any).operationsDispatchNotificationGroup ??
                [],
              otherDispatchNotificationGroup:
                (companySettings as any).otherDispatchNotificationGroup ?? []
            }}
            fetcher={fetcher}
          >
            <input
              type="hidden"
              name="intent"
              value="maintenanceDispatchNotifications"
            />
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Maintenance Dispatch Notifications
              </CardTitle>
              <CardDescription>
                Configure notifications for when maintenance dispatches are
                created from the shop floor. Notifications are routed based on
                the failure mode type.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-8 max-w-[400px]">
                <div className="flex flex-col gap-2">
                  <Label>Maintenance Type</Label>
                  <Users
                    name="maintenanceDispatchNotificationGroup"
                    label="Who should receive notifications for maintenance-related dispatches?"
                    type="employee"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Quality Type</Label>
                  <Users
                    name="qualityDispatchNotificationGroup"
                    label="Who should receive notifications for quality-related dispatches?"
                    type="employee"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Operations Type</Label>
                  <Users
                    name="operationsDispatchNotificationGroup"
                    label="Who should receive notifications for operations-related dispatches?"
                    type="employee"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Other Type</Label>
                  <Users
                    name="otherDispatchNotificationGroup"
                    label="Who should receive notifications for other dispatches?"
                    type="employee"
                  />
                </div>
              </div>
            </CardContent>
            <CardFooter>
              <Submit
                isDisabled={fetcher.state !== "idle"}
                isLoading={
                  fetcher.state !== "idle" &&
                  fetcher.formData?.get("intent") ===
                    "maintenanceDispatchNotifications"
                }
              >
                Save
              </Submit>
            </CardFooter>
          </ValidatedForm>
        </Card>

        <Card>
          <ValidatedForm
            method="post"
            validator={maintenanceSettingsValidator}
            defaultValues={{
              maintenanceGenerateInAdvance:
                companySettings.maintenanceGenerateInAdvance ?? false,
              maintenanceAdvanceDays:
                companySettings.maintenanceAdvanceDays ?? 7
            }}
            fetcher={fetcher}
          >
            <input type="hidden" name="intent" value="maintenance" />
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Maintenance Scheduling
              </CardTitle>
              <CardDescription>
                Configure how preventative maintenance dispatches are
                automatically generated from maintenance schedules.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-6 max-w-[400px]">
                <div className="flex flex-col gap-2">
                  <Boolean
                    name="maintenanceGenerateInAdvance"
                    description="Create maintenance dispatches in advance"
                    value={maintenanceGenerateInAdvance}
                    onChange={setMaintenanceGenerateInAdvance}
                  />
                </div>
                {maintenanceGenerateInAdvance && (
                  <div className="flex flex-col gap-2">
                    <Number
                      name="maintenanceAdvanceDays"
                      label="Days in advance to generate dispatches"
                      minValue={1}
                      maxValue={365}
                    />
                  </div>
                )}
              </div>
            </CardContent>
            <CardFooter>
              <Submit
                isDisabled={fetcher.state !== "idle"}
                isLoading={
                  fetcher.state !== "idle" &&
                  fetcher.formData?.get("intent") === "maintenance"
                }
              >
                Save
              </Submit>
            </CardFooter>
          </ValidatedForm>
        </Card>
        <Card>
          <ValidatedForm
            method="post"
            validator={suggestionNotificationValidator}
            defaultValues={{
              suggestionNotificationGroup:
                company.suggestionNotificationGroup ?? []
            }}
            fetcher={fetcher}
          >
            <input type="hidden" name="intent" value="suggestions" />
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Suggestion Notifications
              </CardTitle>
              <CardDescription>
                Configure notifications for when new suggestions are submitted.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-8 max-w-[400px]">
                <div className="flex flex-col gap-2">
                  <Label>Suggestion Notifications</Label>
                  <Users
                    name="suggestionNotificationGroup"
                    label="Who should receive notifications when a new suggestion is submitted?"
                    type="employee"
                  />
                </div>
              </div>
            </CardContent>
            <CardFooter>
              <Submit
                isDisabled={fetcher.state !== "idle"}
                isLoading={
                  fetcher.state !== "idle" &&
                  fetcher.formData?.get("intent") === "suggestions"
                }
              >
                Save
              </Submit>
            </CardFooter>
          </ValidatedForm>
        </Card>
      </VStack>
    </ScrollArea>
  );
}
