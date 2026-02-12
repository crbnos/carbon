import type { AuditLogEntry } from "@carbon/database/audit.types";
import {
  Badge,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  HStack,
  Spinner,
  VStack
} from "@carbon/react";
import { formatDateTime } from "@carbon/utils";
import { memo, useEffect } from "react";
import { LuFilePen, LuFilePlus, LuFileX, LuHistory } from "react-icons/lu";
import { useFetcher } from "react-router";
import { EmployeeAvatar } from "~/components";

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

    // Load audit log data when drawer opens
    useEffect(() => {
      if (
        isOpen &&
        entityType &&
        entityId &&
        fetcher.state === "idle" &&
        !fetcher.data
      ) {
        const params = new URLSearchParams({
          entityType,
          entityId,
          companyId
        });
        fetcher.load(`/api/audit-log?${params.toString()}`);
      }
    }, [isOpen, entityType, entityId, companyId, fetcher]);

    // Reset when drawer closes
    useEffect(() => {
      if (!isOpen) {
        // The fetcher will be reset on next open due to the data check above
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
        <DrawerContent size="md">
          <DrawerHeader>
            <DrawerTitle className="flex items-center gap-2">
              <LuHistory className="size-5" />
              Audit History
            </DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Spinner />
              </div>
            ) : entries.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <LuHistory className="size-12 mb-4 opacity-50" />
                <p>No audit history found</p>
                <p className="text-sm">
                  Changes to this record will appear here.
                </p>
              </div>
            ) : (
              <VStack className="gap-4">
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
    <div className="border rounded-lg p-4 w-full">
      <HStack className="justify-between items-start mb-3">
        <HStack className="gap-2">
          {entry.actorId ? (
            <EmployeeAvatar employeeId={entry.actorId} />
          ) : (
            <VStack className="items-start gap-0">
              <span className="font-medium">System</span>
              <span className="text-xs text-muted-foreground">
                {formatDateTime(entry.createdAt)}
              </span>
            </VStack>
          )}
          {entry.actorId && (
            <VStack className="items-start gap-0">
              <span className="text-xs text-muted-foreground">
                {formatDateTime(entry.createdAt)}
              </span>
            </VStack>
          )}
        </HStack>
        <Badge variant={opInfo.variant}>
          <HStack className="gap-1">
            {opInfo.icon}
            <span>{opInfo.label}</span>
          </HStack>
        </Badge>
      </HStack>

      {/* Show diff for UPDATE operations */}
      {entry.operation === "UPDATE" && diffKeys.length > 0 && (
        <div className="mt-3 pt-3 border-t">
          <p className="text-sm font-medium mb-2">Changes</p>
          <VStack className="gap-2">
            {diffKeys.map((key) => {
              const change = entry.diff![key];
              return (
                <div
                  key={key}
                  className="text-sm bg-muted/50 rounded px-2 py-1"
                >
                  <span className="font-medium text-muted-foreground">
                    {formatFieldName(key)}:
                  </span>{" "}
                  <span className="text-red-600 line-through">
                    {formatValue(change.old)}
                  </span>{" "}
                  <span className="text-muted-foreground">→</span>{" "}
                  <span className="text-green-600">
                    {formatValue(change.new)}
                  </span>
                </div>
              );
            })}
          </VStack>
        </div>
      )}
    </div>
  );
});

AuditLogEntryCard.displayName = "AuditLogEntryCard";

function formatFieldName(key: string): string {
  // Convert camelCase to Title Case with spaces
  // Also handles nested paths like "customFields.myField"
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/\./g, " → ")
    .replace(/^./, (str) => str.toUpperCase())
    .trim();
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "(empty)";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
