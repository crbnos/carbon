// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { Hidden, Select, Submit, ValidatedForm, validator } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  HStack,
  ScrollArea,
  Switch,
  toast,
  VStack
} from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { z } from "zod";
import { SettingsPage, SettingsPageHeading } from "~/components/SettingsPage";
import SettingsSectionHeader from "~/components/SettingsSectionHeader";
import { plmReleaseControl } from "~/modules/items/items.models";
import {
  plmReleaseControlValidator,
  settingsToggle
} from "~/modules/settings/settings.models";
import { getCompanySettings } from "~/modules/settings/settings.service";
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

// One form per card, told apart by its intent: each becomes the fields of
// `settings.items.update` it saves (the operation drops `intent`).
const itemsSettingsForm = z.discriminatedUnion("intent", [
  settingsToggle("materialIds", "materialGeneratedIds"),
  settingsToggle("materialUnits", "useMetric"),
  settingsToggle("allowLowercaseItemIds", "allowLowercaseItemIds"),
  settingsToggle("bomExplorerReadableId", "showBomExplorerReadableId"),
  plmReleaseControlValidator.extend({ intent: z.literal("plmReleaseControl") })
]);

export async function action(args: ActionFunctionArgs) {
  const input = await validator(itemsSettingsForm).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  return api.settings.updateItemsSettings(input.data);
}

export default function ItemsSettingsRoute() {
  const { t } = useLingui();
  const { companySettings } = useLoaderData<typeof loader>();
  const fetcher = useAction<typeof action>({
    onSuccess: ({ data }) => {
      if (!data) return;
      if (data.materialGeneratedIds !== undefined)
        toast.success(t`Material IDs setting updated`);
      else if (data.useMetric !== undefined)
        toast.success(t`Material units setting updated`);
      else if (data.allowLowercaseItemIds !== undefined)
        toast.success(t`Item ID casing setting updated`);
      else if (data.showBomExplorerReadableId !== undefined)
        toast.success(t`BoM explorer setting updated`);
      else toast.success(t`Release control setting updated`);
    }
  });

  const releaseControlLabels: Record<
    (typeof plmReleaseControl)[number],
    string
  > = {
    off: t`Off — released revisions stay editable`,
    warn: t`Warn — edits succeed with a warning`,
    enforce: t`Enforce — edits are blocked`
  };

  const isToggling = fetcher.state !== "idle";

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

  const handleLowercaseItemIdsToggle = useCallback(
    (checked: boolean) => {
      fetcher.submit(
        { intent: "allowLowercaseItemIds", enabled: String(checked) },
        { method: "POST" }
      );
    },
    [fetcher]
  );

  const handleBomExplorerReadableIdToggle = useCallback(
    (checked: boolean) => {
      fetcher.submit(
        { intent: "bomExplorerReadableId", enabled: String(checked) },
        { method: "POST" }
      );
    },
    [fetcher]
  );

  return (
    <ScrollArea className="w-full h-[calc(100dvh-var(--topbar-height)-var(--content-inset))]">
      <SettingsPage className="gap-4">
        <SettingsPageHeading>
          <Trans>Items</Trans>
        </SettingsPageHeading>

        <SettingsSectionHeader>
          <Trans>Identifiers</Trans>
        </SettingsSectionHeader>

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
              <Trans>Item IDs</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>
                Control whether item IDs (parts, materials, consumables, tools,
                and services) may contain lowercase characters.
              </Trans>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <HStack className="justify-between items-center">
              <VStack className="items-start" spacing={1}>
                <span className="font-medium">
                  {companySettings.allowLowercaseItemIds ? (
                    <Trans>Lowercase item IDs are allowed</Trans>
                  ) : (
                    <Trans>Item IDs are forced to uppercase</Trans>
                  )}
                </span>
                <span className="text-sm text-muted-foreground">
                  {companySettings.allowLowercaseItemIds ? (
                    <Trans>Item IDs keep the casing you type.</Trans>
                  ) : (
                    <Trans>
                      Enable to allow lowercase characters in item IDs.
                    </Trans>
                  )}
                </span>
              </VStack>
              <Switch
                checked={companySettings.allowLowercaseItemIds ?? false}
                onCheckedChange={handleLowercaseItemIdsToggle}
                disabled={isToggling}
              />
            </HStack>
          </CardContent>
        </Card>

        <SettingsSectionHeader>
          <Trans>Bill of Materials</Trans>
        </SettingsSectionHeader>

        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>BoM Explorer</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>
                Choose whether the bill of material explorer on items, quotes,
                and jobs labels each line with its description or its item ID.
              </Trans>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <HStack className="justify-between items-center">
              <VStack className="items-start" spacing={1}>
                <span className="font-medium">
                  {companySettings.showBomExplorerReadableId ? (
                    <Trans>Lines show item IDs</Trans>
                  ) : (
                    <Trans>Lines show descriptions</Trans>
                  )}
                </span>
                <span className="text-sm text-muted-foreground">
                  {companySettings.showBomExplorerReadableId ? (
                    <Trans>Each line shows its item ID and revision.</Trans>
                  ) : (
                    <Trans>
                      Enable to show the item ID and revision instead of the
                      description.
                    </Trans>
                  )}
                </span>
              </VStack>
              <Switch
                checked={companySettings.showBomExplorerReadableId ?? false}
                onCheckedChange={handleBomExplorerReadableIdToggle}
                disabled={isToggling}
              />
            </HStack>
          </CardContent>
        </Card>

        <SettingsSectionHeader>
          <Trans>Units</Trans>
        </SettingsSectionHeader>

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

        <SettingsSectionHeader>
          <Trans>Revisions</Trans>
        </SettingsSectionHeader>

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
      </SettingsPage>
    </ScrollArea>
  );
}
