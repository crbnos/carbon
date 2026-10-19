// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { storage } from "@carbon/files";
import {
  Input,
  PhoneInput,
  Select,
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
  HStack,
  Label,
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
import CompanyDefaultAttachmentsCard from "~/components/CompanyDefaultAttachmentsCard";
import { EmailRecipients, Users } from "~/components/Form";
import Country from "~/components/Form/Country";
import { SettingsPage, SettingsPageHeading } from "~/components/SettingsPage";
import SettingsSectionHeader from "~/components/SettingsSectionHeader";
import { useSavedToggle } from "~/hooks/useSavedToggle";
import {
  accountsPayableBillingAddressValidator,
  billingAddressFields,
  defaultSupplierCcValidator,
  purchasePriceUpdateTimingTypes,
  purchasePriceUpdateTimingValidator,
  settingsToggle,
  supplierQuoteNotificationValidator
} from "~/modules/settings/settings.models";
import {
  getAccountsPayableBillingAddress,
  getCompanySettings
} from "~/modules/settings/settings.service";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Purchasing`,
  to: path.to.purchasingSettings
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "settings"
  });

  const [companySettings, apBillingAddress, defaultAttachmentsResult] =
    await Promise.all([
      getCompanySettings(client, companyId),
      getAccountsPayableBillingAddress(client, companyId),
      storage(client)
        .company(companyId)
        .list(`${companyId}/default-attachments/company`)
    ]);

  if (companySettings.error) {
    throw redirect(
      path.to.settings,
      await flash(
        request,
        error(companySettings.error, "Failed to get company settings")
      )
    );
  }

  return {
    companySettings: companySettings.data,
    apBillingAddress: apBillingAddress.data,
    defaultAttachments: defaultAttachmentsResult.data ?? []
  };
}

// One form per card, told apart by its intent: each becomes the fields of
// `settings.purchasing.update` it saves (the operation drops `intent`).
const purchasingSettingsForm = z.discriminatedUnion("intent", [
  settingsToggle("accountsPayableAddressToggle", "accountsPayableAddress"),
  settingsToggle(
    "requireSupplierContactAndLocationToggle",
    "requireSupplierContactAndLocation"
  ),
  purchasePriceUpdateTimingValidator.extend({
    intent: z.literal("purchasePriceUpdateTiming")
  }),
  settingsToggle("updateLeadTimesOnReceipt", "updateLeadTimesOnReceipt"),
  settingsToggle("showSupplierReadableIdToggle", "showSupplierReadableId"),
  supplierQuoteNotificationValidator
    .extend({ intent: z.literal("supplierQuoteNotification") })
    .transform(({ supplierQuoteNotificationGroup }) => ({
      supplierQuoteNotificationGroup: supplierQuoteNotificationGroup ?? []
    })),
  accountsPayableBillingAddressValidator
    .extend({ intent: z.literal("accountsPayableBillingAddress") })
    .transform((form) => ({
      accountsPayableBillingAddress: billingAddressFields(form)
    })),
  defaultSupplierCcValidator
    .extend({ intent: z.literal("emails") })
    .transform(({ defaultSupplierCc }) => ({
      defaultSupplierCc: defaultSupplierCc ?? []
    }))
]);

export async function action(args: ActionFunctionArgs) {
  const input = await validator(purchasingSettingsForm).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  return api.settings.updatePurchasingSettings(input.data);
}

export default function PurchasingSettingsRoute() {
  const { t } = useLingui();
  const { companySettings, apBillingAddress, defaultAttachments } =
    useLoaderData<typeof loader>();
  const fetcher = useAction<typeof action>({
    onSuccess: ({ data }) => {
      if (!data) return;
      if (data.purchasePriceUpdateTiming)
        toast.success(t`Purchase price update timing updated`);
      else if (data.supplierQuoteNotificationGroup)
        toast.success(t`Supplier quote notification setting updated`);
      else if (data.accountsPayableBillingAddress)
        toast.success(t`Accounts payable billing address updated`);
      else toast.success(t`Supplier email settings updated`);
    }
  });

  const toggleFetcher = useAction<typeof action>({
    onSuccess: ({ data }) => {
      if (!data) return;
      if (data.accountsPayableAddress !== undefined) {
        toast.success(
          data.accountsPayableAddress
            ? t`Accounts payable billing address enabled`
            : t`Accounts payable billing address disabled`
        );
      } else if (data.requireSupplierContactAndLocation !== undefined) {
        toast.success(
          data.requireSupplierContactAndLocation
            ? t`Supplier contact requirement enabled`
            : t`Supplier contact requirement disabled`
        );
      } else if (data.updateLeadTimesOnReceipt !== undefined) {
        toast.success(
          data.updateLeadTimesOnReceipt
            ? t`Lead time updates on receipt enabled`
            : t`Lead time updates on receipt disabled`
        );
      } else if (data.showSupplierReadableId !== undefined) {
        toast.success(
          data.showSupplierReadableId
            ? t`Supplier IDs shown`
            : t`Supplier IDs hidden`
        );
      }
    }
  });

  const apAddressEnabled = useSavedToggle(
    toggleFetcher,
    "accountsPayableAddressToggle",
    companySettings.accountsPayableAddress ?? false
  );

  const requireSupplierContactAndLocation = useSavedToggle(
    toggleFetcher,
    "requireSupplierContactAndLocationToggle",
    (companySettings as { requireSupplierContactAndLocation?: boolean })
      .requireSupplierContactAndLocation ?? false
  );

  const leadTimesOnReceiptEnabled = useSavedToggle(
    toggleFetcher,
    "updateLeadTimesOnReceipt",
    (companySettings as { updateLeadTimesOnReceipt?: boolean })
      .updateLeadTimesOnReceipt ?? false
  );

  const showSupplierReadableIdEnabled = useSavedToggle(
    toggleFetcher,
    "showSupplierReadableIdToggle",
    companySettings.showSupplierReadableId ?? false
  );

  const handleShowSupplierReadableIdToggle = useCallback(
    (checked: boolean) => {
      toggleFetcher.submit(
        { intent: "showSupplierReadableIdToggle", enabled: checked.toString() },
        { method: "POST" }
      );
    },
    [toggleFetcher]
  );

  const handleRequireSupplierContactToggle = useCallback(
    (checked: boolean) => {
      toggleFetcher.submit(
        {
          intent: "requireSupplierContactAndLocationToggle",
          enabled: checked.toString()
        },
        { method: "POST" }
      );
    },
    [toggleFetcher]
  );

  const handleApAddressToggle = useCallback(
    (checked: boolean) => {
      toggleFetcher.submit(
        { intent: "accountsPayableAddressToggle", enabled: checked.toString() },
        { method: "POST" }
      );
    },
    [toggleFetcher]
  );

  const handleLeadTimesOnReceiptToggle = useCallback(
    (checked: boolean) => {
      toggleFetcher.submit(
        {
          intent: "updateLeadTimesOnReceipt",
          enabled: checked.toString()
        },
        { method: "POST" }
      );
    },
    [toggleFetcher]
  );

  return (
    <ScrollArea className="w-full h-[calc(100dvh-var(--topbar-height)-var(--content-inset))]">
      <SettingsPage className="gap-4">
        <SettingsPageHeading>
          <Trans>Purchasing</Trans>
        </SettingsPageHeading>

        <SettingsSectionHeader>
          <Trans>Documents</Trans>
        </SettingsSectionHeader>

        <CompanyDefaultAttachmentsCard
          files={(defaultAttachments ?? []) as any}
        />
        <Card>
          <ValidatedForm
            method="post"
            validator={defaultSupplierCcValidator}
            defaultValues={{
              defaultSupplierCc: companySettings.defaultSupplierCc ?? []
            }}
            fetcher={fetcher}
          >
            <input type="hidden" name="intent" value="emails" />
            <CardHeader>
              <CardTitle>
                <Trans>Emails</Trans>
              </CardTitle>
              <CardDescription>
                <Trans>
                  These email addresses will be automatically CC'd on all emails
                  sent to suppliers (quotes, purchase orders, etc.).
                </Trans>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-8 max-w-[400px]">
                <EmailRecipients
                  name="defaultSupplierCc"
                  label={t`Default CC Recipients`}
                />
              </div>
            </CardContent>
            <CardFooter>
              <Submit
                isDisabled={fetcher.state !== "idle"}
                isLoading={
                  fetcher.state !== "idle" &&
                  fetcher.formData?.get("intent") === "defaultSupplierCc"
                }
              >
                <Trans>Save</Trans>
              </Submit>
            </CardFooter>
          </ValidatedForm>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Require a Supplier Contact and Location</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>
                A supplier must have at least one contact with an email address
                and at least one location with a country — plus a state, for US
                addresses — before its quotes, orders and invoices can be issued
                or posted. Spend platforms cannot create a vendor without all of
                them, so a supplier missing any has its bills rejected after the
                fact.
              </Trans>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <HStack className="justify-between items-center">
              <VStack className="items-start" spacing={1}>
                <span className="font-medium">
                  {requireSupplierContactAndLocation ? (
                    <Trans>A supplier contact and location are required</Trans>
                  ) : (
                    <Trans>A supplier contact and location are optional</Trans>
                  )}
                </span>
                <span className="text-sm text-muted-foreground">
                  {requireSupplierContactAndLocation ? (
                    <Trans>
                      Quotes, orders and invoices are blocked until the supplier
                      has a contact with an email address and a location with a
                      country.
                    </Trans>
                  ) : (
                    <Trans>
                      Enable to block issuing or posting for a supplier with no
                      contact or no location.
                    </Trans>
                  )}
                </span>
              </VStack>
              <Switch
                checked={requireSupplierContactAndLocation}
                onCheckedChange={handleRequireSupplierContactToggle}
                disabled={toggleFetcher.state !== "idle"}
              />
            </HStack>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Centralized Billing Address</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>
                Route all AP invoices to one address (e.g. corporate
                headquarters) instead of individual purchasers.
              </Trans>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <HStack className="justify-between items-center">
              <VStack className="items-start" spacing={1}>
                <span className="font-medium">
                  {apAddressEnabled ? (
                    <Trans>Centralized billing is enabled</Trans>
                  ) : (
                    <Trans>Centralized billing is disabled</Trans>
                  )}
                </span>
                <span className="text-sm text-muted-foreground">
                  {apAddressEnabled ? (
                    <Trans>
                      AP invoices are routed to a single billing address.
                    </Trans>
                  ) : (
                    <Trans>
                      Enable to route all AP invoices to a single billing
                      address.
                    </Trans>
                  )}
                </span>
              </VStack>
              <Switch
                checked={apAddressEnabled}
                onCheckedChange={handleApAddressToggle}
                disabled={toggleFetcher.state !== "idle"}
              />
            </HStack>
          </CardContent>
        </Card>
        {apAddressEnabled && (
          <Card>
            <ValidatedForm
              method="post"
              validator={accountsPayableBillingAddressValidator}
              defaultValues={{
                name: apBillingAddress?.name ?? "",
                addressLine1: apBillingAddress?.addressLine1 ?? "",
                addressLine2: apBillingAddress?.addressLine2 ?? "",
                city: apBillingAddress?.city ?? "",
                state: apBillingAddress?.state ?? "",
                postalCode: apBillingAddress?.postalCode ?? "",
                countryCode: apBillingAddress?.countryCode ?? "",
                phone: apBillingAddress?.phone ?? "",
                fax: apBillingAddress?.fax ?? "",
                email: apBillingAddress?.email ?? ""
              }}
              fetcher={fetcher}
            >
              <input
                type="hidden"
                name="intent"
                value="accountsPayableBillingAddress"
              />
              <CardHeader>
                <CardTitle>
                  <Trans>Billing Address</Trans>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4 w-full">
                  <Input name="name" label={t`Name`} />
                  <Input name="email" label={t`Email`} />
                  <Input name="addressLine1" label={t`Address Line 1`} />
                  <Input name="addressLine2" label={t`Address Line 2`} />
                  <Input name="city" label={t`City`} />
                  <Input name="state" label={t`State / Province`} />
                  <Input name="postalCode" label={t`Postal Code`} />
                  <Country name="countryCode" />
                  <PhoneInput name="phone" label={t`Phone`} />
                  <PhoneInput name="fax" label={t`Fax`} />
                </div>
              </CardContent>
              <CardFooter>
                <Submit
                  isDisabled={fetcher.state !== "idle"}
                  isLoading={
                    fetcher.state !== "idle" &&
                    fetcher.formData?.get("intent") ===
                      "accountsPayableBillingAddress"
                  }
                >
                  <Trans>Save</Trans>
                </Submit>
              </CardFooter>
            </ValidatedForm>
          </Card>
        )}

        <SettingsSectionHeader>
          <Trans>Automatic Updates</Trans>
        </SettingsSectionHeader>

        <Card>
          <ValidatedForm
            method="post"
            validator={purchasePriceUpdateTimingValidator}
            defaultValues={{
              purchasePriceUpdateTiming:
                companySettings.purchasePriceUpdateTiming ??
                "Purchase Invoice Post"
            }}
            fetcher={fetcher}
          >
            <input
              type="hidden"
              name="intent"
              value="purchasePriceUpdateTiming"
            />
            <CardHeader>
              <CardTitle>
                <Trans>Automatic Cost Updates</Trans>
              </CardTitle>
              <CardDescription>
                <Trans>
                  Configure when purchased item costs should be updated from
                  supplier transactions.
                </Trans>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-8 max-w-[400px]">
                <Select
                  name="purchasePriceUpdateTiming"
                  label={t`Update costs on`}
                  options={purchasePriceUpdateTimingTypes.map((type) => ({
                    label: type,
                    value: type
                  }))}
                />
              </div>
            </CardContent>
            <CardFooter>
              <Submit
                isDisabled={fetcher.state !== "idle"}
                isLoading={
                  fetcher.state !== "idle" &&
                  fetcher.formData?.get("intent") ===
                    "purchasePriceUpdateTiming"
                }
              >
                <Trans>Save</Trans>
              </Submit>
            </CardFooter>
          </ValidatedForm>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Automatic Lead Time Updates</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>
                Update part lead times from posted purchase receipts.
              </Trans>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <HStack className="justify-between items-center">
              <VStack className="items-start" spacing={1}>
                <span className="font-medium">
                  {leadTimesOnReceiptEnabled ? (
                    <Trans>Lead time updates are enabled</Trans>
                  ) : (
                    <Trans>Lead time updates are disabled</Trans>
                  )}
                </span>
                <span className="text-sm text-muted-foreground">
                  {leadTimesOnReceiptEnabled ? (
                    <Trans>
                      Part lead times update from posted purchase receipts.
                    </Trans>
                  ) : (
                    <Trans>
                      Enable to update part lead times from posted purchase
                      receipts.
                    </Trans>
                  )}
                </span>
              </VStack>
              <Switch
                checked={leadTimesOnReceiptEnabled}
                onCheckedChange={handleLeadTimesOnReceiptToggle}
                disabled={toggleFetcher.state !== "idle"}
              />
            </HStack>
          </CardContent>
        </Card>
        <SettingsSectionHeader>
          <Trans>Suppliers</Trans>
        </SettingsSectionHeader>

        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Show Supplier IDs</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>
                Show a readable Supplier ID column on the supplier list,
                supplier forms, and dropdowns. Suppliers are still identified
                internally either way.
              </Trans>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <HStack className="justify-between items-center">
              <VStack className="items-start" spacing={1}>
                <span className="font-medium">
                  {showSupplierReadableIdEnabled ? (
                    <Trans>Supplier IDs are shown</Trans>
                  ) : (
                    <Trans>Supplier IDs are hidden</Trans>
                  )}
                </span>
                <span className="text-sm text-muted-foreground">
                  {showSupplierReadableIdEnabled ? (
                    <Trans>
                      A readable Supplier ID appears on lists, forms and
                      dropdowns.
                    </Trans>
                  ) : (
                    <Trans>
                      Enable to show a readable Supplier ID on lists, forms and
                      dropdowns.
                    </Trans>
                  )}
                </span>
              </VStack>
              <Switch
                checked={showSupplierReadableIdEnabled}
                onCheckedChange={handleShowSupplierReadableIdToggle}
                disabled={toggleFetcher.state !== "idle"}
              />
            </HStack>
          </CardContent>
        </Card>

        <SettingsSectionHeader>
          <Trans>Notifications</Trans>
        </SettingsSectionHeader>

        <Card>
          <ValidatedForm
            method="post"
            validator={supplierQuoteNotificationValidator}
            defaultValues={{
              supplierQuoteNotificationGroup:
                companySettings.supplierQuoteNotificationGroup ?? []
            }}
            fetcher={fetcher}
          >
            <input
              type="hidden"
              name="intent"
              value="supplierQuoteNotification"
            />
            <CardHeader>
              <CardTitle>
                <Trans>Supplier Quote Notifications</Trans>
              </CardTitle>
              <CardDescription>
                <Trans>
                  Configure who should receive notifications when a supplier
                  submits a quote.
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
                    name="supplierQuoteNotificationGroup"
                    label={t`Who should receive notifications when a supplier quote is submitted?`}
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
                  fetcher.formData?.get("intent") ===
                    "supplierQuoteNotification"
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
