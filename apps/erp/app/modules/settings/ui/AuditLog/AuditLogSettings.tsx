import { auditConfig, getEntityLabel } from "@carbon/database/audit.config";
import type {
  AuditDiff,
  AuditLogArchive,
  AuditLogEntry
} from "@carbon/database/audit.types";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  HStack,
  Switch,
  VStack
} from "@carbon/react";
import { formatDate, formatDateTime } from "@carbon/utils";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuArchive,
  LuDownload,
  LuFilePen,
  LuFilePlus,
  LuFileX
} from "react-icons/lu";
import { useFetcher } from "react-router";
import { EmployeeAvatar, Table } from "~/components";

type AuditLogSettingsProps = {
  enabled: boolean;
  entries: AuditLogEntry[];
  archives: AuditLogArchive[];
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

// Format a value for display in the diff
function formatValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return JSON.stringify(value);
}

// Single-line diff display for a field change
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

// Expanded content for a row
const ExpandedRowContent = memo(({ entry }: { entry: AuditLogEntry }) => {
  const hasDiff = entry.diff && Object.keys(entry.diff).length > 0;

  return (
    <div className="px-6 py-4">
      {/* Metadata Row */}
      <div className="grid grid-cols-3 gap-4 mb-4 text-sm">
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

      {/* Changes Section */}
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

const AuditLogSettings = memo(
  ({ enabled, entries, archives, count }: AuditLogSettingsProps) => {
    const fetcher = useFetcher();

    const isToggling = fetcher.state !== "idle";

    const handleToggle = useCallback(
      (checked: boolean) => {
        fetcher.submit(
          { action: checked ? "enable" : "disable" },
          { method: "POST" }
        );
      },
      [fetcher]
    );

    const handleDownloadArchive = useCallback(
      (archiveId: string) => {
        fetcher.submit({ action: "download", archiveId }, { method: "POST" });
      },
      [fetcher]
    );

    const columns = useMemo<ColumnDef<AuditLogEntry>[]>(
      () => [
        {
          accessorKey: "entityType",
          header: "Entity",
          cell: ({ row }) => {
            const entry = row.original;
            return (
              <div>
                <div className="font-medium">
                  {getEntityLabel(
                    entry.entityType as (typeof auditConfig.entities)[number]
                  )}
                </div>
                <div className="text-xs text-muted-foreground font-mono truncate max-w-[200px]">
                  {entry.entityId}
                </div>
              </div>
            );
          },
          meta: {
            filter: {
              type: "static",
              options: auditConfig.entities.map((entity) => ({
                label: getEntityLabel(entity),
                value: entity
              }))
            }
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
              <EmployeeAvatar employeeId={entry.actorId} />
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
      <div className="flex flex-col h-full w-full">
        {/* Enable/Disable Card - fixed height section with padding */}
        <div className="px-4 md:px-6 pt-4 md:pt-6 flex-shrink-0">
          <Card>
            <CardHeader>
              <CardTitle>Audit Logging</CardTitle>
              <CardDescription>
                Track changes to key business entities including invoices,
                orders, customers, suppliers, and more.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <HStack className="justify-between items-center">
                <VStack className="items-start gap-1">
                  <span className="font-medium">
                    {enabled
                      ? "Audit logging is enabled"
                      : "Audit logging is disabled"}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {enabled
                      ? "All changes to auditable entities are being recorded."
                      : "Enable to start tracking changes to your data."}
                  </span>
                </VStack>
                <Switch
                  checked={enabled}
                  onCheckedChange={handleToggle}
                  disabled={isToggling}
                />
              </HStack>
            </CardContent>
          </Card>
        </div>

        {/* Audit Log Table - fills remaining space */}
        {enabled && (
          <div className="flex-1 min-h-0">
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
          </div>
        )}

        {/* Archives Section - only shown if archives exist */}
        {enabled && archives.length > 0 && (
          <div className="px-4 md:px-6 pb-4 md:pb-6 flex-shrink-0">
            <Card>
              <CardHeader>
                <HStack className="justify-between items-center">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <LuArchive className="size-5" />
                      Archived Logs
                    </CardTitle>
                    <CardDescription>
                      Logs older than {auditConfig.retentionDays} days are
                      automatically archived.
                    </CardDescription>
                  </div>
                </HStack>
              </CardHeader>
              <CardContent>
                <VStack className="gap-2">
                  {archives.map((archive) => (
                    <HStack
                      key={archive.id}
                      className="justify-between items-center p-3 border rounded-md"
                    >
                      <VStack className="items-start gap-0.5">
                        <span className="font-medium">
                          {formatDate(archive.startDate)} -{" "}
                          {formatDate(archive.endDate)}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          {archive.rowCount.toLocaleString()} records
                          {archive.sizeBytes &&
                            ` (${formatBytes(archive.sizeBytes)})`}
                        </span>
                      </VStack>
                      <Button
                        variant="secondary"
                        size="sm"
                        leftIcon={<LuDownload />}
                        onClick={() => handleDownloadArchive(archive.id)}
                      >
                        Download
                      </Button>
                    </HStack>
                  ))}
                </VStack>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    );
  }
);

AuditLogSettings.displayName = "AuditLogSettings";
export default AuditLogSettings;

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
