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
import { Boolean, Submit, ValidatedForm, validator } from "@carbon/form";
import { useFetcher, useLoaderData } from "@remix-run/react";
import { useEffect } from "react";
import {
  getCompanySettings,
  materialIdsValidator,
  materialUnitsValidator,
  updateMaterialGeneratedIdsSetting,
  updateMetricSettings,
} from "~/modules/settings";

import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Items",
  to: path.to.itemsSettings,
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
    case "materialIds":
      const idsValidation = await validator(materialIdsValidator).validate(
        formData
      );

      if (idsValidation.error) {
        return json({ success: false, message: "Invalid form data" });
      }

      const materialIdsResult = await updateMaterialGeneratedIdsSetting(
        client,
        companyId,
        idsValidation.data.materialGeneratedIds
      );
      if (materialIdsResult.error)
        return json({
          success: false,
          message: materialIdsResult.error.message,
        });

      return json({ success: true, message: "Material IDs setting updated" });

    case "materialUnits":
      const unitsValidation = await validator(materialUnitsValidator).validate(
        formData
      );

      if (unitsValidation.error) {
        return json({ success: false, message: "Invalid form data" });
      }

      const materialUnitsResult = await updateMetricSettings(
        client,
        companyId,
        unitsValidation.data.useMetric
      );
      if (materialUnitsResult.error)
        return json({
          success: false,
          message: materialUnitsResult.error.message,
        });

      return json({ success: true, message: "Material units setting updated" });
  }

  return json({ success: false, message: "Invalid form data" });
}

export default function ItemsSettingsRoute() {
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
        <Heading size="h3">Items</Heading>
        <Card>
          <ValidatedForm
            method="post"
            validator={materialIdsValidator}
            defaultValues={{
              materialGeneratedIds:
                companySettings.materialGeneratedIds ?? false,
            }}
            fetcher={fetcher}
          >
            <input type="hidden" name="intent" value="materialIds" />
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Material IDs
              </CardTitle>
              <CardDescription>
                Generate material IDs and descriptions based on the properties
                of the material.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-8 max-w-[400px]">
                <div className="flex flex-col gap-2">
                  <Boolean
                    name="materialGeneratedIds"
                    description="Generate IDs and descriptions for raw materials"
                  />
                </div>
              </div>
            </CardContent>
            <CardFooter>
              <Submit>Save</Submit>
            </CardFooter>
          </ValidatedForm>
        </Card>
        <Card>
          <ValidatedForm
            method="post"
            validator={materialUnitsValidator}
            defaultValues={{
              useMetric: (companySettings as any).useMetric ?? false,
            }}
            fetcher={fetcher}
          >
            <input type="hidden" name="intent" value="materialUnits" />
            <CardHeader>
              <CardTitle className="flex items-center gap-2">Metric</CardTitle>
              <CardDescription>
                Use metric system for default material dimensions.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-8 max-w-[400px]">
                <div className="flex flex-col gap-2">
                  <Boolean
                    name="useMetric"
                    description="Use metric units for material dimensions"
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
