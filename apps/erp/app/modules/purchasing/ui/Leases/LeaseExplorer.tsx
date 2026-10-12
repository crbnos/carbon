// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuCircleStop, LuEllipsisVertical, LuHandCoins } from "react-icons/lu";
import { useNavigate, useParams } from "react-router";
import { Empty } from "~/components";
import { useLocations } from "~/components/Form/Location";
import { useOptimisticLocation, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import LeaseStatus from "./LeaseStatus";
import type { Lease, LeaseLine, LeaseRouteData } from "./types";
import {
  type LeaseAssetActionState,
  useLeaseAssetActions
} from "./useLeaseAssetActions";

/** The lease's assets, one row each, like a rental agreement's units. A row
 *  opens the asset's page; the lease itself opens from the header. */
export default function LeaseExplorer() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const routeData = useRouteData<LeaseRouteData>(path.to.lease(id));
  if (!routeData) return null;

  const { lease, lines, payments, schedule } = routeData;

  return (
    <VStack
      className="w-full h-[calc(100dvh-var(--topbar-height)-var(--header-height)-var(--content-inset))] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent"
      spacing={0}
    >
      {lines.length > 0 ? (
        <ExplorerLines
          lease={lease}
          lines={lines}
          payments={payments}
          schedule={schedule}
        />
      ) : (
        <Empty />
      )}
    </VStack>
  );
}

function ExplorerLines({
  lease,
  lines,
  payments,
  schedule
}: Pick<LeaseRouteData, "lease" | "lines" | "payments" | "schedule">) {
  const actions = useLeaseAssetActions({ lease, payments, schedule });
  const locations = useLocations();
  const locationName = new Map(
    locations.map((location) => [location.value, location.label])
  );

  return (
    <>
      {lines.map((line) => (
        <ExplorerLine
          key={line.id}
          lease={lease}
          line={line}
          location={locationName.get(line.locationId ?? "")}
          state={actions.stateOf(line)}
          onAction={actions.open}
        />
      ))}
      {actions.modals}
    </>
  );
}

function ExplorerLine({
  lease,
  line,
  location,
  state,
  onAction
}: {
  lease: Lease;
  line: LeaseLine;
  location: string | undefined;
  state: LeaseAssetActionState;
  onAction: ReturnType<typeof useLeaseAssetActions>["open"];
}) {
  const { t } = useLingui();
  const optimisticLocation = useOptimisticLocation();
  const navigate = useNavigate();

  const to = path.to.leaseLine(lease.id!, line.id);
  const isSelected = optimisticLocation.pathname === to;
  const hasActions = state.canTerminate || state.canPurchase;

  return (
    <HStack
      className={cn(
        "group w-full p-2 items-center border-b hover:bg-accent/30 cursor-pointer",
        isSelected && "bg-accent/60 hover:bg-accent/50"
      )}
      onClick={() => {
        if (!isSelected) navigate(to);
      }}
    >
      <HStack spacing={2} className="flex-1 min-w-0">
        <VStack spacing={0} className="min-w-0">
          <span className="font-semibold truncate w-full">
            {line.description}
          </span>
          <span className="text-muted-foreground text-xs truncate w-full">
            {[line.serialNumber, location].filter(Boolean).join(" · ")}
          </span>
        </VStack>
      </HStack>
      <HStack spacing={1} className="shrink-0">
        <LeaseStatus
          status={lease.status === "Draft" ? "Draft" : line.status}
        />
        {hasActions && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                aria-label={t`Asset actions`}
                className="opacity-0 group-hover:opacity-100 group-active:opacity-100 data-[state=open]:opacity-100"
                icon={<LuEllipsisVertical />}
                size="md"
                variant="solid"
                onClick={(e) => e.stopPropagation()}
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent onClick={(e) => e.stopPropagation()}>
              {state.canTerminate && (
                <DropdownMenuItem onClick={() => onAction("terminate", line)}>
                  <DropdownMenuIcon icon={<LuCircleStop />} />
                  <Trans>Terminate</Trans>
                </DropdownMenuItem>
              )}
              {state.canPurchase && (
                <DropdownMenuItem onClick={() => onAction("purchase", line)}>
                  <DropdownMenuIcon icon={<LuHandCoins />} />
                  <Trans>Exercise Purchase Option</Trans>
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </HStack>
    </HStack>
  );
}
