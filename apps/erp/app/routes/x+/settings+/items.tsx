import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Heading,
  HStack,
  ScrollArea,
  Switch,
  toast,
  VStack
} from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useCallback, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData } from "react-router";
import {
  getCompanySettings,
  updateMaterialGeneratedIdsSetting,
  updateMetricSettings
} from "~/modules/settings";

import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Items`,
  to: path.to.itemsSettings
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
  await requirePermissions(request, {
    update: "settings"
  });

  const formData = await request.formData();
  const intent = formData.get("intent");

  const enabled = formData.get("enabled") === "true";

  switch (intent) {
    case "materialIds": {
      const result = await updateMaterialGeneratedIdsSetting(enabled);
      if (result.error)
        return { success: false, message: result.error.message };
      return { success: true, message: "Material IDs setting updated" };
    }

    case "materialUnits": {
      const result = await updateMetricSettings(enabled);
      if (result.error)
        return { success: false, message: result.error.message };
      return { success: true, message: "Material units setting updated" };
    }
  }

  return { success: false, message: "Invalid form data" };
}

export default function ItemsSettingsRoute() {
  const { companySettings } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

  const isToggling = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.success === true && fetcher?.data?.message) {
      toast.success(fetcher.data.message);
    }

    if (fetcher.data?.success === false && fetcher?.data?.message) {
      toast.error(fetcher.data.message);
    }
  }, [fetcher.data?.message, fetcher.data?.success]);

  const handleMaterialIdsToggle = useCallback(
    (checked: boolean) => {
      fetcher.submit(
        { intent: "materialIds", enabled: String(checked) },
        { method: "POST" }
      );
    },
    [fetcher]
  );

  const handleMetricToggle = useCallback(
    (checked: boolean) => {
      fetcher.submit(
        { intent: "materialUnits", enabled: String(checked) },
        { method: "POST" }
      );
    },
    [fetcher]
  );

  return (
    <ScrollArea className="w-full h-[calc(100dvh-49px)]">
      <VStack
        spacing={4}
        className="py-12 px-4 max-w-[60rem] h-full mx-auto gap-4"
      >
        <Heading size="h3">
          <Trans>Items</Trans>
        </Heading>
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Material IDs</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>
                Generate material IDs and descriptions based on the properties
                of the material.
              </Trans>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <HStack className="justify-between items-center">
              <VStack className="items-start" spacing={1}>
                <span className="font-medium">
                  {companySettings.materialGeneratedIds ? (
                    <Trans>Generated IDs are enabled</Trans>
                  ) : (
                    <Trans>Generated IDs are disabled</Trans>
                  )}
                </span>
                <span className="text-sm text-muted-foreground">
                  {companySettings.materialGeneratedIds ? (
                    <Trans>
                      IDs and descriptions are generated for raw materials.
                    </Trans>
                  ) : (
                    <Trans>
                      Enable to generate IDs and descriptions for raw materials.
                    </Trans>
                  )}
                </span>
              </VStack>
              <Switch
                checked={companySettings.materialGeneratedIds ?? false}
                onCheckedChange={handleMaterialIdsToggle}
                disabled={isToggling}
              />
            </HStack>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Metric</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>Use metric system for default material dimensions.</Trans>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <HStack className="justify-between items-center">
              <VStack className="items-start" spacing={1}>
                <span className="font-medium">
                  {(companySettings as any).useMetric ? (
                    <Trans>Metric units are enabled</Trans>
                  ) : (
                    <Trans>Metric units are disabled</Trans>
                  )}
                </span>
                <span className="text-sm text-muted-foreground">
                  {(companySettings as any).useMetric ? (
                    <Trans>Material dimensions use metric units.</Trans>
                  ) : (
                    <Trans>
                      Enable to use metric units for material dimensions.
                    </Trans>
                  )}
                </span>
              </VStack>
              <Switch
                checked={(companySettings as any).useMetric ?? false}
                onCheckedChange={handleMetricToggle}
                disabled={isToggling}
              />
            </HStack>
          </CardContent>
        </Card>
      </VStack>
    </ScrollArea>
  );
}
