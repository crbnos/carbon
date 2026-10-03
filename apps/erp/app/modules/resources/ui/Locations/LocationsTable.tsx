// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { MENU_ITEM_SHORTCUTS, MenuIcon, MenuItem } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuBuilding2,
  LuClock,
  LuGlobe,
  LuHouse,
  LuMap,
  LuMapPin,
  LuPencil,
  LuTrash,
  LuUser
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { EmployeeAvatar, Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions, useUrlParams } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import type { ShiftLocation } from "~/modules/resources";
import { usePeople } from "~/stores";
import { path } from "~/utils/path";

type LocationsTableProps = {
  data: ShiftLocation[];
  count: number;
};

const LocationsTable = memo(({ data, count }: LocationsTableProps) => {
  const { t } = useLingui();
  const navigate = useNavigate();
  const permissions = usePermissions();
  const [params] = useUrlParams();
  const [people] = usePeople();

  const rows = data.map((row) => ({
    ...row
  }));

  const customColumns = useCustomColumns<ShiftLocation>("location");
  const columns = useMemo<ColumnDef<(typeof rows)[number]>[]>(() => {
    const defaultColumns: ColumnDef<(typeof rows)[number]>[] = [
      {
        accessorKey: "name",
        header: t`Location`,
        cell: ({ row }) => (
          <Hyperlink to={row.original.id}>
            <Enumerable value={row.original.name} className="cursor-pointer" />
          </Hyperlink>
        ),
        meta: {
          icon: <LuMapPin />
        }
      },
      {
        accessorKey: "addressLine1",
        header: t`Address`,
        cell: (item) => item.getValue(),
        meta: {
          icon: <LuHouse />
        }
      },
      {
        accessorKey: "city",
        header: t`City`,
        cell: (item) => item.getValue(),
        meta: {
          icon: <LuBuilding2 />
        }
      },
      {
        accessorKey: "stateProvince",
        header: t`State / Province`,
        cell: (item) => item.getValue(),
        meta: {
          icon: <LuMap />
        }
      },
      {
        accessorKey: "countryCode",
        header: t`Country`,
        cell: (item) => item.getValue(),
        meta: {
          icon: <LuGlobe />
        }
      },
      // {
      //   accessorKey: "timezone",
      //   header: "Timezone",
      //   cell: (item) => item.getValue(),
      // },
      {
        id: "createdBy",
        header: t`Created By`,
        cell: ({ row }) => (
          <EmployeeAvatar employeeId={row.original.createdBy} />
        ),
        meta: {
          icon: <LuUser />,
          filter: {
            type: "static",
            options: people.map((employee) => ({
              value: employee.id,
              label: employee.name
            }))
          }
        }
      },
      {
        id: "updatedBy",
        header: t`Updated By`,
        cell: ({ row }) => (
          <EmployeeAvatar employeeId={row.original.updatedBy} />
        ),
        meta: {
          icon: <LuClock />,
          filter: {
            type: "static",
            options: people.map((employee) => ({
              value: employee.id,
              label: employee.name
            }))
          }
        }
      }
    ];
    return [...defaultColumns, ...customColumns];
  }, [people, customColumns, t]);

  const renderContextMenu = useCallback(
    (row: (typeof data)[number]) => {
      return (
        <>
          <MenuItem
            shortcut={MENU_ITEM_SHORTCUTS.edit}
            onClick={() => {
              navigate(`${path.to.location(row.id)}?${params.toString()}`);
            }}
          >
            <MenuIcon icon={<LuPencil />} />
            <Trans>Edit Location</Trans>
          </MenuItem>
          <MenuItem
            shortcut={MENU_ITEM_SHORTCUTS.delete}
            destructive
            disabled={!permissions.can("delete", "resources")}
            onClick={() => {
              navigate(
                `${path.to.deleteLocation(row.id)}?${params.toString()}`
              );
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            <Trans>Delete Location</Trans>
          </MenuItem>
        </>
      );
    },
    [navigate, params, permissions]
  );

  return (
    <Table<(typeof rows)[number]>
      data={rows}
      count={count}
      columns={columns}
      primaryAction={
        permissions.can("create", "resources") && (
          <New label={t`Location`} to={`new?${params.toString()}`} />
        )
      }
      renderContextMenu={renderContextMenu}
      title={t`Locations`}
      table="location"
      withSavedView
    />
  );
});

LocationsTable.displayName = "LocationsTable";
export default LocationsTable;
