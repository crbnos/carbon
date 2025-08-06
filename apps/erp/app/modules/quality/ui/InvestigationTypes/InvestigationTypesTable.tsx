import { Checkbox, MenuIcon, MenuItem, useDisclosure } from "@carbon/react";
import { useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { LuFlaskConical, LuPencil, LuTrash } from "react-icons/lu";
import { Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions, useUrlParams } from "~/hooks";
import { path } from "~/utils/path";
import type { InvestigationType } from "../../types";

type InvestigationTypesTableProps = {
  data: InvestigationType[];
  count: number;
};

const InvestigationTypesTable = memo(
  ({ data, count }: InvestigationTypesTableProps) => {
    const [params] = useUrlParams();
    const navigate = useNavigate();
    const permissions = usePermissions();
    const deleteDisclosure = useDisclosure();
    const [selectedInvestigationType, setSelectedInvestigationType] =
      useState<InvestigationType | null>(null);

    const columns = useMemo<ColumnDef<InvestigationType>[]>(() => {
      const defaultColumns: ColumnDef<InvestigationType>[] = [
        {
          accessorKey: "name",
          header: "Investigation Type",
          cell: ({ row }) => (
            <Hyperlink to={row.original.id}>
              <Enumerable value={row.original.name} />
            </Hyperlink>
          ),
          meta: {
            icon: <LuFlaskConical />,
          },
        },
        {
          accessorKey: "active",
          header: "Active",
          cell: ({ row }) => <Checkbox checked={row.original.active} />,
        },
      ];
      return defaultColumns;
    }, []);

    const renderContextMenu = useCallback(
      (row: InvestigationType) => {
        return (
          <>
            <MenuItem
              onClick={() => {
                navigate(
                  `${path.to.investigationType(row.id)}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuPencil />} />
              Edit Type
            </MenuItem>
            <MenuItem
              destructive
              disabled={!permissions.can("delete", "quality")}
              onClick={() => {
                flushSync(() => {
                  setSelectedInvestigationType(row);
                });
                deleteDisclosure.onOpen();
              }}
            >
              <MenuIcon icon={<LuTrash />} />
              Delete Type
            </MenuItem>
          </>
        );
      },
      [navigate, params, permissions, deleteDisclosure]
    );

    return (
      <>
        <Table<InvestigationType>
          data={data}
          columns={columns}
          count={count}
          primaryAction={
            permissions.can("create", "quality") && (
              <New
                label="Investigation Type"
                to={`${path.to.newInvestigationType}?${params.toString()}`}
              />
            )
          }
          renderContextMenu={renderContextMenu}
          title="Investigation Types"
        />
        {deleteDisclosure.isOpen && selectedInvestigationType && (
          <ConfirmDelete
            action={path.to.deleteInvestigationType(
              selectedInvestigationType.id
            )}
            isOpen
            onCancel={() => {
              setSelectedInvestigationType(null);
              deleteDisclosure.onClose();
            }}
            onSubmit={() => {
              setSelectedInvestigationType(null);
              deleteDisclosure.onClose();
            }}
            name={selectedInvestigationType.name ?? "investigation type"}
            text="Are you sure you want to delete this investigation type?"
          />
        )}
      </>
    );
  }
);

InvestigationTypesTable.displayName = "InvestigationTypesTable";
export default InvestigationTypesTable;
