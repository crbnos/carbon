import type { PrintJob } from "@carbon/printing";
import {
  Badge,
  Button,
  HStack,
  MenuIcon,
  MenuItem,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle
} from "@carbon/react";
import { formatDateTime } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  LuCalendar,
  LuCircleCheck,
  LuCircleX,
  LuClock,
  LuEye,
  LuFileText,
  LuLoader,
  LuPrinter,
  LuRefreshCw,
  LuTrash
} from "react-icons/lu";
import { useFetcher } from "react-router";
import { Table } from "~/components";

type PrintJobsTableProps = {
  jobs: PrintJob[];
  count: number;
};

type ViewContent = {
  content: string;
  contentType: string;
  printJobId: string;
};

const statusConfig: Record<
  string,
  {
    variant: "yellow" | "blue" | "green" | "red" | "purple";
    icon: React.ReactNode;
    label: string;
  }
> = {
  generating: {
    variant: "purple",
    icon: <LuLoader className="size-3" />,
    label: "Generating"
  },
  queued: {
    variant: "yellow",
    icon: <LuClock className="size-3" />,
    label: "Queued"
  },
  printing: {
    variant: "blue",
    icon: <LuPrinter className="size-3" />,
    label: "Printing"
  },
  completed: {
    variant: "green",
    icon: <LuCircleCheck className="size-3" />,
    label: "Completed"
  },
  failed: {
    variant: "red",
    icon: <LuCircleX className="size-3" />,
    label: "Failed"
  }
};

const ExpandedRowContent = memo(({ job }: { job: PrintJob }) => {
  return (
    <div className="px-6 py-4">
      <div className="grid grid-cols-4 gap-4 mb-4 text-sm">
        <div>
          <span className="text-muted-foreground">Printer URL</span>
          <div className="font-mono text-xs break-all">{job.printerUrl}</div>
        </div>
        <div>
          <span className="text-muted-foreground">Source Document</span>
          <div className="font-mono text-xs">
            {job.sourceDocumentReadableId ?? job.sourceDocumentId}
          </div>
        </div>
        <div>
          <span className="text-muted-foreground">Attempts</span>
          <div className="font-mono text-xs">{job.attempts}</div>
        </div>
        <div>
          <span className="text-muted-foreground">Completed At</span>
          <div className="font-mono text-xs">
            {job.completedAt ? formatDateTime(job.completedAt) : "—"}
          </div>
        </div>
        <div>
          <span className="text-muted-foreground">Event ID</span>
          <div className="font-mono text-xs">{job.id}</div>
        </div>
        <div>
          <span className="text-muted-foreground">Created At</span>
          <div className="font-mono text-xs">
            {formatDateTime(job.createdAt)}
          </div>
        </div>
        <div>
          <span className="text-muted-foreground">Updated At</span>
          <div className="font-mono text-xs">
            {job.updatedAt ? formatDateTime(job.updatedAt) : "—"}
          </div>
        </div>
        <div>
          <span className="text-muted-foreground">Created By</span>
          <div className="font-mono text-xs">{job.createdBy}</div>
        </div>
      </div>

      {job.error && (
        <div>
          <h4 className="text-sm font-medium mb-2">Error</h4>
          <pre className="text-xs font-mono bg-red-500/10 text-red-500 p-3 rounded-md whitespace-pre-wrap">
            {job.error}
          </pre>
        </div>
      )}
    </div>
  );
});
ExpandedRowContent.displayName = "ExpandedRowContent";

function parseZplDimensions(zplContent: string) {
  const pwMatch = zplContent.match(/\^PW(\d+)/);
  const llMatch = zplContent.match(/\^LL(\d+)/);
  const dpi = 203;
  const dpmm = Math.round(dpi / 25.4);

  const widthInches = pwMatch
    ? Math.max(0.5, Math.round((Number(pwMatch[1]) / dpi) * 10) / 10)
    : 2;
  const heightInches = llMatch
    ? Math.max(0.5, Math.round((Number(llMatch[1]) / dpi) * 10) / 10)
    : 1;

  return { dpmm, width: widthInches, height: heightInches };
}

function ZplPreview({ zpl }: { zpl: string }) {
  const { t } = useLingui();
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let revoked = false;
    let objectUrl: string | null = null;
    const { dpmm, width, height } = parseZplDimensions(zpl);

    fetch(
      `https://api.labelary.com/v1/printers/${dpmm}dpmm/labels/${width}x${height}/0/`,
      {
        method: "POST",
        headers: {
          Accept: "image/png",
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: zpl
      }
    )
      .then((res) => {
        if (!res.ok) throw new Error(`Labelary returned ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        if (revoked) return;
        objectUrl = URL.createObjectURL(blob);
        setImageUrl(objectUrl);
        setLoading(false);
      })
      .catch((err) => {
        if (revoked) return;
        setError(err.message);
        setLoading(false);
      });

    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [zpl]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
        <Trans>Rendering label preview...</Trans>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-destructive">
          <Trans>Preview failed: {error}</Trans>
        </p>
        <pre className="text-xs font-mono bg-muted p-4 rounded-md overflow-auto whitespace-pre-wrap break-all max-h-[40vh]">
          {zpl}
        </pre>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <img
        src={imageUrl!}
        alt={t`ZPL Label Preview`}
        className="border border-border rounded-md max-h-[350px] object-contain self-start"
      />
      <pre className="text-xs font-mono bg-muted p-4 rounded-md overflow-auto whitespace-pre-wrap break-all max-h-[30vh]">
        {zpl}
      </pre>
    </div>
  );
}

const PrintJobsTable = memo(({ jobs, count }: PrintJobsTableProps) => {
  const { t } = useLingui();
  const fetcher = useFetcher<{
    success: boolean;
    message?: string;
    content?: string;
    contentType?: string;
    printJobId?: string;
  }>();
  const [viewContent, setViewContent] = useState<ViewContent | null>(null);

  useEffect(() => {
    if (fetcher.data && "content" in fetcher.data && fetcher.data.content) {
      setViewContent({
        content: fetcher.data.content,
        contentType: fetcher.data.contentType as string,
        printJobId: fetcher.data.printJobId as string
      });
    }
  }, [fetcher.data]);

  const columns = useMemo<ColumnDef<PrintJob>[]>(
    () => [
      {
        accessorKey: "status",
        header: t`Status`,
        cell: ({ row }) => {
          const config = statusConfig[row.original.status];
          return (
            <Badge
              variant={config?.variant ?? "secondary"}
              className="shrink-0"
            >
              <HStack className="gap-1">
                {config?.icon}
                <span>{config?.label ?? row.original.status}</span>
              </HStack>
            </Badge>
          );
        },
        meta: {
          filter: {
            type: "static",
            options: [
              { label: "Generating", value: "generating" },
              { label: "Queued", value: "queued" },
              { label: "Printing", value: "printing" },
              { label: "Completed", value: "completed" },
              { label: "Failed", value: "failed" }
            ]
          }
        }
      },
      {
        accessorKey: "description",
        header: t`Description`,
        cell: ({ row }) => (
          <div className="max-w-[300px] truncate font-medium">
            {row.original.description}
          </div>
        ),
        meta: {
          icon: <LuFileText />
        }
      },
      {
        accessorKey: "sourceDocument",
        header: t`Source`,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.sourceDocument}
          </span>
        ),
        meta: {
          filter: {
            type: "static",
            options: [
              { label: "Receipt", value: "receipt" },
              { label: "Shipment", value: "shipment" },
              { label: "Operation", value: "operation" },
              { label: "Job", value: "job" },
              { label: "Item", value: "item" },
              { label: "Kanban", value: "kanban" },
              { label: "Split", value: "split" }
            ]
          }
        }
      },
      {
        accessorKey: "contentType",
        header: t`Type`,
        cell: ({ row }) => (
          <span className="font-mono text-xs uppercase text-muted-foreground">
            {row.original.contentType ?? "—"}
          </span>
        ),
        meta: {
          filter: {
            type: "static",
            options: [
              { label: "ZPL", value: "zpl" },
              { label: "PDF", value: "pdf" }
            ]
          }
        }
      },
      {
        accessorKey: "origin",
        header: t`Origin`,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground capitalize">
            {row.original.origin}
          </span>
        ),
        meta: {
          filter: {
            type: "static",
            options: [
              { label: "Auto", value: "auto" },
              { label: "Manual", value: "manual" },
              { label: "Reprint", value: "reprint" }
            ]
          }
        }
      },
      {
        accessorKey: "createdAt",
        header: t`When`,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {formatDateTime(row.original.createdAt)}
          </span>
        ),
        meta: {
          icon: <LuCalendar />
        }
      }
    ],
    [t]
  );

  const renderExpandedRow = useCallback(
    (job: PrintJob) => <ExpandedRowContent job={job} />,
    []
  );

  const renderContextMenu = useCallback(
    (job: PrintJob) => (
      <>
        <MenuItem
          disabled={job.status === "generating"}
          onClick={() => {
            fetcher.submit(
              { intent: "viewContent", printJobId: job.id },
              { method: "post" }
            );
          }}
        >
          <MenuIcon icon={<LuEye />} />
          <Trans>View</Trans>
        </MenuItem>
        <MenuItem
          disabled={job.status === "generating"}
          onClick={() => {
            fetcher.submit(
              {
                intent: "reprint",
                printJobId: job.id,
                printerUrl: job.printerUrl
              },
              { method: "post" }
            );
          }}
        >
          <MenuIcon icon={<LuRefreshCw />} />
          <Trans>Reprint</Trans>
        </MenuItem>
        <MenuItem
          destructive
          onClick={() => {
            fetcher.submit(
              { intent: "delete", printJobId: job.id },
              { method: "post" }
            );
          }}
        >
          <MenuIcon icon={<LuTrash />} />
          <Trans>Delete</Trans>
        </MenuItem>
      </>
    ),
    [fetcher]
  );

  return (
    <>
      <Table
        data={jobs}
        columns={columns}
        count={count}
        title={t`Print Jobs`}
        table="printJob"
        withSearch
        withPagination
        renderExpandedRow={renderExpandedRow}
        renderContextMenu={renderContextMenu}
      />
      {viewContent && (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open) setViewContent(null);
          }}
        >
          <ModalContent size="large">
            <ModalHeader>
              <ModalTitle>
                <Trans>
                  Print Output ({viewContent.contentType?.toUpperCase()})
                </Trans>
              </ModalTitle>
            </ModalHeader>
            <ModalBody>
              {viewContent.contentType === "zpl" ? (
                <ZplPreview zpl={viewContent.content} />
              ) : viewContent.contentType === "pdf" ? (
                <iframe
                  src={`data:application/pdf;base64,${viewContent.content}`}
                  className="w-full h-[60vh] border border-border rounded-md"
                  title={t`PDF Preview`}
                />
              ) : null}
            </ModalBody>
            <ModalFooter>
              <Button variant="secondary" onClick={() => setViewContent(null)}>
                <Trans>Close</Trans>
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      )}
    </>
  );
});

PrintJobsTable.displayName = "PrintJobsTable";
export default PrintJobsTable;
