import { getTableLabel } from "@carbon/database/audit.config";
import type { AuditLogEntry } from "@carbon/database/audit.types";
import {
  Badge,
  cn,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  HStack,
  Skeleton,
  VStack
} from "@carbon/react";
import { formatDateTime } from "@carbon/utils";
import { memo, useEffect, useRef } from "react";
import { LuFilePen, LuFilePlus, LuFileX, LuHistory } from "react-icons/lu";
import { useFetcher } from "react-router";
import { EmployeeAvatar, Empty } from "~/components";

type AuditLogDrawerProps = {
  isOpen: boolean;
  onClose: () => void;
  entityType: string;
  entityId: string;
  companyId: string;
};

type AuditLogFetcherData = {
  entries: AuditLogEntry[];
};

const operationLabels: Record<
  string,
  { label: string; variant: "green" | "blue" | "red"; icon: React.ReactNode }
> = {
  INSERT: {
    label: "Created",
    variant: "green",
    icon: <LuFilePlus className="size-3" />
  },
  UPDATE: {
    label: "Updated",
    variant: "blue",
    icon: <LuFilePen className="size-3" />
  },
  DELETE: {
    label: "Deleted",
    variant: "red",
    icon: <LuFileX className="size-3" />
  }
};

const AuditLogDrawer = memo(
  ({
    isOpen,
    onClose,
    entityType,
    entityId,
    companyId
  }: AuditLogDrawerProps) => {
    const fetcher = useFetcher<AuditLogFetcherData>();
    const lastLoadedRef = useRef<string | null>(null);
    const loadKey = `${entityType}:${entityId}:${companyId}`;

    // Load audit log data when drawer opens or entity changes
    useEffect(() => {
      if (
        isOpen &&
        entityType &&
        entityId &&
        fetcher.state === "idle" &&
        lastLoadedRef.current !== loadKey
      ) {
        lastLoadedRef.current = loadKey;
        const params = new URLSearchParams({
          entityType,
          entityId,
          companyId
        });
        fetcher.load(`/api/audit-log?${params.toString()}`);
      }
    }, [isOpen, entityType, entityId, companyId, loadKey, fetcher]);

    // Reset tracking when drawer closes so it re-fetches on next open
    useEffect(() => {
      if (!isOpen) {
        lastLoadedRef.current = null;
      }
    }, [isOpen]);

    const entries = fetcher.data?.entries ?? [];
    const isLoading = fetcher.state === "loading";

    return (
      <Drawer
        open={isOpen}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <DrawerContent size="lg" position="left">
          <DrawerHeader>
            <DrawerTitle className="flex items-center gap-2">
              <LuHistory className="size-5" />
              History
            </DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            {isLoading ? (
              <VStack spacing={3}>
                <Skeleton className="w-full h-[151px]" />
                <Skeleton className="w-full h-[151px]" />
              </VStack>
            ) : entries.length === 0 ? (
              <Empty />
            ) : (
              <VStack spacing={3}>
                {entries.map((entry) => (
                  <AuditLogEntryCard key={entry.id} entry={entry} />
                ))}
              </VStack>
            )}
          </DrawerBody>
        </DrawerContent>
      </Drawer>
    );
  }
);

AuditLogDrawer.displayName = "AuditLogDrawer";
export default AuditLogDrawer;

type AuditLogEntryCardProps = {
  entry: AuditLogEntry;
};

const AuditLogEntryCard = memo(({ entry }: AuditLogEntryCardProps) => {
  const opInfo = operationLabels[entry.operation] ?? {
    label: entry.operation,
    variant: "secondary" as const,
    icon: null
  };

  const diffKeys = entry.diff ? Object.keys(entry.diff) : [];

  return (
    <div className="border bg-muted/40 rounded-lg p-4 w-full">
      <HStack className="justify-between items-start mb-3">
        <VStack spacing={1}>
          {entry.actorId ? (
            <EmployeeAvatar employeeId={entry.actorId} />
          ) : (
            <span className="font-medium">System</span>
          )}
          <span
            className={cn(
              "text-xs text-muted-foreground",
              entry.actorId && "pl-8"
            )}
          >
            {formatDateTime(entry.createdAt)}
          </span>
        </VStack>
        <VStack spacing={1} className="items-end">
          <Badge variant={opInfo.variant} className="flex-shrink-0">
            <HStack className="gap-1">
              {opInfo.icon}
              <span>{opInfo.label}</span>
            </HStack>
          </Badge>
          <span className="text-xs text-muted-foreground">
            {getTableLabel(entry.tableName)}
          </span>
        </VStack>
      </HStack>

      <div className="mt-3 pt-3 border-t">
        <p className="text-sm font-medium mb-2">Changes</p>
        {diffKeys.length > 0 ? (
          <div className="space-y-1">
            {diffKeys.map((key) => {
              const change = entry.diff![key];
              return (
                <div
                  key={key}
                  className="flex items-center gap-2 font-mono text-sm py-1"
                >
                  <span className="text-muted-foreground font-medium min-w-[120px]">
                    {key}:
                  </span>
                  {change.old !== undefined && (
                    <span className="px-2 py-0.5 rounded bg-red-500/10 text-red-500">
                      {formatValue(change.old)}
                    </span>
                  )}
                  {change.old !== undefined && change.new !== undefined && (
                    <span className="text-muted-foreground">→</span>
                  )}
                  {change.new !== undefined && (
                    <span className="px-2 py-0.5 rounded bg-green-500/10 text-green-500">
                      {formatValue(change.new)}
                    </span>
                  )}
                </div>
              );
            })}
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

AuditLogEntryCard.displayName = "AuditLogEntryCard";

function formatValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return JSON.stringify(value);
}
