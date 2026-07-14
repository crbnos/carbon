import { Badge, MenuIcon, MenuItem } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuCalendarDays,
  LuCalendarRange,
  LuClock,
  LuMapPin,
  LuPencil,
  LuTrash
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions, useUrlParams } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import type { ShiftLocation } from "~/modules/resources/types";
import { path } from "~/utils/path";
import type { Shift } from "../../types";

type ShiftsTableProps = {
  data: Shift[];
  count: number;
  locations: Partial<ShiftLocation>[];
};

const ShiftsTable = memo(({ data, count, locations }: ShiftsTableProps) => {
  const { t } = useLingui();
  const navigate = useNavigate();
  const permissions = usePermissions();
  const [params] = useUrlParams();

  const renderDays = useCallback((row: Shift) => {
    const days = [
      row.monday && "M",
      row.tuesday && "Tu",
      row.wednesday && "W",
      row.thursday && "Th",
      row.friday && "F",
      row.saturday && "Sa",
      row.sunday && "Su"
    ].filter(Boolean);

    return days.map((day) => (
      <Badge key={day as string} variant="outline" className="mr-0.5">
        {day}
      </Badge>
    ));
  }, []);

  const customColumns = useCustomColumns<Shift>("shift");

  const columns = useMemo<ColumnDef<Shift>[]>(() => {
    const defaultColumns: ColumnDef<Shift>[] = [
      {
        accessorKey: "name",
        header: t`Shift`,
        cell: ({ row }) => (
          <Hyperlink to={row.original.id!}>{row.original.name}</Hyperlink>
        ),
        meta: {
          icon: <LuCalendarRange />
        }
      },
      {
        accessorKey: "startTime",
        header: t`Start Time`,
        cell: (item) => item.getValue(),
        meta: {
          icon: <LuClock />
        }
      },
      {
        accessorKey: "endTime",
        header: t`End Time`,
        cell: (item) => item.getValue(),
        meta: {
          icon: <LuClock />
        }
      },
      {
        accessorKey: "locationName",
        header: t`Location`,
        cell: (item) => <Enumerable value={item.getValue<string>()} />,
        meta: {
          icon: <LuMapPin />,
          filter: {
            type: "static",
            options: locations.map((location) => ({
              value: location.name!,
              label: <Enumerable value={location.name!} />
            }))
          }
        }
      },
      {
        id: "days",
        header: t`Days`,
        // @ts-ignore
        cell: ({ row }) => renderDays(row.original),
        meta: {
          icon: <LuCalendarDays />,
          filterHeader: t`Days`,
          exportValue: (row) =>
            (
              [
                ["monday", "M"],
                ["tuesday", "Tu"],
                ["wednesday", "W"],
                ["thursday", "Th"],
                ["friday", "F"],
                ["saturday", "Sa"],
                ["sunday", "Su"]
              ] as const
            )
              .filter(([key]) => row[key])
              .map(([, label]) => label)
              .join(", ")
        }
      }
    ];

    return [...defaultColumns, ...customColumns];
  }, [locations, renderDays, customColumns, t]);

  const renderContextMenu = useCallback(
    (row: Shift) => {
      return (
        <>
          <MenuItem
            onClick={() => {
              navigate(`${path.to.shift(row.id!)}?${params.toString()}}`);
            }}
          >
            <MenuIcon icon={<LuPencil />} />
            <Trans>Edit Shift</Trans>
          </MenuItem>
          <MenuItem
            destructive
            disabled={!permissions.can("delete", "people")}
            onClick={() => {
              navigate(`${path.to.deleteShift(row.id!)}?${params.toString()}`);
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            <Trans>Delete Shift</Trans>
          </MenuItem>
        </>
      );
    },
    [navigate, params, permissions]
  );

  return (
    <Table<Shift>
      data={data}
      count={count}
      columns={columns}
      primaryAction={
        permissions.can("create", "people") && (
          <New label={t`Shift`} to={`new?${params.toString()}`} />
        )
      }
      renderContextMenu={renderContextMenu}
      title={t`Shifts`}
    />
  );
});

ShiftsTable.displayName = "ShiftsTable";
export default ShiftsTable;
