import { HStack, MenuIcon, MenuItem, useDisclosure } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { useFetcher, useFetchers, useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo, useState } from "react";
import {
  LuBookMarked,
  LuCalendar,
  LuMap,
  LuPencil,
  LuPin,
  LuQrCode,
  LuStar,
  LuTrash,
  LuUser,
  LuUserSquare,
} from "react-icons/lu";
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
import type { SalesRFQ } from "~/modules/sales";
import { salesRFQStatusType } from "~/modules/sales";
import { useCustomers, usePeople } from "~/stores";
import { favoriteSchema } from "~/types/validators";
import { path } from "~/utils/path";
import { SalesRFQStatus } from ".";

type SalesRFQsTableProps = {
  data: SalesRFQ[];
  count: number;
};

const SalesRFQsTable = memo(({ data, count }: SalesRFQsTableProps) => {
  const permissions = usePermissions();
  const navigate = useNavigate();

  const [selectedSalesRFQ, setSelectedSalesRFQ] = useState<SalesRFQ | null>(
    null
  );
  const deleteSalesRFQModal = useDisclosure();

  const [customers] = useCustomers();
  const [people] = usePeople();

  const fetcher = useFetcher<{}>();
  const optimisticFavorite = useOptimisticFavorite();

  const rows = useMemo<SalesRFQ[]>(
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
  const customColumns = useCustomColumns<SalesRFQ>("salesRFQ");
  const columns = useMemo<ColumnDef<SalesRFQ>[]>(() => {
    const defaultColumns: ColumnDef<SalesRFQ>[] = [
      {
        accessorKey: "rfqId",
        header: "RFQ Number",
        cell: ({ row }) => (
          <HStack>
            {row.original.favorite ? (
              <fetcher.Form
                method="post"
                action={path.to.salesRfqFavorite}
                className="flex items-center"
              >
                <input type="hidden" name="id" value={row.original.id!} />
                <input type="hidden" name="favorite" value="unfavorite" />
                <button type="submit">
                  <LuPin
                    className="cursor-pointer w-4 h-4 outline-foreground fill-foreground"
                    type="submit"
                  />
                </button>
              </fetcher.Form>
            ) : (
              <fetcher.Form
                method="post"
                action={path.to.salesRfqFavorite}
                className="flex items-center"
              >
                <input type="hidden" name="id" value={row.original.id!} />
                <input type="hidden" name="favorite" value="favorite" />
                <button type="submit">
                  <LuPin
                    className="cursor-pointer w-4 h-4 text-muted-foreground"
                    type="submit"
                  />
                </button>
              </fetcher.Form>
            )}
            <Hyperlink to={path.to.salesRfqDetails(row.original.id!)}>
              {row.original.rfqId}
            </Hyperlink>
          </HStack>
        ),
        meta: {
          icon: <LuBookMarked />,
        },
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
          icon: <LuUserSquare />,
        },
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: (item) => {
          const status = item.getValue<(typeof salesRFQStatusType)[number]>();
          return <SalesRFQStatus status={status} />;
        },
        meta: {
          filter: {
            type: "static",
            options: salesRFQStatusType.map((status) => ({
              value: status,
              label: <SalesRFQStatus status={status} />,
            })),
          },
          pluralHeader: "Statuses",
          icon: <LuStar />,
        },
      },
      {
        accessorKey: "customerReference",
        header: "Customer Reference",
        cell: (item) => item.getValue(),
        meta: {
          icon: <LuQrCode />,
        },
      },
      {
        accessorKey: "rfqDate",
        header: "RFQ Date",
        cell: (item) => formatDate(item.getValue<string>()),
        meta: {
          icon: <LuCalendar />,
        },
      },
      {
        accessorKey: "expirationDate",
        header: "Due Date",
        cell: (item) => formatDate(item.getValue<string>()),
        meta: {
          icon: <LuCalendar />,
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
          icon: <LuUser />,
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
          icon: <LuMap />,
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
  }, [customers, people, customColumns, fetcher]);

  const renderContextMenu = useMemo(() => {
    // eslint-disable-next-line react/display-name
    return (row: SalesRFQ) => (
      <>
        <MenuItem onClick={() => navigate(path.to.salesRfqDetails(row.id!))}>
          <MenuIcon icon={<LuPencil />} />
          Edit
        </MenuItem>
        <MenuItem
          disabled={!permissions.can("delete", "sales")}
          onClick={() => {
            setSelectedSalesRFQ(row);
            deleteSalesRFQModal.onOpen();
          }}
        >
          <MenuIcon icon={<LuTrash />} />
          Delete
        </MenuItem>
      </>
    );
  }, [deleteSalesRFQModal, navigate, permissions]);

  return (
    <>
      <Table<SalesRFQ>
        count={count}
        columns={columns}
        data={rows}
        defaultColumnPinning={{
          left: ["rfqId"],
        }}
        defaultColumnVisibility={{
          createdAt: false,
          updatedAt: false,
          updatedBy: false,
        }}
        primaryAction={
          permissions.can("create", "sales") && (
            <New label="RFQ" to={path.to.newSalesRFQ} />
          )
        }
        renderContextMenu={renderContextMenu}
      />
      {selectedSalesRFQ && selectedSalesRFQ.id && (
        <ConfirmDelete
          action={path.to.deleteSalesRfq(selectedSalesRFQ.id)}
          isOpen={deleteSalesRFQModal.isOpen}
          name={selectedSalesRFQ.rfqId!}
          text={`Are you sure you want to delete ${selectedSalesRFQ.rfqId!}? This cannot be undone.`}
          onCancel={() => {
            deleteSalesRFQModal.onClose();
            setSelectedSalesRFQ(null);
          }}
          onSubmit={() => {
            deleteSalesRFQModal.onClose();
            setSelectedSalesRFQ(null);
          }}
        />
      )}
    </>
  );
});

SalesRFQsTable.displayName = "SalesRFQsTable";

export default SalesRFQsTable;

function useOptimisticFavorite() {
  const fetchers = useFetchers();
  const favoriteFetcher = fetchers.find(
    (f) => f.formAction === path.to.salesRfqFavorite
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
