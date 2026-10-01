// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
import { getLogger } from "@carbon/logger";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Heading,
  HStack,
  Label,
  ScrollArea,
  Switch,
  toast,
  VStack
} from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData } from "react-router";
import CompanyDefaultAttachmentsCard from "~/components/CompanyDefaultAttachmentsCard";
import { EmailRecipients, Users } from "~/components/Form";
import Country from "~/components/Form/Country";
import SettingsSectionHeader from "~/components/SettingsSectionHeader";
import {
  accountsPayableBillingAddressValidator,
  defaultSupplierCcValidator,
  getAccountsPayableBillingAddress,
  getCompanySettings,
  purchasePriceUpdateTimingTypes,
  purchasePriceUpdateTimingValidator,
  supplierQuoteNotificationValidator,
  updateAccountsPayableAddressSetting,
  updateAccountsPayableBillingAddress,
  updateDefaultSupplierCc,
  updateLeadTimesOnReceiptSetting,
  updatePurchasePriceUpdateTimingSetting,
  updateRequireSupplierContactSetting,
  updateShowSupplierReadableIdSetting,
  updateSupplierQuoteNotificationSetting
} from "~/modules/settings";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

const logger = getLogger("erp", "settings", "purchasing");

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

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "settings"
  });

  const formData = await request.formData();
  const intent = formData.get("intent");

  switch (intent) {
    case "accountsPayableAddressToggle":
      const apToggleEnabled = formData.get("enabled") === "true";
      const apToggleResult = await updateAccountsPayableAddressSetting(
        client,
        companyId,
        apToggleEnabled
      );
      if (apToggleResult.error) {
        logger.error("Failed to update accounts payable address toggle", {
          error: apToggleResult.error
        });
        return {
          success: false,
          message: apToggleResult.error.message
        };
      }
      return {
        success: true,
        message: `Accounts payable billing address ${apToggleEnabled ? "enabled" : "disabled"}`
      };

    case "requireSupplierContactAndLocationToggle": {
      const enabled = formData.get("enabled") === "true";
      const result = await updateRequireSupplierContactSetting(
        client,
        companyId,
        enabled
      );
      if (result.error) {
        logger.error("Failed to update require supplier contact", {
          error: result.error
        });
        return { success: false, message: result.error.message };
      }
      return {
        success: true,
        message: `Supplier contact requirement ${enabled ? "enabled" : "disabled"}`
      };
    }

    case "purchasePriceUpdateTiming":
      const validation = await validator(
        purchasePriceUpdateTimingValidator
      ).validate(formData);

      if (validation.error) {
        return { success: false, message: "Invalid form data" };
      }

      const result = await updatePurchasePriceUpdateTimingSetting(
        client,
        companyId,
        validation.data.purchasePriceUpdateTiming
      );

      if (result.error) {
        logger.error("Failed to update purchase price timing setting", {
          error: result.error
        });
        return {
          success: false,
          message: result.error.message
        };
      }

      return {
        success: true,
        message: "Purchase price update timing updated"
      };

    case "updateLeadTimesOnReceipt":
      const updateLeadTimesOnReceipt = formData.get("enabled") === "true";
      const updateLeadTimesResult = await updateLeadTimesOnReceiptSetting(
        client,
        companyId,
        updateLeadTimesOnReceipt
      );

      if (updateLeadTimesResult.error) {
        logger.error("Failed to update lead-time-on-receipt setting", {
          error: updateLeadTimesResult.error
        });
        return {
          success: false,
          message: updateLeadTimesResult.error.message
        };
      }

      return {
        success: true,
        message: `Lead time updates on receipt ${updateLeadTimesOnReceipt ? "enabled" : "disabled"}`
      };

    case "showSupplierReadableIdToggle":
      const showSupplierReadableId = formData.get("enabled") === "true";
      const showSupplierReadableIdResult =
        await updateShowSupplierReadableIdSetting(
          client,
          companyId,
          showSupplierReadableId
        );

      if (showSupplierReadableIdResult.error) {
        logger.error("Failed to update supplier ID visibility setting", {
          error: showSupplierReadableIdResult.error
        });
        return {
          success: false,
          message: showSupplierReadableIdResult.error.message
        };
      }

      return {
        success: true,
        message: `Supplier IDs ${showSupplierReadableId ? "shown" : "hidden"}`
      };

    case "supplierQuoteNotification":
      const supplierQuoteValidation = await validator(
        supplierQuoteNotificationValidator
      ).validate(formData);

      if (supplierQuoteValidation.error) {
        return { success: false, message: "Invalid form data" };
      }

      const supplierQuoteResult = await updateSupplierQuoteNotificationSetting(
        client,
        companyId,
        supplierQuoteValidation.data.supplierQuoteNotificationGroup ?? []
      );

      if (supplierQuoteResult.error) {
        logger.error("Failed to update supplier quote notification setting", {
          error: supplierQuoteResult.error
        });
        return {
          success: false,
          message: supplierQuoteResult.error.message
        };
      }

      return {
        success: true,
        message: "Supplier quote notification setting updated"
      };

    case "accountsPayableBillingAddress":
      const apBillingValidation = await validator(
        accountsPayableBillingAddressValidator
      ).validate(formData);

      if (apBillingValidation.error) {
        return { success: false, message: "Invalid form data" };
      }

      const apBillingResult = await updateAccountsPayableBillingAddress(
        client,
        companyId,
        apBillingValidation.data,
        userId
      );

      if (apBillingResult.error) {
        logger.error("Failed to update accounts payable billing address", {
          error: apBillingResult.error
        });
        return {
          success: false,
          message: apBillingResult.error.message
        };
      }

      return {
        success: true,
        message: "Accounts payable billing address updated"
      };

    case "emails":
      const defaultSupplierCcValidation = await validator(
        defaultSupplierCcValidator
      ).validate(formData);

      if (defaultSupplierCcValidation.error) {
        return { success: false, message: "Invalid form data" };
      }

      const defaultSupplierCcResult = await updateDefaultSupplierCc(
        client,
        companyId,
        defaultSupplierCcValidation.data.defaultSupplierCc ?? []
      );

      if (defaultSupplierCcResult.error) {
        logger.error("Failed to update default supplier CC", {
          error: defaultSupplierCcResult.error
        });
        return {
          success: false,
          message: defaultSupplierCcResult.error.message
        };
      }

      return {
        success: true,
        message: "Supplier email settings updated"
      };
  }

  return { success: false, message: "Unknown intent" };
}

export default function PurchasingSettingsRoute() {
  const { t } = useLingui();
  const { companySettings, apBillingAddress, defaultAttachments } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

  useEffect(() => {
    if (fetcher.data?.success === true && fetcher?.data?.message) {
      toast.success(fetcher.data.message);
    }

    if (fetcher.data?.success === false && fetcher?.data?.message) {
      toast.error(fetcher.data.message);
    }
  }, [fetcher.data?.message, fetcher.data?.success]);

  const toggleFetcher = useFetcher<typeof action>();

  const [apAddressEnabled, setApAddressEnabled] = useState(
    companySettings.accountsPayableAddress ?? false
  );

  const [requireSupplierContactAndLocation, setRequireSupplierContact] =
    useState(
      (companySettings as { requireSupplierContactAndLocation?: boolean })
        .requireSupplierContactAndLocation ?? false
    );

  const [leadTimesOnReceiptEnabled, setLeadTimesOnReceiptEnabled] = useState(
    (companySettings as { updateLeadTimesOnReceipt?: boolean })
      .updateLeadTimesOnReceipt ?? false
  );

  const [showSupplierReadableIdEnabled, setShowSupplierReadableIdEnabled] =
    useState(companySettings.showSupplierReadableId ?? false);

  const handleShowSupplierReadableIdToggle = useCallback(
    (checked: boolean) => {
      setShowSupplierReadableIdEnabled(checked);
      toggleFetcher.submit(
        { intent: "showSupplierReadableIdToggle", enabled: checked.toString() },
        { method: "POST" }
      );
    },
    [toggleFetcher]
  );

  const handleRequireSupplierContactToggle = useCallback(
    (checked: boolean) => {
      setRequireSupplierContact(checked);
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
      setApAddressEnabled(checked);
      toggleFetcher.submit(
        { intent: "accountsPayableAddressToggle", enabled: checked.toString() },
        { method: "POST" }
      );
    },
    [toggleFetcher]
  );

  const handleLeadTimesOnReceiptToggle = useCallback(
    (checked: boolean) => {
      setLeadTimesOnReceiptEnabled(checked);
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

  useEffect(() => {
    if (toggleFetcher.data?.success === true && toggleFetcher?.data?.message) {
      toast.success(toggleFetcher.data.message);
    }
    if (toggleFetcher.data?.success === false && toggleFetcher?.data?.message) {
      toast.error(toggleFetcher.data.message);
    }
  }, [toggleFetcher.data?.message, toggleFetcher.data?.success]);

  return (
    <ScrollArea className="w-full h-[calc(100dvh-var(--topbar-height)-var(--content-inset))]">
      <VStack
        spacing={4}
        className="py-12 px-4 max-w-[60rem] h-full mx-auto gap-4"
      >
        <Heading size="h3">
          <Trans>Purchasing</Trans>
        </Heading>

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
      </VStack>
    </ScrollArea>
  );
}
