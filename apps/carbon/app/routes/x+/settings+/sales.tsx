import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  ScrollArea,
  toast,
  VStack,
} from "@carbon/react";
import { json, type ActionFunctionArgs } from "@vercel/remix";

import type { Company } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { Boolean, Submit, ValidatedForm, validator } from "@carbon/form";
import { useFetcher } from "@remix-run/react";
import { useEffect } from "react";
import { useRouteData } from "~/hooks";
import {
  digitalQuoteValidator,
  updateDigitalQuoteSetting,
} from "~/modules/settings";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Sales",
  to: path.to.salesSettings,
};

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

      const { error } = await updateDigitalQuoteSetting(
        client,
        companyId,
        validation.data.digitalQuoteEnabled
      );
      if (error) return json({ success: false, message: error.message });
  }

  return json({ success: true, message: "Digital quote setting updated" });
}

export default function SalesSettingsRoute() {
  const fetcher = useFetcher<typeof action>();
  const routeData = useRouteData<{ company: Company }>(
    path.to.authenticatedRoot
  );

  const company = routeData?.company;
  if (!company) throw new Error("Company not found");

  useEffect(() => {
    if (fetcher.data?.success === true && fetcher?.data?.message) {
      toast.success(fetcher.data.message);
    }

    if (fetcher.data?.success === false && fetcher?.data?.message) {
      toast.error(fetcher.data.message);
    }
  }, [fetcher.data?.message, fetcher.data?.success]);

  return (
    <ScrollArea className="w-full h-[calc(100vh-49px)]">
      <VStack spacing={2} className="p-2 h-full">
        <Card>
          <ValidatedForm
            method="post"
            validator={digitalQuoteValidator}
            defaultValues={{ digitalQuoteEnabled: company.digitalQuoteEnabled }}
            fetcher={fetcher}
          >
            <input type="hidden" name="intent" value="digitalQuote" />
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Digital Quote
              </CardTitle>
              <CardDescription>
                Enable digital quotes for your company. This will allow you to
                send digital quotes to your customers, and allow them to accept
                them online.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Boolean name="digitalQuoteEnabled" description="Enabled" />
            </CardContent>
            <CardFooter>
              <Submit>Save</Submit>
            </CardFooter>
          </ValidatedForm>
        </Card>
      </VStack>
    </ScrollArea>
  );
}
