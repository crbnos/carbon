import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
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
      <VStack spacing={2} className="p-2 h-full">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LuSun /> Horizontal Light Mode
            </CardTitle>
          </CardHeader>
          <CardContent>
            <CompanyLogoForm company={company} mode="light" icon={false} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LuMoon /> Horizontal Dark Mode
            </CardTitle>
          </CardHeader>
          <CardContent>
            <CompanyLogoForm company={company} mode="dark" icon={false} />
          </CardContent>
        </Card>
        <div className="grid grid-cols-2 gap-2 w-full">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <LuSun /> Icon Light Mode
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CompanyLogoForm company={company} mode="light" icon />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <LuMoon /> Icon Dark Mode
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CompanyLogoForm company={company} mode="dark" icon />
            </CardContent>
          </Card>
        </div>
      </VStack>
    </ScrollArea>
  );
}
