import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Heading,
  ScrollArea,
  toast,
  VStack,
} from "@carbon/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { Hidden, Select, Submit, ValidatedForm, validator } from "@carbon/form";
import { useFetcher, useLoaderData } from "@remix-run/react";
import { useEffect } from "react";
import {
  getCompanySettings,
  kanbanOutputTypes,
  kanbanOutputValidator,
  updateKanbanOutputSetting,
} from "~/modules/settings";

import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Inventory",
  to: path.to.inventorySettings,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "settings",
  });

  const [companySettings] = await Promise.all([
    getCompanySettings(client, companyId),
  ]);
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
    case "kanbanOutput":
      const kanbanOutputValidation = await validator(
        kanbanOutputValidator
      ).validate(formData);

      if (kanbanOutputValidation.error) {
        return json({ success: false, message: "Invalid form data" });
      }

      const kanbanOutputResult = await updateKanbanOutputSetting(
        client,
        companyId,
        kanbanOutputValidation.data.kanbanOutput
      );
      if (kanbanOutputResult.error)
        return json({
          success: false,
          message: kanbanOutputResult.error.message,
        });

      return json({ success: true, message: "Kanban output setting updated" });
  }

  return json({ success: false, message: "Invalid form data" });
}

const outputLabels: Record<(typeof kanbanOutputTypes)[number], string> = {
  label: "Label",
  qrcode: "QR Code",
  url: "URL",
};

export default function InventorySettingsRoute() {
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
        <Heading size="h3">Inventory</Heading>
        <Card>
          <ValidatedForm
            method="post"
            validator={kanbanOutputValidator}
            defaultValues={{
              kanbanOutput: companySettings.kanbanOutput ?? "qrcode",
            }}
            fetcher={fetcher}
          >
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Kanban Output
              </CardTitle>
              <CardDescription>
                Style of kanban output to show in the Kanban table
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Hidden name="intent" value="kanbanOutput" />
              <div className="flex flex-col gap-8 max-w-[400px]">
                <div className="flex flex-col gap-2">
                  <Select
                    name="kanbanOutput"
                    label="Output"
                    options={kanbanOutputTypes.map((type) => ({
                      value: type,
                      label: outputLabels[type],
                    }))}
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
