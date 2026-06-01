import { error, useCarbon } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  Input,
  PhoneInput,
  Select,
  Submit,
  ValidatedForm,
  validator
} from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import {
  Badge,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  generateHTML,
  Heading,
  HStack,
  Label,
  ScrollArea,
  Switch,
  toast,
  useDebounce,
  VStack
} from "@carbon/react";
import { Editor } from "@carbon/react/Editor";
import { getLocalTimeZone, today } from "@internationalized/date";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useState } from "react";
import { LuCircleCheck } from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData } from "react-router";
import CompanyDefaultAttachmentsCard from "~/components/CompanyDefaultAttachmentsCard";
import { EmailRecipients, Users } from "~/components/Form";
import Country from "~/components/Form/Country";
import { usePermissions, useUser } from "~/hooks";
import {
  accountsPayableBillingAddressValidator,
  defaultSupplierCcValidator,
  getAccountsPayableBillingAddress,
  getCompanySettings,
  getTerms,
  purchasePriceUpdateTimingTypes,
  purchasePriceUpdateTimingValidator,
  supplierQuoteNotificationValidator,
  updateAccountsPayableAddressSetting,
  updateAccountsPayableBillingAddress,
  updateDefaultSupplierCc,
  updateLeadTimesOnReceiptSetting,
  updatePurchasePriceUpdateTimingSetting,
  updatePurchasingPdfThumbnails,
  updateShowSupplierReadableIdSetting,
  updateSupplierQuoteNotificationSetting
} from "~/modules/settings";
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

  const [companySettings, terms, apBillingAddress, defaultAttachmentsResult] =
    await Promise.all([
      getCompanySettings(client, companyId),
      getTerms(client, companyId),
      getAccountsPayableBillingAddress(client, companyId),
      client.storage
        .from("private")
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

  if (terms.error) {
    throw redirect(
      path.to.settings,
      await flash(request, error(terms.error, "Failed to load terms"))
    );
  }

  return {
    companySettings: companySettings.data,
    terms: terms.data,
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
        console.error(
          "Failed to update accounts payable address toggle:",
          apToggleResult.error
        );
        return {
          success: false,
          message: apToggleResult.error.message
        };
      }
      return {
        success: true,
        message: `Accounts payable billing address ${apToggleEnabled ? "enabled" : "disabled"}`
      };

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
        console.error(
          "Failed to update purchase price timing setting:",
          result.error
        );
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
        console.error(
          "Failed to update lead-time-on-receipt setting:",
          updateLeadTimesResult.error
        );
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
        console.error(
          "Failed to update supplier ID visibility setting:",
          showSupplierReadableIdResult.error
        );
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
        console.error(
          "Failed to update supplier quote notification setting:",
          supplierQuoteResult.error
        );
        return {
          success: false,
          message: supplierQuoteResult.error.message
        };
      }

      return {
        success: true,
        message: "Supplier quote notification setting updated"
      };

    case "pdfs": {
      const pdfEnabled = formData.get("enabled") === "true";
      const thumbnailsResult = await updatePurchasingPdfThumbnails(
        client,
        companyId,
        pdfEnabled
      );

      if (thumbnailsResult.error)
        return {
          success: false,
          message: thumbnailsResult.error.message
        };

      return { success: true, message: "PDF settings updated" };
    }

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
        console.error(
          "Failed to update accounts payable billing address:",
          apBillingResult.error
        );
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
        console.error(
          "Failed to update default supplier CC:",
          defaultSupplierCcResult.error
        );
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
  const { companySettings, terms, apBillingAddress, defaultAttachments } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const permissions = usePermissions();
  const { carbon } = useCarbon();
  const {
    id: userId,
    company: { id: companyId }
  } = useUser();

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

  const [purchasingTermsStatus, setPurchasingTermsStatus] = useState<
    "saved" | "draft"
  >("saved");

  const handleUpdatePurchasingTerms = (content: JSONContent) => {
    setPurchasingTermsStatus("draft");
    onUpdatePurchasingTerms(content);
  };
  const onUpdatePurchasingTerms = useDebounce(
    async (content: JSONContent) => {
      if (!carbon) return;
      const { error } = await carbon
        .from("terms")
        .update({
          purchasingTerms: content,
          updatedAt: today(getLocalTimeZone()).toString(),
          updatedBy: userId
        })
        .eq("id", companyId);
      if (!error) setPurchasingTermsStatus("saved");
    },
    2500,
    true
  );

  const onUploadImage = async (file: File) => {
    // Implement image upload logic here
    // This is a placeholder function
    console.error("Image upload not implemented", file);
    return "";
  };

  return (
    <ScrollArea className="w-full h-[calc(100dvh-49px)]">
      <VStack
        spacing={4}
        className="py-12 px-4 max-w-[60rem] h-full mx-auto gap-4"
      >
        <Heading size="h3">
          <Trans>Purchasing</Trans>
        </Heading>

        <p className="mt-4 text-xxs text-foreground/70 uppercase font-light tracking-wide">
          <Trans>Documents</Trans>
        </p>

        <Card>
          <HStack className="justify-between items-start">
            <CardHeader>
              <CardTitle>
                <Trans>Purchasing Terms &amp; Conditions</Trans>
              </CardTitle>
              <CardDescription>
                <Trans>
                  Define the terms and conditions for purchase orders
                </Trans>
              </CardDescription>
            </CardHeader>
            <CardAction className="py-6">
              {purchasingTermsStatus === "draft" ? (
                <Badge variant="secondary">
                  <Trans>Draft</Trans>
                </Badge>
              ) : (
                <LuCircleCheck className="w-4 h-4 text-emerald-500" />
              )}
            </CardAction>
          </HStack>
          <CardContent>
            {permissions.can("update", "settings") ? (
              <Editor
                initialValue={(terms.purchasingTerms ?? {}) as JSONContent}
                onUpload={onUploadImage}
                onChange={handleUpdatePurchasingTerms}
              />
            ) : (
              <div
                className="prose dark:prose-invert"
                dangerouslySetInnerHTML={{
                  __html: generateHTML(terms.purchasingTerms as JSONContent)
                }}
              />
            )}
          </CardContent>
        </Card>
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
            <HStack className="justify-between items-center">
              <div>
                <CardTitle>
                  <Trans>Centralized Billing Address</Trans>
                </CardTitle>
                <CardDescription>
                  <Trans>
                    Route all AP invoices to one address (e.g. corporate
                    headquarters) instead of individual purchasers.
                  </Trans>
                </CardDescription>
              </div>
              <Switch
                checked={apAddressEnabled}
                onCheckedChange={handleApAddressToggle}
                disabled={toggleFetcher.state !== "idle"}
              />
            </HStack>
          </CardHeader>
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

        <Card>
          <CardHeader>
            <HStack className="justify-between items-center">
              <div>
                <CardTitle>
                  <Trans>Include Thumbnails on Purchasing Documents</Trans>
                </CardTitle>
                <CardDescription>
                  <Trans>Show part thumbnails on purchase order PDFs.</Trans>
                </CardDescription>
              </div>
              <Switch
                checked={
                  companySettings.includeThumbnailsOnPurchasingPdfs ?? true
                }
                onCheckedChange={(checked) => {
                  toggleFetcher.submit(
                    { intent: "pdfs", enabled: String(checked) },
                    { method: "POST" }
                  );
                }}
                disabled={toggleFetcher.state !== "idle"}
              />
            </HStack>
          </CardHeader>
        </Card>

        <p className="mt-4 text-xxs text-foreground/70 uppercase font-light tracking-wide">
          <Trans>Automatic Updates</Trans>
        </p>

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
            <HStack className="justify-between items-center">
              <div>
                <CardTitle>
                  <Trans>Automatic Lead Time Updates</Trans>
                </CardTitle>
                <CardDescription>
                  <Trans>
                    Update part lead times from posted purchase receipts.
                  </Trans>
                </CardDescription>
              </div>
              <Switch
                checked={leadTimesOnReceiptEnabled}
                onCheckedChange={handleLeadTimesOnReceiptToggle}
                disabled={toggleFetcher.state !== "idle"}
              />
            </HStack>
          </CardHeader>
        </Card>
        <p className="mt-4 text-xxs text-foreground/70 uppercase font-light tracking-wide">
          <Trans>Suppliers</Trans>
        </p>

        <Card>
          <CardHeader>
            <HStack className="justify-between items-center">
              <div>
                <CardTitle>
                  <Trans>Show Supplier IDs</Trans>
                </CardTitle>
                <CardDescription>
                  <Trans>
                    Show a readable Supplier ID column on the supplier list,
                    supplier forms, and dropdowns. Suppliers are still
                    identified internally either way.
                  </Trans>
                </CardDescription>
              </div>
              <Switch
                checked={showSupplierReadableIdEnabled}
                onCheckedChange={handleShowSupplierReadableIdToggle}
                disabled={toggleFetcher.state !== "idle"}
              />
            </HStack>
          </CardHeader>
        </Card>

        <p className="mt-4 text-xxs text-foreground/70 uppercase font-light tracking-wide">
          <Trans>Notifications</Trans>
        </p>

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
