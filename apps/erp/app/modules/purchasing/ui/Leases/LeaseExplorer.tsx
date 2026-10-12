// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn, HStack, VStack } from "@carbon/react";
import { useNavigate, useParams } from "react-router";
import { Empty, ItemThumbnail } from "~/components";
import { useLocations } from "~/components/Form/Location";
import { useOptimisticLocation, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import LeaseStatus from "./LeaseStatus";
import type { Lease, LeaseLine, LeaseRouteData } from "./types";

/** The lease's assets, one row each, like a rental agreement's units. A row
 *  opens the asset's page, where it is terminated or bought; the lease
 *  itself opens from the header. */
export default function LeaseExplorer() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const routeData = useRouteData<LeaseRouteData>(path.to.lease(id));
  if (!routeData) return null;

  const { lease, lines } = routeData;

  return (
    <VStack
      className="w-full h-[calc(100dvh-var(--topbar-height)-var(--header-height)-var(--content-inset))] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent"
      spacing={0}
    >
      {lines.length > 0 ? (
        <ExplorerLines lease={lease} lines={lines} />
      ) : (
        <Empty />
      )}
    </VStack>
  );
}

function ExplorerLines({
  lease,
  lines
}: Pick<LeaseRouteData, "lease" | "lines">) {
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
          location={locationName.get(line.locationId ?? lease.locationId ?? "")}
        />
      ))}
    </>
  );
}

function ExplorerLine({
  lease,
  line,
  location
}: {
  lease: Lease;
  line: LeaseLine;
  location: string | undefined;
}) {
  const optimisticLocation = useOptimisticLocation();
  const navigate = useNavigate();

  const to = path.to.leaseLine(lease.id!, line.id);
  const isSelected = optimisticLocation.pathname === to;

  return (
    <HStack
      className={cn(
        "group w-full p-2 items-center border-b hover:bg-accent/30 cursor-pointer relative",
        isSelected && "bg-accent/60 hover:bg-accent/50"
      )}
      onClick={() => {
        if (!isSelected) navigate(to);
      }}
    >
      <HStack spacing={2} className="flex-grow min-w-0 pr-24">
        <ItemThumbnail
          thumbnailPath={line.fixedAsset?.item?.thumbnailPath}
          type="Part"
        />
        <VStack spacing={0} className="min-w-0">
          <span className="font-semibold line-clamp-1">{line.description}</span>
          <span className="text-muted-foreground text-xs truncate line-clamp-1">
            {[line.serialNumber, location].filter(Boolean).join(" · ")}
          </span>
        </VStack>
      </HStack>
      <HStack spacing={1} className="absolute right-2">
        <LeaseStatus
          status={lease.status === "Draft" ? "Draft" : line.status}
        />
      </HStack>
    </HStack>
  );
}
