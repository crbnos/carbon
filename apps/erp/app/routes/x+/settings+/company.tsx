import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Heading,
  HStack,
  ScrollArea,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  VStack
} from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuKeySquare, LuRocket } from "react-icons/lu";
import type { ActionFunctionArgs } from "react-router";
import { data, Link } from "react-router";
import { useRouteData } from "~/hooks";
import { useImplementationReopenItem } from "~/hooks/useImplementationNavItem";
import type { Company as CompanyType } from "~/modules/settings";
import {
  CompanyForm,
  companyValidator,
  updateCompany
} from "~/modules/settings";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { copyToClipboard } from "~/utils/string";

export const handle: Handle = {
  breadcrumb: msg`Company`,
  to: path.to.company
};

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "settings"
  });
  const formData = await request.formData();

  const validation = await validator(companyValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const update = await updateCompany(client, companyId, {
    ...validation.data,
    updatedBy: userId
  });
  if (update.error)
    return data(
      {},
      await flash(request, error(update.error, "Failed to update company"))
    );

  return data({}, await flash(request, success("Updated company")));
}

export default function Company() {
  const { t } = useLingui();
  const routeData = useRouteData<{ company: CompanyType }>(
    path.to.authenticatedRoot
  );

  const company = routeData?.company;
  if (!company) throw new Error("Company not found");

  // Buried reopen entry for a finished implementation hub — only present once the
  // company was enrolled and onboarding was wrapped up (status complete/archived).
  const reopenHub = useImplementationReopenItem();

  const initialValues = {
    name: company.name,
    taxId: company.taxId ?? undefined,
    vatNumber: company.vatNumber ?? undefined,
    eori: company.eori ?? undefined,
    addressLine1: company.addressLine1 ?? "",
    addressLine2: company.addressLine2 ?? undefined,
    city: company.city ?? "",
    stateProvince: company.stateProvince ?? "",
    postalCode: company.postalCode ?? "",
    countryCode: company.countryCode ?? "",
    baseCurrencyCode: company.baseCurrencyCode ?? undefined,
    phone: company.phone ?? undefined,
    email: company.email ?? undefined,
    website: company.website ?? undefined
  };

  return (
    <ScrollArea className="w-full h-[calc(100dvh-49px)]">
      <VStack
        spacing={4}
        className="py-12 px-4 max-w-[60rem] h-full mx-auto gap-4"
      >
        <HStack spacing={1} className="items-center">
          <Heading size="h3">
            <Trans>Company</Trans>
          </Heading>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                aria-label={t`Copy`}
                size="sm"
                className="p-1"
                onClick={() => copyToClipboard(company.id ?? "")}
              >
                <LuKeySquare className="w-3 h-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <span>
                <Trans>Copy company unique identifier</Trans>
              </span>
            </TooltipContent>
          </Tooltip>
        </HStack>
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-1.5">
                <CardTitle>
                  <Trans>Basic Information</Trans>
                </CardTitle>
                <CardDescription>
                  <Trans>
                    This information will be used on document headers
                  </Trans>
                </CardDescription>
              </div>
              {reopenHub ? (
                <Button
                  asChild
                  variant="secondary"
                  size="sm"
                  leftIcon={<LuRocket />}
                  className="shrink-0"
                >
                  <Link to={reopenHub.to}>
                    <Trans>Go to implementation hub</Trans>
                  </Link>
                </Button>
              ) : null}
            </div>
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
