import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { Select, Submit, ValidatedForm, validator } from "@carbon/form";
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
  VStack
} from "@carbon/react";
import { labelSizes } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData } from "react-router";
import {
  getCompanySettings,
  productLabelSizeValidator,
  updateProductLabelSize
} from "~/modules/settings";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
export const handle: Handle = {
  breadcrumb: msg`Labels`,
  to: path.to.labelsSettings
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "settings"
  });

  const companySettings = await getCompanySettings();
  if (!companySettings.data)
    throw redirect(
      path.to.settings,
      await flash(
        request,
        error(companySettings.error, "Failed to get company settings")
      )
    );
  return { companySettings: companySettings.data };
}

export async function action({ request }: ActionFunctionArgs) {
  await requirePermissions(request, {
    update: "settings"
  });

  const formData = await request.formData();
  const intent = formData.get("intent");

  switch (intent) {
    case "productLabelSize":
      const validation = await validator(productLabelSizeValidator).validate(
        formData
      );

      if (validation.error) {
        return { success: false, message: "Invalid form data" };
      }

      const productLabelSize = await updateProductLabelSize(
        validation.data.productLabelSize
      );
      if (productLabelSize.error)
        return {
          success: false,
          message: productLabelSize.error.message
        };
  }

  return { success: true, message: "Label settings updated" };
}

export default function SalesSettingsRoute() {
  const { t } = useLingui();
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
        <Heading size="h3">
          <Trans>Labels</Trans>
        </Heading>
        <Card>
          <ValidatedForm
            method="post"
            validator={productLabelSizeValidator}
            defaultValues={{
              productLabelSize: companySettings.productLabelSize ?? "avery5160"
            }}
            fetcher={fetcher}
          >
            <input type="hidden" name="intent" value="productLabelSize" />
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trans>Product Label Size</Trans>
              </CardTitle>
              <CardDescription>
                <Trans>
                  Define the default size of the product label. Used for
                  tracking items in inventory.
                </Trans>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-8 max-w-[400px]">
                <div className="flex flex-col gap-2">
                  <Select
                    name="productLabelSize"
                    label={t`Product Label Size`}
                    options={labelSizes.map((size) => ({
                      value: size.id,
                      label: size.name
                    }))}
                  />
                </div>
              </div>
            </CardContent>
            <CardFooter>
              <Submit>
                <Trans>Save</Trans>
              </Submit>
            </CardFooter>
          </ValidatedForm>
        </Card>
      </VStack>
    </ScrollArea>
  );
}
