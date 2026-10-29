// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  Boolean,
  Number,
  Submit,
  ValidatedForm,
  validator
} from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  cn,
  HStack,
  Label,
  ScrollArea,
  Switch,
  toast,
  VStack
} from "@carbon/react";
import { INPUT_FORMAT, redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { z } from "zod";
import { Users } from "~/components/Form";
import { SettingsPage, SettingsPageHeading } from "~/components/SettingsPage";
import SettingsSectionHeader from "~/components/SettingsSectionHeader";
import { useSavedToggle } from "~/hooks/useSavedToggle";
import {
  digitalQuoteValidator,
  quoteLineCategoryMarkupsSettingsValidator,
  rfqReadyValidator,
  salesRuleNotificationValidator,
  settingsToggle
} from "~/modules/settings/settings.models";
import { getCompanySettings } from "~/modules/settings/settings.service";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Sales`,
  to: path.to.salesSettings
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
  return {
    companySettings: companySettings.data
  };
}

// One form per card, told apart by its intent: each becomes the fields of
// `settings.sales.update` it saves.
const salesSettingsForm = z.discriminatedUnion("intent", [
  settingsToggle(
    "requireCustomerContactAndLocationToggle",
    "requireCustomerContactAndLocation"
  ),
  settingsToggle("showCustomerReadableIdToggle", "showCustomerReadableId"),
  digitalQuoteValidator
    .extend({ intent: z.literal("digitalQuote") })
    .transform((form) => ({
      digitalQuoteEnabled: form.digitalQuoteEnabled,
      digitalQuoteNotificationGroup: form.digitalQuoteNotificationGroup ?? [],
      digitalQuoteIncludesPurchaseOrders:
        form.digitalQuoteIncludesPurchaseOrders
    })),
  rfqReadyValidator
    .extend({ intent: z.literal("rfq") })
    .transform(({ rfqReadyNotificationGroup }) => ({
      rfqReadyNotificationGroup: rfqReadyNotificationGroup ?? []
    })),
  salesRuleNotificationValidator
    .extend({ intent: z.literal("salesRuleViolations") })
    .transform(({ salesRuleNotificationGroup }) => ({
      salesRuleNotificationGroup: salesRuleNotificationGroup ?? []
    })),
  quoteLineCategoryMarkupsSettingsValidator
    .extend({ intent: z.literal("categoryMarkups") })
    .transform(({ intent: _, ...quoteLineCategoryMarkups }) => ({
      quoteLineCategoryMarkups
    }))
]);

export async function action(args: ActionFunctionArgs) {
  const input = await validator(salesSettingsForm).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  return api.settings.updateSalesSettings(input.data);
}

export default function SalesSettingsRoute() {
  const { t } = useLingui();
  const { companySettings } = useLoaderData<typeof loader>();
  const fetcher = useAction<typeof action>({
    onSuccess: ({ data }) => {
      if (!data) return;
      if (data.digitalQuoteEnabled !== undefined)
        toast.success(t`Digital quote setting updated`);
      else if (data.rfqReadyNotificationGroup)
        toast.success(t`RFQ setting updated`);
      else if (data.salesRuleNotificationGroup)
        toast.success(t`Sales rule notification settings updated`);
      else toast.success(t`Default category markups updated`);
    }
  });
  const toggleFetcher = useAction<typeof action>({
    onSuccess: ({ data }) => {
      if (!data) return;
      if (data.requireCustomerContactAndLocation !== undefined) {
        toast.success(
          data.requireCustomerContactAndLocation
            ? t`Customer contact requirement enabled`
            : t`Customer contact requirement disabled`
        );
      } else if (data.showCustomerReadableId !== undefined) {
        toast.success(
          data.showCustomerReadableId
            ? t`Customer IDs shown`
            : t`Customer IDs hidden`
        );
      }
    }
  });

  const requireCustomerContactAndLocation = useSavedToggle(
    toggleFetcher,
    "requireCustomerContactAndLocationToggle",
    (companySettings as { requireCustomerContactAndLocation?: boolean })
      .requireCustomerContactAndLocation ?? false
  );

  const handleRequireCustomerContactToggle = useCallback(
    (checked: boolean) => {
      toggleFetcher.submit(
        {
          intent: "requireCustomerContactAndLocationToggle",
          enabled: checked.toString()
        },
        { method: "POST" }
      );
    },
    [toggleFetcher]
  );

  const showCustomerReadableIdEnabled = useSavedToggle(
    toggleFetcher,
    "showCustomerReadableIdToggle",
    companySettings.showCustomerReadableId ?? false
  );

  const handleShowCustomerReadableIdToggle = useCallback(
    (checked: boolean) => {
      toggleFetcher.submit(
        { intent: "showCustomerReadableIdToggle", enabled: checked.toString() },
        { method: "POST" }
      );
    },
    [toggleFetcher]
  );

  const [digitalQuoteEnabled, setDigitalQuoteEnabled] = useState(
    companySettings.digitalQuoteEnabled ?? false
  );

  return (
    <ScrollArea className="w-full h-[calc(100dvh-var(--topbar-height)-var(--content-inset))]">
      <SettingsPage className="gap-4">
        <SettingsPageHeading>
          <Trans>Sales</Trans>
        </SettingsPageHeading>

        <SettingsSectionHeader>
          <Trans>Documents</Trans>
        </SettingsSectionHeader>

        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Require a Customer Contact and Location</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>
                A customer must have at least one contact with an email address
                and at least one location with a country — plus a state, for US
                addresses — before its quotes, orders and invoices can be issued
                or posted. The mirror of the supplier requirement under
                Purchasing; no integration requires it today.
              </Trans>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <HStack className="justify-between items-center">
              <VStack className="items-start" spacing={1}>
                <span className="font-medium">
                  {requireCustomerContactAndLocation ? (
                    <Trans>A customer contact and location are required</Trans>
                  ) : (
                    <Trans>A customer contact and location are optional</Trans>
                  )}
                </span>
                <span className="text-sm text-muted-foreground">
                  {requireCustomerContactAndLocation ? (
                    <Trans>
                      Quotes, orders and invoices are blocked until the customer
                      has a contact with an email address and a location with a
                      country.
                    </Trans>
                  ) : (
                    <Trans>
                      Enable to block issuing or posting for a customer with no
                      contact or no location.
                    </Trans>
                  )}
                </span>
              </VStack>
              <Switch
                checked={requireCustomerContactAndLocation}
                onCheckedChange={handleRequireCustomerContactToggle}
                disabled={toggleFetcher.state !== "idle"}
              />
            </HStack>
          </CardContent>
        </Card>
        <SettingsSectionHeader>
          <Trans>Customers</Trans>
        </SettingsSectionHeader>

        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Show Customer IDs</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>
                Show a readable Customer ID column on the customer list,
                customer forms, and dropdowns. Customers are still identified
                internally either way.
              </Trans>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <HStack className="justify-between items-center">
              <VStack className="items-start" spacing={1}>
                <span className="font-medium">
                  {showCustomerReadableIdEnabled ? (
                    <Trans>Customer IDs are shown</Trans>
                  ) : (
                    <Trans>Customer IDs are hidden</Trans>
                  )}
                </span>
                <span className="text-sm text-muted-foreground">
                  {showCustomerReadableIdEnabled ? (
                    <Trans>
                      A readable Customer ID appears on lists, forms and
                      dropdowns.
                    </Trans>
                  ) : (
                    <Trans>
                      Enable to show a readable Customer ID on lists, forms and
                      dropdowns.
                    </Trans>
                  )}
                </span>
              </VStack>
              <Switch
                checked={showCustomerReadableIdEnabled}
                onCheckedChange={handleShowCustomerReadableIdToggle}
                disabled={toggleFetcher.state !== "idle"}
              />
            </HStack>
          </CardContent>
        </Card>

        <SettingsSectionHeader>
          <Trans>Quotes</Trans>
        </SettingsSectionHeader>

        <Card>
          <ValidatedForm
            method="post"
            validator={digitalQuoteValidator}
            defaultValues={{
              digitalQuoteEnabled: companySettings.digitalQuoteEnabled ?? false,
              digitalQuoteNotificationGroup:
                companySettings.digitalQuoteNotificationGroup ?? [],
              digitalQuoteIncludesPurchaseOrders:
                companySettings.digitalQuoteIncludesPurchaseOrders ?? false
            }}
            fetcher={fetcher}
          >
            <input type="hidden" name="intent" value="digitalQuote" />
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trans>Digital Quotes</Trans>
              </CardTitle>
              <CardDescription>
                <Trans>
                  Enable digital quotes for your company. This will allow you to
                  send digital quotes to your customers, and allow them to
                  accept them online.
                </Trans>
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
                  <Label>
                    <Trans>Notifications</Trans>
                  </Label>
                  <Users
                    name="digitalQuoteNotificationGroup"
                    label={t`Who should receive notifications when a digital quote is accepted or expired?`}
                    type="employee"
                  />
                </div>
              </div>
            </CardContent>
            <CardFooter>
              <Submit
                isDisabled={fetcher.state !== "idle"}
                isLoading={
                  fetcher.state !== "idle" &&
                  fetcher.formData?.get("intent") === "digitalQuote"
                }
              >
                <Trans>Save</Trans>
              </Submit>
            </CardFooter>
          </ValidatedForm>
        </Card>
        <CategoryMarkupsCard
          companySettings={companySettings}
          fetcher={fetcher}
        />

        <SettingsSectionHeader>
          <Trans>Notifications</Trans>
        </SettingsSectionHeader>

        <Card>
          <ValidatedForm
            method="post"
            validator={rfqReadyValidator}
            defaultValues={{
              rfqReadyNotificationGroup:
                companySettings.rfqReadyNotificationGroup ?? []
            }}
            fetcher={fetcher}
          >
            <input type="hidden" name="intent" value="rfq" />
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trans>RFQ</Trans>
              </CardTitle>
              <CardDescription>
                <Trans>
                  Enable notifications when an RFQ is marked as ready for quote.
                </Trans>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-8 max-w-[400px]">
                <div className="flex flex-col gap-2">
                  <Label>
                    <Trans>Notifications</Trans>
                  </Label>
                  <Users
                    name="rfqReadyNotificationGroup"
                    label={t`Who should receive notifications when a RFQ is marked ready for quote?`}
                    type="employee"
                  />
                </div>
              </div>
            </CardContent>
            <CardFooter>
              <Submit
                isDisabled={fetcher.state !== "idle"}
                isLoading={
                  fetcher.state !== "idle" &&
                  fetcher.formData?.get("intent") === "rfq"
                }
              >
                <Trans>Save</Trans>
              </Submit>
            </CardFooter>
          </ValidatedForm>
        </Card>
        <Card>
          <ValidatedForm
            method="post"
            validator={salesRuleNotificationValidator}
            defaultValues={{
              salesRuleNotificationGroup:
                companySettings.salesRuleNotificationGroup ?? []
            }}
            fetcher={fetcher}
          >
            <input type="hidden" name="intent" value="salesRuleViolations" />
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trans>Sales Rule Violations</Trans>
              </CardTitle>
              <CardDescription>
                <Trans>
                  Enable notifications when a sales rule violation is blocked or
                  acknowledged on a quote, sales order, or sales invoice.
                </Trans>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-8 max-w-[400px]">
                <div className="flex flex-col gap-2">
                  <Label>
                    <Trans>Notifications</Trans>
                  </Label>
                  <Users
                    name="salesRuleNotificationGroup"
                    label={t`Who should receive notifications when a sales rule violation is blocked or acknowledged?`}
                    type="employee"
                  />
                </div>
              </div>
            </CardContent>
            <CardFooter>
              <Submit
                isDisabled={fetcher.state !== "idle"}
                isLoading={
                  fetcher.state !== "idle" &&
                  fetcher.formData?.get("intent") === "salesRuleViolations"
                }
              >
                <Trans>Save</Trans>
              </Submit>
            </CardFooter>
          </ValidatedForm>
        </Card>
      </SettingsPage>
    </ScrollArea>
  );
}

const costCategoryKeys = [
  "materialCost",
  "partCost",
  "toolCost",
  "consumableCost",
  "laborCost",
  "machineCost",
  "overheadCost",
  "outsideCost"
] as const;

const categoryLabels: Record<string, { label: string; description: string }> = {
  materialCost: {
    label: "Material",
    description: "Raw materials"
  },
  partCost: {
    label: "Part",
    description: "Made and purchased parts"
  },
  toolCost: {
    label: "Tool",
    description: "Jigs, fixtures, and other tools"
  },
  consumableCost: {
    label: "Consumable",
    description: "Consumables like lubricants, gloves, and other small items"
  },
  laborCost: {
    label: "Labor",
    description: "Service and labor costs"
  },
  machineCost: {
    label: "Machine",
    description: "Time the machine is running"
  },
  overheadCost: {
    label: "Overhead",
    description: "Administrative and other operational costs"
  },
  outsideCost: {
    label: "Outside",
    description: "Services performed by third parties"
  }
};

function CategoryMarkupsCard({
  companySettings,
  fetcher
}: {
  companySettings: ReturnType<
    typeof useLoaderData<typeof loader>
  >["companySettings"];
  fetcher: ReturnType<typeof useAction<typeof action>>;
}) {
  const saved = (companySettings as Record<string, unknown>)
    .quoteLineCategoryMarkups as Record<string, number> | null;

  return (
    <Card>
      <ValidatedForm
        method="post"
        validator={quoteLineCategoryMarkupsSettingsValidator}
        defaultValues={{
          materialCost: saved?.materialCost ?? 0,
          partCost: saved?.partCost ?? 0,
          toolCost: saved?.toolCost ?? 0,
          consumableCost: saved?.consumableCost ?? 0,
          laborCost: saved?.laborCost ?? 0,
          machineCost: saved?.machineCost ?? 0,
          overheadCost: saved?.overheadCost ?? 0,
          outsideCost: saved?.outsideCost ?? 0
        }}
        fetcher={fetcher}
      >
        <input type="hidden" name="intent" value="categoryMarkups" />
        <CardHeader>
          <CardTitle>
            <Trans>Quote Markups</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>
              Set default markup percentages for each cost category on new quote
              lines
            </Trans>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <VStack>
            {costCategoryKeys.map((key, index) => (
              <HStack
                key={key}
                className={cn(
                  "justify-between items-center w-full",
                  index !== costCategoryKeys.length - 1 &&
                    "border-b border-border pb-4"
                )}
              >
                <VStack spacing={0} className="flex flex-1">
                  <span className="text-sm font-medium">
                    {categoryLabels[key].label}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {categoryLabels[key].description}
                  </span>
                </VStack>
                <div className="flex flex-shrink-0">
                  <Number
                    name={key}
                    label=""
                    formatOptions={INPUT_FORMAT.percent}
                    minValue={0}
                  />
                </div>
              </HStack>
            ))}
          </VStack>
        </CardContent>
        <CardFooter>
          <Submit
            isDisabled={fetcher.state !== "idle"}
            isLoading={
              fetcher.state !== "idle" &&
              fetcher.formData?.get("intent") === "categoryMarkups"
            }
          >
            <Trans>Save</Trans>
          </Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
}
