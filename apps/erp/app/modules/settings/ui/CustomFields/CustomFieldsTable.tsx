// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  HStack,
  MENU_ITEM_SHORTCUTS,
  MenuIcon,
  MenuItem
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import { BiAddToQueue } from "react-icons/bi";
import { BsListUl } from "react-icons/bs";
import { LuDatabase, LuLayoutGrid, LuList, LuTags } from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions, useUrlParams } from "~/hooks";
import type { CustomFieldsTableType } from "~/modules/settings";
import { modulesType } from "~/modules/settings";
import { tablesWithTags } from "~/modules/shared";
import { path } from "~/utils/path";

type CustomFieldsTableProps = {
  data: CustomFieldsTableType[];
  count: number;
};

const CustomFieldsTable = memo(({ data, count }: CustomFieldsTableProps) => {
  const { t } = useLingui();
  const navigate = useNavigate();
  const [params] = useUrlParams();
  const permissions = usePermissions();

  const columns = useMemo<ColumnDef<CustomFieldsTableType>[]>(() => {
    return [
      {
        accessorKey: "name",
        header: t`Table`,
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <Hyperlink to={row.original.table!}>{row.original.name}</Hyperlink>
            {tablesWithTags.includes(row.original.table!) && (
              <LuTags className="text-emerald-500" />
            )}
          </div>
        ),
        meta: {
          mobile: "P1",
          icon: <LuDatabase />
        }
      },
      {
        accessorKey: "module",
        header: t`Module`,
        cell: ({ row }) => <Enumerable value={row.original.module} />,
        meta: {
          mobile: "P2",
          icon: <LuLayoutGrid />,
          filter: {
            type: "static",
            options: modulesType.map((m) => ({
              label: <Enumerable value={m} />,
              value: m
            }))
          }
        }
      },
      {
        header: t`Fields`,
        meta: { mobile: "P2" },
        cell: ({ row }) => (
          <HStack className="text-xs text-muted-foreground">
            <LuList />
            <span>
              {Array.isArray(row.original.fields)
                ? (row.original.fields?.length ?? 0)
                : 0}{" "}
              Fields
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                navigate(
                  `${path.to.customFieldList(
                    row.original.table!
                  )}?${params?.toString()}`
                );
              }}
            >
              <Trans>Edit</Trans>
            </Button>
          </HStack>
        )
      }
    ];
  }, [navigate, params, t]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const renderContextMenu = useCallback(
    (row: (typeof data)[number]) => {
      return (
        <>
          <MenuItem
            onClick={() => {
              navigate(
                `${path.to.newCustomField(row.table!)}?${params?.toString()}`
              );
            }}
          >
            <MenuIcon icon={<BiAddToQueue />} />
            <Trans>New Field</Trans>
          </MenuItem>
          <MenuItem
            shortcut={MENU_ITEM_SHORTCUTS.view}
            onClick={() => {
              navigate(
                `${path.to.customFieldList(row.table!)}?${params?.toString()}`
              );
            }}
          >
            <MenuIcon icon={<BsListUl />} />
            <Trans>View Custom Fields</Trans>
          </MenuItem>
        </>
      );
    },

    [navigate, params, permissions]
  );

  return (
    <>
      <Table<CustomFieldsTableType>
        data={data}
        columns={columns}
        count={count ?? 0}
        title={t`Custom Fields`}
        renderContextMenu={renderContextMenu}
      />
    </>
  );
});

CustomFieldsTable.displayName = "CustomFieldsTable";
export default CustomFieldsTable;
