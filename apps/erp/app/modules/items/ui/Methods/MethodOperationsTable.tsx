// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo } from "react";
import { Hyperlink, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { operationTypes } from "~/modules/shared";
import { useParts, useTools } from "~/stores";
import type { MethodOperation } from "../../types";
import { getPathToMakeMethod } from "./utils";

type MethodOperationsTableProps = {
  data: MethodOperation[];
  count: number;
};

const MethodOperationsTable = memo(
  ({ data, count }: MethodOperationsTableProps) => {
    const { t } = useLingui();
    const parts = useParts();
    const tools = useTools();

    const items = useMemo(() => [...parts, ...tools], [parts, tools]);

    const columns = useMemo<ColumnDef<MethodOperation>[]>(() => {
      return [
        {
          accessorKey: "description",
          header: t`Description`,
          cell: ({ row }) => (
            <Hyperlink
              to={getPathToMakeMethod(
                // @ts-ignore
                row.original.makeMethod?.item?.type,
                // @ts-ignore
                row.original.makeMethod?.item?.id,
                // @ts-ignore
                row.original.makeMethod?.id
              )}
              className="max-w-[260px] truncate"
            >
              {row.original.description}
            </Hyperlink>
          )
        },
        {
          accessorKey: "makeMethod.item.readableIdWithRevision",
          header: t`Item ID`,
          cell: ({ row }) => {
            // @ts-ignore
            return row.original.makeMethod?.item?.readableIdWithRevision;
          },
          meta: {
            filter: {
              type: "static",
              options: items?.map((item) => ({
                value: item.readableIdWithRevision,
                label: item.readableIdWithRevision
              }))
            }
          }
        },
        {
          accessorKey: "operationType",
          header: t`Operation Type`,
          cell: (item) => (
            <Enumerable value={item.getValue<string>() ?? null} />
          ),
          meta: {
            filter: {
              type: "static",
              options: operationTypes.map((value) => ({
                value,
                label: <Enumerable value={value ?? null} />
              }))
            }
          }
        },
        {
          accessorKey: "setupTime",
          header: t`Setup Time`,
          cell: ({ row }) => {
            return `${row.original.setupTime} ${row.original.setupUnit}`;
          }
        },
        {
          accessorKey: "laborTime",
          header: t`Labor Time`,
          cell: ({ row }) => {
            return `${row.original.laborTime} ${row.original.laborUnit}`;
          }
        },
        {
          accessorKey: "machineTime",
          header: t`Machine Time`,
          cell: ({ row }) => {
            return `${row.original.machineTime} ${row.original.machineUnit}`;
          }
        }
      ];
    }, [items, t]);

    return (
      <Table<MethodOperation>
        count={count}
        columns={columns}
        data={data}
        title={t`Method Operations`}
      />
    );
  }
);

MethodOperationsTable.displayName = "MethodOperationsTable";

export default MethodOperationsTable;
