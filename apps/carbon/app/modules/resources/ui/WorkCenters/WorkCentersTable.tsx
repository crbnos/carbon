import { HStack, MenuIcon, MenuItem, useDisclosure } from "@carbon/react";
import { useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo, useState } from "react";
import {
  LuAlertTriangle,
  LuAlignLeft,
  LuBuilding2,
  LuCheckCircle,
  LuCog,
  LuDollarSign,
  LuPencil,
  LuTrash,
  LuUser,
  LuWrench,
} from "react-icons/lu";
import { EmployeeAvatar, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { ConfirmDelete } from "~/components/Modals";
import { useCurrencyFormatter, usePermissions, useUrlParams } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import type { WorkCenter } from "~/modules/resources";
import { usePeople } from "~/stores";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";

type WorkCentersTableProps = {
  data: WorkCenter[];
  count: number;
  locations: ListItem[];
};

const defaultColumnVisibility = {
  description: false,
  createdAt: false,
  createdBy: false,
  updatedAt: false,
  updatedBy: false,
};

const WorkCentersTable = memo(
  ({ data, count, locations }: WorkCentersTableProps) => {
    const navigate = useNavigate();
    const [params] = useUrlParams();
    const [people] = usePeople();

    const permissions = usePermissions();
    const deleteModal = useDisclosure();
    const [selectedWorkCenter, setSelectedWorkCenter] =
      useState<WorkCenter | null>(null);

    const formatter = useCurrencyFormatter();

    const onDelete = (data: WorkCenter) => {
      setSelectedWorkCenter(data);
      deleteModal.onOpen();
    };

    const onDeleteCancel = () => {
      setSelectedWorkCenter(null);
      deleteModal.onClose();
    };

    const customColumns = useCustomColumns<WorkCenter>("workCenter");
    const columns = useMemo<ColumnDef<WorkCenter>[]>(() => {
      const defaultColumns: ColumnDef<WorkCenter>[] = [
        {
          accessorKey: "name",
          header: "Work Center",
          cell: ({ row }) => (
            <HStack>
              {((row.original.processes as any[]) ?? []).length > 0 ? (
                <Enumerable
                  value={row.original.name}
                  onClick={() => navigate(row.original.id!)}
                  className="cursor-pointer"
                />
              ) : (
                <HStack onClick={() => navigate(row.original.id!)} spacing={2}>
                  <LuAlertTriangle />
                  <span>{row.original.name}</span>
                </HStack>
              )}

              {row.original.requiredAbilityId && (
                <LuCheckCircle
                  className="text-emerald-500"
                  title="Requires ability"
                />
              )}
            </HStack>
          ),
          meta: {
            icon: <LuWrench />,
          },
        },
        {
          id: "processes",
          header: "Processes",
          cell: ({ row }) => (
            <span className="flex gap-2 items-center flex-wrap py-2">
              {((row.original.processes ?? []) as Array<ListItem>).map(
                (process) => (
                  <Enumerable
                    key={process.name}
                    value={process.name}
                    onClick={() => navigate(path.to.process(process.id))}
                    className="cursor-pointer"
                  />
                )
              )}
            </span>
          ),
          meta: {
            icon: <LuCog />,
          },
        },
        {
          accessorKey: "locationName",
          header: "Location",
          cell: (item) => <Enumerable value={item.getValue<string>()} />,
          meta: {
            icon: <LuBuilding2 />,
            filter: {
              type: "static",
              options: locations.map(({ name }) => ({
                value: name,
                label: <Enumerable value={name} />,
              })),
            },
          },
        },
        {
          accessorKey: "description",
          header: "Description",
          cell: ({ row }) => (
            <span className="max-w-[300px] line-clamp-1">
              {row.original.description}
            </span>
          ),
          meta: {
            icon: <LuAlignLeft />,
          },
        },
        {
          accessorKey: "laborRate",
          header: "Labor Rate",
          cell: ({ row }) => (
            <span>{formatter.format(row.original.laborRate ?? 0)}</span>
          ),
          meta: {
            icon: <LuDollarSign />,
          },
        },
        {
          accessorKey: "machineRate",
          header: "Machine Rate",
          cell: ({ row }) => (
            <span>{formatter.format(row.original.machineRate ?? 0)}</span>
          ),
          meta: {
            icon: <LuDollarSign />,
          },
        },
        {
          accessorKey: "overheadRate",
          header: "Overhead Rate",
          cell: ({ row }) => (
            <span>{formatter.format(row.original.overheadRate ?? 0)}</span>
          ),
          meta: {
            icon: <LuDollarSign />,
          },
        },
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
      ];
      return [...defaultColumns, ...customColumns];
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [params, customColumns]);

    const renderContextMenu = useCallback<(row: WorkCenter) => JSX.Element>(
      (row) => (
        <>
          <MenuItem
            onClick={() => {
              navigate(`${path.to.workCenter(row.id!)}?${params?.toString()}`);
            }}
          >
            <MenuIcon icon={<LuPencil />} />
            Edit Work Center
          </MenuItem>
          <MenuItem
            disabled={!permissions.can("delete", "resources")}
            onClick={() => onDelete(row)}
          >
            <MenuIcon icon={<LuTrash />} />
            Delete Work Center
          </MenuItem>
        </>
      ),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [navigate, params, permissions]
    );

    return (
      <>
        <Table<WorkCenter>
          data={data}
          defaultColumnVisibility={defaultColumnVisibility}
          columns={columns}
          count={count ?? 0}
          primaryAction={
            permissions.can("update", "resources") && (
              <New label="Work Center" to={`new?${params.toString()}`} />
            )
          }
          renderContextMenu={renderContextMenu}
        />

        {selectedWorkCenter && selectedWorkCenter.id && (
          <ConfirmDelete
            action={path.to.deleteWorkCenter(selectedWorkCenter.id)}
            name={selectedWorkCenter?.name ?? ""}
            text={`Are you sure you want to deactivate the ${selectedWorkCenter?.name} work center?`}
            isOpen={deleteModal.isOpen}
            onCancel={onDeleteCancel}
            onSubmit={onDeleteCancel}
          />
        )}
      </>
    );
  }
);

WorkCentersTable.displayName = "WorkCentersTable";
export default WorkCentersTable;
