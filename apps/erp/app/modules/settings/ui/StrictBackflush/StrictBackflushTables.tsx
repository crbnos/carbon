// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTrigger,
  useViewport
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo } from "react";
import {
  LuBookMarked,
  LuGitBranch,
  LuMapPin,
  LuPackage,
  LuSquareStack,
  LuText
} from "react-icons/lu";
import { Hyperlink, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import JobStatus from "~/modules/production/ui/Jobs/JobStatus";
import { path } from "~/utils/path";
import type { JobMissingStorageUnit, MethodMissingPullFrom } from "../../types";

// The make-method page of a method's item, by item type. Only Parts, Tools and
// Services carry make methods with their own route.
export function makeMethodPath(method: {
  itemId: string;
  itemType: string;
  makeMethodId: string;
}): string | null {
  switch (method.itemType) {
    case "Part":
      return path.to.partMake(method.itemId, method.makeMethodId);
    case "Tool":
      return path.to.toolMake(method.itemId, method.makeMethodId);
    case "Service":
      return path.to.serviceMake(method.itemId, method.makeMethodId);
    default:
      return null;
  }
}

const PARTS_SHOWN = 3;

// A list of part IDs in one cell. An ID never breaks across lines. Past the
// first few, "+N more" opens the whole list in a scrolling popover (a sheet on
// a phone). The drawer's search and the CSV download cover every ID too.
function PartList({ parts, label }: { parts: string[]; label: string }) {
  const { t } = useLingui();
  const { isPhone } = useViewport();
  const shown = parts.slice(0, PARTS_SHOWN);
  const more = parts.length - shown.length;
  return (
    <div className="flex flex-wrap items-center gap-x-1 text-sm min-w-0 max-w-full">
      {shown.map((part, index) => (
        <span key={part} className="whitespace-nowrap">
          {part}
          {index < shown.length - 1 ? "," : ""}
        </span>
      ))}
      {more > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="link" size="sm" className="text-muted-foreground">
              {t`+${more} more`}
            </Button>
          </PopoverTrigger>
          {/* Rendered outside the drawer, whose scroll lock swallows the
              wheel and touch events: stop them here, or the list cannot
              scroll (conventions-ui.md, "Popovers inside Drawers"). */}
          <PopoverContent
            align="start"
            collisionPadding={8}
            className="w-64 p-0"
            aria-label={label}
            onWheel={(event) => event.stopPropagation()}
            onTouchMove={(event) => event.stopPropagation()}
          >
            {/* A phone's sheet titles itself from aria-label. */}
            {!isPhone && (
              <PopoverHeader className="mx-0 mt-0 mb-0 flex items-center justify-between gap-2">
                <span className="truncate">{label}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {parts.length}
                </span>
              </PopoverHeader>
            )}
            <ul className="max-h-72 overflow-y-auto py-1 text-sm scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent">
              {parts.map((part) => (
                <li key={part} className="truncate px-4 py-1" title={part}>
                  {part}
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

function LocationPills({ locations }: { locations: string[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {locations.map((location) => (
        <Enumerable key={location} value={location} />
      ))}
    </div>
  );
}

export const MethodsMissingPullFromTable = memo(
  ({ data, count }: { data: MethodMissingPullFrom[]; count: number }) => {
    const { t } = useLingui();
    const columns = useMemo<ColumnDef<MethodMissingPullFrom>[]>(
      () => [
        {
          accessorKey: "readableId",
          header: t`Part`,
          cell: ({ row }) => {
            const to = makeMethodPath(row.original);
            return to ? (
              <Hyperlink to={to}>{row.original.readableId}</Hyperlink>
            ) : (
              <span className="whitespace-nowrap">
                {row.original.readableId}
              </span>
            );
          },
          meta: { mobile: "P1", icon: <LuBookMarked /> }
        },
        {
          accessorKey: "name",
          header: t`Description`,
          cell: ({ row }) => (
            <span className="line-clamp-1">{row.original.name}</span>
          ),
          meta: { icon: <LuText /> }
        },
        {
          accessorKey: "version",
          header: t`Version`,
          cell: ({ row }) => <span>V{row.original.version}</span>,
          meta: { icon: <LuGitBranch /> }
        },
        {
          accessorKey: "materials",
          header: t`Materials missing a Pull From`,
          cell: ({ row }) => (
            <PartList
              parts={row.original.materials}
              label={t`Materials missing a Pull From`}
            />
          ),
          meta: {
            mobile: "P2",
            icon: <LuSquareStack />,
            exportValue: (row) => row.materials.join(", ")
          }
        },
        {
          accessorKey: "locations",
          header: t`Locations`,
          cell: ({ row }) => (
            <LocationPills locations={row.original.locations} />
          ),
          meta: {
            icon: <LuMapPin />,
            exportValue: (row) => row.locations.join(", ")
          }
        }
      ],
      [t]
    );

    return (
      <Table<MethodMissingPullFrom>
        data={data}
        columns={columns}
        count={count}
        title={t`Methods`}
        table="strictBackflushMethods"
        withSearch
        withPagination
      />
    );
  }
);
MethodsMissingPullFromTable.displayName = "MethodsMissingPullFromTable";

export const JobsMissingStorageUnitTable = memo(
  ({ data, count }: { data: JobMissingStorageUnit[]; count: number }) => {
    const { t } = useLingui();
    const columns = useMemo<ColumnDef<JobMissingStorageUnit>[]>(
      () => [
        {
          accessorKey: "jobId",
          header: t`Job`,
          cell: ({ row }) => (
            <Hyperlink to={path.to.job(row.original.id)}>
              {row.original.jobId}
            </Hyperlink>
          ),
          meta: { mobile: "P1", icon: <LuBookMarked /> }
        },
        {
          accessorKey: "status",
          header: t`Status`,
          cell: ({ row }) => <JobStatus status={row.original.status} />
        },
        {
          accessorKey: "readableId",
          header: t`Part`,
          cell: ({ row }) => (
            <span className="whitespace-nowrap">
              {row.original.readableId ?? ""}
            </span>
          ),
          meta: { icon: <LuPackage /> }
        },
        {
          accessorKey: "locationName",
          header: t`Location`,
          cell: ({ row }) => <Enumerable value={row.original.locationName} />,
          meta: { icon: <LuMapPin /> }
        },
        {
          accessorKey: "materials",
          header: t`Materials with no storage unit`,
          cell: ({ row }) => (
            <PartList
              parts={row.original.materials}
              label={t`Materials with no storage unit`}
            />
          ),
          meta: {
            mobile: "P2",
            icon: <LuSquareStack />,
            exportValue: (row) => row.materials.join(", ")
          }
        }
      ],
      [t]
    );

    return (
      <Table<JobMissingStorageUnit>
        data={data}
        columns={columns}
        count={count}
        title={t`Jobs`}
        table="strictBackflushJobs"
        withSearch
        withPagination
      />
    );
  }
);
JobsMissingStorageUnitTable.displayName = "JobsMissingStorageUnitTable";
