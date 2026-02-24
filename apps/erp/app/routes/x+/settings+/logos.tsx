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
  updateLogoLightIcon
} from "~/modules/settings";
import { maxSizeMB } from "~/modules/settings/ui/Company/CompanyLogoForm";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Logos",
  to: path.to.logos
};

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "settings"
  });

  const formData = await request.formData();
  const mode = formData.get("mode");
  const icon = formData.get("icon");
  const path = formData.get("path") as string | null;

  if (typeof mode !== "string" || typeof icon !== "string") {
    return data({ error: "Invalid form data" }, { status: 400 });
  }

  if (mode === "light" && icon === "false") {
    const { error } = await updateLogoLight(client, companyId, path);
    if (error) return data({ error: "Failed to update logo" }, { status: 500 });
  }
  if (mode === "dark" && icon === "false") {
    const { error } = await updateLogoDark(client, companyId, path);
    if (error) return data({ error: "Failed to update logo" }, { status: 500 });
  }
  if (mode === "light" && icon === "true") {
    const { error } = await updateLogoLightIcon(client, companyId, path);
    if (error) return data({ error: "Failed to update logo" }, { status: 500 });
  }
  if (mode === "dark" && icon === "true") {
    const { error } = await updateLogoDarkIcon(client, companyId, path);
    if (error) return data({ error: "Failed to update logo" }, { status: 500 });
  }

  return { success: true };
}

export default function LogosRoute() {
  const routeData = useRouteData<{ company: Company }>(
    path.to.authenticatedRoot
  );

  const company = routeData?.company;
  if (!company) throw new Error("Company not found");

  return (
    <ScrollArea className="w-full h-[calc(100dvh-49px)]">
      <VStack spacing={4} className="py-12 px-4 max-w-[60rem] h-full mx-auto">
        <div className="flex w-full justify-between items-center gap-1">
          <Heading size="h3">Logos</Heading>
          <Badge variant="outline">{maxSizeMB}MB limit</Badge>
        </div>

        <div className="grid grid-cols-2 gap-4 w-full">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <LuSun /> Mark Light Mode
              </CardTitle>
              <CardDescription>
                Used in the navigation and on documents like sales orders
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CompanyLogoForm company={company} mode="light" icon />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <LuMoon /> Mark Dark Mode
              </CardTitle>
              <CardDescription>
                Used in the navigation in dark mode
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CompanyLogoForm company={company} mode="dark" icon />
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LuSun /> Wordmark Light Mode
            </CardTitle>
            <CardDescription>
              Used on the home screen and digital quotes
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CompanyLogoForm company={company} mode="light" icon={false} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LuMoon /> Wordmark Dark Mode
            </CardTitle>
            <CardDescription>
              Used on the home screen in dark mode
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CompanyLogoForm company={company} mode="dark" icon={false} />
          </CardContent>
        </Card>
      </VStack>
    </ScrollArea>
  );
}
