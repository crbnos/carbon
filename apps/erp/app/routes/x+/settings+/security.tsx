import {
  assertIsPost,
  CONTROLLED_ENVIRONMENT,
  error,
  success
} from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { requirePlan } from "@carbon/ee/plan.server";
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
import { usePlanGate } from "~/hooks/usePlanGate";
import { useSettings } from "~/hooks/useSettings";
import {
  SecurityUpgradeOverlay,
  updateRequireMfaSetting
} from "~/modules/settings";
import { sendMfaRequiredEmails } from "~/services/mfa-email.server";
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

  if (requireMfa) {
    await requirePlan({
      request,
      client,
      companyId,
      feature: "TWO_FACTOR",
      redirectTo: path.to.security,
      message: "Upgrade to Business to require two-factor authentication"
    });
  }

  // Read the stored value first: the switch re-submits on every flip, and a
  // toggle that lands on the value it already had must not re-announce.
  const previous = await client
    .from("companySettings")
    .select("requireMfa")
    .eq("id", companyId)
    .single();

  const update = await updateRequireMfaSetting(client, companyId, requireMfa);
  if (update.error)
    return data(
      {},
      await flash(
        request,
        error(update.error, "Failed to update two-factor requirement")
      )
    );

  // Only the off → on transition is news. If the prior read failed we don't
  // know it was a transition, so we stay quiet rather than mailing the company.
  //
  // CONTROLLED_ENVIRONMENT is checked separately because effective enforcement
  // is `CONTROLLED_ENVIRONMENT || requireMfa` (see the ERP/MES shell loaders),
  // and nothing ever writes the column in such a deployment — it stays false
  // while MFA is already mandatory. Without this guard the column would read as
  // a fresh off → on and the company would be told a requirement "now" applies
  // that has applied since the day it was deployed. Enforcement there is a
  // deployment fact, not an event, so there is nothing to announce.
  if (
    !CONTROLLED_ENVIRONMENT &&
    requireMfa &&
    previous.data?.requireMfa === false
  ) {
    await sendMfaRequiredEmails(getCarbonServiceRole(), companyId);
  }

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
  const { isGated } = usePlanGate({ feature: "TWO_FACTOR" });

  if (isGated && !CONTROLLED_ENVIRONMENT && !requireMfa) {
    return <SecurityUpgradeOverlay />;
  }

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
