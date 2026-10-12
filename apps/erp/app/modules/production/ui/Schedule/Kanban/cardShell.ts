// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// The shared visual shell for every schedule-board card (operation, job, batch):
// card background, hover, and the dark-mode elevated-surface shadow. Kept in one
// place so the batch card is visually locked to the operation/job cards instead
// of re-declaring the shadow string. (The same token appears on other surfaces
// across the app via @carbon/react primitives; unifying it into a Tailwind
// utility is a separate, app-wide change.)
export const KANBAN_CARD_SHELL =
  "bg-card hover:bg-muted/30 dark:border-none dark:shadow-[inset_0_0.5px_0_rgb(255_255_255_/_0.08),_inset_0_0_1px_rgb(255_255_255_/_0.24),_0_0_0_0.5px_rgb(0,0,0,1),0px_0px_4px_rgba(0,_0,_0,_0.08)]";

type Sortable = ReturnType<typeof useSortable>;

/**
 * What a card's body needs from `useSortable`, as values `memo` can compare.
 *
 * A card is a thin shell that calls `useSortable` and a memoized body that
 * takes these as props. dnd-kit re-renders every sortable whenever the drop
 * target changes; with the hook inside the body, every card on the board
 * rendered in full on each change (a form, avatars and menus per card) and a
 * drag stuttered. Now only the cards that move or change drag state do.
 */
export type SortableCardProps = {
  setNodeRef: Sortable["setNodeRef"];
  attributes: Sortable["attributes"];
  listeners: Sortable["listeners"];
  transform: string | undefined;
  transition: string | undefined;
  isDragging: boolean;
};

export const sortableCardProps = (sortable: Sortable): SortableCardProps => ({
  setNodeRef: sortable.setNodeRef,
  attributes: sortable.attributes,
  listeners: sortable.listeners,
  transform: CSS.Translate.toString(sortable.transform),
  transition: sortable.transition,
  isDragging: sortable.isDragging
});
