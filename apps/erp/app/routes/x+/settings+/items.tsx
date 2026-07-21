import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { Hidden, Select, Submit, ValidatedForm, validator } from "@carbon/form";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
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
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData } from "react-router";
import { plmReleaseControl } from "~/modules/items";
import {
  getCompanySettings,
  plmReleaseControlValidator,
  updateMaterialGeneratedIdsSetting,
  updateMetricSettings,
  updatePlmReleaseControlSetting
} from "~/modules/settings";

import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Items`,
  to: path.to.itemsSettings
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

  const enabled = formData.get("enabled") === "true";

  switch (intent) {
    case "materialIds": {
      const result = await updateMaterialGeneratedIdsSetting(
        client,
        companyId,
        enabled
      );
      if (result.error)
        return { success: false, message: result.error.message };
      return { success: true, message: "Material IDs setting updated" };
    }

    case "materialUnits": {
      const result = await updateMetricSettings(client, companyId, enabled);
      if (result.error)
        return { success: false, message: result.error.message };
      return { success: true, message: "Material units setting updated" };
    }

    case "plmReleaseControl": {
      const validation = await validator(plmReleaseControlValidator).validate(
        formData
      );
      if (validation.error) {
        return { success: false, message: "Invalid form data" };
      }

      const result = await updatePlmReleaseControlSetting(
        client,
        companyId,
        validation.data.plmReleaseControl
      );
      if (result.error)
        return { success: false, message: result.error.message };
      return { success: true, message: "Release control setting updated" };
    }
  }

  return { success: false, message: "Invalid form data" };
}

export default function ItemsSettingsRoute() {
  const { t } = useLingui();
  const { companySettings } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

  const releaseControlLabels: Record<
    (typeof plmReleaseControl)[number],
    string
  > = {
    off: t`Off — released revisions stay editable`,
    warn: t`Warn — edits succeed with a warning`,
    enforce: t`Enforce — edits are blocked`
  };

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
        <Card>
          <ValidatedForm
            method="post"
            validator={plmReleaseControlValidator}
            defaultValues={{
              plmReleaseControl: companySettings.plmReleaseControl ?? "enforce"
            }}
            fetcher={fetcher}
          >
            <CardHeader>
              <CardTitle>
                <Trans>Release Control</Trans>
              </CardTitle>
              <CardDescription>
                <Trans>
                  Controls whether the bill of material and bill of process of a
                  released (Production) revision can be edited outside a change
                  order.
                </Trans>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Hidden name="intent" value="plmReleaseControl" />
              <div className="flex flex-col gap-2 max-w-[400px]">
                <Select
                  name="plmReleaseControl"
                  label={t`Release control`}
                  options={plmReleaseControl.map((option) => ({
                    value: option,
                    label: releaseControlLabels[option]
                  }))}
                />
              </div>
            </CardContent>
            <CardFooter>
              <Submit>
                <Trans>Save</Trans>
              </Submit>
            </CardFooter>
          </ValidatedForm>
        </Card>
      </VStack>
    </ScrollArea>
  );
}
