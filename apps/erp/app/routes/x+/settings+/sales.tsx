import { error, useCarbon } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  Boolean,
  Input,
  Number,
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
  cn,
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
  accountsReceivableBillingAddressValidator,
  defaultCustomerCcValidator,
  digitalQuoteValidator,
  getAccountsReceivableBillingAddress,
  getCompanySettings,
  getTerms,
  quoteLineCategoryMarkupsSettingsValidator,
  rfqReadyValidator,
  updateAccountsReceivableAddressSetting,
  updateAccountsReceivableBillingAddress,
  updateDefaultCustomerCc,
  updateDigitalQuoteSetting,
  updateQuoteLineCategoryMarkups,
  updateRfqReadySetting,
  updateSalesPdfThumbnails
} from "~/modules/settings";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Sales",
  to: path.to.salesSettings
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "settings"
  });

  const [companySettings, terms, arBillingAddress] = await Promise.all([
    getCompanySettings(client, companyId),
    getTerms(client, companyId),
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
    terms: terms.data,
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

    case "digitalQuote":
      const validation = await validator(digitalQuoteValidator).validate(
        formData
      );

      if (validation.error) {
        return { success: false, message: "Invalid form data" };
      }

      const digitalQuote = await updateDigitalQuoteSetting(
        client,
        companyId,
        validation.data.digitalQuoteEnabled,
        validation.data.digitalQuoteNotificationGroup ?? [],
        validation.data.digitalQuoteIncludesPurchaseOrders
      );
      if (digitalQuote.error)
        return { success: false, message: digitalQuote.error.message };

      return { success: true, message: "Digital quote setting updated" };

    case "pdfs": {
      const pdfEnabled = formData.get("enabled") === "true";
      const thumbnailsResult = await updateSalesPdfThumbnails(
        client,
        companyId,
        pdfEnabled
      );

      if (thumbnailsResult.error)
        return { success: false, message: thumbnailsResult.error.message };

      return { success: true, message: "PDF settings updated" };
    }

    case "rfq":
      const rfqValidation =
        await validator(rfqReadyValidator).validate(formData);

      if (rfqValidation.error) {
        return { success: false, message: "Invalid form data" };
      }

      const rfqSettings = await updateRfqReadySetting(
        client,
        companyId,
        rfqValidation.data.rfqReadyNotificationGroup ?? []
      );

      if (rfqSettings.error)
        return { success: false, message: rfqSettings.error.message };

      return { success: true, message: "RFQ setting updated" };

    case "categoryMarkups":
      const categoryMarkupsValidation = await validator(
        quoteLineCategoryMarkupsSettingsValidator
      ).validate(formData);

      if (categoryMarkupsValidation.error) {
        return { success: false, message: "Invalid form data" };
      }

      const categoryMarkupsResult = await updateQuoteLineCategoryMarkups(
        client,
        companyId,
        categoryMarkupsValidation.data
      );

      if (categoryMarkupsResult.error)
        return {
          success: false,
          message: categoryMarkupsResult.error.message
        };

      return {
        success: true,
        message: "Default category markups updated"
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

export default function SalesSettingsRoute() {
  const { companySettings, terms, arBillingAddress } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const toggleFetcher = useFetcher<typeof action>();
  const [arAddressEnabled, setArAddressEnabled] = useState(
    companySettings.accountsReceivableAddress ?? false
  );

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

  const [digitalQuoteEnabled, setDigitalQuoteEnabled] = useState(
    companySettings.digitalQuoteEnabled ?? false
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

  const permissions = usePermissions();
  const { carbon } = useCarbon();
  const {
    id: userId,
    company: { id: companyId }
  } = useUser();

  const [salesTermsStatus, setSalesTermsStatus] = useState<"saved" | "draft">(
    "saved"
  );

  const handleUpdateSalesTerms = (content: JSONContent) => {
    setSalesTermsStatus("draft");
    onUpdateSalesTerms(content);
  };

  const onUpdateSalesTerms = useDebounce(
    async (content: JSONContent) => {
      setSalesTermsStatus("draft");
      await carbon
        ?.from("terms")
        .update({
          salesTerms: content,
          updatedAt: today(getLocalTimeZone()).toString(),
          updatedBy: userId
        })
        .eq("id", companyId);
      setSalesTermsStatus("saved");
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
        <Heading size="h3">Sales</Heading>
        <Card>
          <HStack className="justify-between items-start">
            <CardHeader>
              <CardTitle>Sales Terms &amp; Conditions</CardTitle>
              <CardDescription>
                Define the terms and conditions for quotes and sales orders
              </CardDescription>
            </CardHeader>
            <CardAction className="py-6">
              {salesTermsStatus === "draft" ? (
                <Badge variant="secondary">Draft</Badge>
              ) : (
                <LuCircleCheck className="w-4 h-4 text-emerald-500" />
              )}
            </CardAction>
          </HStack>
          <CardContent>
            {permissions.can("update", "settings") ? (
              <Editor
                initialValue={(terms?.salesTerms ?? {}) as JSONContent}
                onUpload={onUploadImage}
                onChange={handleUpdateSalesTerms}
              />
            ) : (
              <div
                className="prose dark:prose-invert"
                dangerouslySetInnerHTML={{
                  __html: generateHTML(terms?.salesTerms as JSONContent)
                }}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <HStack className="justify-between items-center">
              <div>
                <CardTitle>Accounts Receivable Billing Address</CardTitle>
                <CardDescription>
                  The billing address used on quotes, sales orders, invoices,
                  and other sales documents.
                </CardDescription>
              </div>
              <Switch
                checked={arAddressEnabled}
                onCheckedChange={handleArAddressToggle}
                disabled={toggleFetcher.state !== "idle"}
              />
            </HStack>
          </CardHeader>
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
                      "accountsReceivableBillingAddress"
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
                Digital Quotes
              </CardTitle>
              <CardDescription>
                Enable digital quotes for your company. This will allow you to
                send digital quotes to your customers, and allow them to accept
                them online.
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
                  <Label>Notifications</Label>
                  <Users
                    name="digitalQuoteNotificationGroup"
                    label="Who should receive notifications when a digital quote is accepted or expired?"
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
                Save
              </Submit>
            </CardFooter>
          </ValidatedForm>
        </Card>
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
              <CardTitle className="flex items-center gap-2">RFQ</CardTitle>
              <CardDescription>
                Enable notifications when an RFQ is marked as ready for quote.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-8 max-w-[400px]">
                <div className="flex flex-col gap-2">
                  <Label>Notifications</Label>
                  <Users
                    name="rfqReadyNotificationGroup"
                    label="Who should receive notifications when a RFQ is marked ready for quote?"
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
                Save
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
              <CardTitle>Emails</CardTitle>
              <CardDescription>
                These email addresses will be automatically CC'd on all quote
                emails sent to customers.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-8 max-w-[400px]">
                <EmailRecipients
                  name="defaultCustomerCc"
                  label="Default CC Recipients"
                />
              </div>
            </CardContent>
            <CardFooter>
              <Submit
                isDisabled={fetcher.state !== "idle"}
                isLoading={
                  fetcher.state !== "idle" &&
                  fetcher.formData?.get("intent") === "defaultCustomerCc"
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
              Show part thumbnails on quotes, sales orders, sales invoices, and
              shipments.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <HStack className="justify-between items-center">
              <VStack className="items-start gap-1">
                <span className="font-medium">
                  {companySettings.includeThumbnailsOnSalesPdfs
                    ? "Thumbnails are included"
                    : "Thumbnails are not included"}
                </span>
                <span className="text-sm text-muted-foreground">
                  {companySettings.includeThumbnailsOnSalesPdfs
                    ? "Part thumbnails are shown on sales PDFs."
                    : "Enable to show part thumbnails on sales PDFs."}
                </span>
              </VStack>
              <Switch
                checked={companySettings.includeThumbnailsOnSalesPdfs ?? true}
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
        <CategoryMarkupsCard
          companySettings={companySettings}
          fetcher={fetcher}
        />
      </VStack>
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
  fetcher: ReturnType<typeof useFetcher<typeof action>>;
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
          <CardTitle>Quote Markups</CardTitle>
          <CardDescription>
            Set default markup percentages for each cost category on new quote
            lines
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
                    formatOptions={{
                      style: "percent",
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 2
                    }}
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
            Save
          </Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
}
