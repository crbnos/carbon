// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { useAction } from "@carbon/query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Heading,
  HStack,
  ScrollArea,
  Switch,
  toast,
  VStack
} from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import {
  getCompanySettings,
  projectSettingsValidator,
  updateProjectSettings
} from "~/modules/settings";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

const logger = getLogger("erp", "settings-projects");

export const handle: Handle = {
  breadcrumb: msg`Projects`,
  to: path.to.projectsSettings
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "settings"
  });

  const companySettings = await getCompanySettings(client, companyId);
  if (!companySettings.data) {
    logger.error("Failed to load company settings", {
      companyId,
      error: companySettings.error
    });
    throw redirect(
      path.to.settings,
      await flash(
        request,
        error(companySettings.error, "Failed to get company settings")
      )
    );
  }
  return { companySettings: companySettings.data };
}

/** Which setting each switch posts, by intent. */
const SETTING_BY_INTENT = {
  timesheetApproval: "timesheetApprovalRequired",
  requireElement: "requireProjectElement"
} as const;

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "settings"
  });

  const formData = await request.formData();
  const intent = formData.get("intent");
  if (typeof intent !== "string" || !Object.hasOwn(SETTING_BY_INTENT, intent)) {
    return { success: false, message: "Unknown intent" };
  }

  const field = SETTING_BY_INTENT[intent as keyof typeof SETTING_BY_INTENT];
  const parsed = projectSettingsValidator
    .pick({ [field]: true } as Record<typeof field, true>)
    .safeParse({
      [field]: formData.get("enabled") === "true" ? "on" : undefined
    });
  if (!parsed.success) {
    return { success: false, message: "Invalid form data" };
  }

  const update = await updateProjectSettings(client, companyId, parsed.data);
  if (update.error) {
    logger.error("Failed to update project settings", {
      companyId,
      error: update.error
    });
    return { success: false, message: update.error.message };
  }
  return { success: true, message: "Project settings updated" };
}

export default function ProjectsSettingsRoute() {
  const { companySettings } = useLoaderData<typeof loader>();
  const fetcher = useAction<typeof action>({
    onSuccess: (data) => toast.success(data.message),
    onError: (data) => toast.error(data.message)
  });
  const isToggling = fetcher.state !== "idle";

  const toggle = (intent: keyof typeof SETTING_BY_INTENT, checked: boolean) =>
    fetcher.submit({ intent, enabled: String(checked) }, { method: "POST" });

  return (
    <ScrollArea className="w-full h-[calc(100dvh-var(--topbar-height)-var(--content-inset))]">
      <VStack
        spacing={4}
        className="py-12 px-4 max-w-[60rem] h-full mx-auto gap-4"
      >
        <Heading size="h3">
          <Trans>Projects</Trans>
        </Heading>

        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Timesheet Approval</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>
                Submitted time waits in Approvals before it posts to the
                project. When this is off, time posts as soon as it is
                submitted.
              </Trans>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <HStack className="justify-between items-center">
              <span className="font-medium">
                <Trans>Require approval of timesheets</Trans>
              </span>
              <Switch
                checked={companySettings.timesheetApprovalRequired ?? false}
                onCheckedChange={(checked) =>
                  toggle("timesheetApproval", checked)
                }
                disabled={isToggling}
              />
            </HStack>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Charge Numbers</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>
                When this is on, time, material and purchases charge an element
                of a project, never the project alone.
              </Trans>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <HStack className="justify-between items-center">
              <span className="font-medium">
                <Trans>Require an element on every project charge</Trans>
              </span>
              <Switch
                checked={companySettings.requireProjectElement ?? false}
                onCheckedChange={(checked) => toggle("requireElement", checked)}
                disabled={isToggling}
              />
            </HStack>
          </CardContent>
        </Card>
      </VStack>
    </ScrollArea>
  );
}
