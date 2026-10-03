// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Badge,
  Button,
  HStack,
  MENU_ITEM_SHORTCUTS,
  MenuIcon,
  MenuItem,
  useDisclosure
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo, useState } from "react";
import { BiAddToQueue } from "react-icons/bi";
import { BsListUl } from "react-icons/bs";
import { LuListChecks, LuPencil, LuTrash } from "react-icons/lu";
import { useNavigate } from "react-router";
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
    const { t } = useLingui();
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
          header: t`Category`,
          cell: ({ row }) => (
            <Hyperlink to={row.original.id} className="flex items-center gap-2">
              {row.original.emoji ? (
                <span className="text-base">{row.original.emoji}</span>
              ) : (
                <LuListChecks />
              )}{" "}
              <span>{row.original.name}</span>
            </Hyperlink>
          )
        },
        {
          header: t`Attributes`,
          cell: ({ row }) => (
            <HStack className="text-xs text-muted-foreground">
              <LuListChecks />
              <span>
                {Array.isArray(row.original.userAttribute)
                  ? (row.original.userAttribute?.length ?? 0)
                  : 0}{" "}
                <Trans>Attributes</Trans>
              </span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  navigate(
                    `${path.to.attributeCategoryList(
                      row.original.id
                    )}?${params?.toString()}`
                  );
                }}
              >
                <Trans>Edit</Trans>
              </Button>
            </HStack>
          )
        },
        {
          accessorKey: "public",
          header: t`Visibility`,
          cell: (item) => {
            const isPublic = item.getValue<boolean>()?.toString() === "true";
            return (
              <Badge variant={isPublic ? undefined : "outline"}>
                {isPublic ? <Trans>Public</Trans> : <Trans>Private</Trans>}
              </Badge>
            );
          },
          meta: {
            filter: {
              type: "static",
              options: [
                { label: t`Public`, value: "true" },
                { label: t`Private`, value: "false" }
              ]
            },
            pluralHeader: t`Visibilities`
          }
        }
      ];
    }, [navigate, params, t]);

    // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
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
              <Trans>New Attribute</Trans>
            </MenuItem>
            <MenuItem
              shortcut={MENU_ITEM_SHORTCUTS.view}
              onClick={() => {
                navigate(
                  `${path.to.attributeCategoryList(
                    row.id
                  )}?${params?.toString()}`
                );
              }}
            >
              <MenuIcon icon={<BsListUl />} />
              <Trans>View Attributes</Trans>
            </MenuItem>
            <MenuItem
              shortcut={MENU_ITEM_SHORTCUTS.edit}
              onClick={() => {
                navigate(path.to.attributeCategory(row.id));
              }}
            >
              <MenuIcon icon={<LuPencil />} />
              <Trans>Edit Category</Trans>
            </MenuItem>
            <MenuItem
              shortcut={MENU_ITEM_SHORTCUTS.delete}
              destructive
              disabled={row.protected || !permissions.can("delete", "users")}
              onClick={() => onDelete(row)}
            >
              <MenuIcon icon={<LuTrash />} />
              <Trans>Delete Category</Trans>
            </MenuItem>
          </>
        );
      },

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
              <New label={t`Category`} to={`new?${params.toString()}`} />
            )
          }
          renderContextMenu={renderContextMenu}
          title={t`Attributes`}
        />
        {selectedCategory && selectedCategory.id && (
          <ConfirmDelete
            action={path.to.deleteAttributeCategory(selectedCategory.id)}
            name={selectedCategory?.name ?? ""}
            text={t`Are you sure you want to deactivate the ${selectedCategory?.name} attribute category?`}
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
