import { HStack, MenuIcon, MenuItem, useDisclosure } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { useFetcher, useFetchers, useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo, useState } from "react";
import {
  LuBookMarked,
  LuCalendar,
  LuPencil,
  LuPin,
  LuQrCode,
  LuStar,
  LuTrash,
  LuUser,
  LuUserSquare,
} from "react-icons/lu";
import {
  EmployeeAvatar,
  Hyperlink,
  ItemThumbnail,
  New,
  SupplierAvatar,
  Table,
} from "~/components";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import type { SupplierQuote } from "~/modules/purchasing";
import {
  SupplierQuoteStatus,
  supplierQuoteStatusType,
} from "~/modules/purchasing";
import { usePeople, useSuppliers } from "~/stores";
import { favoriteSchema } from "~/types/validators";
import { path } from "~/utils/path";
import QuoteStatus from "./SupplierQuoteStatus";

type SupplierQuotesTableProps = {
  data: SupplierQuote[];
  count: number;
};

const SupplierQuotesTable = memo(
  ({ data, count }: SupplierQuotesTableProps) => {
    const permissions = usePermissions();
    const navigate = useNavigate();

    const [selectedSupplierQuote, setSelectedSupplierQuote] =
      useState<SupplierQuote | null>(null);
    const deleteSupplierQuoteModal = useDisclosure();

    const [suppliers] = useSuppliers();
    const [people] = usePeople();

    const fetcher = useFetcher<{}>();
    const optimisticFavorite = useOptimisticFavorite();

    const rows = useMemo<SupplierQuote[]>(
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
    const customColumns = useCustomColumns<SupplierQuote>("quote");
    const columns = useMemo<ColumnDef<SupplierQuote>[]>(() => {
      const employeeOptions = people.map((employee) => ({
        value: employee.id,
        label: employee.name,
      }));

      const defaultColumns: ColumnDef<SupplierQuote>[] = [
        {
          accessorKey: "supplierQuoteId",
          header: "Quote Number",
          cell: ({ row }) => (
            <HStack>
              {row.original.favorite ? (
                <fetcher.Form
                  method="post"
                  action={path.to.supplierQuoteFavorite}
                  className="flex items-center"
                >
                  <input type="hidden" name="id" value={row.original.id!} />
                  <input type="hidden" name="favorite" value="unfavorite" />
                  <button type="submit">
                    <LuPin
                      className="cursor-pointer w-4 h-4 outline-foreground fill-foreground flex-shrink-0"
                      type="submit"
                    />
                  </button>
                </fetcher.Form>
              ) : (
                <fetcher.Form
                  method="post"
                  action={path.to.supplierQuoteFavorite}
                  className="flex items-center"
                >
                  <input type="hidden" name="id" value={row.original.id!} />
                  <input type="hidden" name="favorite" value="favorite" />
                  <button type="submit">
                    <LuPin
                      className="cursor-pointer w-4 h-4 text-muted-foreground flex-shrink-0"
                      type="submit"
                    />
                  </button>
                </fetcher.Form>
              )}
              <ItemThumbnail
                size="sm"
                thumbnailPath={row.original.thumbnailPath}
                // @ts-ignore
                type={row.original.itemType}
              />
              <Hyperlink to={path.to.supplierQuoteDetails(row.original.id!)}>
                {row.original.supplierQuoteId}
              </Hyperlink>
            </HStack>
          ),
          meta: {
            icon: <LuBookMarked />,
          },
        },
        {
          id: "supplierId",
          header: "Supplier",
          cell: ({ row }) => (
            <SupplierAvatar supplierId={row.original.supplierId} />
          ),
          meta: {
            filter: {
              type: "static",
              options: suppliers?.map((supplier) => ({
                value: supplier.id,
                label: supplier.name,
              })),
            },
            icon: <LuUserSquare />,
          },
        },

        {
          accessorKey: "status",
          header: "Status",
          cell: ({ row }) => (
            <SupplierQuoteStatus status={row.original.status} />
          ),
          meta: {
            filter: {
              type: "static",
              options: supplierQuoteStatusType.map((status) => ({
                value: status,
                label: <QuoteStatus status={status} />,
              })),
            },
            pluralHeader: "Statuses",
            icon: <LuStar />,
          },
        },
        {
          accessorKey: "supplierReference",
          header: "Supplier Reference",
          cell: (item) => item.getValue(),
          meta: {
            icon: <LuQrCode />,
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
              options: employeeOptions,
            },
            icon: <LuUser />,
          },
        },
        {
          accessorKey: "dueDate",
          header: "Due Date",
          cell: (item) => formatDate(item.getValue<string>()),
          meta: {
            icon: <LuCalendar />,
          },
        },
        {
          accessorKey: "expirationDate",
          header: "Expiration Date",
          cell: (item) => formatDate(item.getValue<string>()),
          meta: {
            icon: <LuCalendar />,
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
            icon: <LuUser />,
          },
        },
        {
          accessorKey: "createdAt",
          header: "Created At",
          cell: (item) => formatDate(item.getValue<string>()),
          meta: {
            icon: <LuCalendar />,
          },
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
            icon: <LuUser />,
          },
        },
        {
          accessorKey: "updatedAt",
          header: "Created At",
          cell: (item) => formatDate(item.getValue<string>()),
          meta: {
            icon: <LuCalendar />,
          },
        },
      ];

      return [...defaultColumns, ...customColumns];
    }, [suppliers, people, customColumns, fetcher]);

    const renderContextMenu = useMemo(() => {
      // eslint-disable-next-line react/display-name
      return (row: SupplierQuote) => (
        <>
          <MenuItem
            onClick={() => navigate(path.to.supplierQuoteDetails(row.id!))}
          >
            <MenuIcon icon={<LuPencil />} />
            Edit
          </MenuItem>
          <MenuItem
            disabled={!permissions.can("delete", "purchasing")}
            onClick={() => {
              setSelectedSupplierQuote(row);
              deleteSupplierQuoteModal.onOpen();
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            Delete
          </MenuItem>
        </>
      );
    }, [deleteSupplierQuoteModal, navigate, permissions]);

    return (
      <>
        <Table<SupplierQuote>
          count={count}
          columns={columns}
          data={rows}
          defaultColumnPinning={{
            left: ["supplierQuoteId"],
          }}
          defaultColumnVisibility={{
            createdAt: false,
            createdBy: false,
            updatedAt: false,
            updatedBy: false,
          }}
          primaryAction={
            permissions.can("create", "purchasing") && (
              <New label="Quote" to={path.to.newQuote} />
            )
          }
          renderContextMenu={renderContextMenu}
        />
        {selectedSupplierQuote && selectedSupplierQuote.id && (
          <ConfirmDelete
            action={path.to.deleteQuote(selectedSupplierQuote.id)}
            isOpen={deleteSupplierQuoteModal.isOpen}
            name={selectedSupplierQuote.supplierQuoteId!}
            text={`Are you sure you want to delete ${selectedSupplierQuote.supplierQuoteId!}? This cannot be undone.`}
            onCancel={() => {
              deleteSupplierQuoteModal.onClose();
              setSelectedSupplierQuote(null);
            }}
            onSubmit={() => {
              deleteSupplierQuoteModal.onClose();
              setSelectedSupplierQuote(null);
            }}
          />
        )}
      </>
    );
  }
);

SupplierQuotesTable.displayName = "SupplierQuotesTable";

export default SupplierQuotesTable;

function useOptimisticFavorite() {
  const fetchers = useFetchers();
  const favoriteFetcher = fetchers.find(
    (f) => f.formAction === path.to.supplierQuoteFavorite
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
