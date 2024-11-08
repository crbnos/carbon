import { MenuIcon, MenuItem } from "@carbon/react";
import { useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuBuilding2,
  LuClock,
  LuGlobe,
  LuHome,
  LuMap,
  LuMapPin,
  LuPencil,
  LuTrash,
  LuUser,
} from "react-icons/lu";
import { EmployeeAvatar, New, Table } from "~/components";
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
  const navigate = useNavigate();
  const permissions = usePermissions();
  const [params] = useUrlParams();
  const [people] = usePeople();

  const rows = data.map((row) => ({
    ...row,
  }));

  const customColumns = useCustomColumns<ShiftLocation>("location");
  const columns = useMemo<ColumnDef<(typeof rows)[number]>[]>(() => {
    const defaultColumns: ColumnDef<(typeof rows)[number]>[] = [
      {
        accessorKey: "name",
        header: "Location",
        cell: ({ row }) => (
          <Enumerable
            value={row.original.name}
            onClick={() => navigate(row.original.id)}
            className="cursor-pointer"
          />
        ),
        meta: {
          icon: <LuMapPin />,
        },
      },
      {
        accessorKey: "addressLine1",
        header: "Address",
        cell: (item) => item.getValue(),
        meta: {
          icon: <LuHome />,
        },
      },
      {
        accessorKey: "city",
        header: "City",
        cell: (item) => item.getValue(),
        meta: {
          icon: <LuBuilding2 />,
        },
      },
      {
        accessorKey: "stateProvince",
        header: "State / Province",
        cell: (item) => item.getValue(),
        meta: {
          icon: <LuMap />,
        },
      },
      {
        accessorKey: "countryCode",
        header: "Country",
        cell: (item) => item.getValue(),
        meta: {
          icon: <LuGlobe />,
        },
      },
      // {
      //   accessorKey: "timezone",
      //   header: "Timezone",
      //   cell: (item) => item.getValue(),
      // },
      {
        id: "createdBy",
        header: "Created By",
        cell: ({ row }) => (
          <EmployeeAvatar employeeId={row.original.createdBy} />
        ),
        meta: {
          icon: <LuUser />,
          filter: {
            type: "static",
            options: people.map((employee) => ({
              value: employee.id,
              label: employee.name,
            })),
          },
        },
      },
      {
        id: "updatedBy",
        header: "Updated By",
        cell: ({ row }) => (
          <EmployeeAvatar employeeId={row.original.updatedBy} />
        ),
        meta: {
          icon: <LuClock />,
          filter: {
            type: "static",
            options: people.map((employee) => ({
              value: employee.id,
              label: employee.name,
            })),
          },
        },
      },
    ];
    return [...defaultColumns, ...customColumns];
  }, [people, customColumns, navigate]);

  const renderContextMenu = useCallback(
    (row: (typeof data)[number]) => {
      return (
        <>
          <MenuItem
            onClick={() => {
              navigate(`${path.to.location(row.id)}?${params.toString()}`);
            }}
          >
            <MenuIcon icon={<LuPencil />} />
            Edit Location
          </MenuItem>
          <MenuItem
            disabled={!permissions.can("delete", "resources")}
            onClick={() => {
              navigate(
                `${path.to.deleteLocation(row.id)}?${params.toString()}`
              );
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            Delete Location
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
          <New label="Location" to={`new?${params.toString()}`} />
        )
      }
      renderContextMenu={renderContextMenu}
    />
  );
});

LocationsTable.displayName = "LocationsTable";
export default LocationsTable;
