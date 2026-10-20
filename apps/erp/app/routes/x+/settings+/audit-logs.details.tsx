// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getGlobalAuditLog } from "@carbon/ee/audit.server";
import { getLogger } from "@carbon/logger";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerHeader,
  DrawerTitle
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { AuditLogTable } from "~/modules/settings/ui";
import { decodeOffsetToken, encodeOffsetToken } from "~/utils/cursor";
import { listErrorPage } from "~/utils/list-registry/load.server";
import { PAGE_SIZE } from "~/utils/pagination";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

const logger = getLogger("erp", "audit-logs");

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "settings"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { filters } = getGenericQueryFilters(searchParams);
  // The audit log RPC pages by offset, so the `after` token holds the next
  // offset.
  const offset = decodeOffsetToken(searchParams.get("after"));

  const entityTypeFilter = filters?.find((f) => f.column === "entityType")
    ?.value as string | undefined;
  const actorIdFilter = filters?.find((f) => f.column === "actorId")?.value;
  const operationFilter = filters?.find((f) => f.column === "operation")
    ?.value as "INSERT" | "UPDATE" | "DELETE" | undefined;

  const query = getGlobalAuditLog(client, companyId, {
    // One extra row tells whether a next page exists.
    limit: PAGE_SIZE + 1,
    offset,
    search: search ?? undefined,
    entityType: entityTypeFilter as NonNullable<
      Parameters<typeof getGlobalAuditLog>[2]
    >["entityType"],
    actorId: actorIdFilter,
    operation: operationFilter
  });
  // The RPC throws on an error. A later page reports it to the list instead
  // of replacing the page.
  const result =
    offset > 0
      ? await query.catch((cause: unknown) => {
          logger.error("Failed to load a page of the audit log", {
            companyId,
            offset,
            error: cause
          });
          return null;
        })
      : await query;
  if (!result) return listErrorPage("entries");

  return {
    entries: result.data.slice(0, PAGE_SIZE),
    count: result.count,
    nextCursor:
      result.data.length > PAGE_SIZE
        ? encodeOffsetToken(offset + PAGE_SIZE)
        : null
  };
}

export default function AuditLogDetailsRoute() {
  const { entries, count, nextCursor } = useLoaderData<typeof loader>();
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
          <DrawerTitle>
            <Trans>All Audit Logs</Trans>
          </DrawerTitle>
        </DrawerHeader>
        <DrawerBody className="p-0 max-md:p-0">
          <AuditLogTable
            entries={entries}
            count={count}
            nextCursor={nextCursor}
          />
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
