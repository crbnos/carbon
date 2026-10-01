// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { MenuIcon, MenuItem } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuArrowRight,
  LuHash,
  LuMaximize,
  LuPencil,
  LuStepForward,
  LuText,
  LuTextCursor
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, Table } from "~/components";
import { usePermissions, useUrlParams } from "~/hooks";
import type { Sequence } from "~/modules/settings";
import { path } from "~/utils/path";

type SequencesTableProps = {
  data: Sequence[];
  count: number;
};

const SequencesTable = memo(({ data, count }: SequencesTableProps) => {
  const { t } = useLingui();
  const [params] = useUrlParams();
  const navigate = useNavigate();
  const permissions = usePermissions();

  const columns = useMemo<ColumnDef<(typeof data)[number]>[]>(() => {
    return [
      {
        accessorKey: "name",
        header: t`Name`,
        cell: ({ row }) => (
          <Hyperlink to={row.original.table}>{row.original.name}</Hyperlink>
        ),
        meta: {
          icon: <LuText />
        }
      },
      {
        accessorKey: "prefix",
        header: t`Prefix`,
        cell: (item) => item.getValue(),
        meta: {
          icon: <LuTextCursor />
        }
      },
      {
        accessorKey: "next",
        header: t`Current`,
        cell: (item) => item.getValue(),
        meta: {
          icon: <LuArrowRight />
        }
      },
      {
        accessorKey: "size",
        header: t`Size`,
        cell: (item) => item.getValue(),
        meta: {
          icon: <LuMaximize />
        }
      },
      {
        accessorKey: "step",
        header: t`Step`,
        cell: (item) => item.getValue(),
        meta: {
          icon: <LuStepForward />
        }
      },
      {
        accessorKey: "suffix",
        header: t`Suffix`,
        cell: (item) => item.getValue(),
        meta: {
          icon: <LuHash />
        }
      }
    ];
  }, [t]);

  const renderContextMenu = useCallback(
    (row: (typeof data)[number]) => {
      return (
        <>
          <MenuItem
            disabled={!permissions.can("update", "settings")}
            onClick={() => {
              navigate(
                `${path.to.tableSequence(row.table)}?${params.toString()}`
              );
            }}
          >
            <MenuIcon icon={<LuPencil />} />
            <Trans>Edit Sequence</Trans>
          </MenuItem>
        </>
      );
    },
    [navigate, params, permissions]
  );

  return (
    <Table<(typeof data)[number]>
      data={data}
      columns={columns}
      count={count}
      renderContextMenu={renderContextMenu}
      title={t`Sequences`}
    />
  );
});

SequencesTable.displayName = "SequencesTable";
export default SequencesTable;
