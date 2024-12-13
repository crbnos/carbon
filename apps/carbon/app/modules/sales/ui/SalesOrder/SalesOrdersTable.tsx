import {
  Badge,
  Checkbox,
  HStack,
  MenuIcon,
  MenuItem,
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTrigger,
  useDisclosure,
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo, useState } from "react";
import {
  LuBookMarked,
  LuCalendar,
  LuCreditCard,
  LuDollarSign,
  LuExternalLink,
  LuPencil,
  LuQrCode,
  LuStar,
  LuTrash,
  LuTruck,
  LuUser,
  LuUserSquare,
} from "react-icons/lu";
import {
  CustomerAvatar,
  EmployeeAvatar,
  Hyperlink,
  ItemThumbnail,
  New,
  Table,
} from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { ConfirmDelete } from "~/components/Modals";
import { useCurrencyFormatter, usePermissions } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";

import JobStatus from "~/modules/production/ui/Jobs/JobStatus";
import { useCustomers, usePeople } from "~/stores";
import { path } from "~/utils/path";
import { salesOrderStatusType } from "../../sales.models";
import type { SalesOrder } from "../../types";
import SalesStatus from "./SalesStatus";

type SalesOrdersTableProps = {
  data: SalesOrder[];
  count: number;
};

const SalesOrdersTable = memo(({ data, count }: SalesOrdersTableProps) => {
  const permissions = usePermissions();
  const currencyFormatter = useCurrencyFormatter();

  const [selectedSalesOrder, setSelectedSalesOrder] =
    useState<SalesOrder | null>(null);

  const deleteSalesOrderModal = useDisclosure();

  const [people] = usePeople();
  const [customers] = useCustomers();

  const { edit } = useSalesOrder();

  const customColumns = useCustomColumns<SalesOrder>("salesOrder");

  const columns = useMemo<ColumnDef<SalesOrder>[]>(() => {
    const defaultColumns: ColumnDef<SalesOrder>[] = [
      {
        accessorKey: "salesOrderId",
        header: "Sales Order Number",
        cell: ({ row }) => (
          <HStack>
            <ItemThumbnail
              size="sm"
              thumbnailPath={row.original.thumbnailPath}
              // @ts-ignore
              type={row.original.itemType}
            />
            <Hyperlink to={path.to.salesOrderDetails(row.original.id!)}>
              {row.original.salesOrderId}
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
        cell: ({ row }) => {
          return <CustomerAvatar customerId={row.original.customerId} />;
        },
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
          const status = item.getValue<(typeof salesOrderStatusType)[number]>();
          return <SalesStatus status={status} />;
        },
        meta: {
          filter: {
            type: "static",
            options: salesOrderStatusType.map((status) => ({
              value: status,
              label: <SalesStatus status={status} />,
            })),
          },
          pluralHeader: "Statuses",
          icon: <LuStar />,
        },
      },
      {
        id: "jobs",
        header: "Jobs",
        cell: ({ row }) => {
          if (row.original.jobs === null || !Array.isArray(row.original.jobs))
            return null;
          return (
            <Popover>
              <PopoverTrigger>
                <Badge variant="secondary">
                  {row.original.jobs.length} Jobs
                  <LuExternalLink className="w-3 h-3 ml-2" />
                </Badge>
              </PopoverTrigger>
              <PopoverContent>
                <PopoverHeader>Jobs</PopoverHeader>
                <div className="flex flex-col w-full gap-4 text-sm">
                  {(
                    row.original.jobs as {
                      id: string;
                      jobId: string;
                      status: "Draft";
                    }[]
                  ).map((job) => (
                    <div
                      key={job.id}
                      className="flex items-center justify-between gap-2"
                    >
                      <Hyperlink
                        to={path.to.jobDetails(job.id)}
                        className="flex items-center justify-start gap-1"
                      >
                        {job.jobId}
                        <LuExternalLink className="w-4 h-4" />
                      </Hyperlink>
                      <div className="flex items-center justify-end">
                        <JobStatus status={job.status} />
                      </div>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          );
        },
      },
      {
        accessorKey: "customerReference",
        header: "Customer Ref.",
        cell: (item) => item.getValue(),
        meta: {
          icon: <LuQrCode />,
        },
      },
      {
        accessorKey: "orderDate",
        header: "Order Date",
        cell: (item) => formatDate(item.getValue<string>()),
        meta: {
          icon: <LuCalendar />,
        },
      },
      {
        accessorKey: "orderTotal",
        header: "Order Total",
        cell: (item) => currencyFormatter.format(item.getValue<number>()),
        meta: {
          icon: <LuDollarSign />,
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
        accessorKey: "receiptPromisedDate",
        header: "Promised Date",
        cell: (item) => formatDate(item.getValue<string>()),
        meta: {
          icon: <LuCalendar />,
        },
      },
      {
        accessorKey: "shippingMethodName",
        header: "Shipping Method",
        cell: (item) => item.getValue(),
        meta: {
          icon: <LuTruck />,
        },
      },
      // {
      //   accessorKey: "shippingTermName",
      //   header: "Shipping Term",
      //   cell: (item) => <Enumerable value={item.getValue<string>()} />,
      // },
      {
        accessorKey: "paymentTermName",
        header: "Payment Method",
        cell: (item) => <Enumerable value={item.getValue<string>()} />,
        meta: {
          icon: <LuCreditCard />,
        },
      },
      {
        accessorKey: "dropShipment",
        header: "Drop Shipment",
        cell: (item) => <Checkbox isChecked={item.getValue<boolean>()} />,
        meta: {
          filter: {
            type: "static",
            options: [
              { value: "true", label: "Yes" },
              { value: "false", label: "No" },
            ],
          },
          pluralHeader: "Drop Shipment Statuses",
          icon: <LuTruck />,
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
  }, [customers, people, customColumns, currencyFormatter]);

  const renderContextMenu = useMemo(() => {
    // eslint-disable-next-line react/display-name
    return (row: SalesOrder) => (
      <>
        <MenuItem
          disabled={!permissions.can("view", "sales")}
          onClick={() => edit(row)}
        >
          <MenuIcon icon={<LuPencil />} />
          Edit
        </MenuItem>

        {/*<MenuItem
            disabled={
              !["To Recieve", "To Receive and Invoice"].includes(
                row.status ?? ""
              ) || !permissions.can("update", "inventory")
            }
            onClick={() => {
              receive(row);
            }}
          >
            <MenuIcon icon={<MdCallReceived />} />
            Receive
          </MenuItem>*/}
        <MenuItem
          disabled={!permissions.can("delete", "sales")}
          destructive
          onClick={() => {
            setSelectedSalesOrder(row);
            deleteSalesOrderModal.onOpen();
          }}
        >
          <MenuIcon icon={<LuTrash />} />
          Delete
        </MenuItem>
      </>
    );
  }, [deleteSalesOrderModal, edit, permissions /*receive*/]);

  return (
    <>
      <Table<SalesOrder>
        count={count}
        columns={columns}
        data={data}
        defaultColumnPinning={{
          left: ["salesOrderId"],
        }}
        defaultColumnVisibility={{
          receiptPromisedDate: false,
          shippingMethodName: false,
          shippingTermName: false,
          paymentTermName: false,
          dropShipment: false,
          createdBy: false,
          createdAt: false,
          updatedBy: false,
          updatedAt: false,
        }}
        primaryAction={
          permissions.can("create", "sales") && (
            <New label="Sales Order" to={path.to.newSalesOrder} />
          )
        }
        renderContextMenu={renderContextMenu}
      />

      {selectedSalesOrder && selectedSalesOrder.id && (
        <ConfirmDelete
          action={path.to.deleteSalesOrder(selectedSalesOrder.id)}
          isOpen={deleteSalesOrderModal.isOpen}
          name={selectedSalesOrder.salesOrderId!}
          text={`Are you sure you want to delete ${selectedSalesOrder.salesOrderId!}? This cannot be undone.`}
          onCancel={() => {
            deleteSalesOrderModal.onClose();
            setSelectedSalesOrder(null);
          }}
          onSubmit={() => {
            deleteSalesOrderModal.onClose();
            setSelectedSalesOrder(null);
          }}
        />
      )}
    </>
  );
});
SalesOrdersTable.displayName = "SalesOrdersTable";

export default SalesOrdersTable;

export const useSalesOrder = () => {
  const navigate = useNavigate();

  const edit = useCallback(
    (salesOrder: SalesOrder) => navigate(path.to.salesOrder(salesOrder.id!)),
    [navigate]
  );

  /*const invoice = useCallback(
    (salesOrder: SalesOrder) =>
      navigate(
        `${path.to.newPurchaseInvoice}?sourceDocument=Purchase Order&sourceDocumentId=${purchaseOrder.id}`
      ),
    [navigate]
  );

  const receive = useCallback(
    (salesOrder: SalesOrder) =>
      navigate(
        `${path.to.newReceipt}?sourceDocument=Purchase Order&sourceDocumentId=${salesOrder.id}`
      ),
    [navigate]
  );*/

  return {
    edit,
    //invoice,
    //receive,
  };
};
