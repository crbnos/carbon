import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
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
import { Boolean, Submit, ValidatedForm, validator } from "@carbon/form";
import { useFetcher, useLoaderData } from "@remix-run/react";
import { useEffect, useState } from "react";
import { Users } from "~/components/Form";
import {
  digitalQuoteValidator,
  getCompanySettings,
  updateDigitalQuoteSetting,
} from "~/modules/settings";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Sales",
  to: path.to.salesSettings,
};

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
  const intent = formData.get("intent");

  switch (intent) {
    case "digitalQuote":
      const validation = await validator(digitalQuoteValidator).validate(
        formData
      );

      if (validation.error) {
        return json({ success: false, message: "Invalid form data" });
      }

      const { error } = await updateDigitalQuoteSetting(
        client,
        companyId,
        validation.data.digitalQuoteEnabled,
        validation.data.digitalQuoteNotificationGroup ?? [],
        validation.data.digitalQuoteIncludesPurchaseOrders
      );
      if (error) return json({ success: false, message: error.message });
  }

  return json({ success: true, message: "Digital quote setting updated" });
}

export default function SalesSettingsRoute() {
  const { companySettings } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [digitalQuoteEnabled, setDigitalQuoteEnabled] = useState(
    companySettings.digitalQuoteEnabled ?? false
  );

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
      <VStack spacing={2} className="p-2 h-full">
        <Card>
          <ValidatedForm
            method="post"
            validator={digitalQuoteValidator}
            defaultValues={{
              digitalQuoteEnabled: companySettings.digitalQuoteEnabled ?? false,
              digitalQuoteNotificationGroup:
                companySettings.digitalQuoteNotificationGroup ?? [],
              digitalQuoteIncludesPurchaseOrders:
                companySettings.digitalQuoteIncludesPurchaseOrders ?? false,
            }}
            fetcher={fetcher}
          >
            <input type="hidden" name="intent" value="digitalQuote" />
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Digital Quotes
              </CardTitle>
              <CardDescription>
                Enable digital quotes for your company. This will allow you to
                send digital quotes to your customers, and allow them to accept
                them online.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-8 max-w-[400px]">
                <div className="flex flex-col gap-2">
                  <Boolean
                    name="digitalQuoteEnabled"
                    description="Digital Quotes Enabled"
                    onChange={(value) => {
                      setDigitalQuoteEnabled(value);
                    }}
                  />
                  <Boolean
                    name="digitalQuoteIncludesPurchaseOrders"
                    description="Include Purchase Orders"
                    isDisabled={!digitalQuoteEnabled}
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <Label>Notifications</Label>
                  <Users
                    name="digitalQuoteNotificationGroup"
                    label="Who should receive notifications when a digital quote is accepted or expired?"
                  />
                </div>
              </div>
            </CardContent>
            <CardFooter>
              <Submit>Save</Submit>
            </CardFooter>
          </ValidatedForm>
        </Card>
      </VStack>
    </ScrollArea>
  );
}
