import { error, useCarbon } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { Input, Select, Submit, ValidatedForm, validator } from "@carbon/form";
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
import { useCallback, useEffect, useState } from "react";
import { LuCircleCheck } from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData } from "react-router";
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
  updateSupplierApprovalSetting,
  updateSupplierQuoteNotificationSetting
} from "~/modules/settings";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Purchasing",
  to: path.to.purchasingSettings
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "settings"
  });

  const [companySettings, terms, apBillingAddress] = await Promise.all([
    getCompanySettings(client, companyId),
    getTerms(client, companyId),
    getAccountsPayableBillingAddress(client, companyId)
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
    apBillingAddress: apBillingAddress.data
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "settings"
  });

  const formData = await request.formData();
  const intent = formData.get("intent");

  switch (intent) {
    case "supplierApproval":
      const supplierApprovalEnabled =
        formData.get("supplierApproval") === "true";
      const supplierApprovalResult = await updateSupplierApprovalSetting(
        client,
        companyId,
        supplierApprovalEnabled
      );

      if (supplierApprovalResult.error) {
        console.error(
          "Failed to update supplier approval setting:",
          supplierApprovalResult.error
        );
        return {
          success: false,
          message: supplierApprovalResult.error.message
        };
      }

      return {
        success: true,
        message: `Supplier approval ${supplierApprovalEnabled ? "enabled" : "disabled"}`
      };

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
  const { companySettings, terms, apBillingAddress } =
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

  const [supplierApprovalEnabled, setSupplierApprovalEnabled] = useState(
    companySettings.supplierApproval ?? false
  );

  const handleSupplierApprovalToggle = useCallback(
    (checked: boolean) => {
      setSupplierApprovalEnabled(checked);
      toggleFetcher.submit(
        { intent: "supplierApproval", supplierApproval: checked.toString() },
        { method: "POST" }
      );
    },
    [toggleFetcher]
  );

  const [apAddressEnabled, setApAddressEnabled] = useState(
    companySettings.accountsPayableAddress ?? false
  );

  const [leadTimesOnReceiptEnabled, setLeadTimesOnReceiptEnabled] = useState(
    (companySettings as { updateLeadTimesOnReceipt?: boolean })
      .updateLeadTimesOnReceipt ?? false
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
        <Heading size="h3">Purchasing</Heading>

        <Card>
          <HStack className="justify-between items-start">
            <CardHeader>
              <CardTitle>Purchasing Terms &amp; Conditions</CardTitle>
              <CardDescription>
                Define the terms and conditions for purchase orders
              </CardDescription>
            </CardHeader>
            <CardAction className="py-6">
              {purchasingTermsStatus === "draft" ? (
                <Badge variant="secondary">Draft</Badge>
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
        <Card>
          <CardHeader>
            <HStack className="justify-between items-center">
              <div>
                <CardTitle>Accounts Payable Billing Address</CardTitle>
                <CardDescription>
                  The billing address used on purchase orders and other
                  purchasing documents.
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
                <CardTitle>Billing Address</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4 w-full">
                  <Input name="name" label="Name" />
                  <Input name="email" label="Email" />
                  <Input name="addressLine1" label="Address Line 1" />
                  <Input name="addressLine2" label="Address Line 2" />
                  <Input name="city" label="City" />
                  <Input name="state" label="State / Province" />
                  <Input name="postalCode" label="Postal Code" />
                  <Country name="countryCode" />
                  <Input name="phone" label="Phone" />
                  <Input name="fax" label="Fax" />
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
                  Save
                </Submit>
              </CardFooter>
            </ValidatedForm>
          </Card>
        )}

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
              <CardTitle>Purchase Price Updates</CardTitle>
              <CardDescription>
                Configure when purchased item prices should be updated from
                supplier transactions.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-8 max-w-[400px]">
                <Select
                  name="purchasePriceUpdateTiming"
                  label="Update prices on"
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
                Save
              </Submit>
            </CardFooter>
          </ValidatedForm>
        </Card>
        <Card>
          <CardHeader>
            <HStack className="justify-between items-center">
              <div>
                <CardTitle>Lead Time Updates</CardTitle>
                <CardDescription>
                  Update part lead times from posted purchase receipts.
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
        <Card>
          <CardHeader>
            <HStack className="justify-between items-center">
              <div>
                <CardTitle>Supplier Approval Required</CardTitle>
                <CardDescription>
                  Require approval before suppliers can be set to Active
                </CardDescription>
              </div>
              <Switch
                checked={supplierApprovalEnabled}
                onCheckedChange={handleSupplierApprovalToggle}
                disabled={toggleFetcher.state !== "idle"}
              />
            </HStack>
          </CardHeader>
        </Card>
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
              <CardTitle>Supplier Quote Notifications</CardTitle>
              <CardDescription>
                Configure who should receive notifications when a supplier
                submits a quote.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-8 max-w-[400px]">
                <div className="flex flex-col gap-2">
                  <Label>Notifications</Label>
                  <Users
                    name="supplierQuoteNotificationGroup"
                    label="Who should receive notifications when a supplier quote is submitted?"
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
                Save
              </Submit>
            </CardFooter>
          </ValidatedForm>
        </Card>
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
              <CardTitle>Emails</CardTitle>
              <CardDescription>
                These email addresses will be automatically CC'd on all emails
                sent to suppliers (quotes, purchase orders, etc.).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-8 max-w-[400px]">
                <EmailRecipients
                  name="defaultSupplierCc"
                  label="Default CC Recipients"
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
                Save
              </Submit>
            </CardFooter>
          </ValidatedForm>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>PDFs</CardTitle>
            <CardDescription>
              Show part thumbnails on purchase orders.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <HStack className="justify-between items-center">
              <VStack className="items-start gap-1">
                <span className="font-medium">
                  {companySettings.includeThumbnailsOnPurchasingPdfs
                    ? "Thumbnails are included"
                    : "Thumbnails are not included"}
                </span>
                <span className="text-sm text-muted-foreground">
                  {companySettings.includeThumbnailsOnPurchasingPdfs
                    ? "Part thumbnails are shown on purchase order PDFs."
                    : "Enable to show part thumbnails on purchase order PDFs."}
                </span>
              </VStack>
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
          </CardContent>
        </Card>
      </VStack>
    </ScrollArea>
  );
}
