// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
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
  LuFileText,
  LuPencil,
  LuTarget,
  LuTrash,
  LuUser
} from "react-icons/lu";
import { Link, useNavigate } from "react-router";
import { DateTime, EmployeeAvatar, Hyperlink, New, Table } from "~/components";
import { ConfirmDelete } from "~/components/Modals";
import type { InfiniteOptions } from "~/components/Table";
import { usePermissions, useUrlParams } from "~/hooks";
import { useItems } from "~/stores/items";
import { path } from "~/utils/path";
import type { InspectionDocument } from "../../types";

type InspectionDocumentTableProps = {
  data: InspectionDocument[];
  count: number;
  infinite: InfiniteOptions;
};

const defaultColumnVisibility = {
  createdAt: false,
  updatedAt: false,
  updatedBy: false
};

const InspectionDocumentTable = memo(
  ({ data, count, infinite }: InspectionDocumentTableProps) => {
    const [params] = useUrlParams();
    const navigate = useNavigate();
    const { t } = useLingui();
    const permissions = usePermissions();
    const [items] = useItems();

    const itemsById = useMemo(
      () => new Map(items.map((item) => [item.id, item])),
      [items]
    );
    const groupRowsBy = useMemo(
      () => ({
        key: (row: InspectionDocument) => row.partId ?? "",
        header: (plans: InspectionDocument[]) => {
          const partId = plans[0]?.partId ?? null;
          const item = partId ? itemsById.get(partId) : undefined;
          return (
            <HStack spacing={3} className="px-4 py-2">
              {partId ? (
                <Link
                  to={path.to.part(partId)}
                  className="whitespace-nowrap text-sm font-medium hover:underline"
                >
                  {item?.readableIdWithRevision ?? partId}
                </Link>
              ) : (
                <span className="text-sm font-medium text-muted-foreground">
                  {t`No part`}
                </span>
              )}
              {item?.name ? (
                <span className="min-w-0 truncate text-sm text-muted-foreground">
                  {item.name}
                </span>
              ) : null}
            </HStack>
          );
        }
      }),
      [itemsById, t]
    );

    const deleteDisclosure = useDisclosure();
    const [selectedDiagram, setSelectedDiagram] =
      useState<InspectionDocument | null>(null);

    const columns = useMemo<ColumnDef<InspectionDocument>[]>(
      () => [
        {
          accessorKey: "name",
          header: t`Inspection Plan`,
          cell: ({ row }) => (
            <Hyperlink to={path.to.inspectionDocument(row.original.id)}>
              {row.original.name}
            </Hyperlink>
          ),
          // The service computes `name`; the view has no such column to sort.
          enableSorting: false,
          meta: { mobile: "P1", icon: <LuTarget /> }
        },
        {
          // The group header shows the part, so the column never renders: it
          // holds the Part filter and puts the part number in the CSV. The
          // view's `partReadableId` is what the background export writes too.
          accessorKey: "partReadableId",
          header: () => null,
          cell: () => null,
          enableSorting: false,
          meta: {
            exportOnly: true,
            filterHeader: t`Part`,
            filter: {
              type: "static" as const,
              options: items?.map((item) => ({
                value: item.readableIdWithRevision,
                label: item.readableIdWithRevision
              }))
            },
            exportValue: (row) => row.partReadableId,
            icon: <LuBookMarked />
          }
        },
        {
          id: "createdBy",
          header: t`Created By`,
          cell: ({ row }) => (
            <EmployeeAvatar employeeId={row.original.createdBy} />
          ),
          meta: { icon: <LuUser /> }
        },
        {
          accessorKey: "createdAt",
          header: t`Created At`,
          cell: (item) => (
            <DateTime value={item.getValue<string>()} variant="date" />
          ),
          meta: { mobile: "P2", icon: <LuFileText /> }
        },
        {
          id: "updatedBy",
          header: t`Updated By`,
          cell: ({ row }) => (
            <EmployeeAvatar employeeId={row.original.updatedBy} />
          ),
          meta: { icon: <LuUser /> }
        },
        {
          accessorKey: "updatedAt",
          header: t`Updated At`,
          cell: (item) => (
            <DateTime value={item.getValue<string>()} variant="date" />
          ),
          meta: { icon: <LuFileText /> }
        }
      ],
      [items, t]
    );

    const renderContextMenu = useCallback(
      (row: InspectionDocument) => (
        <>
          <MenuItem
            shortcut={MENU_ITEM_SHORTCUTS.edit}
            disabled={!permissions.can("update", "quality")}
            onClick={() => {
              navigate(
                `${path.to.inspectionDocument(row.id)}?${params?.toString()}`
              );
            }}
          >
            <MenuIcon icon={<LuPencil />} />
            Edit Diagram
          </MenuItem>
          <MenuItem
            shortcut={MENU_ITEM_SHORTCUTS.delete}
            destructive
            disabled={!permissions.can("delete", "quality")}
            onClick={() => {
              flushSync(() => {
                setSelectedDiagram(row);
              });
              deleteDisclosure.onOpen();
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            Delete Diagram
          </MenuItem>
        </>
      ),
      [permissions, navigate, params, deleteDisclosure]
    );

    return (
      <>
        <Table<InspectionDocument>
          data={data}
          infinite={infinite}
          columns={columns}
          count={count}
          defaultColumnVisibility={defaultColumnVisibility}
          groupRowsBy={groupRowsBy}
          primaryAction={
            permissions.can("create", "quality") && (
              <New
                label={t`Inspection Plan`}
                to={`${path.to.newInspectionDocument}?${params?.toString()}`}
              />
            )
          }
          renderContextMenu={renderContextMenu}
          title={t`Inspection Plans`}
        />
        {deleteDisclosure.isOpen && selectedDiagram && (
          <ConfirmDelete
            action={path.to.deleteInspectionDocument(selectedDiagram.id)}
            isOpen
            onCancel={() => {
              setSelectedDiagram(null);
              deleteDisclosure.onClose();
            }}
            onSubmit={() => {
              setSelectedDiagram(null);
              deleteDisclosure.onClose();
            }}
            name={selectedDiagram.name}
            text={t`Are you sure you want to delete this inspection plan?`}
          />
        )}
      </>
    );
  }
);

InspectionDocumentTable.displayName = "InspectionDocumentTable";
export default InspectionDocumentTable;
