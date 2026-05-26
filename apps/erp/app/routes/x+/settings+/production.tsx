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
import { jobCompletedValidator } from "~/modules/settings";
import {
  getCompanySettings,
  updateJobTravelerWorkInstructions
} from "~/modules/settings/settings.service.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Production`,
  to: path.to.productionSettings
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "settings"
  });

  const companySettings = await getCompanySettings();

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

  if (intent === "jobTraveler") {
    const enabled = formData.get("enabled") === "true";
    const update = await updateJobTravelerWorkInstructions(enabled);

    if (update.error) return { success: false, message: update.error.message };

    return { success: true, message: "Job traveler settings updated" };
  }

  return { success: false, message: "Unknown intent" };
}

export default function ProductionSettingsRoute() {
  const { t } = useLingui();
  const { companySettings } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const toggleFetcher = useFetcher<typeof action>();

  useEffect(() => {
    if (fetcher.data?.success === true && fetcher?.data?.message) {
      toast.success(fetcher.data.message);
    }

    if (fetcher.data?.success === false && fetcher?.data?.message) {
      toast.error(fetcher.data.message);
    }
  }, [fetcher.data?.message, fetcher.data?.success]);

  useEffect(() => {
    if (toggleFetcher.data?.success === true && toggleFetcher?.data?.message) {
      toast.success(toggleFetcher.data.message);
    }
    if (toggleFetcher.data?.success === false && toggleFetcher?.data?.message) {
      toast.error(toggleFetcher.data.message);
    }
  }, [toggleFetcher.data?.message, toggleFetcher.data?.success]);

  const handleJobTravelerToggle = useCallback(
    (checked: boolean) => {
      toggleFetcher.submit(
        { intent: "jobTraveler", enabled: String(checked) },
        { method: "POST" }
      );
    },
    [toggleFetcher]
  );

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
          <ValidatedForm
            method="post"
            validator={jobCompletedValidator}
            defaultValues={{
              inventoryJobCompletedNotificationGroup:
                companySettings.inventoryJobCompletedNotificationGroup ?? [],
              salesJobCompletedNotificationGroup:
                companySettings.salesJobCompletedNotificationGroup ?? []
            }}
            fetcher={fetcher}
          >
            <input type="hidden" name="intent" value="jobCompleted" />
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trans>Completed Job Notifications</Trans>
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
                isDisabled={fetcher.state !== "idle"}
                isLoading={fetcher.state !== "idle"}
              >
                <Trans>Save</Trans>
              </Submit>
            </CardFooter>
          </ValidatedForm>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Job Traveler</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>
                Configure the content displayed on job traveler PDFs.
              </Trans>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <HStack className="justify-between items-center">
              <VStack className="items-start" spacing={1}>
                <span className="font-medium">
                  {companySettings.jobTravelerIncludeWorkInstructions ? (
                    <Trans>Work instructions are included</Trans>
                  ) : (
                    <Trans>Work instructions are not included</Trans>
                  )}
                </span>
                <span className="text-sm text-muted-foreground">
                  {companySettings.jobTravelerIncludeWorkInstructions ? (
                    <Trans>Job traveler PDFs include work instructions.</Trans>
                  ) : (
                    <Trans>
                      Enable to include work instructions on job traveler PDFs.
                    </Trans>
                  )}
                </span>
              </VStack>
              <Switch
                checked={
                  companySettings.jobTravelerIncludeWorkInstructions ?? false
                }
                onCheckedChange={handleJobTravelerToggle}
                disabled={toggleFetcher.state !== "idle"}
              />
            </HStack>
          </CardContent>
        </Card>
      </VStack>
    </ScrollArea>
  );
}
