import {
  BarProgress,
  HStack,
  MenuIcon,
  MenuItem,
  useDisclosure
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo, useState } from "react";
import {
  LuBookMarked,
  LuCalendar,
  LuMap,
  LuPencil,
  LuQrCode,
  LuSquareUser,
  LuStar,
  LuTrash,
  LuUser
} from "react-icons/lu";
import { useNavigate } from "react-router";
import {
  CustomerAvatar,
  EmployeeAvatar,
  Hyperlink,
  ItemThumbnail,
  New,
  Table
} from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { ConfirmDelete } from "~/components/Modals";
import { useDateFormatter, usePermissions } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import { useCustomers, usePeople } from "~/stores";
import { path } from "~/utils/path";
import { quoteStatusType } from "../../sales.models";
import type { Quotation } from "../../types";
import QuoteStatus from "./QuoteStatus";

type QuotesTableProps = {
  data: Quotation[];
  count: number;
};

const QuotesTable = memo(({ data, count }: QuotesTableProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const navigate = useNavigate();
  const { formatDate } = useDateFormatter();

  const [selectedQuotation, setSelectedQuotation] = useState<Quotation | null>(
    null
  );
  const deleteQuotationModal = useDisclosure();

  const [customers] = useCustomers();
  const [people] = usePeople();

  const customColumns = useCustomColumns<Quotation>("quote");
  const columns = useMemo<ColumnDef<Quotation>[]>(() => {
    const employeeOptions = people.map((employee) => ({
      value: employee.id,
      label: employee.name
    }));

    const defaultColumns: ColumnDef<Quotation>[] = [
      {
        accessorKey: "quoteId",
        header: t`Quote Number`,
        cell: ({ row }) => (
          <HStack>
            <ItemThumbnail
              size="md"
              thumbnailPath={row.original.thumbnailPath}
              // @ts-ignore
              type={row.original.itemType}
            />
            <Hyperlink to={path.to.quoteDetails(row.original.id!)}>
              <div className="flex justify-start items-center gap-0">
                <span>{row.original.quoteId}</span>
                {(row.original.revisionId ?? 0) > 0 && (
                  <span className="text-muted-foreground">
                    -{row.original.revisionId}
                  </span>
                )}
              </div>
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
        cell: ({ row }) => (
          <CustomerAvatar customerId={row.original.customerId} />
        ),
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
          const status = row.original.status;
          const lines = row.original.lines ?? 0;
          const completedLines = row.original.completedLines ?? 0;
          return status === "Draft" ? (
            <BarProgress
              gradient
              progress={lines === 0 ? 0 : (completedLines / lines) * 100}
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
              label: <QuoteStatus status={status} />
            }))
          },
          pluralHeader: t`Statuses`,
          icon: <LuStar />
        }
      },
      {
        accessorKey: "customerReference",
        header: t`Customer RFQ`,
        cell: (item) => item.getValue(),
        meta: {
          icon: <LuQrCode />
        }
      },
      {
        accessorKey: "salesPersonId",
        header: t`Sales Person`,
        cell: ({ row }) => (
          <EmployeeAvatar employeeId={row.original.salesPersonId} />
        ),
        meta: {
          filter: {
            type: "static",
            options: employeeOptions
          },
          icon: <LuUser />
        }
      },
      {
        accessorKey: "estimatorId",
        header: t`Estimator`,
        cell: ({ row }) => (
          <EmployeeAvatar employeeId={row.original.estimatorId} />
        ),
        meta: {
          filter: {
            type: "static",
            options: employeeOptions
          },
          icon: <LuUser />
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
            options: employeeOptions
          },
          icon: <LuUser />
        }
      },
      {
        accessorKey: "dueDate",
        header: t`Due Date`,
        cell: (item) => formatDate(item.getValue<string>()),
        meta: {
          icon: <LuCalendar />
        }
      },
      {
        accessorKey: "expirationDate",
        header: t`Expiration Date`,
        cell: (item) => formatDate(item.getValue<string>()),
        meta: {
          icon: <LuCalendar />
        }
      },
      {
        accessorKey: "locationName",
        header: t`Location`,
        cell: (item) => <Enumerable value={item.getValue<string>()} />,
        meta: {
          filter: {
            type: "fetcher",
            endpoint: path.to.api.locations,
            transform: (data: { id: string; name: string }[] | null) =>
              data?.map(({ name }) => ({
                value: name,
                label: <Enumerable value={name} />
              })) ?? []
          },
          icon: <LuMap />
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
  }, [customers, people, customColumns, t]);

  const renderContextMenu = useMemo(() => {
    return (row: Quotation) => (
      <>
        <MenuItem onClick={() => navigate(path.to.quoteDetails(row.id!))}>
          <MenuIcon icon={<LuPencil />} />
          <Trans>Edit</Trans>
        </MenuItem>
        <MenuItem
          disabled={!permissions.can("delete", "sales")}
          destructive
          onClick={() => {
            setSelectedQuotation(row);
            deleteQuotationModal.onOpen();
          }}
        >
          <MenuIcon icon={<LuTrash />} />
          <Trans>Delete</Trans>
        </MenuItem>
      </>
    );
  }, [deleteQuotationModal, navigate, permissions]);

  return (
    <>
      <Table<Quotation>
        count={count}
        columns={columns}
        data={data}
        defaultColumnPinning={{
          left: ["quoteId"]
        }}
        defaultColumnVisibility={{
          createdAt: false,
          createdBy: false,
          updatedAt: false,
          updatedBy: false
        }}
        primaryAction={
          permissions.can("create", "sales") && (
            <New label={t`Quote`} to={path.to.newQuote} />
          )
        }
        renderContextMenu={renderContextMenu}
        table="quote"
        title={t`Quotes`}
        withSavedView
      />
      {selectedQuotation && selectedQuotation.id && (
        <ConfirmDelete
          action={path.to.deleteQuote(selectedQuotation.id)}
          isOpen={deleteQuotationModal.isOpen}
          name={selectedQuotation.quoteId!}
          text={t`Are you sure you want to delete ${selectedQuotation.quoteId!}? This cannot be undone.`}
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
