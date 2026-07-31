import { VStack } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo } from "react";
import {
  LuComponent,
  LuMessageSquareWarning,
  LuSignal,
  LuTag
} from "react-icons/lu";
import { Table } from "~/components";
import { OnshapeStatus } from "~/components/Icons";
import type { OnshapeReleaseException } from "../../types";

type OnshapeSyncReleaseExceptionsTableProps = {
  data: OnshapeReleaseException[];
  unmatchedOverflow: number;
  ambiguousOverflow: number;
};

/**
 * The released Onshape revisions the latest sync could not attribute to exactly
 * one part. Both reasons live in one table so the whole gap between what Onshape
 * released and what Carbon holds reads in one place.
 */
const OnshapeSyncReleaseExceptionsTable = memo(
  ({
    data,
    unmatchedOverflow,
    ambiguousOverflow
  }: OnshapeSyncReleaseExceptionsTableProps) => {
    const { t } = useLingui();

    const reasonLabels: Record<OnshapeReleaseException["reason"], string> =
      useMemo(
        () => ({
          unmatched: t`No matching part`,
          ambiguous: t`Matches more than one part`
        }),
        [t]
      );

    const columns = useMemo<ColumnDef<OnshapeReleaseException>[]>(() => {
      return [
        {
          accessorKey: "partNumber",
          header: t`Part number`,
          cell: ({ row }) =>
            row.original.partNumber ?? (
              <span className="text-muted-foreground">—</span>
            ),
          meta: {
            icon: <LuComponent />
          }
        },
        {
          accessorKey: "revision",
          header: t`Revision`,
          cell: ({ row }) =>
            row.original.revision ?? (
              <span className="text-muted-foreground">—</span>
            ),
          meta: {
            icon: <LuTag />
          }
        },
        {
          accessorKey: "state",
          header: t`Release state`,
          cell: ({ row }) =>
            row.original.state ? (
              <OnshapeStatus status={row.original.state} />
            ) : (
              <span className="text-muted-foreground">—</span>
            ),
          meta: {
            icon: <LuSignal />
          }
        },
        {
          accessorKey: "reason",
          header: t`Reason`,
          cell: ({ row }) => reasonLabels[row.original.reason],
          meta: {
            icon: <LuMessageSquareWarning />,
            exportValue: (row) => reasonLabels[row.reason]
          }
        }
      ];
    }, [reasonLabels, t]);

    return (
      <VStack spacing={0} className="h-full">
        <div className="flex-1 min-h-0 w-full">
          <Table<OnshapeReleaseException>
            data={data}
            columns={columns}
            count={data.length}
            emptyState={
              <span className="text-sm text-muted-foreground">
                <Trans>
                  Every released revision in the latest sync matched exactly one
                  part
                </Trans>
              </span>
            }
            title={t`Release exceptions`}
            withPagination={false}
            withSearch={false}
          />
        </div>
        {/* The run stores a capped list, so the counts are the honest remainder. */}
        {(unmatchedOverflow > 0 || ambiguousOverflow > 0) && (
          <VStack spacing={0} className="px-4 py-3 md:px-6">
            {unmatchedOverflow > 0 && (
              <span className="text-xs text-muted-foreground">
                {t`and ${unmatchedOverflow} more with no matching part`}
              </span>
            )}
            {ambiguousOverflow > 0 && (
              <span className="text-xs text-muted-foreground">
                {t`and ${ambiguousOverflow} more matching more than one part`}
              </span>
            )}
          </VStack>
        )}
      </VStack>
    );
  }
);

OnshapeSyncReleaseExceptionsTable.displayName =
  "OnshapeSyncReleaseExceptionsTable";
export default OnshapeSyncReleaseExceptionsTable;
