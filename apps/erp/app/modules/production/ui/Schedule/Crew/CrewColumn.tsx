import { Badge, cn, ScrollArea, ScrollBar } from "@carbon/react";
import { SortableContext, useSortable } from "@dnd-kit/sortable";
import { Trans } from "@lingui/react/macro";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CardEditorContext, CrewCardItem } from "./CrewCard";
import { CrewCard, cardId } from "./CrewCard";
import { UNASSIGNED } from "./crewShared";

export type CardHandlers = {
  onOpen: (item: CrewCardItem) => void;
};

export function CrewColumn({
  id,
  title,
  items,
  isDisabled,
  sticky = false,
  editor,
  cardHandlers
}: {
  id: string;
  title: string;
  items: CrewCardItem[];
  isDisabled: boolean;
  sticky?: boolean;
  editor: CardEditorContext;
  cardHandlers: CardHandlers;
}) {
  const { setNodeRef } = useSortable({
    id,
    data: { type: "column", column: { id, title } },
    // draggable only — a boolean would ALSO disable the droppable, making
    // empty columns dead drop targets (dnd-kit normalizes true to both)
    disabled: { draggable: true, droppable: false }
  });
  const elementRef = useRef<HTMLDivElement | null>(null);
  const [isScrolled, setIsScrolled] = useState(false);

  // shadow only once the board is actually scrolled — at rest the sticky
  // column sits flush and needs no separation
  useEffect(() => {
    if (!sticky) return;
    const viewport = elementRef.current?.closest(
      "[data-radix-scroll-area-viewport]"
    );
    if (!viewport) return;
    const onScroll = () => setIsScrolled(viewport.scrollLeft > 0);
    onScroll();
    viewport.addEventListener("scroll", onScroll, { passive: true });
    return () => viewport.removeEventListener("scroll", onScroll);
  }, [sticky]);
  const itemIds = useMemo(() => items.map((item) => cardId(item)), [items]);
  const headcount = items.filter((item) => !item.isAbsent).length;

  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        elementRef.current = node;
      }}
      className={cn(
        "w-[300px] max-w-full flex flex-col flex-shrink-0 snap-center rounded-none bg-card/30 border-0 border-r h-[calc(100dvh-var(--header-height)*2)]",
        sticky && "sticky left-0 z-10 bg-card transition-shadow",
        sticky && isScrolled && "shadow-[6px_0_12px_-6px_rgba(0,0,0,0.15)]"
      )}
    >
      <div className="p-4 w-full font-semibold text-left flex flex-row items-center sticky top-0 z-1 border-b bg-card">
        <span className="mr-auto truncate">{title}</span>
        <Badge variant="secondary">{headcount}</Badge>
      </div>
      <ScrollArea className="flex-grow">
        <SortableContext items={itemIds}>
          <div className="flex flex-col gap-2 p-2">
            {items.map((item) => (
              <CrewCard
                key={cardId(item)}
                item={item}
                editor={editor}
                isDisabled={isDisabled}
                {...cardHandlers}
              />
            ))}
            {/* the dashed box doubles as the drop affordance — an empty
                station should still look like somewhere you can drop */}
            {items.length === 0 && (
              <div className="flex items-center justify-center rounded-md border border-dashed border-border py-8 text-xs text-muted-foreground">
                {id === UNASSIGNED ? (
                  <Trans>No one to assign</Trans>
                ) : (
                  <Trans>No one crewed</Trans>
                )}
              </div>
            )}
          </div>
        </SortableContext>
        <ScrollBar orientation="vertical" />
      </ScrollArea>
    </div>
  );
}
