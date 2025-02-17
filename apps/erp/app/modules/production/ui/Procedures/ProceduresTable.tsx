import {
  Badge,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  MenuIcon,
  MenuItem,
} from "@carbon/react";
import { useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuBookMarked,
  LuCalendar,
  LuEllipsisVertical,
  LuGitPullRequest,
  LuPencil,
  LuTrash,
  LuUser,
} from "react-icons/lu";
import { EmployeeAvatar, Hyperlink, New, Table } from "~/components";

import { usePermissions, useUrlParams } from "~/hooks";
import { path } from "~/utils/path";
import { Procedures } from "../../types";
import ProcedureStatus from "./ProcedureStatus";
import { Enumerable } from "~/components/Enumerable";
import { TbRoute } from "react-icons/tb";
import { useProcesses } from "~/components/Form/Process";

type ProceduresTableProps = {
  data: Procedures[];
  count: number;
};

const ProceduresTable = memo(({ data, count }: ProceduresTableProps) => {
  const [params] = useUrlParams();
  const navigate = useNavigate();
  const permissions = usePermissions();
  const processes = useProcesses();

  const columns = useMemo<ColumnDef<Procedures>[]>(() => {
    const defaultColumns: ColumnDef<Procedures>[] = [
      {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => (
          <div className="flex flex-col gap-0">
            <Hyperlink to={path.to.procedure(row.original.id!)}>
              {row.original.name}
            </Hyperlink>
            <span className="text-sm text-muted-foreground">
              Version {row.original.version}
            </span>
          </div>
        ),
        meta: {
          icon: <LuBookMarked />,
        },
      },
      {
        accessorKey: "processId",
        header: "Process",
        cell: ({ row }) => (
          <Enumerable
            value={
              processes.find((p) => p.value === row.original.processId)
                ?.label ?? null
            }
          />
        ),
        meta: {
          icon: <TbRoute />,
          filter: {
            type: "static",
            options: processes,
          },
        },
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => <ProcedureStatus status={row.original.status} />,
        meta: {
          icon: <LuCalendar />,
        },
      },
      {
        accessorKey: "assignee",
        header: "Assignee",
        cell: ({ row }) => (
          <EmployeeAvatar employeeId={row.original.assignee} />
        ),
        meta: {
          icon: <LuUser />,
        },
      },
      {
        id: "versions",
        header: "Versions",
        cell: ({ row }) => {
          const versions = row.original?.versions as Array<{
            id: string;
            version: number;
            status: "Draft" | "Active" | "Archived";
          }>;

          return (
            <HoverCard>
              <HoverCardTrigger>
                <Badge variant="secondary" className="cursor-pointer">
                  {versions?.length ?? 0} Version
                  {versions?.length === 1 ? "" : "s"}
                  <LuEllipsisVertical className="w-3 h-3 ml-2" />
                </Badge>
              </HoverCardTrigger>
              <HoverCardContent>
                <div className="flex flex-col w-full gap-4 text-sm">
                  {(versions ?? [])
                    .sort((a, b) => a.version - b.version)
                    .map((version) => (
                      <div
                        key={version.id}
                        className="flex items-center justify-between gap-2"
                      >
                        <Hyperlink
                          to={path.to.procedure(version.id)}
                          className="flex items-center justify-start gap-1"
                        >
                          Version {version.version}
                        </Hyperlink>
                        <div className="flex items-center justify-end">
                          <ProcedureStatus status={version.status} />
                        </div>
                      </div>
                    ))}
                </div>
              </HoverCardContent>
            </HoverCard>
          );
        },
        meta: {
          icon: <LuGitPullRequest />,
        },
      },
    ];
    return [...defaultColumns];
  }, [processes]);

  const renderContextMenu = useCallback(
    (row: Procedures) => {
      return (
        <>
          <MenuItem
            disabled={!permissions.can("update", "production")}
            onClick={() => {
              navigate(`${path.to.procedure(row.id!)}`);
            }}
          >
            <MenuIcon icon={<LuPencil />} />
            Edit Procedure
          </MenuItem>
          <MenuItem
            disabled={!permissions.can("delete", "production")}
            onClick={() => {
              navigate(
                `${path.to.deleteProcedure(row.id!)}?${params.toString()}`
              );
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            Delete Procedure
          </MenuItem>
        </>
      );
    },
    [navigate, params, permissions]
  );

  return (
    <Table<Procedures>
      data={data}
      columns={columns}
      count={count}
      primaryAction={
        permissions.can("create", "production") && (
          <New label="Procedure" to={path.to.newProcedure} />
        )
      }
      renderContextMenu={renderContextMenu}
      title="Procedures"
      table="procedure"
      withSavedView
    />
  );
});

ProceduresTable.displayName = "ProceduresTable";
export default ProceduresTable;
