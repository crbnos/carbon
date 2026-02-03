import { error, useCarbon } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { Select, Submit, ValidatedForm, validator } from "@carbon/form";
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
  toast,
  useDebounce,
  VStack
} from "@carbon/react";
import { Editor } from "@carbon/react/Editor";
import { getLocalTimeZone, today } from "@internationalized/date";
import { useEffect, useState } from "react";
import { LuCircleCheck } from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData } from "react-router";
import { EmailRecipients, Users } from "~/components/Form";
import { usePermissions, useUser } from "~/hooks";
import {
  defaultSupplierCcValidator,
  getCompanySettings,
  getTerms,
  purchasePriceUpdateTimingTypes,
  purchasePriceUpdateTimingValidator,
  supplierQuoteNotificationValidator,
  updateDefaultSupplierCc,
  updatePurchasePriceUpdateTimingSetting,
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

  const [companySettings, terms] = await Promise.all([
    getCompanySettings(client, companyId),
    getTerms(client, companyId)
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
    terms: terms.data
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "settings"
  });

  const formData = await request.formData();
  const intent = formData.get("intent");

  switch (intent) {
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
        return { success: false, message: result.error.message };
      }

      return {
        success: true,
        message: "Purchase price update timing updated"
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
        return { success: false, message: supplierQuoteResult.error.message };
      }

      return {
        success: true,
        message: "Supplier quote notification setting updated"
      };

    case "defaultSupplierCc":
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
        return {
          success: false,
          message: defaultSupplierCcResult.error.message
        };
      }

      return {
        success: true,
        message: "Default supplier CC updated"
      };
  }

  return { success: false, message: "Unknown intent" };
}

export default function PurchasingSettingsRoute() {
  const { companySettings, terms } = useLoaderData<typeof loader>();
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
            <input type="hidden" name="intent" value="defaultSupplierCc" />
            <CardHeader>
              <CardTitle>Default CC for Supplier Emails</CardTitle>
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
      </VStack>
    </ScrollArea>
  );
}
