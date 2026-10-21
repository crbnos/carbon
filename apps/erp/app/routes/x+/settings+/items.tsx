// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { Hidden, Select, Submit, ValidatedForm, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { useAction } from "@carbon/query";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  HStack,
  RecordOutlet,
  ScrollArea,
  Switch,
  toast,
  VStack
} from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useCallback } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { z } from "zod";
import { SettingsPage, SettingsPageHeading } from "~/components/SettingsPage";
import SettingsSectionHeader from "~/components/SettingsSectionHeader";
import { plmReleaseControl } from "~/modules/items/items.models";
import {
  plmReleaseControlValidator,
  settingsToggle
} from "~/modules/settings/settings.models";
import {
  getCompanySettings,
  getStrictBackflushGapCounts
} from "~/modules/settings/settings.service";
import { getDatabaseClient } from "~/services/database.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

const logger = getLogger("erp", "settings-items");

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

  let gaps: { methods: number; jobs: number } | null = null;
  let gapsError = false;
  if (companySettings.data.requireBackflushStorageUnit) {
    const counts = await getStrictBackflushGapCounts(
      getDatabaseClient(),
      companyId
    );
    if (counts.error) {
      logger.error("Failed to count strict backflush gaps", {
        companyId,
        error: counts.error
      });
      gapsError = true;
    }
    gaps = counts.data;
  }

  return {
    companySettings: companySettings.data,
    gaps,
    gapsError
  };
}

// One form per card, told apart by its intent: each becomes the fields of
// `settings.items.update` it saves (the operation drops `intent`).
const itemsSettingsForm = z.discriminatedUnion("intent", [
  settingsToggle("materialIds", "materialGeneratedIds"),
  settingsToggle("materialUnits", "useMetric"),
  settingsToggle("allowLowercaseItemIds", "allowLowercaseItemIds"),
  settingsToggle("bomExplorerReadableId", "showBomExplorerReadableId"),
  settingsToggle("requireBackflushStorageUnit", "requireBackflushStorageUnit"),
  settingsToggle("preventNegativeBackflush", "preventNegativeBackflush"),
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
  const { companySettings, gaps, gapsError } = useLoaderData<typeof loader>();
  // Named for the Plural messages' placeholders.
  const methodsMissingPullFrom = gaps?.methods ?? 0;
  const jobsMissingStorageUnit = gaps?.jobs ?? 0;
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
      else if (data.requireBackflushStorageUnit !== undefined)
        toast.success(t`Strict backflush setting updated`);
      else if (data.preventNegativeBackflush !== undefined)
        toast.success(t`Negative stock setting updated`);
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

  const handleStrictBackflushToggle = useCallback(
    (checked: boolean) => {
      fetcher.submit(
        { intent: "requireBackflushStorageUnit", enabled: String(checked) },
        { method: "POST" }
      );
    },
    [fetcher]
  );

  const handlePreventNegativeBackflushToggle = useCallback(
    (checked: boolean) => {
      fetcher.submit(
        { intent: "preventNegativeBackflush", enabled: String(checked) },
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

        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Strict Backflush</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>
                Backflush each material only from the storage unit on its
                material line, never from another storage unit.
              </Trans>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <VStack spacing={4}>
              <HStack className="justify-between items-center w-full">
                <VStack className="items-start" spacing={1}>
                  <span className="font-medium">
                    {companySettings.requireBackflushStorageUnit ? (
                      <Trans>Strict backflush is on</Trans>
                    ) : (
                      <Trans>Strict backflush is off</Trans>
                    )}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {companySettings.requireBackflushStorageUnit ? (
                      <Trans>
                        A method version needs a Pull From storage unit on each
                        pulled material before it can be made active.
                      </Trans>
                    ) : (
                      <Trans>
                        A short storage unit falls back to another storage unit
                        with stock.
                      </Trans>
                    )}
                  </span>
                </VStack>
                <Switch
                  checked={companySettings.requireBackflushStorageUnit ?? false}
                  onCheckedChange={handleStrictBackflushToggle}
                  disabled={isToggling}
                />
              </HStack>
              <HStack className="justify-between items-center w-full border-t pt-4">
                <VStack className="items-start" spacing={1}>
                  <span className="font-medium">
                    <Trans>Prevent negative stock</Trans>
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {!companySettings.requireBackflushStorageUnit ? (
                      <Trans>Applies when strict backflush is on.</Trans>
                    ) : companySettings.preventNegativeBackflush ? (
                      <Trans>
                        An operation or job that would take its storage unit
                        below zero is stopped until the stock is there.
                      </Trans>
                    ) : (
                      <Trans>
                        A short storage unit goes below zero, and the operation
                        or job still completes.
                      </Trans>
                    )}
                  </span>
                </VStack>
                <Switch
                  checked={companySettings.preventNegativeBackflush}
                  onCheckedChange={handlePreventNegativeBackflushToggle}
                  disabled={
                    isToggling || !companySettings.requireBackflushStorageUnit
                  }
                />
              </HStack>
              {gapsError && (
                <p className="w-full border-t pt-4 text-sm text-destructive">
                  <Trans>
                    Could not check for active methods and open jobs with gaps.
                    Reload the page to try again.
                  </Trans>
                </p>
              )}
              {methodsMissingPullFrom > 0 && (
                <GapRow
                  to={path.to.itemsSettingsMethodsMissingPullFrom}
                  label={
                    <Plural
                      value={methodsMissingPullFrom}
                      one="# active method has materials with no Pull From"
                      other="# active methods have materials with no Pull From"
                    />
                  }
                  description={
                    <Trans>
                      Set a Pull From on each one through a new version.
                    </Trans>
                  }
                />
              )}
              {jobsMissingStorageUnit > 0 && (
                <GapRow
                  to={path.to.itemsSettingsJobsMissingStorageUnit}
                  label={
                    <Plural
                      value={jobsMissingStorageUnit}
                      one="# open job has materials with no storage unit"
                      other="# open jobs have materials with no storage unit"
                    />
                  }
                  description={
                    <Trans>
                      Their next backflush will be refused until each material
                      has a storage unit.
                    </Trans>
                  }
                />
              )}
            </VStack>
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
        <RecordOutlet />
      </SettingsPage>
    </ScrollArea>
  );
}

function GapRow({
  to,
  label,
  description
}: {
  to: string;
  label: ReactNode;
  description: ReactNode;
}) {
  return (
    <HStack className="justify-between items-center w-full border-t pt-4 gap-4">
      <VStack className="items-start min-w-0 flex-1" spacing={1}>
        <span className="text-sm font-medium">{label}</span>
        <span className="text-sm text-muted-foreground">{description}</span>
      </VStack>
      <Button variant="secondary" className="shrink-0" asChild>
        <Link to={to}>
          <Trans>Review</Trans>
        </Link>
      </Button>
    </HStack>
  );
}
