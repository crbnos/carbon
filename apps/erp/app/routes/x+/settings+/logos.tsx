import { requirePermissions } from "@carbon/auth/auth.server";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Heading,
  ScrollArea,
  VStack
} from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { LuMoon, LuSun } from "react-icons/lu";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { useRouteData } from "~/hooks";
import type { Company } from "~/modules/settings";
import {
  CompanyLogoForm,
  updateLogoDark,
  updateLogoDarkIcon,
  updateLogoLight,
  updateLogoLightIcon,
  updateLogoWatermark
} from "~/modules/settings";
import { maxSizeMB } from "~/modules/settings/ui/Company/CompanyLogoForm";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Logos`,
  to: path.to.logos
};

const TARGET_UPDATERS = {
  logoLight: updateLogoLight,
  logoDark: updateLogoDark,
  logoLightIcon: updateLogoLightIcon,
  logoDarkIcon: updateLogoDarkIcon,
  logoWatermark: updateLogoWatermark
} as const;

type LogoTarget = keyof typeof TARGET_UPDATERS;

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "settings"
  });

  const formData = await request.formData();
  const target = formData.get("target");
  const logoPath = formData.get("path") as string | null;

  if (typeof target !== "string" || !(target in TARGET_UPDATERS)) {
    return data({ error: "Invalid target" }, { status: 400 });
  }

  const { error } = await TARGET_UPDATERS[target as LogoTarget](
    client,
    companyId,
    logoPath
  );
  if (error) return data({ error: "Failed to update logo" }, { status: 500 });

  return { success: true };
}

export default function LogosRoute() {
  const routeData = useRouteData<{ company: Company }>(
    path.to.authenticatedRoot
  );

  const company = routeData?.company;
  if (!company) throw new Error("Company not found");

  return (
    <ScrollArea className="w-full h-[calc(100dvh-var(--topbar-height))]">
      <VStack spacing={4} className="py-12 px-4 max-w-[60rem] h-full mx-auto">
        <div className="flex w-full justify-between items-center gap-1">
          <Heading size="h3">
            <Trans>Logos</Trans>
          </Heading>
          <Badge variant="outline">{maxSizeMB}MB limit</Badge>
        </div>

        <div className="grid grid-cols-2 gap-4 w-full">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <LuSun /> <Trans>Mark Light Mode</Trans>
              </CardTitle>
              <CardDescription>
                <Trans>
                  Used in the navigation and on documents like sales orders
                </Trans>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CompanyLogoForm company={company} target="logoLightIcon" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <LuMoon /> <Trans>Mark Dark Mode</Trans>
              </CardTitle>
              <CardDescription>
                <Trans>Used in the navigation in dark mode</Trans>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CompanyLogoForm company={company} target="logoDarkIcon" />
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LuSun /> <Trans>Wordmark Light Mode</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>Used on the home screen and digital quotes</Trans>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CompanyLogoForm company={company} target="logoLight" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LuMoon /> <Trans>Wordmark Dark Mode</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>Used on the home screen in dark mode</Trans>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CompanyLogoForm company={company} target="logoDark" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trans>PDF Watermark</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>
                Shown as a faint background behind every page of generated PDFs
              </Trans>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CompanyLogoForm company={company} target="logoWatermark" />
          </CardContent>
        </Card>
      </VStack>
    </ScrollArea>
  );
}
