import { error, getCarbonServiceRole, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  disableAuditLog,
  enableAuditLog,
  getArchiveDownloadUrl,
  getAuditLogArchives,
  isAuditLogEnabled,
  syncAuditSubscriptions
} from "@carbon/database/audit";
import { Button, Heading, ScrollArea, VStack } from "@carbon/react";
import { LuHistory } from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Link, Outlet, redirect, useLoaderData } from "react-router";
import { AuditLogSettings } from "~/modules/settings";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Audit Log",
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
      const serviceRole = getCarbonServiceRole();
      archives = await getAuditLogArchives(serviceRole, companyId);
    } catch {
      // Archives table might not exist
    }
  }

  return {
    enabled,
    archives
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "settings"
  });

  const formData = await request.formData();
  const actionType = formData.get("action") as string;

  switch (actionType) {
    case "enable": {
      try {
        await enableAuditLog(client, companyId);
        throw redirect(
          path.to.auditLog,
          await flash(request, success("Audit logging enabled"))
        );
      } catch (err) {
        if (err instanceof Response) throw err;
        throw redirect(
          path.to.auditLog,
          await flash(request, error(err, "Failed to enable audit logging"))
        );
      }
    }

    case "disable": {
      try {
        await disableAuditLog(client, companyId);
        throw redirect(
          path.to.auditLog,
          await flash(request, success("Audit logging disabled"))
        );
      } catch (err) {
        if (err instanceof Response) throw err;
        throw redirect(
          path.to.auditLog,
          await flash(request, error(err, "Failed to disable audit logging"))
        );
      }
    }

    case "download": {
      const archiveId = formData.get("archiveId") as string;
      if (!archiveId) {
        throw redirect(
          path.to.auditLog,
          await flash(request, error(null, "Archive ID is required"))
        );
      }

      try {
        const serviceRole = getCarbonServiceRole();
        const downloadUrl = await getArchiveDownloadUrl(serviceRole, archiveId);
        // Redirect to the signed URL for download
        return redirect(downloadUrl);
      } catch (err) {
        throw redirect(
          path.to.auditLog,
          await flash(request, error(err, "Failed to generate download URL"))
        );
      }
    }

    default:
      throw redirect(
        path.to.auditLog,
        await flash(request, error(null, "Invalid action"))
      );
  }
}

export default function AuditLogRoute() {
  const { enabled, archives } = useLoaderData<typeof loader>();

  return (
    <ScrollArea className="w-full h-[calc(100dvh-49px)]">
      <VStack
        spacing={4}
        className="py-12 px-4 max-w-[60rem] h-full mx-auto gap-4"
      >
        <div className="flex items-center justify-between w-full">
          <Heading size="h3">Audit Logs</Heading>
          {enabled && (
            <Button leftIcon={<LuHistory />} asChild>
              <Link to={path.to.auditLogDetails}>View All</Link>
            </Button>
          )}
        </div>
        <AuditLogSettings enabled={enabled} archives={archives} />
        {enabled && <Outlet />}
      </VStack>
    </ScrollArea>
  );
}
