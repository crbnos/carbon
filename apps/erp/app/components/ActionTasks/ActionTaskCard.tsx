import {
  Button,
  cn,
  generateHTML,
  HStack,
  IconButton,
  type JSONContent,
  useDisclosure
} from "@carbon/react";
import { Editor } from "@carbon/react/Editor";
import { useLingui } from "@lingui/react/macro";
import type { DragControls } from "framer-motion";
import type { ReactElement, ReactNode } from "react";
import {
  LuChevronRight,
  LuCircleCheck,
  LuCirclePlay,
  LuGripVertical,
  LuLoaderCircle
} from "react-icons/lu";
import Assignee from "~/components/Assignee";

export type ActionTaskStatus =
  | "Pending"
  | "In Progress"
  | "Completed"
  | "Skipped";

// The Start/Complete/Reopen transition, shared by every action-task surface
// (Quality issues + Change Orders).
export const actionTaskStatusActions: Record<
  ActionTaskStatus,
  { action: string; icon: ReactElement; next: ActionTaskStatus }
> = {
  Pending: { action: "Start", icon: <LuCirclePlay />, next: "In Progress" },
  "In Progress": {
    action: "Complete",
    icon: <LuCircleCheck />,
    next: "Completed"
  },
  Completed: { action: "Reopen", icon: <LuLoaderCircle />, next: "Pending" },
  Skipped: { action: "Reopen", icon: <LuLoaderCircle />, next: "Pending" }
};

// The single, shared presentational card for an action task — used by both the
// Quality issue actions and the Change Order actions so the two look identical.
// Purely presentational: persistence (notes save, status route, integrations)
// lives in the calling wrapper and is threaded in via callbacks + slots.
export function ActionTaskCard({
  title,
  status,
  notes,
  canEditNotes,
  onNotesChange,
  onUploadImage,
  onStatusChange,
  assigneeTable,
  assigneeId,
  assignee,
  statusBadge,
  headerExtras,
  footerExtras,
  isDisabled = false,
  showDragHandle = false,
  dragControls
}: {
  title: string;
  status: ActionTaskStatus;
  notes: JSONContent;
  canEditNotes: boolean;
  onNotesChange?: (value: JSONContent) => void;
  onUploadImage?: (file: File) => Promise<string>;
  onStatusChange: (next: ActionTaskStatus) => void;
  assigneeTable: string;
  assigneeId: string;
  assignee?: string;
  // Slots for entity-specific bits: statusBadge (left of assignee), headerExtras
  // (left of the collapse chevron — e.g. Linear/Jira or a delete button), and
  // footerExtras (right of the assignee — e.g. due date / processes / supplier).
  statusBadge?: ReactNode;
  headerExtras?: ReactNode;
  footerExtras?: ReactNode;
  isDisabled?: boolean;
  showDragHandle?: boolean;
  dragControls?: DragControls;
}) {
  const { t } = useLingui();
  const disclosure = useDisclosure({ defaultIsOpen: true });
  const statusAction = actionTaskStatusActions[status];
  const isComplete = status === "Completed" || status === "Skipped";

  return (
    <div className="rounded-lg border w-full flex flex-col bg-card">
      <div className="flex w-full justify-between px-4 py-2 items-center">
        <div className="flex flex-col flex-1">
          <span
            className={cn(
              "text-base font-semibold tracking-tight",
              isComplete && "line-through text-muted-foreground"
            )}
          >
            {title}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {showDragHandle && !isDisabled && dragControls && (
            <button
              type="button"
              className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground transition-colors p-1"
              onPointerDown={(e) => dragControls.start(e)}
            >
              <LuGripVertical size={16} />
            </button>
          )}
          {headerExtras}
          <IconButton
            icon={<LuChevronRight />}
            variant="ghost"
            onClick={disclosure.onToggle}
            aria-label={t`Open task details`}
            className={cn(disclosure.isOpen && "rotate-90")}
          />
        </div>
      </div>

      {disclosure.isOpen && (
        <div className="px-4 py-2 rounded">
          {canEditNotes ? (
            <Editor
              className="w-full min-h-[100px]"
              initialValue={notes}
              onUpload={onUploadImage}
              onChange={(value) => onNotesChange?.(value)}
            />
          ) : (
            <div
              className="prose dark:prose-invert"
              dangerouslySetInnerHTML={{ __html: generateHTML(notes) }}
            />
          )}
        </div>
      )}

      <div className="bg-muted/30 border-t px-4 py-2 flex justify-between w-full">
        <HStack>
          {statusBadge}
          <Assignee
            table={assigneeTable}
            id={assigneeId}
            size="sm"
            value={assignee}
            disabled={isDisabled}
          />
          {footerExtras}
        </HStack>
        <HStack>
          <Button
            isDisabled={isDisabled}
            leftIcon={statusAction.icon}
            variant="secondary"
            size="sm"
            onClick={() => onStatusChange(statusAction.next)}
          >
            {statusAction.action}
          </Button>
        </HStack>
      </div>
    </div>
  );
}
