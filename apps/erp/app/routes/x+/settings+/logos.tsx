import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Heading,
  ScrollArea,
  VStack,
} from "@carbon/react";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import type { Company } from "~/modules/settings";
import {
  CompanyLogoForm,
  updateLogoDark,
  updateLogoDarkIcon,
  updateLogoLight,
  updateLogoLightIcon,
} from "~/modules/settings";

import { requirePermissions } from "@carbon/auth/auth.server";
import { LuMoon, LuSun } from "react-icons/lu";
import { useRouteData } from "~/hooks";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Logos",
  to: path.to.logos,
};

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "settings",
  });

  const formData = await request.formData();
  const mode = formData.get("mode");
  const icon = formData.get("icon");
  const path = formData.get("path") as string | null;

  if (typeof mode !== "string" || typeof icon !== "string") {
    return json({ error: "Invalid form data" }, { status: 400 });
  }

  if (mode === "light" && icon === "false") {
    const { error } = await updateLogoLight(client, companyId, path);
    if (error) return json({ error: "Failed to update logo" }, { status: 500 });
  }
  if (mode === "dark" && icon === "false") {
    const { error } = await updateLogoDark(client, companyId, path);
    if (error) return json({ error: "Failed to update logo" }, { status: 500 });
  }
  if (mode === "light" && icon === "true") {
    const { error } = await updateLogoLightIcon(client, companyId, path);
    if (error) return json({ error: "Failed to update logo" }, { status: 500 });
  }
  if (mode === "dark" && icon === "true") {
    const { error } = await updateLogoDarkIcon(client, companyId, path);
    if (error) return json({ error: "Failed to update logo" }, { status: 500 });
  }

  return json({ success: true });
}

export default function LogosRoute() {
  const routeData = useRouteData<{ company: Company }>(
    path.to.authenticatedRoot
  );

  const company = routeData?.company;
  if (!company) throw new Error("Company not found");

  return (
    <ScrollArea className="w-full h-[calc(100dvh-49px)]">
      <VStack
        spacing={4}
        className="py-12 px-4 max-w-[60rem] h-full mx-auto gap-4"
      >
        <Heading size="h3">Logos</Heading>
        <div className="grid grid-cols-2 gap-4 w-full">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <LuSun /> Mark Light Mode
              </CardTitle>
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
          </CardHeader>
          <CardContent>
            <CompanyLogoForm company={company} mode="dark" icon={false} />
          </CardContent>
        </Card>
      </VStack>
    </ScrollArea>
  );
}
