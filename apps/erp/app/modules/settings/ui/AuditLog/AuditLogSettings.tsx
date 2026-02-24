import { auditConfig } from "@carbon/database/audit.config";
import type { AuditLogArchive } from "@carbon/database/audit.types";
import {
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
import { formatDate } from "@carbon/utils";
import { memo, useCallback } from "react";
import { LuDownload } from "react-icons/lu";
import { useFetcher } from "react-router";

type AuditLogSettingsProps = {
  enabled: boolean;
  archives: AuditLogArchive[];
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

const AuditLogSettings = memo(
  ({ enabled, archives }: AuditLogSettingsProps) => {
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

    return (
      <>
        <Card>
          <CardHeader>
            <CardTitle>Audit Logging</CardTitle>
            <CardDescription>
              Track changes to key business entities including invoices, orders,
              customers, suppliers, and more.
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

        {enabled && (
          <Card>
            <CardHeader>
              <CardTitle>Archived Logs</CardTitle>
              <CardDescription>
                Logs older than {auditConfig.retentionDays} days are
                automatically archived.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {archives.length > 0 ? (
                <VStack className="gap-2">
                  {archives.map((archive) => (
                    <HStack
                      key={archive.id}
                      className="justify-between items-center p-6 border rounded-md w-full"
                    >
                      <VStack className="items-start">
                        <span className="font-medium text-sm">
                          {formatDate(archive.startDate)} -{" "}
                          {formatDate(archive.endDate)}
                        </span>
                        <span className="text-xs text-muted-foreground">
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
              ) : (
                <p className="text-sm text-muted-foreground text-center text-balance py-8">
                  No archived logs yet. Logs older than{" "}
                  {auditConfig.retentionDays} days will be automatically
                  archived and available for download here.
                </p>
              )}
            </CardContent>
          </Card>
        )}
      </>
    );
  }
);

AuditLogSettings.displayName = "AuditLogSettings";
export default AuditLogSettings;
