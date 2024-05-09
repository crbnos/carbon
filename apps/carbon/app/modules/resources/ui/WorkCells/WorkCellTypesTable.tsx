import {
  Button,
  Enumerable,
  HStack,
  MenuIcon,
  MenuItem,
  useDisclosure,
} from "@carbon/react";
import { useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo, useState } from "react";
import { BiAddToQueue } from "react-icons/bi";
import { BsFillCheckCircleFill, BsListUl } from "react-icons/bs";
import { LuPencil, LuTrash } from "react-icons/lu";
import { New, Table } from "~/components";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions, useUrlParams } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import type { WorkCellType } from "~/modules/resources";
import { path } from "~/utils/path";

type WorkCellTypesTableProps = {
  data: WorkCellType[];
  count: number;
};

const WorkCellTypesTable = memo(({ data, count }: WorkCellTypesTableProps) => {
  const navigate = useNavigate();
  const [params] = useUrlParams();
  const permissions = usePermissions();
  const deleteModal = useDisclosure();
  const [selectedType, setSelectedType] = useState<WorkCellType | undefined>();

  const onDelete = (data: WorkCellType) => {
    setSelectedType(data);
    deleteModal.onOpen();
  };

  const onDeleteCancel = () => {
    setSelectedType(undefined);
    deleteModal.onClose();
  };

  const customColumns = useCustomColumns<WorkCellType>("workCellType");
  const columns = useMemo<ColumnDef<WorkCellType>[]>(() => {
    const defaultColumns: ColumnDef<WorkCellType>[] = [
      {
        accessorKey: "name",
        header: "Work Cell Type",
        cell: ({ row }) => (
          <HStack>
            <Enumerable
              value={row.original.name}
              onClick={() => navigate(row.original.id)}
              className="cursor-pointer"
            />

            {row.original.requiredAbility && (
              <BsFillCheckCircleFill
                className="text-green-500"
                title="Requires ability"
              />
            )}
          </HStack>
        ),
      },
      {
        accessorKey: "description",
        header: "Description",
        cell: ({ row }) => (
          <span className="max-w-[300px] line-clamp-1">
            {row.original.description}
          </span>
        ),
      },
      {
        header: "Work Cells",
        cell: ({ row }) => (
          <Button
            variant="secondary"
            onClick={() => {
              navigate(
                `${path.to.workCellTypeList(
                  row.original.id
                )}?${params?.toString()}`
              );
            }}
          >
            {Array.isArray(row.original.workCell)
              ? row.original.workCell.length
              : 0}{" "}
            Work Cells
          </Button>
        ),
      },
    ];
    return [...defaultColumns, ...customColumns];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, customColumns]);

  const renderContextMenu = useCallback<(row: WorkCellType) => JSX.Element>(
    (row) => (
      <>
        <MenuItem
          onClick={() => {
            navigate(
              `${path.to.newWorkCellUnit(row.id)}?${params?.toString()}`
            );
          }}
        >
          <MenuIcon icon={<BiAddToQueue />} />
          New Unit
        </MenuItem>
        <MenuItem
          onClick={() => {
            navigate(
              `${path.to.workCellTypeList(row.id)}?${params?.toString()}`
            );
          }}
        >
          <MenuIcon icon={<BsListUl />} />
          Edit Work Cells
        </MenuItem>
        <MenuItem
          onClick={() => {
            navigate(`${path.to.workCellType(row.id)}?${params?.toString()}`);
          }}
        >
          <MenuIcon icon={<LuPencil />} />
          Edit Work Cell Type
        </MenuItem>
        <MenuItem
          disabled={!permissions.can("delete", "users")}
          onClick={() => onDelete(row)}
        >
          <MenuIcon icon={<LuTrash />} />
          Delete Work Cell Type
        </MenuItem>
      </>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [navigate, params, permissions]
  );

  return (
    <>
      <Table<WorkCellType>
        data={data}
        columns={columns}
        count={count ?? 0}
        primaryAction={
          permissions.can("update", "resources") && (
            <New label="Work Cell Type" to={`new?${params.toString()}`} />
          )
        }
        renderContextMenu={renderContextMenu}
      />

      {selectedType && selectedType.id && (
        <ConfirmDelete
          action={path.to.deleteWorkCellType(selectedType.id)}
          name={selectedType?.name ?? ""}
          text={`Are you sure you want to deactivate the ${selectedType?.name} work cell type?`}
          isOpen={deleteModal.isOpen}
          onCancel={onDeleteCancel}
          onSubmit={onDeleteCancel}
        />
      )}
    </>
  );
});

WorkCellTypesTable.displayName = "WorkCellTypesTable";
export default WorkCellTypesTable;
