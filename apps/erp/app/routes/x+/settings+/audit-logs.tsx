// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { CONTROLLED_ENVIRONMENT } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  enableAuditLog,
  getAuditLogArchives,
  isAuditLogEnabled,
  syncAuditSubscriptions
} from "@carbon/ee/audit.server";
import { validator } from "@carbon/form";
import { Button, RecordOutlet, ScrollArea } from "@carbon/react";
import { redirectExternal } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { LuHistory } from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { z } from "zod";
import { SettingsPage, SettingsPageHeading } from "~/components/SettingsPage";
import { usePlanGate } from "~/hooks/usePlanGate";
import {
  AuditLogSettings,
  AuditLogUpgradeOverlay
} from "~/modules/settings/ui";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Audit Log`,
  to: path.to.auditLog
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "settings"
  });

  // Check if audit log is enabled for this company
  let enabled = false;
  try {
    enabled = await isAuditLogEnabled(client, companyId);
  } catch {
    // Table might not exist yet, that's ok
  }

  const serviceRole = getCarbonServiceRole();

  // Controlled environments (ITAR/CUI, NIST 800-171 3.3.1): audit logging is on
  // by default and cannot be turned off. Enable it on demand for any controlled
  // company that isn't already capturing. This is mandatory, not the viewer's
  // choice, so it runs as the service role: create_audit_log_table requires
  // settings_update, and this loader only requires settings_view.
  if (CONTROLLED_ENVIRONMENT && !enabled) {
    try {
      await enableAuditLog(serviceRole, companyId);
      enabled = true;
    } catch {
      // Best-effort; the write path degrades gracefully if it can't enable here.
    }
  }

  // Sync subscriptions to pick up any newly added auditable tables
  if (enabled) {
    try {
      await syncAuditSubscriptions(client, companyId);
    } catch {
      // Subscription sync failure is non-critical
    }
  }

  // Get archives (uses service role to bypass RLS on auditLogArchive table)
  let archives: Awaited<ReturnType<typeof getAuditLogArchives>> = [];
  if (enabled) {
    try {
      archives = await getAuditLogArchives(serviceRole, companyId);
    } catch {
      // Archives table might not exist
    }
  }

  return {
    enabled,
    archives,
    controlled: CONTROLLED_ENVIRONMENT
  };
}

// The switch posts `action` enable or disable; an archive's row posts download.
const auditLogForm = z.discriminatedUnion("action", [
  z.object({ action: z.literal("enable") }),
  z.object({ action: z.literal("disable") }),
  z.object({
    action: z.literal("download"),
    archiveId: z.string().min(1, { message: "Archive ID is required" })
  })
]);

export async function action(args: ActionFunctionArgs) {
  const input = await validator(auditLogForm).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  switch (input.data.action) {
    case "enable":
      return respond(
        args.request,
        await api.settings.enableCompanyAuditLog({})
      ).redirect(path.to.auditLog, { message: "Audit logging enabled" });
    case "disable":
      return respond(
        args.request,
        await api.settings.disableCompanyAuditLog({})
      ).redirect(path.to.auditLog, { message: "Audit logging disabled" });
    case "download": {
      const result = await api.settings.getAuditArchiveDownloadUrl(input.data);
      if (result.error) {
        return respond(args.request, result).redirect(path.to.auditLog);
      }
      return redirectExternal(result.data.url);
    }
  }
}

export default function AuditLogRoute() {
  const { enabled, archives, controlled } = useLoaderData<typeof loader>();
  const { isGated } = usePlanGate({ feature: "AUDIT_LOG" });

  if (isGated) {
    return <AuditLogUpgradeOverlay />;
  }

  return (
    <ScrollArea className="w-full h-[calc(100dvh-var(--topbar-height)-var(--content-inset))]">
      <SettingsPage className="gap-4">
        <div className="flex items-center justify-between w-full max-md:justify-end">
          <SettingsPageHeading>
            <Trans>Audit Logs</Trans>
          </SettingsPageHeading>
          {enabled && (
            <Button variant="secondary" leftIcon={<LuHistory />} asChild>
              <Link to={path.to.auditLogDetails}>
                <Trans>View All</Trans>
              </Link>
            </Button>
          )}
        </div>
        <AuditLogSettings
          enabled={enabled}
          archives={archives}
          controlled={controlled}
        />
        {enabled && <RecordOutlet />}
      </SettingsPage>
    </ScrollArea>
  );
}
