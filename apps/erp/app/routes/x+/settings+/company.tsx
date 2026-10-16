// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Copy,
  Heading,
  HStack,
  ScrollArea
} from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuKeySquare, LuRocket } from "react-icons/lu";
import type { ActionFunctionArgs } from "react-router";
import { Link } from "react-router";
import { AppBarActions } from "~/components/Layout/Mobile";
import { SettingsPage } from "~/components/SettingsPage";
import { useRouteData } from "~/hooks";
import { useImplementationReopenItem } from "~/hooks/useImplementationNavItem";
import { companyValidator } from "~/modules/settings/settings.models";
import type { Company as CompanyType } from "~/modules/settings/types";
import { CompanyForm } from "~/modules/settings/ui";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Company`,
  to: path.to.company
};

export async function action(args: ActionFunctionArgs) {
  const input = await validator(companyValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.settings.updateCompanyDetails(input.data);
  return respond(args.request, result).redirect(path.to.company, {
    message: "Updated company"
  });
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
    registrationNumber: company.registrationNumber ?? undefined,
    addressLine1: company.addressLine1 ?? "",
    addressLine2: company.addressLine2 ?? undefined,
    city: company.city ?? "",
    stateProvince: company.stateProvince ?? "",
    postalCode: company.postalCode ?? "",
    countryCode: company.countryCode ?? "",
    timezone: company.timezone ?? "UTC",
    baseCurrencyCode: company.baseCurrencyCode ?? undefined,
    phone: company.phone ?? undefined,
    email: company.email ?? undefined,
    website: company.website ?? undefined
  };

  return (
    <ScrollArea className="w-full h-[calc(100dvh-var(--topbar-height)-var(--content-inset))]">
      <SettingsPage className="gap-4">
        <HStack spacing={1} className="items-center max-md:hidden">
          <Heading size="h3">
            <Trans>Company</Trans>
          </Heading>
          <Copy
            text={company.id ?? ""}
            label={t`Copy company unique identifier`}
            icon={<LuKeySquare className="size-3" />}
            variant="ghost"
            className="w-auto"
          />
        </HStack>
        <AppBarActions>
          <Copy
            text={company.id ?? ""}
            label={t`Copy company unique identifier`}
            icon={<LuKeySquare />}
            variant="ghost"
            size="lg"
          />
        </AppBarActions>
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
            {/* @ts-expect-error */}
            <CompanyForm company={initialValues} />
          </CardContent>
        </Card>
      </SettingsPage>
    </ScrollArea>
  );
}
