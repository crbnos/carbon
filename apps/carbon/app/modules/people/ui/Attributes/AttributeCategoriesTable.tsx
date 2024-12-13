import {
  Badge,
  Button,
  MenuIcon,
  MenuItem,
  useDisclosure,
} from "@carbon/react";
import { useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo, useState } from "react";
import { BiAddToQueue } from "react-icons/bi";
import { BsListUl } from "react-icons/bs";
import { LuPencil, LuTrash } from "react-icons/lu";
import { Hyperlink, New, Table } from "~/components";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions, useUrlParams } from "~/hooks";

import { path } from "~/utils/path";
import type { AttributeCategory } from "../../types";

type AttributeCategoriesTableProps = {
  data: AttributeCategory[];
  count: number;
};

const AttributeCategoriesTable = memo(
  ({ data, count }: AttributeCategoriesTableProps) => {
    const navigate = useNavigate();
    const [params] = useUrlParams();
    const permissions = usePermissions();
    const deleteModal = useDisclosure();
    const [selectedCategory, setSelectedCategory] = useState<
      AttributeCategory | undefined
    >();

    const onDelete = (data: AttributeCategory) => {
      setSelectedCategory(data);
      deleteModal.onOpen();
    };

    const onDeleteCancel = () => {
      setSelectedCategory(undefined);
      deleteModal.onClose();
    };

    const columns = useMemo<ColumnDef<AttributeCategory>[]>(() => {
      return [
        {
          accessorKey: "name",
          header: "Category",
          cell: ({ row }) => (
            <Hyperlink to={row.original.id}>{row.original.name}</Hyperlink>
          ),
        },
        {
          header: "Attributes",
          cell: ({ row }) => (
            <Button
              variant="secondary"
              onClick={() => {
                navigate(
                  `${path.to.attributeCategoryList(
                    row.original.id
                  )}?${params?.toString()}`
                );
              }}
            >
              {Array.isArray(row.original.userAttribute)
                ? row.original.userAttribute?.length ?? 0
                : 0}{" "}
              Attributes
            </Button>
          ),
        },
        {
          accessorKey: "public",
          header: "Visibility",
          cell: (item) => {
            const isPublic = item.getValue<boolean>()?.toString() === "true";
            return (
              <Badge variant={isPublic ? undefined : "outline"}>
                {isPublic ? "Public" : "Private"}
              </Badge>
            );
          },
          meta: {
            filter: {
              type: "static",
              options: [
                { label: "Public", value: "true" },
                { label: "Private", value: "false" },
              ],
            },
            pluralHeader: "Visibilities",
          },
        },
      ];
    }, [navigate, params]);

    const renderContextMenu = useCallback(
      (row: AttributeCategory) => {
        return (
          <>
            <MenuItem
              onClick={() => {
                navigate(
                  `${path.to.newAttributeForCategory(
                    row.id
                  )}?${params?.toString()}`
                );
              }}
            >
              <MenuIcon icon={<BiAddToQueue />} />
              New Attribute
            </MenuItem>
            <MenuItem
              onClick={() => {
                navigate(
                  `${path.to.attributeCategoryList(
                    row.id
                  )}?${params?.toString()}`
                );
              }}
            >
              <MenuIcon icon={<BsListUl />} />
              View Attributes
            </MenuItem>
            <MenuItem
              onClick={() => {
                navigate(path.to.attributeCategory(row.id));
              }}
            >
              <MenuIcon icon={<LuPencil />} />
              Edit Attribute Category
            </MenuItem>
            <MenuItem
              destructive
              disabled={row.protected || !permissions.can("delete", "users")}
              onClick={() => onDelete(row)}
            >
              <MenuIcon icon={<LuTrash />} />
              Delete Category
            </MenuItem>
          </>
        );
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [navigate, params, permissions]
    );

    return (
      <>
        <Table<AttributeCategory>
          data={data}
          columns={columns}
          count={count ?? 0}
          primaryAction={
            permissions.can("update", "people") && (
              <New label="Attribute Category" to={`new?${params.toString()}`} />
            )
          }
          renderContextMenu={renderContextMenu}
        />
        {selectedCategory && selectedCategory.id && (
          <ConfirmDelete
            action={path.to.deleteAttributeCategory(selectedCategory.id)}
            name={selectedCategory?.name ?? ""}
            text={`Are you sure you want to deactivate the ${selectedCategory?.name} attribute category?`}
            isOpen={deleteModal.isOpen}
            onCancel={onDeleteCancel}
            onSubmit={onDeleteCancel}
          />
        )}
      </>
    );
  }
);

AttributeCategoriesTable.displayName = "AttributeCategoriesTable";
export default AttributeCategoriesTable;
