// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

"use client";

import {
  BottomSheet,
  BottomSheetBody,
  BottomSheetContent,
  BottomSheetHeader,
  BottomSheetTitle,
  Button,
  Checkbox,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  cn,
  HStack,
  IconButton,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  useViewport
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  AnimatePresence,
  LayoutGroup,
  motion,
  Reorder,
  useDragControls
} from "motion/react";
import type { ReactNode } from "react";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState
} from "react";
import { flushSync } from "react-dom";
import {
  LuArrowDown,
  LuArrowUp,
  LuGripVertical,
  LuPencil,
  LuSettings2,
  LuTrash,
  LuX
} from "react-icons/lu";
import Empty from "./Empty";

export interface Item {
  checked: boolean;
  details?: ReactNode;
  footer?: ReactNode;
  id: string;
  isTemporary?: boolean;
  /** The line's readable name ("P-000123") for its controls' labels, when
   *  `title` is not plain text. */
  name?: string;
  order?: "With Previous" | "After Previous";
  title: ReactNode;
}

interface SortableItem<T> extends Item {
  data: T;
}

/**
 * Phones: what a row's edit sheet needs from its row — the sheet is rendered
 * by the editor (`SortableListItemPanel`), the row owns its title and delete.
 */
const PhoneRowContext = createContext<{
  title: ReactNode;
  onClose: () => void;
  onDelete?: () => void;
} | null>(null);

/**
 * The list's reorder callback, so a row can move itself without a drag —
 * keyboard and assistive tech reorder through the same path as the pointer.
 */
const ReorderContext = createContext<{
  items: Item[];
  onReorder: (items: Item[]) => void;
  /** The list's name ("Bill of Materials"), so two lists' move buttons on
   *  one page are told apart. */
  label?: string;
  /** Says a move in the list's polite live region. */
  announce: (message: string) => void;
} | null>(null);

function moveItem<T>(items: T[], from: number, to: number): T[] {
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

interface SortableListItemProps<T> {
  item: SortableItem<T>;
  items: SortableItem<T>[];
  order: number;
  onSelectItem: (id: string | null) => void;
  onToggleItem: (id: string) => void;
  onRemoveItem: (id: string) => void;
  renderExtra?: (item: SortableItem<T>) => React.ReactNode;
  isExpanded?: boolean;
  isHighlighted?: boolean;
  className?: string;
  handleDrag: () => void;
  isReadOnly?: boolean;
  /** Phones: extra items for the row's press-and-hold menu. */
  menuItems?: ReactNode;
}

function SortableListItem<T>({
  item,
  items,
  order,
  onSelectItem,
  onToggleItem,
  onRemoveItem,
  renderExtra,
  handleDrag,
  isExpanded,
  isHighlighted,
  className,
  isReadOnly = false,
  menuItems
}: SortableListItemProps<T>) {
  const { t } = useLingui();
  const { isPhone } = useViewport();
  const [isDragging, setIsDragging] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const isDraggable = !isExpanded && !isReadOnly;
  const dragControls = useDragControls();
  const itemRef = useRef<HTMLDivElement>(null);
  const moveUpRef = useRef<HTMLButtonElement>(null);
  const moveDownRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const reorder = useContext(ReorderContext);
  const index = reorder?.items.findIndex((i) => i.id === item.id) ?? -1;
  const canReorder = !!reorder && index >= 0 && !isReadOnly;
  const canMoveUp = canReorder && index > 0;
  const canMoveDown = canReorder && index < (reorder?.items.length ?? 0) - 1;
  const position = order + 1;
  const itemName =
    item.name?.trim() ||
    (typeof item.title === "string" && item.title.trim()
      ? item.title
      : t`line ${position}`);
  const listLabel = reorder?.label;
  const moveUpLabel = listLabel
    ? t`Move ${itemName} up in ${listLabel}`
    : t`Move ${itemName} up`;
  const moveDownLabel = listLabel
    ? t`Move ${itemName} down in ${listLabel}`
    : t`Move ${itemName} down`;
  const reorderLabel = listLabel
    ? t`Reorder ${itemName} in ${listLabel}`
    : t`Reorder ${itemName}`;

  const move = (delta: -1 | 1, focusTarget?: HTMLElement | null) => {
    if (!reorder || !canReorder) return;
    const to = index + delta;
    if (to < 0 || to >= reorder.items.length) return;
    handleDrag();
    reorder.onReorder(moveItem(reorder.items, index, to));
    const newPosition = to + 1;
    reorder.announce(t`Moved ${itemName} to position ${newPosition}`);
    // Moving the row re-inserts its node, which drops focus.
    if (focusTarget) requestAnimationFrame(() => focusTarget.focus());
  };

  // Alt+ArrowUp / Alt+ArrowDown on the focused row moves it.
  const handleMoveKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (!event.altKey) return;
    if (event.key === "ArrowUp" && canMoveUp) {
      event.preventDefault();
      move(-1, event.currentTarget);
    } else if (event.key === "ArrowDown" && canMoveDown) {
      event.preventDefault();
      move(1, event.currentTarget);
    }
  };

  const handleDragStart = (event: any) => {
    if (isExpanded || isReadOnly) return;
    flushSync(() => setIsDragging(true));
    dragControls.start(event, { snapToCursor: true });
    handleDrag();
  };

  const handleDragEnd = () => {
    setIsDragging(false);
  };

  // Scroll into view when highlighted
  useEffect(() => {
    if (isHighlighted && itemRef.current) {
      itemRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest"
      });
    }
  }, [isHighlighted]);

  if (isPhone) {
    // Phones: a flat row. Tapping it opens the editor in a sheet, holding it
    // opens its menu, and only the grip reorders — a drag anywhere on the
    // card would fight the page's scroll.
    const onDelete = isReadOnly ? undefined : () => setIsConfirmingDelete(true);
    return (
      <Reorder.Item
        as="div"
        value={item}
        ref={itemRef}
        dragListener={false}
        dragControls={dragControls}
        onDragEnd={handleDragEnd}
        className={cn(
          "relative flex items-start gap-3 py-3 pr-1 pl-4",
          isDragging && "z-10 rounded-lg bg-card shadow-lg",
          isHighlighted &&
            "bg-primary/5 shadow-[inset_3px_0_0_hsl(var(--primary))]",
          className
        )}
      >
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              role="button"
              tabIndex={0}
              className="flex min-w-0 flex-1 items-start gap-3 text-left"
              onClick={() => onSelectItem(item.id)}
              aria-keyshortcuts={
                canReorder ? "Alt+ArrowUp Alt+ArrowDown" : undefined
              }
              onKeyDown={(event) => {
                // Enter on a link or button in the title or footer is
                // that control's own, not the row's.
                if (
                  event.key === "Enter" &&
                  event.target === event.currentTarget
                ) {
                  onSelectItem(item.id);
                }
                handleMoveKeyDown(event);
              }}
            >
              <span
                className={cn(
                  "mt-px flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-muted/50 text-xs font-medium tabular-nums text-muted-foreground",
                  item.order === "With Previous" &&
                    "border-dashed bg-transparent"
                )}
              >
                {getParallelizedOrder(order, item, items)}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                {item.title}
                {item.details}
                {item.footer && (
                  // The footer's own controls act in place.
                  // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: only stops the footer's own controls from also selecting the row; not a control
                  <div
                    className="-ml-1 flex flex-wrap items-center gap-1"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {item.footer}
                  </div>
                )}
              </div>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onClick={() => onSelectItem(item.id)}>
              <LuPencil className="mr-2 h-4 w-4" />
              {isReadOnly ? <Trans>View</Trans> : <Trans>Edit</Trans>}
            </ContextMenuItem>
            {canMoveUp && (
              <ContextMenuItem onClick={() => move(-1)}>
                <LuArrowUp className="mr-2 h-4 w-4" />
                <Trans>Move up</Trans>
              </ContextMenuItem>
            )}
            {canMoveDown && (
              <ContextMenuItem onClick={() => move(1)}>
                <LuArrowDown className="mr-2 h-4 w-4" />
                <Trans>Move down</Trans>
              </ContextMenuItem>
            )}
            {menuItems}
            {onDelete && (
              <ContextMenuItem destructive onClick={onDelete}>
                <LuTrash className="mr-2 h-4 w-4" />
                <Trans>Delete</Trans>
              </ContextMenuItem>
            )}
          </ContextMenuContent>
        </ContextMenu>
        {!isReadOnly && (
          <button
            type="button"
            aria-label={reorderLabel}
            aria-keyshortcuts="ArrowUp ArrowDown"
            className="-mt-2.5 flex h-11 w-10 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground active:cursor-grabbing"
            onKeyDown={(event) => {
              if (event.key === "ArrowUp" && canMoveUp) {
                event.preventDefault();
                move(-1, event.currentTarget);
              } else if (event.key === "ArrowDown" && canMoveDown) {
                event.preventDefault();
                move(1, event.currentTarget);
              }
            }}
            onPointerDown={(event) => {
              flushSync(() => setIsDragging(true));
              handleDrag();
              dragControls.start(event);
            }}
          >
            <LuGripVertical className="size-5" />
          </button>
        )}
        <PhoneRowContext.Provider
          value={{
            title: item.title,
            onClose: () => onSelectItem(null),
            onDelete
          }}
        >
          {renderExtra?.(item)}
        </PhoneRowContext.Provider>
        {isConfirmingDelete && (
          <Modal
            open
            onOpenChange={(open) => {
              if (!open) setIsConfirmingDelete(false);
            }}
          >
            <ModalOverlay />
            <ModalContent>
              <ModalHeader>
                <ModalTitle>
                  <Trans>Delete this line?</Trans>
                </ModalTitle>
              </ModalHeader>
              <ModalBody>
                <p className="text-sm text-muted-foreground">
                  <Trans>This cannot be undone.</Trans>
                </p>
              </ModalBody>
              <ModalFooter>
                <Button
                  variant="secondary"
                  onClick={() => setIsConfirmingDelete(false)}
                >
                  <Trans>Cancel</Trans>
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => {
                    setIsConfirmingDelete(false);
                    onRemoveItem(item.id);
                  }}
                >
                  <Trans>Delete</Trans>
                </Button>
              </ModalFooter>
            </ModalContent>
          </Modal>
        )}
      </Reorder.Item>
    );
  }

  return (
    <div className={cn("", className)} key={item.id} ref={itemRef}>
      <div className="flex w-full items-center">
        <Reorder.Item
          value={item}
          className={cn(
            "relative z-auto grow",
            "h-full rounded-md bg-accent/30 dark:bg-background/40",
            "border border-border rounded-lg ",
            !isExpanded && !isReadOnly && "cursor-grab",
            isHighlighted && "border-2 border-primary",
            item.checked && !isDragging ? "w-7/10" : "w-full"
          )}
          key={item.id}
          dragListener={!item.checked && !isExpanded && !isReadOnly}
          dragControls={dragControls}
          onDragEnd={handleDragEnd}
          style={{
            zIndex: isExpanded ? 9999 : undefined,
            position: "relative",
            overflow: "hidden"
          }}
          whileDrag={{ zIndex: 9999 }}
        >
          <div className={cn(isExpanded ? "w-full" : "", "z-20 ")}>
            <motion.div className="w-full py-3 px-3" layout="position">
              <div className="flex flex-col items-center justify-between w-full">
                <div className="flex flex-col w-full">
                  <div className="flex w-full items-center gap-x-2 truncate pl-3">
                    {/* List Remove Actions */}
                    {!isReadOnly && (
                      <Checkbox
                        checked={item.checked}
                        id={`checkbox-${item.id}`}
                        aria-label={t`Mark ${itemName} to delete`}
                        onCheckedChange={() => onToggleItem(item.id)}
                        className="border-foreground/20 bg-background/30 data-[state=checked]:bg-background data-[state=checked]:text-red-200 flex flex-shrink-0 "
                      />
                    )}
                    {/* List Order */}
                    <p className="font-medium text-xs pl-1 text-foreground/50 flex flex-shrink-0">
                      {getParallelizedOrder(order, item, items)}
                    </p>

                    <div
                      key={`${item.checked}`}
                      className="px-1 flex flex-grow truncate"
                    >
                      <HStack
                        className={cn(
                          "w-full justify-between pr-8 max-md:flex-wrap max-md:gap-y-1",
                          !isReadOnly && "cursor-grab"
                        )}
                      >
                        {/* List Title */}
                        {typeof item.title === "string" ? (
                          <button
                            type="button"
                            aria-keyshortcuts={
                              canReorder
                                ? "Alt+ArrowUp Alt+ArrowDown"
                                : undefined
                            }
                            onKeyDown={handleMoveKeyDown}
                            className={cn(
                              "flex min-w-0 font-medium text-sm md:text-base truncate text-left hover:underline cursor-pointer",
                              item.checked ? "text-red-400" : "text-foreground"
                            )}
                            onClick={(e) => {
                              if (!isDragging) {
                                onSelectItem(item.id);
                              }
                            }}
                          >
                            {item.title}
                          </button>
                        ) : (
                          // A rich title can hold its own link (a BOM row's
                          // item link), which a button must not contain. So
                          // the select button is stretched under the title,
                          // named by it, and the title's own links and
                          // buttons sit above it.
                          <div
                            className={cn(
                              "relative min-w-0 flex-1",
                              item.checked && "text-red-400"
                            )}
                          >
                            <button
                              type="button"
                              aria-labelledby={titleId}
                              aria-keyshortcuts={
                                canReorder
                                  ? "Alt+ArrowUp Alt+ArrowDown"
                                  : undefined
                              }
                              onKeyDown={handleMoveKeyDown}
                              onClick={() => {
                                if (!isDragging) {
                                  onSelectItem(item.id);
                                }
                              }}
                              className="absolute inset-0 cursor-pointer rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            />
                            <div
                              id={titleId}
                              className="[&_a]:relative [&_a]:z-10 [&_button]:relative [&_button]:z-10"
                            >
                              {item.title}
                            </div>
                          </div>
                        )}

                        {item.details && (
                          <div className="flex flex-shrink-0 max-md:basis-full max-md:flex-wrap max-md:[&>*]:flex-wrap">
                            {item.details}
                          </div>
                        )}
                      </HStack>
                    </div>
                  </div>
                </div>

                {/* List Item Children */}
              </div>
              {renderExtra && renderExtra(item)}
            </motion.div>
            {item.footer && (
              <div className="flex w-full items-center border-t border-border px-3 py-2">
                {item.footer}
              </div>
            )}
          </div>
          {canReorder && !isExpanded && (
            // Keyboard and assistive-tech reorder: hidden until focused so
            // the pointer layout is unchanged; the drag stays the mouse path.
            // pointer-events-none until focused, so a mouse click on the
            // invisible strip never moves the line.
            <div className="pointer-events-none absolute right-10 top-2.5 z-10 flex gap-1 opacity-0 focus-within:pointer-events-auto focus-within:opacity-100">
              <IconButton
                ref={moveUpRef}
                aria-label={moveUpLabel}
                icon={<LuArrowUp />}
                variant="secondary"
                size="sm"
                isDisabled={!canMoveUp}
                // Landing on the first slot disables this button; keep focus
                // on the sibling instead of dropping it to the page.
                onClick={(event) =>
                  move(
                    -1,
                    index - 1 === 0 ? moveDownRef.current : event.currentTarget
                  )
                }
              />
              <IconButton
                ref={moveDownRef}
                aria-label={moveDownLabel}
                icon={<LuArrowDown />}
                variant="secondary"
                size="sm"
                isDisabled={!canMoveDown}
                onClick={(event) =>
                  move(
                    1,
                    index + 1 === (reorder?.items.length ?? 0) - 1
                      ? moveUpRef.current
                      : event.currentTarget
                  )
                }
              />
            </div>
          )}
          {!isReadOnly && (
            <div
              onPointerDown={isDraggable ? handleDragStart : undefined}
              style={{ touchAction: "none" }}
            />
          )}
        </Reorder.Item>
        {/* List Delete Action Animation */}

        {!isReadOnly && item.checked ? (
          <div className="h-[1.5rem] w-3" />
        ) : null}

        {!isReadOnly && item.checked ? (
          <div className="inset-0 z-0 rounded-full bg-card border-border border dark:shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_0_0_1px_rgba(255,255,255,0.03)_inset,0_0_0_1px_rgba(0,0,0,0.1),0_2px_2px_0_rgba(0,0,0,0.1),0_4px_4px_0_rgba(0,0,0,0.1),0_8px_8px_0_rgba(0,0,0,0.1)] dark:bg-[#161716]/50">
            <button
              type="button"
              aria-label={t`Delete`}
              className="inline-flex h-10 items-center justify-center space-nowrap rounded-md px-3 text-sm font-medium  transition-colors duration-150  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
              onClick={() => onRemoveItem(item.id)}
            >
              <LuTrash className="h-4 w-4 text-red-400 transition-colors duration-150 fill-red-400/60 " />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function SortableListItemToggle({
  isOpen,
  onToggle,
  className,
  name
}: {
  isOpen: boolean;
  onToggle: () => void;
  className?: string;
  /** The line's name, so each row's toggle is told apart ("Edit P-000123"). */
  name?: string;
}) {
  const { t } = useLingui();
  // Phones open a row by tapping it; its sheet has its own close.
  if (useContext(PhoneRowContext)) return null;
  return (
    <button
      type="button"
      aria-label={
        name
          ? isOpen
            ? t`Close ${name}`
            : t`Edit ${name}`
          : isOpen
            ? t`Close`
            : t`Edit`
      }
      aria-expanded={isOpen}
      onClick={onToggle}
      className={cn(
        "absolute right-3 top-3 z-10 max-md:after:absolute max-md:after:-inset-3",
        className
      )}
    >
      {isOpen ? (
        <LuX className="h-5 w-5 text-foreground" />
      ) : (
        <LuSettings2 className="stroke-1 h-5 w-5 text-foreground/80 hover:stroke-primary/70" />
      )}
    </button>
  );
}

export function SortableListItemPanel({
  isOpen,
  children
}: {
  isOpen: boolean;
  children: ReactNode;
}) {
  const { t } = useLingui();
  const phoneRow = useContext(PhoneRowContext);
  if (phoneRow) {
    return (
      <BottomSheet
        open={isOpen}
        onOpenChange={(open) => {
          if (!open) phoneRow.onClose();
        }}
      >
        <BottomSheetContent size="full">
          <BottomSheetHeader className="max-md:justify-start">
            {phoneRow.onDelete && (
              <IconButton
                aria-label={t`Delete`}
                icon={<LuTrash />}
                variant="ghost"
                className="absolute left-1 top-1/2 size-11 -translate-y-1/2 text-red-500"
                onClick={phoneRow.onDelete}
              />
            )}
            <BottomSheetTitle asChild>
              <div className="min-w-0 text-left">{phoneRow.title}</div>
            </BottomSheetTitle>
          </BottomSheetHeader>
          <BottomSheetBody>{children}</BottomSheetBody>
        </BottomSheetContent>
      </BottomSheet>
    );
  }
  return (
    <AnimatePresence initial={false}>
      {isOpen ? (
        <motion.div
          key="panel"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
          className="flex w-full flex-col overflow-hidden"
        >
          <div className="w-full p-2">{children}</div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export type SortableItemRenderProps<T extends Item> = {
  item: T;
  items: T[];
  order: number;
  onToggleItem: (id: string) => void;
  onRemoveItem: (id: string) => void;
};

interface SortableListProps<T extends Item> {
  items: T[];
  onToggleItem: (id: string) => void;
  onRemoveItem: (id: string) => void;
  onReorder: (items: T[]) => void;
  renderItem: (props: SortableItemRenderProps<T>) => React.ReactNode;
  isReadOnly?: boolean;
  emptyState?: React.ReactNode;
  /** The list's name ("Bill of Materials"): names its move buttons when two
   *  lists share a page. */
  label?: string;
}

function SortableList<T extends Item>({
  items,
  onRemoveItem,
  onToggleItem,
  onReorder,
  renderItem,
  isReadOnly = false,
  emptyState,
  label
}: SortableListProps<T>) {
  const { isPhone } = useViewport();
  const [announcement, setAnnouncement] = useState("");
  if (items && Array.isArray(items) && items.length > 0) {
    return (
      <LayoutGroup>
        <ReorderContext.Provider
          value={
            isReadOnly
              ? null
              : {
                  items,
                  onReorder: onReorder as (items: Item[]) => void,
                  label,
                  announce: setAnnouncement
                }
          }
        >
          <div role="status" aria-live="polite" className="sr-only">
            {announcement}
          </div>
          <Reorder.Group
            axis="y"
            values={items}
            // biome-ignore lint/suspicious/noEmptyBlockStatements: suppressed due to migration
            onReorder={isReadOnly ? () => {} : onReorder}
            className={cn(
              "flex flex-col gap-2",
              // Phones: flat rows edge to edge in the card.
              isPhone && "-mx-4 -mb-4 gap-0 divide-y divide-border first:-mt-4"
            )}
          >
            {items?.map((item, index) =>
              renderItem({
                item,
                items,
                order: index,
                onToggleItem,
                onRemoveItem
              })
            )}
          </Reorder.Group>
        </ReorderContext.Provider>
      </LayoutGroup>
    );
  } else {
    return <>{emptyState ?? <Empty />}</>;
  }
}

SortableList.displayName = "SortableList";

export { SortableList, SortableListItem };

function getParallelizedOrder(index: number, item: Item, items: Item[]) {
  if (item?.order !== "With Previous") return index + 1;
  for (let i = index - 1; i >= 0; i--) {
    if (items[i].order !== "With Previous") {
      return i + 1;
    }
  }
  return 1;
}
