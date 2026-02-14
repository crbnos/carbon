import { requirePermissions } from "@carbon/auth/auth.server";
import { getGlobalAuditLog } from "@carbon/database/audit";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerHeader,
  DrawerTitle
} from "@carbon/react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { AuditLogTable } from "~/modules/settings";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "settings"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, filters } = getGenericQueryFilters(searchParams);

  const entityTypeFilter = filters?.find((f) => f.column === "entityType")
    ?.value as string | undefined;
  const actorIdFilter = filters?.find((f) => f.column === "actorId")?.value;
  const operationFilter = filters?.find((f) => f.column === "operation")
    ?.value as "INSERT" | "UPDATE" | "DELETE" | undefined;

  const result = await getGlobalAuditLog(client, companyId, {
    limit,
    offset,
    search: search ?? undefined,
    entityType: entityTypeFilter as NonNullable<
      Parameters<typeof getGlobalAuditLog>[2]
    >["entityType"],
    actorId: actorIdFilter,
    operation: operationFilter
  });

  return {
    entries: result.data,
    count: result.count
  };
}

export default function AuditLogDetailsRoute() {
  const { entries, count } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) {
          navigate(path.to.auditLog);
        }
      }}
    >
      <DrawerContent size="full">
        <DrawerHeader>
          <DrawerTitle>All Audit Logs</DrawerTitle>
        </DrawerHeader>
        <DrawerBody className="p-0">
          <AuditLogTable entries={entries} count={count} />
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
