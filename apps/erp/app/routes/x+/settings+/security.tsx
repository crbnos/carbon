import {
  assertIsPost,
  CONTROLLED_ENVIRONMENT,
  error,
  success
} from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Heading,
  HStack,
  ScrollArea,
  Switch,
  VStack
} from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, Link, useFetcher } from "react-router";
import { usePermissions } from "~/hooks";
import { useSettings } from "~/hooks/useSettings";
import { updateRequireMfaSetting } from "~/modules/settings";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Security`,
  to: path.to.security
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "settings",
    role: "employee"
  });
  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    update: "settings"
  });
  const formData = await request.formData();

  const requireMfa = formData.get("enabled") === "true";
  const update = await updateRequireMfaSetting(client, companyId, requireMfa);
  if (update.error)
    return data(
      {},
      await flash(
        request,
        error(update.error, "Failed to update two-factor requirement")
      )
    );

  return data(
    {},
    await flash(
      request,
      success(
        requireMfa
          ? "Two-factor authentication is now required"
          : "Two-factor authentication is no longer required"
      )
    )
  );
}

export default function Security() {
  const { t } = useLingui();
  const permissions = usePermissions();
  const canEdit = permissions.can("update", "settings");
  const mfaFetcher = useFetcher<{}>();
  const settings = useSettings();
  const requireMfa = settings.requireMfa === true;

  return (
    <ScrollArea className="w-full h-[calc(100dvh-49px)]">
      <VStack
        spacing={4}
        className="py-12 px-4 max-w-[60rem] h-full mx-auto gap-4"
      >
        <Heading size="h3">
          <Trans>Security</Trans>
        </Heading>
        <Card>
          <CardHeader>
            <HStack className="justify-between items-center">
              <div>
                <CardTitle>
                  <Trans>Two-Factor Authentication Enforcement</Trans>
                </CardTitle>
                <CardDescription>
                  {CONTROLLED_ENVIRONMENT ? (
                    <Trans>
                      This is a controlled environment, so two-factor
                      authentication is required for everyone and cannot be
                      turned off.
                    </Trans>
                  ) : (
                    <Trans>
                      Require an authenticator app before anyone can open this
                      company. Their other companies are unaffected. Visit the{" "}
                      <Link
                        to={path.to.employeeAccounts}
                        className="text-primary underline"
                      >
                        employee accounts page
                      </Link>{" "}
                      to see each person's status.
                    </Trans>
                  )}
                </CardDescription>
              </div>
              <Switch
                checked={CONTROLLED_ENVIRONMENT || requireMfa}
                onCheckedChange={(checked) =>
                  mfaFetcher.submit(
                    { enabled: String(checked) },
                    { method: "post" }
                  )
                }
                disabled={
                  CONTROLLED_ENVIRONMENT ||
                  mfaFetcher.state !== "idle" ||
                  !canEdit
                }
                aria-label={t`Require two-factor authentication`}
              />
            </HStack>
          </CardHeader>
        </Card>
      </VStack>
    </ScrollArea>
  );
}
