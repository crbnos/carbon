import {
  Badge,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  HStack,
  Label,
  ScrollArea,
  toast,
  useDebounce,
  VStack,
} from "@carbon/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";

import { error, useCarbon } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { Boolean, Submit, ValidatedForm, validator } from "@carbon/form";
import { useFetcher, useLoaderData } from "@remix-run/react";
import { useEffect, useState } from "react";
import { Users } from "~/components/Form";
import {
  digitalQuoteValidator,
  getCompanySettings,
  getTerms,
  rfqReadyValidator,
  updateDigitalQuoteSetting,
  updateRfqReadySetting,
} from "~/modules/settings";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

import type { JSONContent } from "@carbon/react";
import { Editor, generateHTML } from "@carbon/react/Editor";
import { getLocalTimeZone, today } from "@internationalized/date";
import { LuCircleCheck } from "react-icons/lu";
import { usePermissions, useUser } from "~/hooks";

export const handle: Handle = {
  breadcrumb: "Sales",
  to: path.to.salesSettings,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "settings",
  });

  const [companySettings, terms] = await Promise.all([
    getCompanySettings(client, companyId),
    getTerms(client, companyId),
  ]);
  if (!companySettings.data)
    throw redirect(
      path.to.settings,
      await flash(
        request,
        error(companySettings.error, "Failed to get company settings")
      )
    );
  return json({ companySettings: companySettings.data, terms: terms.data });
}

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "settings",
  });

  const formData = await request.formData();
  const intent = formData.get("intent");

  switch (intent) {
    case "digitalQuote":
      const validation = await validator(digitalQuoteValidator).validate(
        formData
      );

      if (validation.error) {
        return json({ success: false, message: "Invalid form data" });
      }

      const digitalQuote = await updateDigitalQuoteSetting(
        client,
        companyId,
        validation.data.digitalQuoteEnabled,
        validation.data.digitalQuoteNotificationGroup ?? [],
        validation.data.digitalQuoteIncludesPurchaseOrders
      );
      if (digitalQuote.error)
        return json({ success: false, message: digitalQuote.error.message });

    case "rfq":
      const rfqValidation = await validator(rfqReadyValidator).validate(
        formData
      );

      if (rfqValidation.error) {
        return json({ success: false, message: "Invalid form data" });
      }

      const rfqSettings = await updateRfqReadySetting(
        client,
        companyId,
        rfqValidation.data.rfqReadyNotificationGroup ?? []
      );

      if (rfqSettings.error)
        return json({ success: false, message: rfqSettings.error.message });
  }

  return json({ success: true, message: "Digital quote setting updated" });
}

export default function SalesSettingsRoute() {
  const { companySettings, terms } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
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

  const permissions = usePermissions();
  const { carbon } = useCarbon();
  const {
    id: userId,
    company: { id: companyId },
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
          updatedBy: userId,
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
      <VStack spacing={4} className="p-4 h-full">
        <Card>
          <ValidatedForm
            method="post"
            validator={digitalQuoteValidator}
            defaultValues={{
              digitalQuoteEnabled: companySettings.digitalQuoteEnabled ?? false,
              digitalQuoteNotificationGroup:
                companySettings.digitalQuoteNotificationGroup ?? [],
              digitalQuoteIncludesPurchaseOrders:
                companySettings.digitalQuoteIncludesPurchaseOrders ?? false,
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
                  />
                </div>
              </div>
            </CardContent>
            <CardFooter>
              <Submit>Save</Submit>
            </CardFooter>
          </ValidatedForm>
        </Card>
        <Card>
          <ValidatedForm
            method="post"
            validator={rfqReadyValidator}
            defaultValues={{
              rfqReadyNotificationGroup:
                companySettings.rfqReadyNotificationGroup ?? [],
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
                  />
                </div>
              </div>
            </CardContent>
            <CardFooter>
              <Submit>Save</Submit>
            </CardFooter>
          </ValidatedForm>
        </Card>

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
                  __html: generateHTML(terms?.salesTerms as JSONContent),
                }}
              />
            )}
          </CardContent>
        </Card>
      </VStack>
    </ScrollArea>
  );
}
