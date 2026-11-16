// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import { useRevalidator } from "@carbon/query";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
  toast,
  VStack
} from "@carbon/react";
import { formatQuantity } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { useEffect } from "react";
import { LuCheck, LuExternalLink } from "react-icons/lu";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { DateTime } from "~/components";
import { MesAppBar, MesQueueHeader } from "~/components/MesAppBar";
import { MesEmptyState } from "~/components/MesEmptyState";
import { userContext } from "~/context";
import { getLineFeed } from "~/services/inventory.service";
import type { LineFeedRow } from "~/services/line-feed";
import { useItems } from "~/stores";
import type { Handle } from "~/utils/handle";
import { pageMeta } from "~/utils/meta";
import { path } from "~/utils/path";

const logger = getLogger("mes", "line-feed");

export const handle: Handle = {
  realtime: [
    "materialRequest",
    "stockTransfer",
    "stockTransferLine",
    "jobOperation",
    "itemLedger"
  ]
};

export const meta: MetaFunction = () => pageMeta("Line feed");

const emptyLineFeed = {
  rows: [] as LineFeedRow[],
  workCenterNames: {} as Record<string, string>,
  storageUnitNames: {} as Record<string, string>,
  jobReadableIds: {} as Record<string, string>,
  stockTransferReadableIds: {} as Record<string, string>,
  // A failed read is not an empty queue: the screen says so and offers a retry.
  loadFailed: false
};

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "inventory"
  });
  const locationId = context.get(userContext)?.locationId;
  if (!locationId) return emptyLineFeed;

  const lineFeed = await getLineFeed(client, { companyId, locationId });
  if (lineFeed.error || !lineFeed.data) {
    logger.error("Failed to load the line feed", {
      companyId,
      locationId,
      error: lineFeed.error
    });
    return { ...emptyLineFeed, loadFailed: true };
  }

  return { ...lineFeed.data, loadFailed: false };
}

export default function LineFeedRoute() {
  const {
    rows,
    workCenterNames,
    storageUnitNames,
    jobReadableIds,
    stockTransferReadableIds,
    loadFailed
  } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <MesAppBar title={<Trans>Line feed</Trans>} />
      <MesQueueHeader title={<Trans>Line feed</Trans>} />

      <div className="flex-1 min-h-0 w-full overflow-y-auto scrollbar-thin scrollbar-thumb-accent scrollbar-track-transparent">
        {loadFailed ? (
          <MesEmptyState
            className="flex-1 w-full h-[calc(100%-var(--header-height))]"
            title={<Trans>Could not load the line feed</Trans>}
            action={
              <Button
                isLoading={revalidator.state !== "idle"}
                isDisabled={revalidator.state !== "idle"}
                onClick={() => revalidator.revalidate()}
              >
                <Trans>Try again</Trans>
              </Button>
            }
          />
        ) : rows.length > 0 ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,330px),1fr))] p-4 gap-4">
            {rows.map((row) => (
              <LineFeedCard
                key={row.key}
                row={row}
                station={
                  row.workCenterId
                    ? (workCenterNames[row.workCenterId] ?? null)
                    : null
                }
                storageUnit={
                  row.storageUnitId
                    ? (storageUnitNames[row.storageUnitId] ?? null)
                    : null
                }
                reference={
                  row.materialRequestId
                    ? (jobReadableIds[row.materialRequestId] ?? null)
                    : row.stockTransferId
                      ? (stockTransferReadableIds[row.stockTransferId] ?? null)
                      : null
                }
              />
            ))}
          </div>
        ) : (
          <MesEmptyState
            className="flex-1 w-full h-[calc(100%-var(--header-height))]"
            title={<Trans>Nothing to feed</Trans>}
          />
        )}
      </div>
    </div>
  );
}

function LineFeedCard({
  row,
  station,
  storageUnit,
  reference
}: {
  row: LineFeedRow;
  station: string | null;
  storageUnit: string | null;
  reference: string | null;
}) {
  const { t } = useLingui();
  const { locale } = useLocale();
  const [items] = useItems();
  const part = row.itemId
    ? (items.find((item) => item.id === row.itemId)?.readableIdWithRevision ??
      null)
    : null;

  const kindLabel = {
    request: t`Request`,
    shortage: t`Shortage`,
    transfer: t`Transfer`
  }[row.kind];
  const kindVariant = {
    request: "yellow",
    shortage: "orange",
    transfer: "gray"
  } as const;

  const card = (
    <Card className={row.kind === "transfer" ? "cursor-pointer" : undefined}>
      <CardHeader className="pb-2">
        <HStack className="justify-between gap-2">
          <CardTitle className="text-base min-w-0 truncate">
            {station ?? <Trans>No station</Trans>}
          </CardTitle>
          <Badge variant={kindVariant[row.kind]} className="shrink-0">
            {kindLabel}
          </Badge>
        </HStack>
      </CardHeader>
      <CardContent>
        <VStack className="gap-1">
          {storageUnit && (
            <HStack className="justify-between text-sm w-full">
              <span className="text-muted-foreground">
                <Trans>Storage unit</Trans>
              </span>
              <span className="min-w-0 truncate">{storageUnit}</span>
            </HStack>
          )}
          <HStack className="justify-between text-sm w-full">
            <span className="text-muted-foreground">
              <Trans>Part</Trans>
            </span>
            <span className="min-w-0 truncate whitespace-nowrap">
              {part ?? <Trans>Any part</Trans>}
            </span>
          </HStack>
          <HStack className="justify-between text-sm w-full">
            <span className="text-muted-foreground">
              <Trans>Quantity</Trans>
            </span>
            <span className="tabular-nums">
              {row.quantity === null
                ? "—"
                : formatQuantity(row.quantity, locale)}
            </span>
          </HStack>
          <HStack className="justify-between text-sm w-full">
            <span className="text-muted-foreground">
              <Trans>Age</Trans>
            </span>
            <span>
              {row.createdAt ? (
                <DateTime value={row.createdAt} variant="relative" />
              ) : (
                "—"
              )}
            </span>
          </HStack>
          {reference && (
            <HStack className="justify-between text-sm w-full">
              <span className="text-muted-foreground">
                {row.kind === "transfer" ? (
                  <Trans>Stock transfer</Trans>
                ) : (
                  <Trans>Job</Trans>
                )}
              </span>
              <span className="flex items-center gap-1 whitespace-nowrap">
                {reference}
                {row.kind === "transfer" && (
                  <LuExternalLink
                    className="size-3 text-muted-foreground"
                    aria-hidden
                  />
                )}
              </span>
            </HStack>
          )}
          {row.note && (
            <p className="text-sm text-muted-foreground line-clamp-2 pt-1">
              {row.note}
            </p>
          )}
          {row.kind === "request" && row.materialRequestId && (
            <ResolveButton materialRequestId={row.materialRequestId} />
          )}
        </VStack>
      </CardContent>
    </Card>
  );

  // A transfer opens its stock transfer in the ERP; the MES has no transfer
  // screen.
  if (row.kind === "transfer" && row.stockTransferId) {
    return (
      <a
        href={path.to.erpStockTransfer(row.stockTransferId)}
        target="_blank"
        rel="noreferrer"
        className="no-underline"
      >
        {card}
      </a>
    );
  }

  return card;
}

function ResolveButton({ materialRequestId }: { materialRequestId: string }) {
  const { t } = useLingui();
  const fetcher = useFetcher<{ success: boolean; message?: string }>();
  const isSubmitting = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.success === false) {
      toast.error(fetcher.data.message ?? t`Failed to resolve request`);
    }
  }, [fetcher.data, t]);

  return (
    <fetcher.Form
      method="post"
      action={path.to.lineFeedResolve(materialRequestId)}
      className="w-full pt-2"
    >
      <Button
        type="submit"
        variant="secondary"
        size="lg"
        leftIcon={<LuCheck />}
        isLoading={isSubmitting}
        isDisabled={isSubmitting}
        className="w-full"
      >
        <Trans>Resolve</Trans>
      </Button>
    </fetcher.Form>
  );
}
