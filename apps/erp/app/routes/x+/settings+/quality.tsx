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
  Label,
  ScrollArea,
  toast,
  VStack
} from "@carbon/react";
import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData } from "react-router";
import { z } from "zod";
import { Users } from "~/components/Form";
import { getCompanySettings } from "~/modules/settings";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Quality",
  to: path.to.qualitySettings
};

const gaugeCalibrationValidator = z.object({
  gaugeCalibrationExpiredNotificationGroup: z.array(z.string()).optional()
});

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
  const validation = await validator(gaugeCalibrationValidator).validate(
    formData
  );

  if (validation.error) {
    return { success: false, message: "Invalid form data" };
  }

  const update = await client
    .from("companySettings")
    .update({
      gaugeCalibrationExpiredNotificationGroup:
        validation.data.gaugeCalibrationExpiredNotificationGroup ?? []
    })
    .eq("id", companyId);

  if (update.error) return { success: false, message: update.error.message };

  return {
    success: true,
    message: "Gauge calibration notification settings updated"
  };
}

export default function QualitySettingsRoute() {
  const { companySettings } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

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
        <Heading size="h3">Quality</Heading>

        <Card>
          <ValidatedForm
            method="post"
            validator={gaugeCalibrationValidator}
            defaultValues={{
              gaugeCalibrationExpiredNotificationGroup:
                companySettings.gaugeCalibrationExpiredNotificationGroup ?? []
            }}
            fetcher={fetcher}
          >
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Gauge Calibration Notifications
              </CardTitle>
              <CardDescription>
                Configure notifications for when gauges go out of calibration.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-8 max-w-[400px]">
                <div className="flex flex-col gap-2">
                  <Label>Calibration Expiration Notifications</Label>
                  <Users
                    name="gaugeCalibrationExpiredNotificationGroup"
                    label="Who should receive notifications when a gauge goes out of calibration?"
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
                Save
              </Submit>
            </CardFooter>
          </ValidatedForm>
        </Card>
      </VStack>
    </ScrollArea>
  );
}
