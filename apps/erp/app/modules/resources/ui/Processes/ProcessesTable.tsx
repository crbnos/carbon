import {
  Avatar,
  AvatarGroup,
  AvatarGroupList,
  AvatarOverflowIndicator,
  Badge,
  Checkbox,
  HStack,
  MenuIcon,
  MenuItem,
} from "@carbon/react";
import { useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuBuilding2,
  LuCog,
  LuFactory,
  LuPencil,
  LuQrCode,
  LuRuler,
  LuTrash,
  LuTriangleAlert,
  LuUser,
  LuUsers,
} from "react-icons/lu";
import { EmployeeAvatar, Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useWorkCenters } from "~/components/Form/WorkCenter";
import { usePermissions, useUrlParams } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import { type Process } from "~/modules/resources";
import { standardFactorType } from "~/modules/shared";
import { usePeople } from "~/stores";
import { path } from "~/utils/path";

type ProcessesTableProps = {
  data: Process[];
  count: number;
};

const defaultColumnVisibility = {
  createdAt: false,
  createdBy: false,
  updatedAt: false,
  updatedBy: false,
};

const ProcessesTable = memo(({ data, count }: ProcessesTableProps) => {
  const navigate = useNavigate();
  const permissions = usePermissions();
  const [params] = useUrlParams();
  const [people] = usePeople();
  const { options: workCenters } = useWorkCenters({});

  const customColumns = useCustomColumns<Process>("process");
  const columns = useMemo<ColumnDef<Process>[]>(() => {
    const defaultColumns: ColumnDef<Process>[] = [
      {
        accessorKey: "name",
        header: "Process",
        cell: ({ row }) =>
          row.original.processType === "Outside" ||
          ((row.original.workCenters as any[]) ?? []).length > 0 ? (
            <Hyperlink to={row.original.id!}>
              <Enumerable
                value={row.original.name}
                className="cursor-pointer"
              />
            </Hyperlink>
          ) : (
            <Hyperlink to={row.original.id!}>
              <HStack spacing={2}>
                <LuTriangleAlert />
                <span>{row.original.name}</span>
              </HStack>
            </Hyperlink>
          ),
        meta: {
          icon: <LuCog />,
        },
      },
      {
        accessorKey: "processType",
        header: "Process Type",
        cell: (item) =>
          item.getValue() === "Outside" ? (
            <Badge>Outside</Badge>
          ) : (
            <Badge variant="secondary">{item.getValue<string>()}</Badge>
          ),
        meta: {
          icon: <LuFactory />,
        },
      },
      {
        id: "workCenters",
        header: "Work Centers",
        cell: ({ row }) => (
          <span className="flex gap-2 items-center flex-wrap py-2">
            {((row.original.workCenters ?? []) as Array<string>).map((wc) => {
              const workCenter = workCenters.find((w) => w.value === wc);
              return (
                <Enumerable
                  key={workCenter?.label}
                  onClick={() =>
                    navigate(path.to.workCenter(workCenter?.value!))
                  }
                  className="cursor-pointer"
                  value={workCenter?.label ?? null}
                />
              );
            })}
          </span>
        ),
        meta: {
          icon: <LuBuilding2 />,
          filter: {
            type: "static",
            options: workCenters.map((w) => ({
              value: w.value,
              label: <Enumerable value={w.label} />,
            })),
            isArray: true,
          },
        },
      },
      {
        accessorKey: "defaultStandardFactor",
        header: "Default Unit",
        cell: (item) => item.getValue(),
        meta: {
          icon: <LuRuler />,
          filter: {
            type: "static",
            options: standardFactorType.map((type) => ({
              value: type,
              label: type,
            })),
          },
        },
      },
      {
        id: "suppliers",
        header: "Suppliers",
        cell: ({ row }) => (
          <AvatarGroup limit={5}>
            <AvatarGroupList>
              {((row.original.suppliers ?? []) as Array<{ name: string }>).map(
                (s) => (
                  <Avatar key={s.name} name={s.name} />
                )
              )}
            </AvatarGroupList>
            <AvatarOverflowIndicator />
          </AvatarGroup>
        ),
        meta: {
          icon: <LuUsers />,
        },
      },
      {
        accessorKey: "completeAllOnScan",
        header: "Complete All",
        cell: ({ row }) => (
          <div className="flex w-full items-center justify-center">
            <Checkbox isChecked={row.original.completeAllOnScan ?? false} />
          </div>
        ),
        meta: {
          icon: <LuQrCode />,
          filter: {
            type: "static",
            options: [
              { value: "true", label: "Yes" },
              { value: "false", label: "No" },
            ],
          },
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
  }, [workCenters, people, customColumns, navigate]);

  const renderContextMenu = useCallback(
    (row: (typeof data)[number]) => {
      return (
        <>
          <MenuItem
            onClick={() => {
              navigate(`${path.to.process(row.id!)}?${params.toString()}`);
            }}
          >
            <MenuIcon icon={<LuPencil />} />
            Edit Process
          </MenuItem>
          <MenuItem
            destructive
            disabled={!permissions.can("delete", "resources")}
            onClick={() => {
              navigate(
                `${path.to.deleteProcess(row.id!)}?${params.toString()}`
              );
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            Delete Process
          </MenuItem>
        </>
      );
    },
    [navigate, params, permissions]
  );

  return (
    <Table<Process>
      data={data}
      count={count}
      columns={columns}
      defaultColumnVisibility={defaultColumnVisibility}
      primaryAction={
        permissions.can("create", "resources") && (
          <New label="Process" to={`new?${params.toString()}`} />
        )
      }
      renderContextMenu={renderContextMenu}
      title="Processes"
      table="process"
      withSavedView
    />
  );
});

ProcessesTable.displayName = "ProcessesTable";
export default ProcessesTable;
