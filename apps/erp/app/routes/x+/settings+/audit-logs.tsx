import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  disableAuditLog,
  enableAuditLog,
  getArchiveDownloadUrl,
  getAuditLogArchives,
  getGlobalAuditLog,
  isAuditLogEnabled
} from "@carbon/database/audit";
import { Button, Heading, ScrollArea, VStack } from "@carbon/react";
import { LuHistory } from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Link, Outlet, redirect, useLoaderData } from "react-router";
import { AuditLogSettings } from "~/modules/settings";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Audit Log",
  to: path.to.auditLog
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "settings"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, filters } = getGenericQueryFilters(searchParams);

  // Check if audit log is enabled for this company
  let enabled = false;
  try {
    enabled = await isAuditLogEnabled(client, companyId);
  } catch {
    // Table might not exist yet, that's ok
  }

  // Extract filter values from the filter array
  const entityTypeFilter = filters?.find((f) => f.column === "entityType")
    ?.value as string | undefined;
  const actorIdFilter = filters?.find((f) => f.column === "actorId")?.value;
  const operationFilter = filters?.find((f) => f.column === "operation")
    ?.value as "INSERT" | "UPDATE" | "DELETE" | undefined;

  // Get audit log entries if enabled
  let entries: Awaited<ReturnType<typeof getGlobalAuditLog>>["data"] = [];
  let count = 0;

  if (enabled) {
    try {
      const result = await getGlobalAuditLog(client, companyId, {
        limit,
        offset,
        search: search ?? undefined,
        // Cast is safe - filter values come from UI which uses auditConfig.entities
        entityType: entityTypeFilter as NonNullable<
          Parameters<typeof getGlobalAuditLog>[2]
        >["entityType"],
        actorId: actorIdFilter,
        operation: operationFilter
      });
      entries = result.data;
      count = result.count;
    } catch {
      // If the table doesn't exist, the enabled flag will be wrong
      // This can happen during migration, treat as disabled
    }
  }

  // Get archives
  let archives: Awaited<ReturnType<typeof getAuditLogArchives>> = [];
  if (enabled) {
    try {
      archives = await getAuditLogArchives(client, companyId);
    } catch {
      // Archives table might not exist
    }
  }

  return {
    enabled,
    entries,
    archives,
    count
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
        const downloadUrl = await getArchiveDownloadUrl(client, archiveId);
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
  const { enabled, entries, archives, count } = useLoaderData<typeof loader>();

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
        {enabled && <Outlet context={{ entries, count }} />}
      </VStack>
    </ScrollArea>
  );
}
