import {
  HStack,
  MenuIcon,
  MenuItem,
  Progress,
  useDisclosure,
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { useFetcher, useFetchers, useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo, useState } from "react";
import { LuPencil, LuPin, LuTrash } from "react-icons/lu";
import {
  CustomerAvatar,
  EmployeeAvatar,
  Hyperlink,
  New,
  Table,
} from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import type { Quotation } from "~/modules/sales";
import { quoteStatusType } from "~/modules/sales";
import { useCustomers, usePeople } from "~/stores";
import { favoriteSchema } from "~/types/validators";
import { path } from "~/utils/path";
import QuoteStatus from "./QuoteStatus";

type QuotesTableProps = {
  data: Quotation[];
  count: number;
};

const QuotesTable = memo(({ data, count }: QuotesTableProps) => {
  const permissions = usePermissions();
  const navigate = useNavigate();

  const [selectedQuotation, setSelectedQuotation] = useState<Quotation | null>(
    null
  );
  const deleteQuotationModal = useDisclosure();

  const [customers] = useCustomers();
  const [people] = usePeople();

  const fetcher = useFetcher<{}>();
  const optimisticFavorite = useOptimisticFavorite();

  const rows = useMemo<Quotation[]>(
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
  const customColumns = useCustomColumns<Quotation>("quote");
  const columns = useMemo<ColumnDef<Quotation>[]>(() => {
    const employeeOptions = people.map((employee) => ({
      value: employee.id,
      label: employee.name,
    }));

    const defaultColumns: ColumnDef<Quotation>[] = [
      {
        accessorKey: "quoteId",
        header: "Quote Number",
        cell: ({ row }) => (
          <HStack>
            {row.original.favorite ? (
              <fetcher.Form
                method="post"
                action={path.to.quoteFavorite}
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
                action={path.to.quoteFavorite}
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
            <Hyperlink to={path.to.quoteDetails(row.original.id!)}>
              {row.original.quoteId}
            </Hyperlink>
          </HStack>
        ),
      },
      {
        id: "customerId",
        header: "Customer",
        cell: ({ row }) => (
          <CustomerAvatar customerId={row.original.customerId} />
        ),
        meta: {
          filter: {
            type: "static",
            options: customers?.map((customer) => ({
              value: customer.id,
              label: customer.name,
            })),
          },
        },
      },

      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => {
          const status = row.original.status;
          const lines = row.original.lines ?? 0;
          const completedLines = row.original.completedLines ?? 0;
          return status === "Draft" ? (
            <Progress
              numerator={completedLines.toString()}
              denominator={lines.toString()}
              value={lines === 0 ? 0 : (completedLines / lines) * 100}
            />
          ) : (
            <QuoteStatus status={status} />
          );
        },
        meta: {
          filter: {
            type: "static",
            options: quoteStatusType.map((status) => ({
              value: status,
              label: <QuoteStatus status={status} />,
            })),
          },
          pluralHeader: "Statuses",
        },
      },
      {
        accessorKey: "customerReference",
        header: "Customer Reference",
        cell: (item) => item.getValue(),
      },
      {
        accessorKey: "salesPersonId",
        header: "Sales Person",
        cell: ({ row }) => (
          <EmployeeAvatar employeeId={row.original.salesPersonId} />
        ),
        meta: {
          filter: {
            type: "static",
            options: employeeOptions,
          },
        },
      },
      {
        accessorKey: "estimatorId",
        header: "Estimator",
        cell: ({ row }) => (
          <EmployeeAvatar employeeId={row.original.estimatorId} />
        ),
        meta: {
          filter: {
            type: "static",
            options: employeeOptions,
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
            options: employeeOptions,
          },
        },
      },
      {
        accessorKey: "dueDate",
        header: "Due Date",
        cell: (item) => item.getValue(),
      },
      {
        accessorKey: "expirationDate",
        header: "Expiration Date",
        cell: (item) => item.getValue(),
      },
      {
        accessorKey: "locationName",
        header: "Location",
        cell: (item) => <Enumerable value={item.getValue<string>()} />,
        meta: {
          filter: {
            type: "fetcher",
            endpoint: path.to.api.locations,
            transform: (data: { id: string; name: string }[] | null) =>
              data?.map(({ name }) => ({
                value: name,
                label: <Enumerable value={name} />,
              })) ?? [],
          },
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
  }, [customers, people, customColumns, fetcher]);

  const renderContextMenu = useMemo(() => {
    // eslint-disable-next-line react/display-name
    return (row: Quotation) => (
      <>
        <MenuItem onClick={() => navigate(path.to.quote(row.id!))}>
          <MenuIcon icon={<LuPencil />} />
          Edit
        </MenuItem>
        <MenuItem
          disabled={!permissions.can("delete", "sales")}
          onClick={() => {
            setSelectedQuotation(row);
            deleteQuotationModal.onOpen();
          }}
        >
          <MenuIcon icon={<LuTrash />} />
          Delete
        </MenuItem>
      </>
    );
  }, [deleteQuotationModal, navigate, permissions]);

  return (
    <>
      <Table<Quotation>
        count={count}
        columns={columns}
        data={rows}
        defaultColumnPinning={{
          left: ["quoteId"],
        }}
        defaultColumnVisibility={{
          createdAt: false,
          createdBy: false,
          updatedAt: false,
          updatedBy: false,
        }}
        primaryAction={
          permissions.can("create", "sales") && (
            <New label="Quote" to={path.to.newQuote} />
          )
        }
        renderContextMenu={renderContextMenu}
      />
      {selectedQuotation && selectedQuotation.id && (
        <ConfirmDelete
          action={path.to.deleteQuote(selectedQuotation.id)}
          isOpen={deleteQuotationModal.isOpen}
          name={selectedQuotation.quoteId!}
          text={`Are you sure you want to delete ${selectedQuotation.quoteId!}? This cannot be undone.`}
          onCancel={() => {
            deleteQuotationModal.onClose();
            setSelectedQuotation(null);
          }}
          onSubmit={() => {
            deleteQuotationModal.onClose();
            setSelectedQuotation(null);
          }}
        />
      )}
    </>
  );
});

QuotesTable.displayName = "QuotesTable";

export default QuotesTable;

function useOptimisticFavorite() {
  const fetchers = useFetchers();
  const favoriteFetcher = fetchers.find(
    (f) => f.formAction === path.to.quoteFavorite
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
