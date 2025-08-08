import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Heading,
  ScrollArea,
  VStack,
} from "@carbon/react";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { useRouteData } from "~/hooks";
import type { Company as CompanyType } from "~/modules/settings";
import {
  CompanyForm,
  companyValidator,
  updateCompany,
} from "~/modules/settings";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Company",
  to: path.to.company,
};

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "settings",
  });
  const formData = await request.formData();

  const validation = await validator(companyValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const update = await updateCompany(client, companyId, {
    ...validation.data,
    updatedBy: userId,
  });
  if (update.error)
    return json(
      {},
      await flash(request, error(update.error, "Failed to update company"))
    );

  return json({}, await flash(request, success("Updated company")));
}

export default function Company() {
  const routeData = useRouteData<{ company: CompanyType }>(
    path.to.authenticatedRoot
  );

  const company = routeData?.company;
  if (!company) throw new Error("Company not found");

  const initialValues = {
    name: company.name,
    taxId: company.taxId ?? undefined,
    addressLine1: company.addressLine1 ?? "",
    addressLine2: company.addressLine2 ?? undefined,
    city: company.city ?? "",
    stateProvince: company.stateProvince ?? "",
    postalCode: company.postalCode ?? "",
    countryCode: company.countryCode ?? "",
    baseCurrencyCode: company.baseCurrencyCode ?? undefined,
    phone: company.phone ?? undefined,
    email: company.email ?? undefined,
    website: company.website ?? undefined,
  };

  return (
    <ScrollArea className="w-full h-[calc(100dvh-49px)]">
      <VStack
        spacing={4}
        className="py-12 px-4 max-w-[60rem] h-full mx-auto gap-4"
      >
        <Heading size="h3">Company</Heading>
        <Card>
          <CardHeader>
            <CardTitle>Basic Information</CardTitle>
            <CardDescription>
              This information will be used on document headers
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* @ts-ignore */}
            <CompanyForm company={initialValues} />
          </CardContent>
        </Card>
      </VStack>
    </ScrollArea>
  );
}
