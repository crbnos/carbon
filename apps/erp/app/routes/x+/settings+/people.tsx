import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { Boolean, Submit, ValidatedForm, validator } from "@carbon/form";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Heading,
  ScrollArea,
  toast,
  VStack
} from "@carbon/react";
import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData } from "react-router";
import {
  getCompanySettings,
  timeCardSettingsValidator,
  updateTimeCardSetting
} from "~/modules/settings";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "People",
  to: path.to.peopleSettings
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

  if (intent === "timeCard") {
    const validation = await validator(timeCardSettingsValidator).validate(
      formData
    );

    if (validation.error) {
      return { success: false, message: "Invalid form data" };
    }

    const update = await updateTimeCardSetting(client, companyId, {
      timeCardEnabled: validation.data.timeCardEnabled,
      showEmployeeOvertime: validation.data.showEmployeeOvertime
    });

    if (update.error) return { success: false, message: update.error.message };

    return { success: true, message: "Timecard settings updated" };
  }

  return { success: false, message: "Unknown intent" };
}

export default function PeopleSettingsRoute() {
  const { companySettings } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const timecardsEnabled =
    (fetcher.formData?.get("timeCardEnabled") as string | null) === "on"
      ? true
      : fetcher.formData
        ? false
        : (companySettings.timeCardEnabled ?? false);

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
        <Heading size="h3">People</Heading>

        <Card>
          <ValidatedForm
            method="post"
            validator={timeCardSettingsValidator}
            defaultValues={{
              timeCardEnabled: companySettings.timeCardEnabled ?? false,
              showEmployeeOvertime:
                (companySettings as any).showEmployeeOvertime ?? false
            }}
            fetcher={fetcher}
          >
            <input type="hidden" name="intent" value="timeCard" />
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Timecards
              </CardTitle>
              <CardDescription>
                Enable timecard tracking for work shifts.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-start gap-2">
                <Boolean
                  name="timeCardEnabled"
                  description="Enable Timecards"
                />
                <div>
                  <Badge variant="yellow">Beta</Badge>
                </div>
              </div>
              {timecardsEnabled && (
                <div className="mt-4">
                  <Boolean
                    name="showEmployeeOvertime"
                    description="Show overtime totals to employees in Shop Floor"
                  />
                </div>
              )}
            </CardContent>
            <CardFooter>
              <Submit
                isDisabled={fetcher.state !== "idle"}
                isLoading={
                  fetcher.state !== "idle" &&
                  fetcher.formData?.get("intent") === "timeCard"
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
