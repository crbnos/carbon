// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
  VStack
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { DateTime } from "~/components";
import { MesAppBar, MesQueueHeader } from "~/components/MesAppBar";
import { MesEmptyState } from "~/components/MesEmptyState";
import { PickingListStatus } from "~/components/PickingListStatus";
import { userContext } from "~/context";
import { getAssignedPickingLists } from "~/services/picking.service";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  realtime: ["pickingList"]
};

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { client, userId } = await requirePermissions(request, {});
  const effectiveUserId = context.get(userContext)?.effectiveUserId ?? userId;

  const pickingLists = await getAssignedPickingLists(client, effectiveUserId);

  return {
    pickingLists: pickingLists.data ?? []
  };
}

export default function PickingIndexRoute() {
  const { pickingLists } = useLoaderData<typeof loader>();

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <MesAppBar title={<Trans>Picking</Trans>} />
      <MesQueueHeader title={<Trans>Picking</Trans>} />

      <main className="flex-1 min-h-0 w-full overflow-y-auto scrollbar-thin scrollbar-thumb-accent scrollbar-track-transparent">
        {pickingLists.length > 0 ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,330px),1fr))] p-4 gap-4">
            {pickingLists.map((pl) => {
              const lineCount = Number(pl.lineCount ?? 0);
              const completedLineCount = Number(pl.completedLineCount ?? 0);
              const progress =
                lineCount > 0
                  ? Math.round((completedLineCount / lineCount) * 100)
                  : 0;

              return (
                <Link
                  key={pl.id}
                  to={path.to.pickingDetail(pl.id!)}
                  className="no-underline"
                >
                  <Card className="hover:border-primary transition-colors cursor-pointer">
                    <CardHeader className="pb-2">
                      <HStack className="justify-between">
                        <CardTitle className="text-base">
                          {pl.pickingListId}
                        </CardTitle>
                        <PickingListStatus status={pl.status!} />
                      </HStack>
                    </CardHeader>
                    <CardContent>
                      <VStack className="gap-1">
                        <HStack className="justify-between text-sm max-md:w-full">
                          <span className="text-muted-foreground">
                            <Trans>Location</Trans>
                          </span>
                          <span>{pl.locationName}</span>
                        </HStack>
                        {pl.dueDate && (
                          <HStack className="justify-between text-sm max-md:w-full">
                            <span className="text-muted-foreground">
                              <Trans>Due Date</Trans>
                            </span>
                            <span>
                              <DateTime value={pl.dueDate} variant="date" />
                            </span>
                          </HStack>
                        )}
                        <HStack className="justify-between text-sm max-md:w-full">
                          <span className="text-muted-foreground">
                            <Trans>Progress</Trans>
                          </span>
                          <span>
                            {completedLineCount}/{lineCount} · {progress}%
                          </span>
                        </HStack>
                      </VStack>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        ) : (
          <MesEmptyState
            className="flex-1 w-full h-[calc(100%-var(--header-height))]"
            title={<Trans>No picking lists assigned</Trans>}
          />
        )}
      </main>
    </div>
  );
}
