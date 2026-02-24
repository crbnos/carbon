import {
  getEntityLabel,
  getEntityTypes,
  getTableLabel
} from "@carbon/database/audit.config";
import type { AuditDiff, AuditLogEntry } from "@carbon/database/audit.types";
import { Badge, HStack } from "@carbon/react";
import { formatDateTime } from "@carbon/utils";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import { LuFilePen, LuFilePlus, LuFileX } from "react-icons/lu";
import { Link } from "react-router";
import { EmployeeAvatar, Table } from "~/components";
import { path } from "~/utils/path";

type AuditLogTableProps = {
  entries: AuditLogEntry[];
  count: number;
};

const operationConfig: Record<
  string,
  { variant: "green" | "blue" | "red"; icon: React.ReactNode; label: string }
> = {
  INSERT: {
    variant: "green",
    icon: <LuFilePlus className="size-3" />,
    label: "Created"
  },
  UPDATE: {
    variant: "blue",
    icon: <LuFilePen className="size-3" />,
    label: "Updated"
  },
  DELETE: {
    variant: "red",
    icon: <LuFileX className="size-3" />,
    label: "Deleted"
  }
};

function formatValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return JSON.stringify(value);
}

function getEntityPath(entityId: string): string | null {
  const prefix = entityId.split("_")[0];
  if (!prefix || prefix === entityId) return null;

  const map: Record<string, (id: string) => string> = {
    pi: path.to.purchaseInvoice,
    si: path.to.salesInvoice,
    po: path.to.purchaseOrder,
    so: path.to.salesOrder,
    cust: path.to.customer,
    sup: path.to.supplier,
    item: path.to.part,
    job: path.to.job,
    quote: path.to.quote,
    emp: path.to.employeeAccount,
    nc: path.to.issue,
    sh: path.to.shipment,
    rec: path.to.receipt,
    g: path.to.gauge,
    sq: path.to.supplierQuote,
    wc: path.to.workCenter,
    main: path.to.maintenanceDispatch
  };
  const pathFn = map[prefix];
  return pathFn ? pathFn(entityId) : null;
}

const InlineDiff = memo(
  ({
    fieldName,
    oldValue,
    newValue
  }: {
    fieldName: string;
    oldValue: unknown;
    newValue: unknown;
  }) => (
    <div className="flex items-center gap-2 font-mono text-sm py-1">
      <span className="text-muted-foreground font-medium min-w-[120px]">
        {fieldName}:
      </span>
      {oldValue !== undefined && (
        <span className="px-2 py-0.5 rounded bg-red-500/10 text-red-500">
          {formatValue(oldValue)}
        </span>
      )}
      {oldValue !== undefined && newValue !== undefined && (
        <span className="text-muted-foreground">→</span>
      )}
      {newValue !== undefined && (
        <span className="px-2 py-0.5 rounded bg-green-500/10 text-green-500">
          {formatValue(newValue)}
        </span>
      )}
    </div>
  )
);
InlineDiff.displayName = "InlineDiff";

const ExpandedRowContent = memo(({ entry }: { entry: AuditLogEntry }) => {
  const hasDiff = entry.diff && Object.keys(entry.diff).length > 0;

  return (
    <div className="px-6 py-4">
      <div className="grid grid-cols-4 gap-4 mb-4 text-sm">
        <div>
          <span className="text-muted-foreground">Source</span>
          <div className="text-xs font-medium">
            {getTableLabel(entry.tableName)}
          </div>
        </div>
        <div>
          <span className="text-muted-foreground">Event ID</span>
          <div className="font-mono text-xs">{entry.id}</div>
        </div>
        <div>
          <span className="text-muted-foreground">Actor ID</span>
          <div className="font-mono text-xs">{entry.actorId ?? "System"}</div>
        </div>
        <div>
          <span className="text-muted-foreground">Timestamp</span>
          <div className="font-mono text-xs">{entry.createdAt}</div>
        </div>
      </div>

      <div>
        <h4 className="text-sm font-medium mb-2">Changes</h4>
        {hasDiff ? (
          <div className="space-y-1">
            {Object.entries(entry.diff as AuditDiff).map(
              ([fieldName, change]) => (
                <InlineDiff
                  key={fieldName}
                  fieldName={fieldName}
                  oldValue={change.old}
                  newValue={change.new}
                />
              )
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground italic">
            {entry.operation === "INSERT"
              ? "New record created"
              : entry.operation === "DELETE"
                ? "Record deleted"
                : "No changes recorded"}
          </p>
        )}
      </div>
    </div>
  );
});
ExpandedRowContent.displayName = "ExpandedRowContent";

const AuditLogTable = memo(({ entries, count }: AuditLogTableProps) => {
  const columns = useMemo<ColumnDef<AuditLogEntry>[]>(
    () => [
      {
        accessorKey: "entityType",
        header: "Entity",
        cell: ({ row }) => {
          const entry = row.original;
          const entityPath = getEntityPath(entry.entityId);
          return (
            <div>
              <div className="font-medium">
                {getEntityLabel(
                  entry.entityType as Parameters<typeof getEntityLabel>[0]
                )}
              </div>
              {entityPath ? (
                <Link
                  to={entityPath}
                  className="text-xs text-primary font-mono truncate max-w-[200px] block hover:underline"
                >
                  {entry.entityId}
                </Link>
              ) : (
                <div className="text-xs text-muted-foreground font-mono truncate max-w-[200px]">
                  {entry.entityId}
                </div>
              )}
            </div>
          );
        },
        meta: {
          filter: {
            type: "static",
            options: getEntityTypes().map((entityType) => ({
              label: getEntityLabel(entityType),
              value: entityType
            }))
          },
          pluralHeader: "Entities"
        }
      },
      {
        accessorKey: "operation",
        header: "Operation",
        cell: ({ row }) => {
          const config = operationConfig[row.original.operation];
          return (
            <Badge
              variant={config?.variant ?? "secondary"}
              className="shrink-0"
            >
              <HStack className="gap-1">
                {config?.icon}
                <span>{config?.label ?? row.original.operation}</span>
              </HStack>
            </Badge>
          );
        },
        meta: {
          filter: {
            type: "static",
            options: [
              { label: "Created", value: "INSERT" },
              { label: "Updated", value: "UPDATE" },
              { label: "Deleted", value: "DELETE" }
            ]
          }
        }
      },
      {
        accessorKey: "actorId",
        header: "Changed By",
        cell: ({ row }) => {
          const entry = row.original;
          return entry.actorId ? (
            <Link
              to={path.to.employeeAccount(entry.actorId)}
              className="hover:underline"
            >
              <EmployeeAvatar employeeId={entry.actorId} />
            </Link>
          ) : (
            <span className="text-muted-foreground text-sm">System</span>
          );
        }
      },
      {
        id: "changes",
        header: "Changes",
        cell: ({ row }) => {
          const entry = row.original;
          const hasDiff = entry.diff && Object.keys(entry.diff).length > 0;
          return (
            <span className="text-sm text-muted-foreground">
              {hasDiff
                ? `${Object.keys(entry.diff!).length} change${
                    Object.keys(entry.diff!).length !== 1 ? "s" : ""
                  }`
                : "-"}
            </span>
          );
        }
      },
      {
        accessorKey: "createdAt",
        header: "When",
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {formatDateTime(row.original.createdAt)}
          </span>
        )
      }
    ],
    []
  );

  const renderExpandedRow = useCallback(
    (entry: AuditLogEntry) => <ExpandedRowContent entry={entry} />,
    []
  );

  return (
    <Table
      data={entries}
      columns={columns}
      count={count}
      title="Audit Log"
      table="auditLog"
      withSearch
      withPagination
      renderExpandedRow={renderExpandedRow}
    />
  );
});

AuditLogTable.displayName = "AuditLogTable";
export default AuditLogTable;
