import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Heading,
  ScrollArea,
  toast,
  VStack,
} from "@carbon/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { Select, Submit, ValidatedForm, validator } from "@carbon/form";
import { labelSizes } from "@carbon/utils";
import { useFetcher, useLoaderData } from "@remix-run/react";
import { useEffect } from "react";
import { getCompanySettings ,
  productLabelSizeValidator,
  updateProductLabelSize,
} from "~/modules/settings";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
export const handle: Handle = {
  breadcrumb: "Labels",
  to: path.to.labelsSettings,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "settings",
  });

  const [companySettings] = await Promise.all([
    getCompanySettings(client, companyId),
  ]);
  if (!companySettings.data)
    throw redirect(
      path.to.settings,
      await flash(
        request,
        error(companySettings.error, "Failed to get company settings")
      )
    );
  return json({ companySettings: companySettings.data });
}

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "settings",
  });

  const formData = await request.formData();
  const intent = formData.get("intent");

  switch (intent) {
    case "productLabelSize":
      const validation = await validator(productLabelSizeValidator).validate(
        formData
      );

      if (validation.error) {
        return json({ success: false, message: "Invalid form data" });
      }

      const productLabelSize = await updateProductLabelSize(
        client,
        companyId,
        validation.data.productLabelSize
      );
      if (productLabelSize.error)
        return json({
          success: false,
          message: productLabelSize.error.message,
        });
  }

  return json({ success: true, message: "Label settings updated" });
}

export default function SalesSettingsRoute() {
  const { companySettings } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

  useEffect(() => {
    if (fetcher.data?.success === true && fetcher?.data?.message) {
      toast.success(fetcher.data.message);
    }

    if (fetcher.data?.success === false && fetcher?.data?.message) {
      toast.error(fetcher.data.message);
    }
  }, [fetcher.data?.message, fetcher.data?.success]);

  return (
    <ScrollArea className="w-full h-[calc(100dvh-49px)]">
      <VStack
        spacing={4}
        className="py-12 px-4 max-w-[60rem] h-full mx-auto gap-4"
      >
        <Heading size="h3">Labels</Heading>
        <Card>
          <ValidatedForm
            method="post"
            validator={productLabelSizeValidator}
            defaultValues={{
              productLabelSize: companySettings.productLabelSize ?? "avery5160",
            }}
            fetcher={fetcher}
          >
            <input type="hidden" name="intent" value="productLabelSize" />
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Product Label Size
              </CardTitle>
              <CardDescription>
                Define the default size of the product label. Used for tracking
                items in inventory.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-8 max-w-[400px]">
                <div className="flex flex-col gap-2">
                  <Select
                    name="productLabelSize"
                    label="Product Label Size"
                    options={labelSizes.map((size) => ({
                      value: size.id,
                      label: size.name,
                    }))}
                  />
                </div>
              </div>
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
