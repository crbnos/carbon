import {
  Badge,
  Checkbox,
  cn,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  HStack,
  MenuIcon,
  MenuItem,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useDisclosure,
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo, useState } from "react";
import {
  LuBookMarked,
  LuCalendar,
  LuCheck,
  LuCreditCard,
  LuDollarSign,
  LuEllipsisVertical,
  LuFactory,
  LuLoader,
  LuMapPin,
  LuPencil,
  LuQrCode,
  LuSquareUser,
  LuStar,
  LuTrash,
  LuTriangleAlert,
  LuTruck,
  LuUser,
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

import {
  getLocalTimeZone,
  isSameDay,
  parseDate,
  today,
} from "@internationalized/date";
import { useLocations } from "~/components/Form/Location";
import { usePaymentTerm } from "~/components/Form/PaymentTerm";
import { useShippingMethod } from "~/components/Form/ShippingMethod";
import type { jobStatus } from "~/modules/production/production.models";
import JobStatus from "~/modules/production/ui/Jobs/JobStatus";
import { useCustomers, usePeople } from "~/stores";
import { path } from "~/utils/path";
import { salesOrderStatusType } from "../../sales.models";
import type { SalesOrder, SalesOrderJob } from "../../types";
import SalesStatus from "./SalesStatus";
import { useSalesOrder } from "./useSalesOrder";

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
  const shippingMethods = useShippingMethod();
  const paymentTerms = usePaymentTerm();
  const locations = useLocations();
  const todaysDate = useMemo(() => today(getLocalTimeZone()), []);

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
              size="md"
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
          icon: <LuSquareUser />,
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
          const jobs = (row.original.jobs ?? []) as SalesOrderJob[];
          const lines =
            (row.original.lines as {
              id: string;
              saleQuantity: number;
              methodType: "Buy" | "Make" | "Pick";
            }[]) ?? [];

          if (
            lines.length === 0 ||
            lines.every((line) => line.methodType !== "Make")
          ) {
            return null;
          }

          const everyMadeLineHasSufficientJobs = lines.every((line) => {
            if (line.methodType !== "Make") return true;
            const relevantJobs =
              jobs.filter((job) => job.salesOrderLineId === line.id) ?? [];
            const totalJobQuantity = relevantJobs.reduce(
              (acc, job) => acc + job.productionQuantity,
              0
            );

            return totalJobQuantity >= line.saleQuantity;
          });

          const everyMadeLineIsCompleted = lines.every((line) => {
            if (line.methodType !== "Make") return true;
            const relevantJobs =
              jobs.filter((job) => job.salesOrderLineId === line.id) ?? [];
            const totalJobQuantity = relevantJobs.reduce(
              (acc, job) => acc + job.quantityComplete,
              0
            );
            return totalJobQuantity >= line.saleQuantity;
          });

          const statusIcon = everyMadeLineIsCompleted ? (
            <LuCheck className="w-3 h-3 mr-2 text-emerald-500" />
          ) : everyMadeLineHasSufficientJobs ? (
            <LuLoader className="w-3 h-3 mr-2 text-orange-500" />
          ) : (
            <LuTriangleAlert className="w-3 h-3 mr-2 text-red-500" />
          );

          return (
            <div
              className={cn(
                "flex flex-row items-center justify-center gap-2",
                !everyMadeLineHasSufficientJobs && jobs.length === 0
                  ? "justify-center"
                  : "justify-start"
              )}
            >
              {!everyMadeLineHasSufficientJobs && jobs.length === 0 && (
                <Tooltip>
                  <TooltipTrigger>
                    <LuTriangleAlert className="w-3 h-3 mr-2 text-red-500" />
                  </TooltipTrigger>
                  <TooltipContent side="left">
                    <p>Not enough jobs to cover quantity</p>
                  </TooltipContent>
                </Tooltip>
              )}
              {jobs.length > 0 && (
                <HoverCard>
                  <HoverCardTrigger>
                    <Badge variant="secondary" className="cursor-pointer">
                      {statusIcon}
                      {jobs.length} Job
                      {jobs.length > 1 ? "s" : ""}
                      <LuEllipsisVertical className="w-3 h-3 ml-2" />
                    </Badge>
                  </HoverCardTrigger>
                  <HoverCardContent className="w-[400px]">
                    <div className="flex flex-col w-full gap-4 text-sm">
                      {(
                        jobs as {
                          id: string;
                          jobId: string;
                          dueDate?: string;
                          status: (typeof jobStatus)[number];
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
                          </Hyperlink>
                          <div className="flex items-center justify-end gap-1 flex-wrap">
                            <JobStatus status={job.status} />
                            {[
                              "Draft",
                              "Planned",
                              "In Progress",
                              "Ready",
                              "Paused",
                            ].includes(job.status ?? "") && (
                              <>
                                {job.dueDate &&
                                  isSameDay(
                                    parseDate(job.dueDate),
                                    todaysDate
                                  ) && <JobStatus status="Due Today" />}
                                {job.dueDate &&
                                  parseDate(job.dueDate) < todaysDate && (
                                    <JobStatus status="Overdue" />
                                  )}
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </HoverCardContent>
                </HoverCard>
              )}
            </div>
          );
        },
        meta: {
          icon: <LuFactory />,
        },
      },
      {
        accessorKey: "customerReference",
        header: "Customer PO",
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
        accessorKey: "shippingMethodId",
        header: "Shipping Method",
        cell: (item) => (
          <Enumerable
            value={
              shippingMethods.find((sm) => sm.value === item.getValue<string>())
                ?.label ?? null
            }
          />
        ),
        meta: {
          icon: <LuTruck />,
        },
      },
      {
        accessorKey: "locationId",
        header: "Location",
        cell: ({ row }) => (
          <Enumerable
            value={
              locations.find((l) => l.value === row.original.locationId)
                ?.label ?? null
            }
          />
        ),
        meta: {
          icon: <LuMapPin />,
          filter: {
            type: "static",
            options: locations.map((l) => ({
              value: l.value,
              label: <Enumerable value={l.label} />,
            })),
          },
        },
      },
      {
        accessorKey: "paymentTermId",
        header: "Payment Method",
        cell: (item) => (
          <Enumerable
            value={
              paymentTerms.find((pt) => pt.value === item.getValue<string>())
                ?.label ?? null
            }
          />
        ),
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
        header: "Updated At",
        cell: (item) => formatDate(item.getValue<string>()),
        meta: {
          icon: <LuCalendar />,
        },
      },
    ];

    return [...defaultColumns, ...customColumns];
  }, [
    customers,
    people,
    locations,
    customColumns,
    todaysDate,
    currencyFormatter,
    shippingMethods,
    paymentTerms,
  ]);

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
        title="Sales Orders"
        table="salesOrder"
        withSavedView
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
