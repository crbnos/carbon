// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  Hidden,
  Input,
  PhoneInput,
  Select,
  Submit,
  ValidatedForm,
  validator
} from "@carbon/form";
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
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { EmailRecipients, Users } from "~/components/Form";
import Country from "~/components/Form/Country";
import {
  accountsReceivableBillingAddressValidator,
  accountsReceivableEmailValidator,
  defaultCustomerCcValidator,
  getAccountsReceivableBillingAddress,
  getCompanySettings,
  invoiceAutomations,
  invoiceAutomationValidator,
  invoiceNotificationValidator,
  updateAccountsReceivableAddressSetting,
  updateAccountsReceivableBillingAddress,
  updateAccountsReceivableEmail,
  updateDefaultCustomerCc,
  updateInvoiceAutomationSetting,
  updateInvoiceNotificationSetting
} from "~/modules/settings";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Invoicing`,
  to: path.to.invoicingSettings
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "settings"
  });

  const [companySettings, arBillingAddress] = await Promise.all([
    getCompanySettings(client, companyId),
    getAccountsReceivableBillingAddress(client, companyId)
  ]);
  if (!companySettings.data)
    throw redirect(
      path.to.settings,
      await flash(
        request,
        error(companySettings.error, "Failed to get company settings")
      )
    );
  return {
    companySettings: companySettings.data,
    arBillingAddress: arBillingAddress.data
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "settings"
  });

  const formData = await request.formData();
  const intent = formData.get("intent");

  switch (intent) {
    case "invoiceAutomation": {
      const validation = await validator(invoiceAutomationValidator).validate(
        formData
      );

      if (validation.error) {
        return { success: false, message: "Invalid form data" };
      }

      const result = await updateInvoiceAutomationSetting(
        client,
        companyId,
        validation.data.invoiceAutomation
      );

      if (result.error) {
        return { success: false, message: result.error.message };
      }

      return { success: true, message: "Recurring invoice setting updated" };
    }

    case "receivablesEmail": {
      const validation = await validator(
        accountsReceivableEmailValidator
      ).validate(formData);

      if (validation.error) {
        return { success: false, message: "Invalid form data" };
      }

      const result = await updateAccountsReceivableEmail(
        client,
        companyId,
        validation.data.accountsReceivableEmail
      );

      if (result.error) {
        return { success: false, message: result.error.message };
      }

      return { success: true, message: "Receivables email updated" };
    }

    case "invoiceNotifications": {
      const validation = await validator(invoiceNotificationValidator).validate(
        formData
      );

      if (validation.error) {
        return { success: false, message: "Invalid form data" };
      }

      const result = await updateInvoiceNotificationSetting(
        client,
        companyId,
        validation.data.invoiceNotificationGroup ?? []
      );

      if (result.error) {
        return { success: false, message: result.error.message };
      }

      return {
        success: true,
        message: "Invoice notification settings updated"
      };
    }

    case "accountsReceivableAddressToggle":
      const arToggleEnabled = formData.get("enabled") === "true";
      const arToggleResult = await updateAccountsReceivableAddressSetting(
        client,
        companyId,
        arToggleEnabled
      );
      if (arToggleResult.error) {
        return { success: false, message: arToggleResult.error.message };
      }
      return {
        success: true,
        message: `Accounts receivable billing address ${arToggleEnabled ? "enabled" : "disabled"}`
      };

    case "accountsReceivableBillingAddress":
      const arBillingValidation = await validator(
        accountsReceivableBillingAddressValidator
      ).validate(formData);

      if (arBillingValidation.error) {
        return { success: false, message: "Invalid form data" };
      }

      const arBillingResult = await updateAccountsReceivableBillingAddress(
        client,
        companyId,
        arBillingValidation.data,
        userId
      );

      if (arBillingResult.error) {
        return { success: false, message: arBillingResult.error.message };
      }

      return {
        success: true,
        message: "Accounts receivable billing address updated"
      };

    case "emails":
      const defaultCustomerCcValidation = await validator(
        defaultCustomerCcValidator
      ).validate(formData);

      if (defaultCustomerCcValidation.error) {
        return { success: false, message: "Invalid form data" };
      }

      const defaultCustomerCcResult = await updateDefaultCustomerCc(
        client,
        companyId,
        defaultCustomerCcValidation.data.defaultCustomerCc ?? []
      );

      if (defaultCustomerCcResult.error) {
        return {
          success: false,
          message: defaultCustomerCcResult.error.message
        };
      }

      return {
        success: true,
        message: "Customer email settings updated"
      };
  }

  return { success: false, message: "Unknown intent" };
}

export default function InvoicingSettingsRoute() {
  const { t } = useLingui();
  const { companySettings, arBillingAddress } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const toggleFetcher = useFetcher<typeof action>();
  const [arAddressEnabled, setArAddressEnabled] = useState(
    companySettings.accountsReceivableAddress ?? false
  );

  const invoiceAutomationLabels: Record<
    (typeof invoiceAutomations)[number],
    string
  > = {
    "Draft Only": t`Draft only`,
    Post: t`Post`,
    "Post and Email": t`Post and email`
  };

  const handleArAddressToggle = useCallback(
    (checked: boolean) => {
      setArAddressEnabled(checked);
      toggleFetcher.submit(
        {
          intent: "accountsReceivableAddressToggle",
          enabled: checked.toString()
        },
        { method: "POST" }
      );
    },
    [toggleFetcher]
  );

  useEffect(() => {
    if (fetcher.data?.success === true && fetcher?.data?.message) {
      toast.success(fetcher.data.message);
    }

    if (fetcher.data?.success === false && fetcher?.data?.message) {
      toast.error(fetcher.data.message);
    }
  }, [fetcher.data?.message, fetcher.data?.success]);

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
          <Trans>Invoicing</Trans>
        </Heading>

        <Card>
          <ValidatedForm
            method="post"
            validator={invoiceAutomationValidator}
            defaultValues={{
              invoiceAutomation:
                companySettings.invoiceAutomation ?? "Post and Email"
            }}
            fetcher={fetcher}
          >
            <Hidden name="intent" value="invoiceAutomation" />
            <CardHeader>
              <CardTitle>
                <Trans>Recurring Invoices</Trans>
              </CardTitle>
              <CardDescription>
                <Trans>
                  What happens to invoices created automatically each day from
                  recurring billing, such as rental agreements. Invoices with
                  charges, early-return credits or rule violations always wait
                  for review.
                </Trans>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-8 max-w-[400px]">
                <Select
                  name="invoiceAutomation"
                  label={t`When an invoice is created`}
                  options={invoiceAutomations.map((mode) => ({
                    value: mode,
                    label: invoiceAutomationLabels[mode]
                  }))}
                />
              </div>
            </CardContent>
            <CardFooter>
              <Submit
                isDisabled={fetcher.state !== "idle"}
                isLoading={
                  fetcher.state !== "idle" &&
                  fetcher.formData?.get("intent") === "invoiceAutomation"
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
            validator={accountsReceivableEmailValidator}
            defaultValues={{
              accountsReceivableEmail:
                companySettings.accountsReceivableEmail ?? ""
            }}
            fetcher={fetcher}
          >
            <Hidden name="intent" value="receivablesEmail" />
            <CardHeader>
              <CardTitle>
                <Trans>Receivables Email</Trans>
              </CardTitle>
              <CardDescription>
                <Trans>
                  Replies to emailed invoices go here, and it's copied on each
                  one.
                </Trans>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-8 max-w-[400px]">
                <Input name="accountsReceivableEmail" label={t`Email`} />
              </div>
            </CardContent>
            <CardFooter>
              <Submit
                isDisabled={fetcher.state !== "idle"}
                isLoading={
                  fetcher.state !== "idle" &&
                  fetcher.formData?.get("intent") === "receivablesEmail"
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
            validator={invoiceNotificationValidator}
            defaultValues={{
              invoiceNotificationGroup:
                companySettings.invoiceNotificationGroup ?? []
            }}
            fetcher={fetcher}
          >
            <Hidden name="intent" value="invoiceNotifications" />
            <CardHeader>
              <CardTitle>
                <Trans>Notifications</Trans>
              </CardTitle>
              <CardDescription>
                <Trans>
                  Each agreement's salesperson (or its creator) gets a daily
                  summary of their rental invoices.
                </Trans>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-8 max-w-[400px]">
                <Users
                  name="invoiceNotificationGroup"
                  label={t`Also notify`}
                  helperText={t`Gets the summary for every agreement`}
                  type="employee"
                />
              </div>
            </CardContent>
            <CardFooter>
              <Submit
                isDisabled={fetcher.state !== "idle"}
                isLoading={
                  fetcher.state !== "idle" &&
                  fetcher.formData?.get("intent") === "invoiceNotifications"
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
            validator={defaultCustomerCcValidator}
            defaultValues={{
              defaultCustomerCc: companySettings.defaultCustomerCc ?? []
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
                  These email addresses will be automatically CC'd on all quote
                  emails sent to customers.
                </Trans>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-8 max-w-[400px]">
                <EmailRecipients
                  name="defaultCustomerCc"
                  label={t`Default CC Recipients`}
                />
              </div>
            </CardContent>
            <CardFooter>
              <Submit
                isDisabled={fetcher.state !== "idle"}
                isLoading={
                  fetcher.state !== "idle" &&
                  fetcher.formData?.get("intent") === "emails"
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
              <Trans>Centralized Billing Address</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>
                Route all AR invoices to one address (e.g. corporate
                headquarters) instead of individual locations.
              </Trans>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <HStack className="justify-between items-center">
              <VStack className="items-start" spacing={1}>
                <span className="font-medium">
                  {arAddressEnabled ? (
                    <Trans>Centralized billing is enabled</Trans>
                  ) : (
                    <Trans>Centralized billing is disabled</Trans>
                  )}
                </span>
                <span className="text-sm text-muted-foreground">
                  {arAddressEnabled ? (
                    <Trans>
                      AR invoices are routed to a single billing address.
                    </Trans>
                  ) : (
                    <Trans>
                      Enable to route all AR invoices to a single billing
                      address.
                    </Trans>
                  )}
                </span>
              </VStack>
              <Switch
                checked={arAddressEnabled}
                onCheckedChange={handleArAddressToggle}
                disabled={toggleFetcher.state !== "idle"}
              />
            </HStack>
          </CardContent>
        </Card>
        {arAddressEnabled && (
          <Card>
            <ValidatedForm
              method="post"
              validator={accountsReceivableBillingAddressValidator}
              defaultValues={{
                name: arBillingAddress?.name ?? "",
                addressLine1: arBillingAddress?.addressLine1 ?? "",
                addressLine2: arBillingAddress?.addressLine2 ?? "",
                city: arBillingAddress?.city ?? "",
                state: arBillingAddress?.state ?? "",
                postalCode: arBillingAddress?.postalCode ?? "",
                countryCode: arBillingAddress?.countryCode ?? "",
                phone: arBillingAddress?.phone ?? "",
                fax: arBillingAddress?.fax ?? "",
                email: arBillingAddress?.email ?? ""
              }}
              fetcher={fetcher}
            >
              <input
                type="hidden"
                name="intent"
                value="accountsReceivableBillingAddress"
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
                      "accountsReceivableBillingAddress"
                  }
                >
                  <Trans>Save</Trans>
                </Submit>
              </CardFooter>
            </ValidatedForm>
          </Card>
        )}
      </VStack>
    </ScrollArea>
  );
}
