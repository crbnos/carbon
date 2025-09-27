import {
  Badge,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  MenuIcon,
  MenuItem,
  useDisclosure,
} from "@carbon/react";
import { useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo, useState } from "react";
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

import { flushSync } from "react-dom";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import type { QualityDocument } from "../../types";
import QualityDocumentStatus from "./QualityDocumentStatus";

type QualityDocumentsTableProps = {
  data: QualityDocument[];
  count: number;
};

const QualityDocumentsTable = memo(
  ({ data, count }: QualityDocumentsTableProps) => {
    const navigate = useNavigate();
    const permissions = usePermissions();

    const deleteDisclosure = useDisclosure();
    const [selectedQualityDocument, setSelectedQualityDocument] =
      useState<QualityDocument | null>(null);

    const columns = useMemo<ColumnDef<QualityDocument>[]>(() => {
      const defaultColumns: ColumnDef<QualityDocument>[] = [
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
          accessorKey: "status",
          header: "Status",
          cell: ({ row }) => (
            <QualityDocumentStatus status={row.original.status} />
          ),
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
                            <QualityDocumentStatus status={version.status} />
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
    }, []);

    const renderContextMenu = useCallback(
      (row: QualityDocument) => {
        return (
          <>
            <MenuItem
              disabled={!permissions.can("update", "quality")}
              onClick={() => {
                navigate(`${path.to.procedure(row.id!)}`);
              }}
            >
              <MenuIcon icon={<LuPencil />} />
              Edit Document
            </MenuItem>
            <MenuItem
              destructive
              disabled={!permissions.can("delete", "quality")}
              onClick={() => {
                flushSync(() => {
                  setSelectedQualityDocument(row);
                });
                deleteDisclosure.onOpen();
              }}
            >
              <MenuIcon icon={<LuTrash />} />
              Delete Document
            </MenuItem>
          </>
        );
      },
      [navigate, permissions, deleteDisclosure]
    );

    return (
      <>
        <Table<QualityDocument>
          data={data}
          columns={columns}
          count={count}
          primaryAction={
            permissions.can("create", "quality") && (
              <New label="Document" to={path.to.newQualityDocument} />
            )
          }
          renderContextMenu={renderContextMenu}
          title="Quality Documents"
          table="qualityDocument"
          withSavedView
        />
        {deleteDisclosure.isOpen && selectedQualityDocument && (
          <ConfirmDelete
            action={path.to.deleteQualityDocument(selectedQualityDocument.id!)}
            isOpen
            onCancel={() => {
              setSelectedQualityDocument(null);
              deleteDisclosure.onClose();
            }}
            onSubmit={() => {
              setSelectedQualityDocument(null);
              deleteDisclosure.onClose();
            }}
            name={selectedQualityDocument.name ?? "quality document"}
            text="Are you sure you want to delete this quality document?"
          />
        )}
      </>
    );
  }
);

QualityDocumentsTable.displayName = "QualityDocumentsTable";
export default QualityDocumentsTable;
