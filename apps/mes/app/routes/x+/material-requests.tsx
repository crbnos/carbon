// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import { Badge, Button } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { LuMessageSquarePlus, LuRefreshCw } from "react-icons/lu";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData, useRevalidator } from "react-router";
import { DateTime } from "~/components";
import ItemThumbnail from "~/components/ItemThumbnail";
import { MesAppBar, MesQueueHeader } from "~/components/MesAppBar";
import { MesEmptyState } from "~/components/MesEmptyState";
import { ResolveMaterialRequestButton } from "~/components/ResolveMaterialRequestButton";
import { userContext } from "~/context";
import type { OpenMaterialRequest } from "~/services/material-request.service";
import { getOpenMaterialRequests } from "~/services/material-request.service";
import type { Handle } from "~/utils/handle";
import { pageMeta } from "~/utils/meta";

const logger = getLogger("mes", "material-requests");

export const handle: Handle = {
  realtime: ["materialRequest"]
};

export const meta: MetaFunction = () => pageMeta("Material requests");

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "inventory"
  });
  const locationId = context.get(userContext)?.locationId;
  if (!locationId) return { requests: [], loadFailed: false };

  const requests = await getOpenMaterialRequests(client, {
    companyId,
    locationId
  });
  if (requests.error) {
    logger.error("Failed to load material requests", {
      companyId,
      locationId,
      error: requests.error
    });
    // A failed read is not an empty list: the screen says so.
    return { requests: [], loadFailed: true };
  }
  return { requests: requests.data, loadFailed: false };
}

export default function MaterialRequestsRoute() {
  const { requests, loadFailed } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const title = <Trans>Material requests</Trans>;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <MesAppBar title={title} />
      <MesQueueHeader
        title={title}
        actions={
          requests.length > 0 && (
            <Badge variant="yellow" className="tabular-nums">
              <Trans>{requests.length} open</Trans>
            </Badge>
          )
        }
      />
      <div className="flex-1 min-h-0 w-full overflow-y-auto scrollbar-thin scrollbar-thumb-accent scrollbar-track-transparent">
        {requests.length > 0 ? (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,360px),1fr))] gap-4 p-4">
            {requests.map((request) => (
              <RequestCard key={request.id} request={request} />
            ))}
          </ul>
        ) : (
          <MesEmptyState
            className="flex-1 w-full h-[calc(100%-var(--header-height))]"
            title={
              loadFailed ? (
                <Trans>Failed to load material requests</Trans>
              ) : (
                <Trans>No open material requests</Trans>
              )
            }
            action={
              loadFailed && (
                <Button
                  size="lg"
                  variant="secondary"
                  leftIcon={<LuRefreshCw />}
                  onClick={() => revalidator.revalidate()}
                >
                  <Trans>Try again</Trans>
                </Button>
              )
            }
          />
        )}
      </div>
    </div>
  );
}

function RequestCard({ request }: { request: OpenMaterialRequest }) {
  const { item, workCenter, jobOperation, requester } = request;
  const job = jobOperation?.job?.jobId;

  return (
    <li className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-lg font-semibold">
          {workCenter?.name ?? <Trans>No station</Trans>}
        </span>
        <span className="shrink-0 text-sm text-muted-foreground">
          <DateTime value={request.createdAt} variant="relative" />
        </span>
      </div>
      <div className="flex items-center gap-3">
        {item ? (
          <ItemThumbnail
            size="xl"
            thumbnailPath={item.thumbnailPath}
            type={item.type}
          />
        ) : (
          <div className="flex size-16 shrink-0 items-center justify-center rounded-lg bg-muted">
            <LuMessageSquarePlus className="size-8 text-muted-foreground" />
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-base/6 font-medium">
            {item ? (
              (item.readableIdWithRevision ?? item.name)
            ) : (
              <Trans>Something else</Trans>
            )}
          </span>
          {item && (
            <span className="line-clamp-2 text-sm text-muted-foreground">
              {item.name}
            </span>
          )}
        </div>
      </div>
      {request.note && (
        <p className="whitespace-pre-wrap rounded-md bg-muted px-3 py-2 text-sm">
          {request.note}
        </p>
      )}
      <p className="mt-auto truncate text-sm text-muted-foreground">
        {[job, jobOperation?.description, requester?.fullName]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <ResolveMaterialRequestButton materialRequestId={request.id} />
    </li>
  );
}
