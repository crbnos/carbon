import { MenuIcon, MenuItem, useDisclosure } from "@carbon/react";
import { useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo, useState } from "react";
import { LuBookMarked, LuPencil, LuTrash } from "react-icons/lu";
import { Hyperlink, New, Table } from "~/components";

import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { flushSync } from "react-dom";
import { ConfirmDelete } from "~/components/Modals";
import type { NonConformanceTemplate } from "../../types";

type NonConformanceTemplatesTableProps = {
  data: NonConformanceTemplate[];
  count: number;
};

const NonConformanceTemplatesTable = memo(
  ({ data, count }: NonConformanceTemplatesTableProps) => {
    const navigate = useNavigate();
    const permissions = usePermissions();
    const deleteDisclosure = useDisclosure();
    const [selectedNonConformanceTemplate, setSelectedNonConformanceTemplate] =
      useState<NonConformanceTemplate | null>(null);

    const columns = useMemo<ColumnDef<NonConformanceTemplate>[]>(() => {
      const defaultColumns: ColumnDef<NonConformanceTemplate>[] = [
        {
          accessorKey: "name",
          header: "Name",
          cell: ({ row }) => (
            <div className="flex flex-col gap-0">
              <Hyperlink to={path.to.nonConformanceTemplate(row.original.id!)}>
                {row.original.name}
              </Hyperlink>
            </div>
          ),
          meta: {
            icon: <LuBookMarked />,
          },
        },
      ];
      return [...defaultColumns];
    }, []);

    const renderContextMenu = useCallback(
      (row: NonConformanceTemplate) => {
        return (
          <>
            <MenuItem
              disabled={!permissions.can("update", "quality")}
              onClick={() => {
                navigate(`${path.to.nonConformanceTemplate(row.id!)}`);
              }}
            >
              <MenuIcon icon={<LuPencil />} />
              Edit Template
            </MenuItem>
            <MenuItem
              destructive
              disabled={!permissions.can("delete", "quality")}
              onClick={() => {
                flushSync(() => {
                  setSelectedNonConformanceTemplate(row);
                });
                deleteDisclosure.onOpen();
              }}
            >
              <MenuIcon icon={<LuTrash />} />
              Delete Template
            </MenuItem>
          </>
        );
      },
      [navigate, permissions, deleteDisclosure]
    );

    return (
      <>
        <Table<NonConformanceTemplate>
          data={data}
          columns={columns}
          count={count}
          primaryAction={
            permissions.can("create", "quality") && (
              <New
                label="Non-Conformance Template"
                to={path.to.newNonConformanceTemplate}
              />
            )
          }
          renderContextMenu={renderContextMenu}
          title="Non-Conformance Templates"
          table="nonConformanceTemplate"
          withSavedView
        />
        {deleteDisclosure.isOpen && selectedNonConformanceTemplate && (
          <ConfirmDelete
            action={path.to.deleteNonConformanceTemplate(
              selectedNonConformanceTemplate.id!
            )}
            isOpen
            onCancel={() => {
              setSelectedNonConformanceTemplate(null);
              deleteDisclosure.onClose();
            }}
            onSubmit={() => {
              setSelectedNonConformanceTemplate(null);
              deleteDisclosure.onClose();
            }}
            name={
              selectedNonConformanceTemplate.name ?? "non-conformance template"
            }
            text="Are you sure you want to delete this non-conformance template?"
          />
        )}
      </>
    );
  }
);

NonConformanceTemplatesTable.displayName = "NonConformanceTemplatesTable";
export default NonConformanceTemplatesTable;
