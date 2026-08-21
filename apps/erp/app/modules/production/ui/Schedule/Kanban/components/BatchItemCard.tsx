import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton
} from "@carbon/react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useLingui } from "@lingui/react/macro";
import {
  LuEllipsisVertical,
  LuGripVertical,
  LuLayers,
  LuPlay,
  LuTrash,
  LuX
} from "react-icons/lu";
import { useFetcher } from "react-router";
import { path } from "~/utils/path";
import type { BatchItem } from "../types";

// The collapsed schedule-board card for an operation batch. An explicit
// variant of the operation card, not ItemCard with flags: a batch has its own
// anatomy (member rows, dissolve, MES link) and its own drag semantics
// (dragging it to another column reassigns the batch work center).
export function BatchItemCard({
  item,
  isOverlay
}: {
  item: BatchItem;
  isOverlay?: boolean;
}) {
  const { t } = useLingui();
  const fetcher = useFetcher();
  const isCompleting = item.batchStatus === "Completing";
  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging
  } = useSortable({
    id: item.id,
    data: { type: "item", item },
    attributes: { roleDescription: "item" },
    disabled: isCompleting
  });

  const style = {
    transition,
    transform: CSS.Translate.toString(transform)
  };

  const totalQty = item.members.reduce((sum, m) => sum + (m.quantity ?? 0), 0);

  const submitBatch = (fd: FormData) => {
    fetcher.submit(fd, {
      method: "post",
      action: path.to.scheduleBatchingUpdate
    });
  };

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className={cn(
        "max-w-[330px] bg-card hover:bg-muted/30 dark:border-none dark:shadow-[inset_0_0.5px_0_rgb(255_255_255_/_0.08),_inset_0_0_1px_rgb(255_255_255_/_0.24),_0_0_0_0.5px_rgb(0,0,0,1),0px_0px_4px_rgba(0,_0,_0,_0.08)]",
        isOverlay && "ring-2 ring-primary",
        isDragging && "ring-2 ring-primary opacity-30"
      )}
    >
      <CardHeader className="flex flex-col justify-between relative gap-2">
        <div className="flex w-full max-w-full justify-between items-start gap-0">
          <HStack spacing={2} className="min-w-0">
            <LuLayers className="text-muted-foreground size-4 flex-shrink-0" />
            <Badge>{item.batchReadableId}</Badge>
            {isCompleting && <Badge variant="yellow">{t`Completing`}</Badge>}
            <span className="text-xs tabular-nums text-muted-foreground whitespace-nowrap">
              {item.members.length} · {totalQty}
            </span>
          </HStack>
          <HStack spacing={1} className="flex-shrink-0 -mr-2">
            {!isCompleting && (
              <IconButton
                aria-label={t`Move batch`}
                icon={<LuGripVertical />}
                variant="ghost"
                {...attributes}
                {...listeners}
                className="cursor-grab"
              />
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  aria-label={t`More options`}
                  icon={<LuEllipsisVertical />}
                  variant="secondary"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem asChild>
                  <a href={path.to.external.mesBatch(item.batchId)}>
                    <DropdownMenuIcon icon={<LuPlay />} />
                    {t`Open in MES`}
                  </a>
                </DropdownMenuItem>
                {!isCompleting && (
                  <DropdownMenuItem
                    destructive
                    onClick={() => {
                      const fd = new FormData();
                      fd.set("intent", "dissolve");
                      fd.set("batchId", item.batchId);
                      submitBatch(fd);
                    }}
                  >
                    <DropdownMenuIcon icon={<LuTrash />} />
                    {t`Dissolve batch`}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </HStack>
        </div>
        {isCompleting && (
          <a
            href={path.to.external.mesBatch(item.batchId)}
            className="text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            {t`Completion in progress — retry in Shop Floor`}
          </a>
        )}
      </CardHeader>
      <CardContent className="gap-1.5 text-left text-sm">
        {item.members.map((m) => (
          <div
            key={m.id}
            className="group flex items-center justify-between gap-2 rounded-md border border-border/60 px-2 py-1.5"
          >
            <div className="min-w-0">
              <span className="block truncate text-xs font-medium">
                {m.jobReadableId}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {m.itemReadableId}
              </span>
            </div>
            <HStack spacing={1} className="flex-shrink-0">
              <span className="text-xs tabular-nums text-muted-foreground">
                {m.quantity ?? 0}
              </span>
              {!isCompleting && (
                <IconButton
                  aria-label={t`Remove from batch`}
                  icon={<LuX />}
                  variant="ghost"
                  size="sm"
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                  onClick={() => {
                    const fd = new FormData();
                    fd.set("intent", "remove");
                    fd.set("batchId", item.batchId);
                    fd.append("jobOperationIds", m.id);
                    submitBatch(fd);
                  }}
                />
              )}
            </HStack>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
