import {
  Badge,
  cn,
  Separator,
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@carbon/react";
import { Fragment, useMemo } from "react";
import { LuPaperclip } from "react-icons/lu";
import type { z } from "zod";
import { path } from "~/utils/path";
import type { jobOperationValidator } from "./shared";

type Operation = z.infer<typeof jobOperationValidator>[number];

function operationVariant(op: Operation): "green" | "orange" | "gray" {
  if (op.status === "Done") return "green";
  if (op.status === "In Progress") return "orange";
  return "gray";
}

function OperationPill({
  operation,
  className
}: {
  operation: Operation;
  className?: string;
}) {
  return (
    <Badge
      variant={operationVariant(operation)}
      className={cn("rounded-full text-[10px] max-w-[140px]", className)}
      title={operation.description}
    >
      {operation.description}
    </Badge>
  );
}

export function JobOperationProgress({
  customerId,
  jobOperations,
  jobOperationAttachments
}: {
  customerId: string;
  jobOperations: z.infer<typeof jobOperationValidator>;
  jobOperationAttachments: Record<string, string[]>;
}) {
  const sorted = useMemo(
    () => [...jobOperations].sort((a, b) => a.order - b.order),
    [jobOperations]
  );

  if (sorted.length === 0) return null;

  const firstUnfinished = sorted.findIndex((op) => op.status !== "Done");
  const activeIdx =
    firstUnfinished === -1 ? sorted.length - 1 : firstUnfinished;
  const shouldCollapse = sorted.length > 4;

  const visibleIndices = shouldCollapse
    ? [...new Set([0, activeIdx, sorted.length - 1])].sort((a, b) => a - b)
    : sorted.map((_, i) => i);

  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-1.5 cursor-default">
          {visibleIndices.map((idx, i) => {
            const hasGapBefore = i > 0 && idx - visibleIndices[i - 1] > 1;
            return (
              <Fragment key={sorted[idx].id}>
                {hasGapBefore && (
                  <span
                    aria-hidden="true"
                    className="text-muted-foreground text-xs select-none leading-none"
                  >
                    ···
                  </span>
                )}
                <OperationPill operation={sorted[idx]} />
              </Fragment>
            );
          })}
        </div>
      </TooltipTrigger>
      <TooltipContent align="start" className="w-96 p-2">
        <div className="text-[11px] font-medium text-muted-foreground px-2 py-1 uppercase tracking-wide">
          Operations
        </div>
        <Separator className="mb-1" />
        <div className="flex flex-col gap-0.5 max-h-80 overflow-y-auto">
          {sorted.map((op) => {
            const attachments = jobOperationAttachments[op.id] ?? [];
            return (
              <div
                key={op.id}
                className="flex items-center justify-between gap-3 px-2 py-1.5 rounded-md hover:bg-muted/50"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <OperationPill operation={op} className="max-w-[120px]" />
                  <span className="text-xs truncate font-medium">
                    {op.description}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    {op.quantityComplete}/{op.operationQuantity}
                  </span>
                  {attachments.length > 0 && (
                    <div className="flex items-center gap-1">
                      {attachments.map((attachment) => {
                        const fileName = attachment.split("/").pop();
                        return (
                          <a
                            key={attachment}
                            href={path.to.externalCustomerFile(
                              customerId,
                              attachment
                            )}
                            target="_blank"
                            rel="noreferrer"
                            title={fileName}
                            className="text-muted-foreground hover:text-foreground"
                          >
                            <LuPaperclip className="size-3" />
                          </a>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
