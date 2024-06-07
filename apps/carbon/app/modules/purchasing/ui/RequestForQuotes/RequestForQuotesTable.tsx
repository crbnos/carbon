import { HStack, MenuIcon, MenuItem, useDisclosure } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { useFetcher, useFetchers, useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo, useState } from "react";
import { LuPencil, LuPin, LuTrash } from "react-icons/lu";
import { EmployeeAvatar, Hyperlink, New, Table } from "~/components";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import {
  requestForQuoteStatusType,
  type RequestForQuote,
} from "~/modules/purchasing";
import { useParts, usePeople, useSuppliers } from "~/stores";
import { favoriteSchema } from "~/types/validators";
import { path } from "~/utils/path";
import { RequestForQuoteStatus } from "../RequestForQuote";

type RequestForQuotesTableProps = {
  data: RequestForQuote[];
  count: number;
};

const RequestForQuotesTable = memo(
  ({ data, count }: RequestForQuotesTableProps) => {
    const permissions = usePermissions();
    const navigate = useNavigate();
    const fetcher = useFetcher();
    const optimisticFavorite = useOptimisticFavorite();

    const parts = useParts();
    const [people] = usePeople();
    const [suppliers] = useSuppliers();

    const rows = useMemo<RequestForQuote[]>(
      () =>
        data.map((d) =>
          d.id === optimisticFavorite?.id
            ? {
                ...d,
                favorite: optimisticFavorite?.favorite
                  ? optimisticFavorite.favorite === "favorite"
                  : d.favorite,
              }
            : d
        ),
      [data, optimisticFavorite]
    );

    const [selectedRequestForQuote, setSelectedRequestForQuote] =
      useState<RequestForQuote | null>(null);
    const deleteRequestForQuoteModal = useDisclosure();

    const customColumns = useCustomColumns<RequestForQuote>("requestForQuote");
    const columns = useMemo<ColumnDef<RequestForQuote>[]>(() => {
      const defaultColumns: ColumnDef<RequestForQuote>[] = [
        {
          accessorKey: "requestForQuoteId",
          header: "RFQ Number",
          cell: ({ row }) => (
            <HStack>
              {row.original.favorite ? (
                <fetcher.Form
                  method="post"
                  action={path.to.requestForQuoteFavorite}
                  className="flex items-center"
                >
                  <input type="hidden" name="id" value={row.original.id!} />
                  <input type="hidden" name="favorite" value="unfavorite" />
                  <button type="submit">
                    <LuPin
                      className="text-yellow-400 cursor-pointer h-4 w-4"
                      type="submit"
                    />
                  </button>
                </fetcher.Form>
              ) : (
                <fetcher.Form
                  method="post"
                  action={path.to.requestForQuoteFavorite}
                  className="flex items-center"
                >
                  <input type="hidden" name="id" value={row.original.id!} />
                  <input type="hidden" name="favorite" value="favorite" />
                  <button type="submit">
                    <LuPin
                      className="text-yellow-400 cursor-pointer h-4 w-4"
                      type="submit"
                    />
                  </button>
                </fetcher.Form>
              )}
              <Hyperlink to={path.to.requestForQuote(row.original.id!)}>
                {row.original.requestForQuoteId}
              </Hyperlink>
            </HStack>
          ),
        },
        {
          accessorKey: "name",
          header: "Name",
          cell: (item) => {
            if (item.getValue<string>()) {
              return item.getValue<string>().substring(0, 50);
            }
            return null;
          },
        },
        {
          accessorKey: "status",
          header: "Status",
          cell: (item) => {
            const status =
              item.getValue<(typeof requestForQuoteStatusType)[number]>();
            return <RequestForQuoteStatus status={status} />;
          },
          meta: {
            filter: {
              type: "static",
              options: requestForQuoteStatusType.map((status) => ({
                value: status,
                label: <RequestForQuoteStatus status={status} />,
              })),
            },
          },
        },
        {
          id: "assignee",
          header: "Assignee",
          cell: ({ row }) => (
            <EmployeeAvatar employeeId={row.original.assignee} />
          ),
          meta: {
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
          accessorKey: "receiptDate",
          header: "Receipt Date",
          cell: (item) => item.getValue(),
        },
        {
          accessorKey: "expirationDate",
          header: "Expiration Date",
          cell: (item) => item.getValue(),
        },
        {
          accessorKey: "supplierIds",
          header: "Suppliers",
          cell: ({ row }) => row.original.supplierIds?.length ?? 0,
          meta: {
            filter: {
              type: "static",
              options: suppliers.map((supplier) => ({
                value: supplier.id,
                label: supplier.name,
              })),
              isArray: true,
            },
            pluralHeader: "Suppliers",
          },
        },
        {
          id: "itemIds",
          header: "Items",
          cell: ({ row }) => row.original.itemIds?.length ?? 0,
          meta: {
            filter: {
              type: "static",
              options: parts.map((part) => ({
                value: part.id,
                label: part.id,
                helperText: part.name,
              })),
              isArray: true,
            },
            pluralHeader: "Parts",
          },
        },
        {
          id: "createdBy",
          header: "Created By",
          cell: ({ row }) => (
            <EmployeeAvatar employeeId={row.original.createdBy} />
          ),
          meta: {
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
          accessorKey: "createdAt",
          header: "Created At",
          cell: (item) => formatDate(item.getValue<string>()),
        },
        {
          id: "updatedBy",
          header: "Updated By",
          cell: ({ row }) => (
            <EmployeeAvatar employeeId={row.original.updatedBy} />
          ),
          meta: {
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
          accessorKey: "updatedAt",
          header: "Created At",
          cell: (item) => formatDate(item.getValue<string>()),
        },
      ];
      return [...defaultColumns, ...customColumns];
    }, [people, suppliers, parts, customColumns, fetcher]);

    const defaultColumnVisibility = {
      createdAt: false,
      createdBy: false,
      updatedAt: false,
      updatedBy: false,
      itemIds: false,
      supplierIds: false,
    };

    const renderContextMenu = useMemo(() => {
      // eslint-disable-next-line react/display-name
      return (row: RequestForQuote) => (
        <>
          <MenuItem onClick={() => navigate(path.to.requestForQuote(row.id!))}>
            <MenuIcon icon={<LuPencil />} />
            Edit
          </MenuItem>
          <MenuItem
            disabled={!permissions.can("delete", "purchasing")}
            onClick={() => {
              setSelectedRequestForQuote(row);
              deleteRequestForQuoteModal.onOpen();
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            Delete
          </MenuItem>
        </>
      );
    }, [deleteRequestForQuoteModal, navigate, permissions]);

    return (
      <>
        <Table<RequestForQuote>
          count={count}
          columns={columns}
          data={rows}
          defaultColumnPinning={{
            left: ["requestForQuoteId"],
          }}
          defaultColumnVisibility={defaultColumnVisibility}
          primaryAction={
            permissions.can("create", "purchasing") && (
              <New label="Request for Quote" to={path.to.newRequestForQuote} />
            )
          }
          renderContextMenu={renderContextMenu}
          withColumnOrdering
        />
        {selectedRequestForQuote && selectedRequestForQuote.id && (
          <ConfirmDelete
            action={path.to.deleteRequestForQuote(selectedRequestForQuote.id)}
            isOpen={deleteRequestForQuoteModal.isOpen}
            name={selectedRequestForQuote.requestForQuoteId!}
            text={`Are you sure you want to delete ${selectedRequestForQuote.requestForQuoteId!}? This cannot be undone.`}
            onCancel={() => {
              deleteRequestForQuoteModal.onClose();
              setSelectedRequestForQuote(null);
            }}
            onSubmit={() => {
              deleteRequestForQuoteModal.onClose();
              setSelectedRequestForQuote(null);
            }}
          />
        )}
      </>
    );
  }
);

RequestForQuotesTable.displayName = "RequestForQuotesTable";

export default RequestForQuotesTable;

function useOptimisticFavorite() {
  const fetchers = useFetchers();
  const favoriteFetcher = fetchers.find(
    (f) => f.formAction === path.to.requestForQuoteFavorite
  );

  if (favoriteFetcher && favoriteFetcher.formData) {
    const id = favoriteFetcher.formData.get("id");
    const favorite = favoriteFetcher.formData.get("favorite") ?? "off";
    const submission = favoriteSchema.safeParse({ id, favorite });
    if (submission.success) {
      return submission.data;
    }
  }
}
