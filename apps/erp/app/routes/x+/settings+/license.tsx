// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { CarbonEdition } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { resolveLicence } from "@carbon/ee/license.server";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ScrollArea,
  Status
} from "@carbon/react";
import { Edition, formatDate, redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { SettingsPage, SettingsPageHeading } from "~/components/SettingsPage";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`License`,
  to: path.to.license
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, { view: "settings" });
  if (CarbonEdition !== Edition.Enterprise) throw redirect(path.to.company);

  const licence = await resolveLicence();
  return {
    kind: licence.kind,
    status: licence.status,
    plan: licence.plan,
    error: licence.error,
    clockSuspect: licence.clockSuspect,
    checkIn: licence.checkIn,
    licence: licence.licence && {
      issuedTo: licence.licence.issued_to,
      mode: licence.licence.mode,
      seats: licence.licence.seats ?? null,
      expiresAt: licence.licence.expires_at ?? null,
      terminatesAt: licence.licence.terminates_at ?? null
    }
  };
}

function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div>
      <h4 className="font-medium">{label}</h4>
      <div className="text-sm text-muted-foreground">{children}</div>
    </div>
  );
}

export default function LicenseRoute() {
  const { t } = useLingui();
  const { kind, status, plan, error, clockSuspect, checkIn, licence } =
    useLoaderData<typeof loader>();

  const statusLabel = {
    active: t`Active`,
    expired: t`Expired`,
    terminated: t`Ended`,
    none: t`No license`
  }[status];
  const statusColor =
    status === "active" ? "green" : status === "expired" ? "orange" : "red";

  const malformed = t`CARBON_LICENSE is not a valid license. Check that it was copied in full.`;
  const untrusted = t`This license was not signed by Carbon, or its signing key is no longer valid.`;
  const reasons: Record<string, string> = {
    missing: t`CARBON_LICENSE is not set.`,
    revoked: t`This license was revoked.`,
    unavailable: t`The license could not be checked. Carbon tries again in a minute.`,
    ERR_LICENSE_TERMINATED: t`This license has ended, and its grace period is over.`,
    ERR_LICENSE_FROM_FUTURE: t`This license was issued after the server's current time. Check the server clock.`,
    ERR_LICENSE_STRING: malformed,
    ERR_KEYSTRING_CHECKSUM: malformed,
    ERR_LICENSE_SCHEMA: malformed,
    ERR_ENVELOPE_SCHEMA: malformed,
    ERR_SEAL_VERSION: malformed,
    ERR_SEAL_AUTH: malformed,
    ERR_LICENSE_SIG: untrusted,
    ERR_LICENSE_KID_UNKNOWN: untrusted,
    ERR_LICENSE_KID_STATUS: untrusted
  };
  const reason =
    error &&
    (reasons[error] ??
      (error.startsWith("ERR_MANIFEST_")
        ? t`This version of Carbon cannot check the license's signing keys. Update Carbon.`
        : t`The license could not be verified.`));

  return (
    <ScrollArea className="w-full h-[calc(100dvh-var(--topbar-height)-var(--content-inset))]">
      <SettingsPage className="gap-4">
        <SettingsPageHeading>
          <Trans>License</Trans>
        </SettingsPageHeading>
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Carbon Enterprise license</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>
                The license comes from the CARBON_LICENSE setting of this
                deployment. To change it, change that setting and restart.
              </Trans>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 w-full">
              <Field label={<Trans>Status</Trans>}>
                <Status color={statusColor}>{statusLabel}</Status>
              </Field>
              <Field label={<Trans>Plan</Trans>}>{plan ?? "—"}</Field>
              {kind === "floor" && (
                <Field label={<Trans>Reason</Trans>}>
                  {reason}
                  {error?.startsWith("ERR_") && (
                    <div className="font-mono text-xs">{error}</div>
                  )}
                </Field>
              )}
              {licence && (
                <>
                  <Field label={<Trans>Licensee</Trans>}>
                    {licence.issuedTo}
                  </Field>
                  <Field label={<Trans>Mode</Trans>}>
                    {licence.mode === "connected"
                      ? t`Connected`
                      : t`Air-gapped`}
                  </Field>
                  <Field label={<Trans>Expires</Trans>}>
                    {licence.expiresAt
                      ? formatDate(licence.expiresAt)
                      : t`Never`}
                  </Field>
                  <Field label={<Trans>Grace period ends</Trans>}>
                    {licence.terminatesAt
                      ? formatDate(licence.terminatesAt)
                      : "—"}
                  </Field>
                  <Field label={<Trans>Seats licensed</Trans>}>
                    {licence.seats ?? t`Unlimited`}
                  </Field>
                </>
              )}
              {licence?.mode === "connected" && (
                <>
                  <Field label={<Trans>Last check-in</Trans>}>
                    {checkIn.lastAt ? formatDate(checkIn.lastAt) : t`Never`}
                  </Field>
                  <Field label={<Trans>Last check-in error</Trans>}>
                    {checkIn.error ?? "—"}
                  </Field>
                </>
              )}
              {clockSuspect && (
                <Field label={<Trans>Clock</Trans>}>
                  <Trans>The server clock moved back. Check its time.</Trans>
                </Field>
              )}
            </div>
          </CardContent>
        </Card>
      </SettingsPage>
    </ScrollArea>
  );
}
