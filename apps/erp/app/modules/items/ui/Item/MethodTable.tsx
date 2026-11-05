// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAction } from "@carbon/query";
import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  Table,
  Td,
  Th,
  Thead,
  Tr,
  useThrottle
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Reorder, useDragControls } from "motion/react";
import type { ReactNode } from "react";
import { useState } from "react";
import {
  LuEllipsisVertical,
  LuGripVertical,
  LuPencil,
  LuSquareFunction,
  LuTrash
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { CompactEmpty } from "~/components/Table/components/Compact/CompactEmpty";
import type { PartMethodPage } from "../../items.service";
import {
  MethodLockHint,
  MethodPageToolbar,
  useMethodAccess,
  useMethodConfigurator
} from "./MethodPageFrame";

/** Row order, row selection and delete: what both method tables do alike. */
export function useMethodLines<
  T extends { id?: string | null; order: number }
>({
  lines,
  orderAction,
  deleteAction,
  isReadOnly
}: {
  lines: T[];
  orderAction: string;
  deleteAction: string;
  isReadOnly: boolean;
}) {
  const orderFetcher = useAction();
  const deleteFetcher = useAction();
  // Only the rows this session has reordered. Every other row takes its order
  // from the loaded data.
  const [orderState, setOrderState] = useState<Record<string, number>>({});
  const [checkedState, setCheckedState] = useState<Record<string, boolean>>({});

  const sorted = [...lines].sort(
    (a, b) => (orderState[a.id!] ?? a.order) - (orderState[b.id!] ?? b.order)
  );
  const ids = sorted.map((line) => line.id!);

  const saveOrder = useThrottle(
    (updates: Record<string, number>) => {
      const formData = new FormData();
      formData.append("updates", JSON.stringify(updates));
      orderFetcher.submit(formData, { method: "post", action: orderAction });
    },
    1000,
    true
  );

  return {
    sorted,
    ids,
    checkedIds: ids.filter((id) => checkedState[id]),
    isDeleting: deleteFetcher.state !== "idle",
    isChecked: (id: string) => !!checkedState[id],
    onToggle: (id: string) =>
      setCheckedState((prev) => ({ ...prev, [id]: !prev[id] })),
    onReorder: (next: string[]) => {
      if (isReadOnly) return;
      const updates = Object.fromEntries(next.map((id, i) => [id, i + 1]));
      setOrderState(updates);
      saveOrder(updates);
    },
    onRemove: (removed: string[]) => {
      if (isReadOnly || removed.length === 0) return;
      const formData = new FormData();
      for (const id of removed) formData.append("id", id);
      deleteFetcher.submit(formData, { method: "post", action: deleteAction });
      setCheckedState((prev) =>
        Object.fromEntries(
          Object.entries(prev).filter(([id]) => !removed.includes(id))
        )
      );
    }
  };
}

export type MethodLines = ReturnType<typeof useMethodLines>;

export function MethodTable({
  page,
  title,
  addLabel,
  onAdd,
  lines,
  emptyIcon,
  emptyHeading,
  emptyDescription,
  configureField,
  configureLabel,
  configureOptions,
  head,
  children
}: {
  page: PartMethodPage;
  title: ReactNode;
  addLabel: ReactNode;
  onAdd: () => void;
  lines: MethodLines;
  emptyIcon: ReactNode;
  emptyHeading: ReactNode;
  emptyDescription: ReactNode;
  /** The rule field the card editors write, so existing rules keep applying. */
  configureField: string;
  configureLabel: string;
  configureOptions: string[];
  head: ReactNode;
  children: ReactNode;
}) {
  const { t } = useLingui();
  const { isReadOnly } = useMethodAccess(page);
  const { onConfigure, rulesByField, editor } = useMethodConfigurator(page);

  return (
    <div className="flex w-full flex-col gap-4 p-4">
      <MethodPageToolbar page={page} />
      <Card>
        <div className="flex items-center justify-between">
          <CardHeader className="min-w-0">
            <CardTitle className="flex flex-row items-center gap-2">
              {title}
              <MethodLockHint page={page} />
            </CardTitle>
          </CardHeader>
          <CardAction>
            <div className="flex items-center gap-2">
              {lines.checkedIds.length > 0 && (
                <Button
                  variant="destructive"
                  leftIcon={<LuTrash />}
                  isDisabled={isReadOnly}
                  isLoading={lines.isDeleting}
                  onClick={() => lines.onRemove(lines.checkedIds)}
                >
                  <Trans>Delete Selected</Trans>
                </Button>
              )}
              <Button
                variant="secondary"
                isDisabled={isReadOnly}
                onClick={onAdd}
              >
                {addLabel}
              </Button>
              {page.configurable && lines.ids.length > 0 && (
                <IconButton
                  icon={<LuSquareFunction />}
                  aria-label={t`Configure`}
                  variant="ghost"
                  className={cn(
                    rulesByField.has(configureField) &&
                      "text-emerald-500 hover:text-emerald-500"
                  )}
                  onClick={() =>
                    onConfigure({
                      label: configureLabel,
                      field: configureField,
                      code: rulesByField.get(configureField)?.code,
                      returnType: {
                        type: "list",
                        listOptions: configureOptions
                      }
                    })
                  }
                />
              )}
            </div>
          </CardAction>
        </div>
        <CardContent className="@container">
          {lines.ids.length === 0 ? (
            <CompactEmpty
              className="py-10"
              icon={emptyIcon}
              heading={emptyHeading}
              description={emptyDescription}
              primaryAction={
                <Button
                  variant="secondary"
                  isDisabled={isReadOnly}
                  onClick={onAdd}
                >
                  {addLabel}
                </Button>
              }
            />
          ) : (
            <div className="w-full overflow-x-auto">
              <Table full>
                <Thead>
                  <Tr>
                    {!isReadOnly && <Th className="w-16 px-2" />}
                    {head}
                    <Th className="w-10 px-2" />
                  </Tr>
                </Thead>
                <Reorder.Group
                  as="tbody"
                  axis="y"
                  values={lines.ids}
                  onReorder={lines.onReorder}
                >
                  {children}
                </Reorder.Group>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
      {editor}
    </div>
  );
}

export function MethodTableRow({
  id,
  to,
  lines,
  isReadOnly,
  children
}: {
  id: string;
  to: string;
  lines: MethodLines;
  isReadOnly: boolean;
  children: ReactNode;
}) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const dragControls = useDragControls();

  return (
    <Reorder.Item
      as="tr"
      value={id}
      dragListener={false}
      dragControls={dragControls}
      className="group cursor-pointer border-b border-border last:border-0 hover:bg-muted/50"
      onClick={() => navigate(to)}
    >
      {!isReadOnly && (
        <Td className="px-2" onClick={(event) => event.stopPropagation()}>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label={t`Reorder`}
              className="cursor-grab touch-none text-muted-foreground"
              onPointerDown={(event) => dragControls.start(event)}
            >
              <LuGripVertical className="size-4" />
            </button>
            <Checkbox
              aria-label={t`Select`}
              checked={lines.isChecked(id)}
              onCheckedChange={() => lines.onToggle(id)}
            />
          </div>
        </Td>
      )}
      {children}
      <Td className="px-2" onClick={(event) => event.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              aria-label={t`Actions`}
              icon={<LuEllipsisVertical />}
              variant="ghost"
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => navigate(to)}>
              <DropdownMenuIcon icon={<LuPencil />} />
              {isReadOnly ? <Trans>View</Trans> : <Trans>Edit</Trans>}
            </DropdownMenuItem>
            <DropdownMenuItem
              destructive
              disabled={isReadOnly}
              onClick={() => lines.onRemove([id])}
            >
              <DropdownMenuIcon icon={<LuTrash />} />
              <Trans>Delete</Trans>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Td>
    </Reorder.Item>
  );
}
