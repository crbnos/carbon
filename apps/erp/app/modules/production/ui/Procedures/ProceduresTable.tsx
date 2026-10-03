// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Badge,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  HStack,
  MENU_ITEM_SHORTCUTS,
  MenuIcon,
  MenuItem,
  useDisclosure
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import {
  LuBookMarked,
  LuCalendar,
  LuEllipsisVertical,
  LuGitPullRequest,
  LuPencil,
  LuTag,
  LuTrash,
  LuUser
} from "react-icons/lu";
import { TbRoute } from "react-icons/tb";
import { useNavigate } from "react-router";
import { EmployeeAvatar, Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useProcesses } from "~/components/Form/Process";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import type { Procedures } from "../../types";
import ProcedureStatus from "./ProcedureStatus";

type ProceduresTableProps = {
  data: Procedures[];
  tags: { name: string }[];
  count: number;
};

const ProceduresTable = memo(({ data, tags, count }: ProceduresTableProps) => {
  const navigate = useNavigate();
  const { t } = useLingui();
  const permissions = usePermissions();
  const processes = useProcesses();
  const deleteDisclosure = useDisclosure();
  const [selectedProcedure, setSelectedProcedure] = useState<Procedures | null>(
    null
  );

  const columns = useMemo<ColumnDef<Procedures>[]>(() => {
    const defaultColumns: ColumnDef<Procedures>[] = [
      {
        accessorKey: "name",
        header: t`Name`,
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
          icon: <LuBookMarked />
        }
      },
      {
        accessorKey: "processId",
        header: t`Process`,
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
            options: processes
          }
        }
      },
      {
        accessorKey: "status",
        header: t`Status`,
        cell: ({ row }) => <ProcedureStatus status={row.original.status} />,
        meta: {
          icon: <LuCalendar />
        }
      },
      {
        accessorKey: "assignee",
        header: t`Assignee`,
        cell: ({ row }) => (
          <EmployeeAvatar employeeId={row.original.assignee} />
        ),
        meta: {
          icon: <LuUser />
        }
      },
      {
        accessorKey: "tags",
        header: t`Tags`,
        cell: ({ row }) => (
          <HStack spacing={0} className="gap-1">
            {row.original.tags?.map((tag) => (
              <Badge key={tag} variant="secondary">
                {tag}
              </Badge>
            ))}
          </HStack>
        ),
        meta: {
          filter: {
            type: "static",
            options: tags?.map((tag) => ({
              value: tag.name,
              label: <Badge variant="secondary">{tag.name}</Badge>
            })),
            isArray: true
          },
          icon: <LuTag />
        }
      },
      {
        id: "versions",
        header: t`Versions`,
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
          icon: <LuGitPullRequest />
        }
      }
    ];
    return [...defaultColumns];
  }, [processes, tags, t]);

  const renderContextMenu = useCallback(
    (row: Procedures) => {
      return (
        <>
          <MenuItem
            shortcut={MENU_ITEM_SHORTCUTS.edit}
            disabled={!permissions.can("update", "production")}
            onClick={() => {
              navigate(`${path.to.procedure(row.id!)}`);
            }}
          >
            <MenuIcon icon={<LuPencil />} />
            Edit Procedure
          </MenuItem>
          <MenuItem
            shortcut={MENU_ITEM_SHORTCUTS.delete}
            destructive
            disabled={!permissions.can("delete", "production")}
            onClick={() => {
              flushSync(() => {
                setSelectedProcedure(row);
              });
              deleteDisclosure.onOpen();
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            Delete Procedure
          </MenuItem>
        </>
      );
    },
    [navigate, permissions, deleteDisclosure]
  );

  return (
    <>
      <Table<Procedures>
        data={data}
        columns={columns}
        count={count}
        primaryAction={
          permissions.can("create", "production") && (
            <New label={t`Procedure`} to={path.to.newProcedure} />
          )
        }
        renderContextMenu={renderContextMenu}
        title={t`Procedures`}
        table="procedure"
        withSavedView
      />
      {deleteDisclosure.isOpen && selectedProcedure && (
        <ConfirmDelete
          action={path.to.deleteProcedure(selectedProcedure.id!)}
          isOpen
          onCancel={() => {
            setSelectedProcedure(null);
            deleteDisclosure.onClose();
          }}
          onSubmit={() => {
            setSelectedProcedure(null);
            deleteDisclosure.onClose();
          }}
          name={selectedProcedure.name ?? "procedure"}
          text="Are you sure you want to delete this procedure?"
        />
      )}
    </>
  );
});

ProceduresTable.displayName = "ProceduresTable";
export default ProceduresTable;
