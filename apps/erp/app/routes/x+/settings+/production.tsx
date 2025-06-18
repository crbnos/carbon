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
  VStack,
} from "@carbon/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { Submit, ValidatedForm, validator } from "@carbon/form";
import { useFetcher, useLoaderData } from "@remix-run/react";
import { useEffect } from "react";
import { z } from "zod";
import { Users } from "~/components/Form";
import { getCompanySettings } from "~/modules/settings";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Production",
  to: path.to.productionSettings,
};

const jobCompletedValidator = z.object({
  inventoryJobCompletedNotificationGroup: z.array(z.string()).optional(),
  salesJobCompletedNotificationGroup: z.array(z.string()).optional(),
});

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "settings",
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
  return json({ companySettings: companySettings.data });
}

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "settings",
  });

  const formData = await request.formData();
  const validation = await validator(jobCompletedValidator).validate(formData);

  if (validation.error) {
    return json({ success: false, message: "Invalid form data" });
  }

  const update = await client
    .from("companySettings")
    .update({
      inventoryJobCompletedNotificationGroup:
        validation.data.inventoryJobCompletedNotificationGroup ?? [],
      salesJobCompletedNotificationGroup:
        validation.data.salesJobCompletedNotificationGroup ?? [],
    })
    .eq("id", companyId);

  if (update.error)
    return json({ success: false, message: update.error.message });

  return json({ success: true, message: "Job notification settings updated" });
}

export default function ProductionSettingsRoute() {
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
        <Heading size="h3">Production</Heading>

        <Card>
          <ValidatedForm
            method="post"
            validator={jobCompletedValidator}
            defaultValues={{
              inventoryJobCompletedNotificationGroup:
                companySettings.inventoryJobCompletedNotificationGroup ?? [],
              salesJobCompletedNotificationGroup:
                companySettings.salesJobCompletedNotificationGroup ?? [],
            }}
            fetcher={fetcher}
          >
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Completed Job Notifications
              </CardTitle>
              <CardDescription>
                Configure notifications for when jobs are completed.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-8 max-w-[400px]">
                <div className="flex flex-col gap-2">
                  <Label>Inventory Job Notifications</Label>
                  <Users
                    name="inventoryJobCompletedNotificationGroup"
                    label="Who should receive notifications when an inventory job is completed?"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Sales Job Notifications</Label>
                  <Users
                    name="salesJobCompletedNotificationGroup"
                    label="Who should receive notifications when a sales job is completed?"
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
