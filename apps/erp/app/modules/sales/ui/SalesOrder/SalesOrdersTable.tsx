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
  useDisclosure
} from "@carbon/react";
import {
  getLocalTimeZone,
  isSameDay,
  parseDate,
  today
} from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import type { ReactNode } from "react";
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
  LuUser
} from "react-icons/lu";
import {
  CustomerAvatar,
  EmployeeAvatar,
  Hyperlink,
  ItemThumbnail,
  New,
  Table
} from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useLocations } from "~/components/Form/Location";
import { usePaymentTerm } from "~/components/Form/PaymentTerm";
import { useShippingMethod } from "~/components/Form/ShippingMethod";
import { ConfirmDelete } from "~/components/Modals";
import {
  useCurrencyFormatter,
  useDateFormatter,
  usePermissions
} from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
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

const IconWithTooltip = ({
  icon,
  tooltip
}: {
  icon: ReactNode;
  tooltip: string;
}) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <span className="inline-flex">{icon}</span>
    </TooltipTrigger>
    <TooltipContent>
      <p>{tooltip}</p>
    </TooltipContent>
  </Tooltip>
);

const SalesOrdersTable = memo(({ data, count }: SalesOrdersTableProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const currencyFormatter = useCurrencyFormatter();
  const { formatDate } = useDateFormatter();

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
        header: t`Sales Order Number`,
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
          icon: <LuBookMarked />
        }
      },
      {
        id: "customerId",
        header: t`Customer`,
        cell: ({ row }) => {
          return <CustomerAvatar customerId={row.original.customerId} />;
        },
        meta: {
          filter: {
            type: "static",
            options: customers?.map((customer) => ({
              value: customer.id,
              label: customer.name
            }))
          },
          icon: <LuSquareUser />
        }
      },
      {
        accessorKey: "status",
        header: t`Status`,
        cell: ({ row }) => {
          const status =
            row.getValue<(typeof salesOrderStatusType)[number]>("status");
          const jobs = (row.original.jobs ?? []) as SalesOrderJob[];
          const lines =
            (row.original.lines as {
              id: string;
              saleQuantity: number;
              methodType:
                | "Purchase to Order"
                | "Make to Order"
                | "Pull from Inventory";
            }[]) ?? [];
          return (
            <SalesStatus
              status={status}
              jobs={jobs.map((job) => ({
                salesOrderLineId: job.salesOrderLineId,
                productionQuantity: job.quantity,
                quantityComplete: job.quantityComplete,
                status: job.status
              }))}
              lines={lines.map((line) => ({
                id: line.id,
                methodType: line.methodType,
                saleQuantity: line.saleQuantity
              }))}
            />
          );
        },
        meta: {
          filter: {
            type: "static",
            options: salesOrderStatusType.map((status) => ({
              value: status,
              label: <SalesStatus status={status} />
            }))
          },
          pluralHeader: t`Statuses`,
          icon: <LuStar />
        }
      },
      {
        id: "jobs",
        header: t`Jobs`,
        cell: ({ row }) => {
          const jobs = (row.original.jobs ?? []) as SalesOrderJob[];
          const lines =
            (row.original.lines as {
              id: string;
              saleQuantity: number;
              methodType:
                | "Purchase to Order"
                | "Make to Order"
                | "Pull from Inventory";
            }[]) ?? [];

          if (
            lines.length === 0 ||
            lines.every((line) => line.methodType !== "Make to Order")
          ) {
            return null;
          }

          const everyMadeLineHasSufficientJobs = lines.every((line) => {
            if (line.methodType !== "Make to Order") return true;
            const relevantJobs =
              jobs.filter?.((job) => job.salesOrderLineId === line.id) ?? [];
            const totalJobQuantity = relevantJobs.reduce(
              (acc, job) => acc + job.quantity,
              0
            );

            return totalJobQuantity >= line.saleQuantity;
          });

          const everyMadeLineIsCompleted = lines.every((line) => {
            if (line.methodType !== "Make to Order") return true;
            const relevantJobs =
              jobs.filter?.((job) => job.salesOrderLineId === line.id) ?? [];
            const totalJobQuantity = relevantJobs.reduce(
              (acc, job) => acc + job.quantityComplete,
              0
            );
            return totalJobQuantity >= line.saleQuantity;
          });

          const statusIcon = everyMadeLineIsCompleted ? (
            <IconWithTooltip
              icon={<LuCheck className="w-3 h-3 mr-2 text-emerald-500" />}
              tooltip={t`All jobs completed`}
            />
          ) : everyMadeLineHasSufficientJobs ? (
            <IconWithTooltip
              icon={<LuLoader className="w-3 h-3 mr-2 text-orange-500" />}
              tooltip={t`Jobs in progress`}
            />
          ) : (
            <IconWithTooltip
              icon={<LuTriangleAlert className="w-3 h-3 mr-2 text-red-500" />}
              tooltip={t`Not enough jobs to cover quantity`}
            />
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
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <LuTriangleAlert className="w-3 h-3 mr-2 text-red-500" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="left">
                    <p>
                      <Trans>Not enough jobs to cover quantity</Trans>
                    </p>
                  </TooltipContent>
                </Tooltip>
              )}
              {jobs.length > 0 && (
                <HoverCard>
                  <HoverCardTrigger>
                    <Badge variant="secondary" className="cursor-pointer">
                      {statusIcon}
                      {jobs.length}{" "}
                      {jobs.length > 1 ? (
                        <Trans>Jobs</Trans>
                      ) : (
                        <Trans>Job</Trans>
                      )}
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
                              "Paused"
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
          icon: <LuFactory />
        }
      },
      {
        accessorKey: "customerReference",
        header: t`Customer PO`,
        cell: (item) => item.getValue(),
        meta: {
          icon: <LuQrCode />
        }
      },
      {
        accessorKey: "orderDate",
        header: t`Order Date`,
        cell: (item) => formatDate(item.getValue<string>()),
        meta: {
          icon: <LuCalendar />
        }
      },
      {
        accessorKey: "orderTotal",
        header: t`Order Total`,
        cell: (item) => currencyFormatter.format(item.getValue<number>()),
        meta: {
          icon: <LuDollarSign />,
          formatter: currencyFormatter.format,
          renderTotal: true
        }
      },

      {
        id: "assignee",
        header: t`Assignee`,
        cell: ({ row }) => (
          <EmployeeAvatar employeeId={row.original.assignee} />
        ),
        meta: {
          filter: {
            type: "static",
            options: people.map((employee) => ({
              value: employee.id,
              label: employee.name
            }))
          },
          icon: <LuUser />
        }
      },
      {
        accessorKey: "receiptPromisedDate",
        header: t`Promised Date`,
        cell: (item) => formatDate(item.getValue<string>()),
        meta: {
          icon: <LuCalendar />
        }
      },
      {
        accessorKey: "shippingMethodId",
        header: t`Shipping Method`,
        cell: (item) => (
          <Enumerable
            value={
              shippingMethods.find((sm) => sm.value === item.getValue<string>())
                ?.label ?? null
            }
          />
        ),
        meta: {
          icon: <LuTruck />
        }
      },
      {
        accessorKey: "locationId",
        header: t`Location`,
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
              label: <Enumerable value={l.label} />
            }))
          }
        }
      },
      {
        accessorKey: "paymentTermId",
        header: t`Payment Method`,
        cell: (item) => (
          <Enumerable
            value={
              paymentTerms.find((pt) => pt.value === item.getValue<string>())
                ?.label ?? null
            }
          />
        ),
        meta: {
          icon: <LuCreditCard />
        }
      },
      {
        accessorKey: "dropShipment",
        header: t`Drop Shipment`,
        cell: (item) => <Checkbox isChecked={item.getValue<boolean>()} />,
        meta: {
          filter: {
            type: "static",
            options: [
              {
                value: "true",
                label: t`Yes`
              },
              {
                value: "false",
                label: t`No`
              }
            ]
          },
          pluralHeader: t`Drop Shipment Statuses`,
          icon: <LuTruck />
        }
      },
      {
        id: "createdBy",
        header: t`Created By`,
        cell: ({ row }) => (
          <EmployeeAvatar employeeId={row.original.createdBy} />
        ),
        meta: {
          filter: {
            type: "static",
            options: people.map((employee) => ({
              value: employee.id,
              label: employee.name
            }))
          },
          icon: <LuUser />
        }
      },
      {
        accessorKey: "createdAt",
        header: t`Created At`,
        cell: (item) => formatDate(item.getValue<string>()),
        meta: {
          icon: <LuCalendar />
        }
      },
      {
        id: "updatedBy",
        header: t`Updated By`,
        cell: ({ row }) => (
          <EmployeeAvatar employeeId={row.original.updatedBy} />
        ),
        meta: {
          filter: {
            type: "static",
            options: people.map((employee) => ({
              value: employee.id,
              label: employee.name
            }))
          },
          icon: <LuUser />
        }
      },
      {
        accessorKey: "updatedAt",
        header: t`Updated At`,
        cell: (item) => formatDate(item.getValue<string>()),
        meta: {
          icon: <LuCalendar />
        }
      }
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
    t
  ]);

  const renderContextMenu = useMemo(() => {
    return (row: SalesOrder) => (
      <>
        <MenuItem
          disabled={!permissions.can("view", "sales")}
          onClick={() => edit(row)}
        >
          <MenuIcon icon={<LuPencil />} />
          <Trans>Edit</Trans>
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
          <Trans>Delete</Trans>
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
          left: ["salesOrderId"]
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
          updatedAt: false
        }}
        primaryAction={
          permissions.can("create", "sales") && (
            <New label={t`Sales Order`} to={path.to.newSalesOrder} />
          )
        }
        renderContextMenu={renderContextMenu}
        title={t`Sales Orders`}
        table="salesOrder"
        withSavedView
      />

      {selectedSalesOrder && selectedSalesOrder.id && (
        <ConfirmDelete
          action={path.to.deleteSalesOrder(selectedSalesOrder.id)}
          isOpen={deleteSalesOrderModal.isOpen}
          name={selectedSalesOrder.salesOrderId!}
          text={t`Are you sure you want to delete ${selectedSalesOrder.salesOrderId!}? This cannot be undone.`}
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
