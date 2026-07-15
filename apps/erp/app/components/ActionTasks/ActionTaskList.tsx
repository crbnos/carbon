import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
  useDebounce,
  VStack
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { DragControls } from "framer-motion";
import { Reorder, useDragControls } from "framer-motion";
import { type ReactNode, useEffect, useState } from "react";
import { useFetcher } from "react-router";
import type { ListItem } from "~/types";
import { ActionTaskAddModal } from "./ActionTaskAddModal";
import type { ActionTaskStatus } from "./ActionTaskCard";
import { ActionTaskProgress } from "./ActionTaskProgress";

type ActionTaskRow = {
  id: string;
  sortOrder: number | null;
  status: ActionTaskStatus;
};

// The shared action-task list shell used by Quality issues and Change Orders:
// a collapsible card with a progress header, a drag-to-reorder list, and the
// "Add Actions" template picker. Entity specifics — how a row renders and where
// reorder/add post — are injected, so both surfaces share one implementation.
export function ActionTaskList<T extends ActionTaskRow>({
  tasks,
  renderItem,
  reorderAction,
  templates,
  onAdd,
  isAddSubmitting = false,
  addEmptyMessage,
  isDisabled = false,
  title
}: {
  tasks: T[];
  renderItem: (task: T, dragControls: DragControls) => ReactNode;
  reorderAction: string;
  // Add-from-template is opt-in: pass `onAdd` (and its templates) to show the
  // "Add Actions" picker. Omit it — as Change Orders do — and there's no add
  // affordance at all; the list is seeded elsewhere.
  templates?: ListItem[];
  onAdd?: (selectedIds: string[]) => void;
  isAddSubmitting?: boolean;
  addEmptyMessage?: string;
  isDisabled?: boolean;
  title?: ReactNode;
}) {
  const orderFetcher = useFetcher<{ success: boolean }>();

  const [sortOrder, setSortOrder] = useState<string[]>(() =>
    [...tasks]
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
      .map((t) => t.id)
  );

  useEffect(() => {
    setSortOrder(
      [...tasks]
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
        .map((t) => t.id)
    );
  }, [tasks]);

  const updateSortOrder = useDebounce(
    (updates: Record<string, number>) => {
      const formData = new FormData();
      formData.append("updates", JSON.stringify(updates));
      orderFetcher.submit(formData, { method: "post", action: reorderAction });
    },
    1000,
    true
  );

  const onReorder = (newOrder: string[]) => {
    if (isDisabled) return;
    const updates: Record<string, number> = {};
    newOrder.forEach((id, index) => {
      updates[id] = index + 1;
    });
    setSortOrder(newOrder);
    updateSortOrder(updates);
  };

  return (
    <Card className="w-full" isCollapsible>
      <HStack className="justify-between w-full">
        <CardHeader>
          <CardTitle>{title ?? <Trans>Actions</Trans>}</CardTitle>
        </CardHeader>
        {tasks.length > 0 && <ActionTaskProgress tasks={tasks} />}
      </HStack>
      <CardContent>
        <VStack spacing={3}>
          {tasks.length > 0 && (
            <Reorder.Group
              axis="y"
              values={sortOrder}
              onReorder={onReorder}
              className="w-full space-y-3"
            >
              {sortOrder.map((id) => {
                const task = tasks.find((t) => t.id === id);
                if (!task) return null;
                return (
                  <ReorderableItem
                    key={id}
                    task={task}
                    renderItem={renderItem}
                  />
                );
              })}
            </Reorder.Group>
          )}

          {!isDisabled && onAdd && (
            <ActionTaskAddModal
              templates={templates ?? []}
              onAdd={onAdd}
              isSubmitting={isAddSubmitting}
              emptyMessage={addEmptyMessage}
            />
          )}
        </VStack>
      </CardContent>
    </Card>
  );
}

function ReorderableItem<T extends ActionTaskRow>({
  task,
  renderItem
}: {
  task: T;
  renderItem: (task: T, dragControls: DragControls) => ReactNode;
}) {
  const dragControls = useDragControls();
  return (
    <Reorder.Item
      value={task.id}
      dragListener={false}
      dragControls={dragControls}
    >
      {renderItem(task, dragControls)}
    </Reorder.Item>
  );
}
